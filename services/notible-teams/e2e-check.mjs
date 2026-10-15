// End to end: two people, the real Worker (in-memory D1/R2), the real plugin
// sync loop, and a stand-in for Core's sync_export/sync_apply with the same
// rules (newest-wins, tombstones win over older edits, relations need both
// ends). `node e2e-check.mjs`
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "./src/index.js";
import { Teams, SERVER, seal, bytesToBase64 } from "../../plugins/notible-teams/main.js";

// ---------------------------------------------------------------- server
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./migrations/0001_init.sql", import.meta.url), "utf8"));
  const exec = (sql, args) => {
    const prepared = db.prepare(sql);
    if (/^\s*select/i.test(sql) || /returning/i.test(sql)) return { results: prepared.all(...args), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(prepared.run(...args).changes) } };
  };
  const stmt = (sql, args = []) => ({
    bind: (...values) => stmt(sql, values),
    run: async () => exec(sql, args),
    first: async () => db.prepare(sql).all(...args)[0] ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    _exec: () => exec(sql, args),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => { db.exec("BEGIN"); try { const out = list.map((s) => s._exec()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } },
  };
}
const media = new Map();
const CLIENT = "client";
const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const env = {
  DB: d1(),
  MEDIA: {
    put: async (k, v) => { media.set(k, new Uint8Array(v)); },
    get: async (k) => (media.has(k) ? { body: media.get(k) } : null),
    delete: async (keys) => { for (const k of [].concat(keys)) media.delete(k); },
    list: async ({ prefix }) => ({ objects: [...media.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
  },
  GOOGLE_CLIENT_ID: CLIENT,
  JWKS_JSON: JSON.stringify({ keys: [{ ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k" }] }),
  ALLOWED_EMAILS: "ann@x.test,bob@x.test",
};
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith(SERVER), `unexpected fetch ${url}`);
  return worker.fetch(new Request(`https://t.test${String(url).slice(SERVER.length)}`, init), env);
};
const b64u = (v) => Buffer.from(v).toString("base64url");
async function idToken(sub, email) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k" }));
  const p = b64u(JSON.stringify({ iss: "accounts.google.com", aud: CLIENT, exp: Date.now() / 1000 + 600, email_verified: true, sub, email, name: sub }));
  const s = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64u(s)}`;
}

// ------------------------------------------------------------ fake Core
let clock = Date.now() - 1_000_000;
const tick = () => (clock += 10);
function core() {
  const objects = new Map();
  const relations = new Map();
  const tombstones = new Map();
  const rk = (r) => `${r.from_id}|${r.to_id}|${r.kind}`;
  const dropObject = (id, at) => {
    objects.delete(id);
    for (const [k, r] of relations) if (r.from_id === id || r.to_id === id) relations.delete(k);
    tombstones.set(id, Math.max(tombstones.get(id) ?? 0, at));
  };
  return {
    objects, relations,
    create(id, type, title, parent) {
      const at = tick();
      objects.set(id, { id, type, title, content: "", props: "{}", created_at: at, updated_at: at, archived_at: null, trashed_at: null });
      if (parent) relations.set(rk({ from_id: id, to_id: parent, kind: "in" }), { from_id: id, to_id: parent, kind: "in", created_at: at });
    },
    link(from_id, to_id, kind) { relations.set(rk({ from_id, to_id, kind }), { from_id, to_id, kind, created_at: tick() }); },
    edit(id, content) { Object.assign(objects.get(id), { content, updated_at: tick() }); },
    remove(id) { dropObject(id, tick()); },
    api: {
      export: async () => ({
        deviceId: "d", cursor: 0,
        objects: [...objects.values()].map((o) => ({ ...o })),
        relations: [...relations.values()].map((r) => ({ ...r })),
        tombstones: [...tombstones].map(([object_id, deleted_at]) => ({ object_id, deleted_at })),
        relationTombstones: [], outbox: [],
      }),
      apply: async (req) => {
        for (const t of req.tombstones) {
          const local = objects.get(t.object_id);
          if (local && local.updated_at > t.deleted_at) continue;
          dropObject(t.object_id, t.deleted_at);
        }
        for (const t of req.relation_tombstones) relations.delete(rk(t));
        for (const o of req.objects) {
          if ((tombstones.get(o.id) ?? -1) >= o.updated_at) continue;
          const local = objects.get(o.id);
          if (local && local.updated_at >= o.updated_at) continue;
          const { parent_id, ...rest } = o;
          objects.set(o.id, { ...rest });
        }
        for (const r of req.relations) if (objects.has(r.from_id) && objects.has(r.to_id)) relations.set(rk(r), { ...r });
        return { appliedObjects: req.objects.length, cursor: 0 };
      },
      media: {
        store: new Map(),
        async missing(names) { return names.filter((n) => !this.store.has(n)); },
        async read(name) { return this.store.get(name); },
        async write(name, b64) { this.store.set(name, b64); },
      },
    },
  };
}

function person(sub, email) {
  const ws = core();
  const storage = new Map();
  const context = {
    storage: {
      get: (k) => (storage.has(k) ? structuredClone(storage.get(k)) : null),
      set: (k, v) => storage.set(k, structuredClone(v)),
      delete: (k) => storage.delete(k),
      keys: () => [...storage.keys()],
    },
    oauth: { google: { signIn: async (provider) => { assert.equal(provider, "google.identity"); return { accessToken: "a", expiresIn: 1, idToken: await idToken(sub, email) }; } } },
    data: { sync: ws.api, types: { list: async () => [{ name: "note" }, { name: "project" }] } },
  };
  const teams = new Teams(context);
  return { ws, teams, storage };
}

const view = (ws, ids) => [...ws.objects.values()].filter((o) => !ids || ids.has(o.id))
  .map((o) => `${o.title}=${o.content}`).sort();
function sharedIds(ws, root) {
  const ids = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of ws.relations.values()) if (r.kind === "in" && ids.has(r.to_id) && !ids.has(r.from_id)) { ids.add(r.from_id); grew = true; }
  }
  return new Set([...ids].filter((id) => ws.objects.has(id)));
}
const ok = async (p) => { const totals = await p.teams.run(); assert.ok(totals, `run failed: ${p.teams.status.text} ${p.teams.status.notes.join(" | ")}`); return totals; };

// ------------------------------------------------------------- the story
const ann = person("ann", "ann@x.test");
const bob = person("bob", "bob@x.test");
const eve = person("eve", "eve@x.test");

ann.ws.create("P", "project", "Launch", null);
ann.ws.create("F", "note", "Folder", "P");
ann.ws.create("N", "note", "Plan", "F");
ann.ws.create("private", "note", "Diary", null);
ann.ws.edit("N", "v1");
ann.ws.edit("private", "secret");
ann.ws.link("N", "private", "mentions");
ann.ws.api.media.store.set("0f8fad5b-d9cb-469f-a165-70867728950e.png", "aW1hZ2U=");
ann.ws.edit("F", "![](media/0f8fad5b-d9cb-469f-a165-70867728950e.png)");

await assert.rejects(eve.teams.signIn(), /not on the Notible Teams test list/);
await ann.teams.signIn();
await bob.teams.signIn();
const spaceId = await ann.teams.share("P");
await ok(ann);
const code = await ann.teams.invite(spaceId);
await bob.teams.join(code);
await ok(bob);

const P = () => sharedIds(ann.ws, "P");
assert.deepEqual(view(bob.ws), view(ann.ws, P()), "Bob has exactly the shared project");
assert.ok(!bob.ws.objects.has("private"), "the private note never left");
assert.ok(![...bob.ws.relations.values()].some((r) => r.to_id === "private"), "nor the link to it");
assert.equal(bob.ws.api.media.store.get("0f8fad5b-d9cb-469f-a165-70867728950e.png"), "aW1hZ2U=", "the picture arrived");
for (const [k, v] of media) assert.ok(!Buffer.from(v).toString().includes("aW1hZ2U="), `server holds plaintext at ${k}`);

// Plain edits both ways.
bob.ws.edit("N", "bob v2");
await ok(bob); await ok(ann);
assert.equal(ann.ws.objects.get("N").content, "bob v2");
bob.ws.create("B1", "note", "Bob's idea", "F");
await ok(bob); await ok(ann);
assert.equal(ann.ws.objects.get("B1").title, "Bob's idea");

// No echo: a quiet round sends nothing.
assert.equal((await ok(ann)).sent, 0);
assert.equal((await ok(bob)).sent, 0);

// Concurrent edits: nobody's text is lost, and both converge.
ann.ws.edit("N", "ann v3");
bob.ws.edit("N", "bob v3");
await ok(ann); await ok(bob); await ok(ann); await ok(bob);
assert.deepEqual(view(ann.ws, P()), view(bob.ws, sharedIds(bob.ws, "P")), "converged");
const texts = view(ann.ws, P()).join("\n");
assert.match(texts, /Plan=ann v3/);
assert.match(texts, /Plan \(conflict copy, bob\)=bob v3/);

// Delete travels; delete vs edit keeps the edit.
bob.ws.remove("B1");
await ok(bob); await ok(ann);
assert.ok(!ann.ws.objects.has("B1"));
ann.ws.remove("N");
bob.ws.edit("N", "bob keeps it");
await ok(ann); await ok(bob); await ok(ann); await ok(bob);
assert.equal(ann.ws.objects.get("N")?.content, "bob keeps it", "an edit beats a deletion");
assert.deepEqual(view(ann.ws, P()), view(bob.ws, sharedIds(bob.ws, "P")));

// A hostile member cannot reach Ann's private note even knowing its id.
const bobKey = Buffer.from(bob.storage.get(`space:${spaceId}`).key, "base64");
const evil = async (key, payload) => ({ key, baseSeq: 0, ciphertext: bytesToBase64(await seal(bobKey, payload, `${spaceId}|${key}`)) });
await fetch(`${SERVER}/v1/spaces/${spaceId}/items`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${bob.storage.get("session")}`, "Content-Type": "application/json" },
  body: JSON.stringify({ items: [
    await evil("o:private", { ...ann.ws.objects.get("private"), content: "defaced", updated_at: clock + 999 }),
    await evil("r:private:P:in", { from_id: "private", to_id: "P", kind: "in", created_at: clock }),
  ] }),
});
await ok(ann);
assert.equal(ann.ws.objects.get("private").content, "secret");
assert.ok(!sharedIds(ann.ws, "P").has("private"), "and it was not pulled into the project");
assert.ok(ann.teams.status.notes.some((n) => /outside the shared project/.test(n)));

// Removal: Bob loses the server, keeps his notes.
const bobUser = bob.teams.user().id;
await ann.teams.removeMember(spaceId, bobUser);
await ok(bob);
assert.equal(bob.storage.has(`space:${spaceId}`), false, "Bob's key for it is forgotten");
assert.ok(bob.ws.objects.has("P"), "his copy stays");

console.log("Notible Teams end-to-end check passed.");
