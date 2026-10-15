import { ExtensionHost } from "./host.ts";
import { LocalPluginManager } from "./manager.ts";
import { coreDataApi } from "./data.ts";
import { setPluginRegistryState } from "../../lib/api";
import type { PluginRuntimeError } from "../../../packages/plugin-api/src/index.ts";
import { hydrateActiveLocalPlugins as hydrateWithManager } from "./hydrate.ts";
import type { LocalPluginFileReader } from "./loader.ts";
import type { PersistedPluginRecord } from "./hydrate.ts";
export type { PersistedPluginRecord } from "./hydrate.ts";

/**
 * One process-wide host for the current Core window. The persistent registry
 * is separate: it records what is installed, while this host owns live
 * registrations and cleanup for the current session.
 */
export const extensionHost = new ExtensionHost(coreDataApi);
export const localPluginManager = new LocalPluginManager(extensionHost);

export function hydrateActiveLocalPlugins(
  entries: PersistedPluginRecord[],
  reader: LocalPluginFileReader,
) {
  return hydrateWithManager(entries, reader, localPluginManager);
}

/**
 * Keep a command/lifecycle failure visible without allowing it to stop Core.
 * Active plugins keep their lifecycle state after a command error, while the
 * registry stores the last error for repair and the Settings screen can refresh
 * when the failure happens outside that screen.
 */
extensionHost.onError((failure) => {
  void persistPluginRuntimeError(failure);
});

async function persistPluginRuntimeError(failure: PluginRuntimeError): Promise<void> {
  const state = failure.phase === "load" ? "failed" : failure.phase === "unload" ? "disabled" : "active";
  try {
    await setPluginRegistryState(failure.pluginId, failure.version, state, failure.message);
  } catch (error) {
    console.warn("plugin error could not be persisted", error);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("notible:plugin-error", { detail: failure }));
  }
}
