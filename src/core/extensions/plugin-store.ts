// STORE-API (Hive #5): `context.store`. Rust holds it in plugin-store.db; in
// the dev mock, the headless checks, and for a plugin Rust refuses as not
// registered (dev host), it is an in-memory Map.
import type { PluginStore } from "../../../packages/plugin-api/src/index.ts";
import {
  pluginStoreDeleteMany, pluginStoreDeletePrefix, pluginStoreGeneration,
  pluginStoreGetMany, pluginStoreKeys, pluginStoreSetMany,
} from "../data/core-data-api.ts";

export class MemoryPluginStore implements PluginStore {
  private readonly map = new Map<string, string>();
  async get(key: string) { return this.map.get(key) ?? null; }
  async set(key: string, value: string) { this.map.set(key, value); }
  async delete(key: string) { this.map.delete(key); }
  async keys(prefix = "") { return [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort(); }
  async deletePrefix(prefix: string) {
    if (!prefix) throw new Error("deletePrefix needs a non-empty prefix");
    const doomed = [...this.map.keys()].filter((k) => k.startsWith(prefix));
    for (const k of doomed) this.map.delete(k);
    return doomed.length;
  }
  async getMany(keys: string[]) { return keys.map((k) => this.map.get(k) ?? null); }
  async setMany(entries: [string, string][]) { for (const [k, v] of entries) this.map.set(k, v); }
  async deleteMany(keys: string[]) { for (const k of keys) this.map.delete(k); }
}

// Read once per page load: a restore wipes the store and reloads the page,
// so a write still carrying the old generation is refused by Rust.
let generation: Promise<string> | null = null;
function currentGeneration() {
  generation ??= pluginStoreGeneration().catch((error) => { generation = null; throw error; });
  return generation;
}

class CorePluginStore implements PluginStore {
  private memory: MemoryPluginStore | null = null;
  private readonly pluginId: string;
  // No parameter property: node --experimental-strip-types (the headless checks) rejects it.
  constructor(pluginId: string) { this.pluginId = pluginId; }

  private async run<T>(core: () => Promise<T>, memory: (store: MemoryPluginStore) => Promise<T>): Promise<T> {
    if (this.memory) return memory(this.memory);
    try {
      return await core();
    } catch (error) {
      if (!String(error).includes("is not registered")) throw error;
      this.memory ??= new MemoryPluginStore();
      return memory(this.memory);
    }
  }

  get(key: string) { return this.run(async () => (await pluginStoreGetMany(this.pluginId, [key]))[0] ?? null, (m) => m.get(key)); }
  set(key: string, value: string) { return this.setMany([[key, value]]); }
  delete(key: string) { return this.deleteMany([key]); }
  keys(prefix = "") { return this.run(() => pluginStoreKeys(this.pluginId, prefix), (m) => m.keys(prefix)); }
  deletePrefix(prefix: string) {
    if (!prefix) return Promise.reject(new Error("deletePrefix needs a non-empty prefix"));
    return this.run(async () => pluginStoreDeletePrefix(this.pluginId, await currentGeneration(), prefix), (m) => m.deletePrefix(prefix));
  }
  getMany(keys: string[]) { return this.run(() => pluginStoreGetMany(this.pluginId, keys), (m) => m.getMany(keys)); }
  setMany(entries: [string, string][]) { return this.run(async () => pluginStoreSetMany(this.pluginId, await currentGeneration(), entries), (m) => m.setMany(entries)); }
  deleteMany(keys: string[]) { return this.run(async () => pluginStoreDeleteMany(this.pluginId, await currentGeneration(), keys), (m) => m.deleteMany(keys)); }
}

export function createPluginStore(pluginId: string): PluginStore {
  const tauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (!tauri) return new MemoryPluginStore();
  // STORE-API (Hive #5): read the generation now, not on the first write. A
  // page that has not written yet would otherwise fetch the NEW generation
  // after a restore's wipe, and a write still in flight from before the
  // restore would be accepted instead of refused.
  void currentGeneration().catch(() => {});
  return new CorePluginStore(pluginId);
}
