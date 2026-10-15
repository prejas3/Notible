// Runs the real Worker against an in-memory D1 (node:sqlite) and R2 (Map),
// with Google replaced by a locally generated RSA key. `node self-check.mjs`
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker, { verifyIdToken } from "./src/index.js";

// --- D1 shim: the subset the Worker uses, batch = one transaction.
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./migrations/0001_init.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...values) => stmt(sql, values),
    run: async () => exec(sql, args),
    first: async () => { const rows = db.prepare(sql).all(...args); return rows[0] ?? null; },
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    _exec: () => exec(sql, args),
  });
  const exec = (sql, args) => {
    const prepared = db.prepare(sql);
    if (/^\s*select/i.test(sql) || /returning/i.test(sql)) return { results: prepared.all(...args), meta: { changes: 0 } };
    const info = prepared.run(...args);
    return { results: [], meta: { changes: Number(info.changes) } };
  };
  return {
    prepare: (sql) => stmt(sql),
    batch: async (statements) => {
      db.exec("BEGIN");
      try { const out = statements.map((s) => s._exec()); db.exec("COMMIT"); return out; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
}

function r2() {
  const store = new Map();
  return {
    store,
    put: async (key, bytes) => { store.set(key, new Uint8Array(bytes)); },
    get: async (key) => (store.has(key) ? { body: store.get(key) } : null),
    delete: async (keys) => { for (const key of [].concat(keys)) store.delete(key); },
    list: async ({ prefix }) => ({ objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
  };
}

// --- a fake Google
const CLIENT = "test-client.apps.googleusercontent.com";
const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
async function idToken(claims, { kid = "k1", key = privateKey } = {}) {
  const head = b64u(JSON.stringify({ alg: "RS256", kid }));
  const body = b64u(JSON.stringify({
    iss: "https://accounts.google.com", aud: CLIENT, azp: CLIENT, exp: Math.floor(Date.now() / 1000) + 600,
    email_verified: true, ...claims,
  }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64u(sig)}`;
}

const env = { DB: d1(), MEDIA: r2(), GOOGLE_CLIENT_ID: CLIENT, JWKS_JSON: JSON.stringify({ keys: [jwk] }), ALLOWED_EMAILS: "ann@example.com, Bob@Example.com" };
const call = async (method, path, { token, body, raw } = {}) => {
  const response = await worker.fetch(new Request(`https://t.test${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  }), env);
  const type = response.headers.get("Content-Type") ?? "";
  return { status: response.status, data: type.includes("json") ? await response.json() : new Uint8Array(await response.arrayBuffer()) };
};

// --- ID token checks
const good = await idToken({ sub: "ann", email: "ann@example.com", name: "Ann" });
assert.equal((await verifyIdToken(good, env)).sub, "ann");
for (const [label, token] of [
  ["wrong aud", await idToken({ sub: "x", email: "ann@example.com", aud: "other" })],
  ["wrong azp", await idToken({ sub: "x", email: "ann@example.com", azp: "other" })],
  ["expired", await idToken({ sub: "x", email: "ann@example.com", exp: 1 })],
  ["unverified e-mail", await idToken({ sub: "x", email: "ann@example.com", email_verified: false })],
  ["wrong issuer", await idToken({ sub: "x", email: "ann@example.com", iss: "https://evil.example" })],
  ["unknown kid", await idToken({ sub: "x", email: "ann@example.com" }, { kid: "nope" })],
  ["tampered", good.replace(/\.[^.]+\./, `.${b64u(JSON.stringify({ sub: "ann", email: "ann@example.com", aud: CLIENT, iss: "accounts.google.com", exp: 9e9, email_verified: true }))}.`)],
  ["alg none", `${b64u(JSON.stringify({ alg: "none", kid: "k1" }))}.${good.split(".")[1]}.`],
]) {
  await assert.rejects(verifyIdToken(token, env), undefined, label);
}

// --- sessions and the allowlist
const eve = await call("POST", "/v1/session", { body: { idToken: await idToken({ sub: "eve", email: "eve@example.com" }) } });
assert.equal(eve.status, 403, "an account off the list gets no session");
const ann = (await call("POST", "/v1/session", { body: { idToken: good } })).data.session;
const bob = (await call("POST", "/v1/session", { body: { idToken: await idToken({ sub: "bob", email: "bob@example.com", name: "Bob" }) } })).data.session;
const cid = (await call("POST", "/v1/session", { body: { idToken: await idToken({ sub: "cid", email: "ann@example.com" }) } })).data.session;
assert.ok(ann && bob && cid);
assert.equal((await call("GET", "/v1/me")).status, 401);
assert.equal((await call("GET", "/v1/me", { token: "nonsense" })).status, 401);

// --- space, invites, membership
const created = (await call("POST", "/v1/spaces", { token: ann, body: { rootId: "root-1" } })).data;
const sid = created.id;
assert.equal((await call("POST", "/v1/spaces", { token: ann, body: { rootId: "../x" } })).status, 400);
assert.equal((await call("GET", `/v1/spaces/${sid}/items`, { token: bob })).status, 404, "a non-member sees nothing");
const invite = (await call("POST", `/v1/spaces/${sid}/invites`, { token: ann })).data.token;
assert.equal((await call("POST", "/v1/invites/redeem", { token: bob, body: { token: invite } })).data.spaceId, sid);
assert.equal((await call("POST", "/v1/invites/redeem", { token: cid, body: { token: invite } })).status, 410, "single use");
const me = (await call("GET", "/v1/me", { token: bob })).data;
assert.deepEqual(me.spaces[0].members.map((m) => m.email), ["ann@example.com", "bob@example.com"]);
assert.equal(me.spaces[0].rootId, "root-1");

// --- versioned items
const put = (token, items) => call("PUT", `/v1/spaces/${sid}/items`, { token, body: { items } });
let r = (await put(ann, [{ key: "o:1", baseSeq: 0, ciphertext: "A1" }, { key: "o:2", baseSeq: 0, ciphertext: "B1" }])).data.results;
assert.deepEqual(r.map((x) => x.seq), [1, 2]);
r = (await put(bob, [{ key: "o:1", baseSeq: 0, ciphertext: "stale" }])).data.results;
assert.equal(r[0].conflict, true, "creating an existing item is a conflict");
r = (await put(bob, [{ key: "o:1", baseSeq: 1, ciphertext: "A2" }])).data.results;
assert.equal(r[0].seq, 4);
r = (await put(ann, [{ key: "o:1", baseSeq: 1, ciphertext: "lost update" }, { key: "o:3", baseSeq: 0, ciphertext: "C1" }])).data.results;
assert.equal(r[0].conflict, true, "a write on a stale base is refused");
assert.equal(r[1].seq, 6, "the rest of the batch still lands");
let page = (await call("GET", `/v1/spaces/${sid}/items?since=2`, { token: ann })).data;
assert.deepEqual(page.items.map((i) => [i.key, i.ciphertext, i.seq]), [["o:1", "A2", 4], ["o:3", "C1", 6]]);
assert.equal(page.items[0].author, "bob");
assert.equal((await put(ann, [{ key: "o:9", baseSeq: -1, ciphertext: "x" }])).status, 400);

// paging
const many = Array.from({ length: 100 }, (_, i) => ({ key: `o:p${i}`, baseSeq: 0, ciphertext: "p" }));
for (let i = 0; i < 6; i += 1) await put(ann, many.map((item) => ({ ...item, key: `${item.key}-${i}` })));
page = (await call("GET", `/v1/spaces/${sid}/items?since=0`, { token: ann })).data;
assert.equal(page.items.length, 500);
assert.equal(page.more, true);

// --- media
assert.equal((await call("PUT", `/v1/spaces/${sid}/media/..%2Fother`, { token: ann, raw: "x" })).status, 400);
assert.equal((await call("PUT", `/v1/spaces/${sid}/media/a.png`, { token: ann, raw: "sealed" })).status, 200);
assert.equal(Buffer.from((await call("GET", `/v1/spaces/${sid}/media/a.png`, { token: bob })).data).toString(), "sealed");
assert.ok(env.MEDIA.store.has(`${sid}/a.png`));

// --- removal: pre-minted invites die with the member
const bobInvite = (await call("POST", `/v1/spaces/${sid}/invites`, { token: bob })).data.token;
assert.equal((await call("DELETE", `/v1/spaces/${sid}/members/ann`, { token: bob })).status, 403, "only the owner removes others");
assert.equal((await call("DELETE", `/v1/spaces/${sid}/members/ann`, { token: ann })).status, 400, "the owner cannot leave");
assert.equal((await call("DELETE", `/v1/spaces/${sid}/members/bob`, { token: ann })).status, 200);
assert.equal((await call("GET", `/v1/spaces/${sid}/items`, { token: bob })).status, 404);
assert.equal((await call("POST", "/v1/invites/redeem", { token: bob, body: { token: bobInvite } })).status, 410, "a removed member cannot rejoin with an invite minted earlier");

// --- export, delete
assert.equal((await call("GET", `/v1/spaces/${sid}/export`, { token: ann })).data.items.length, 603);
assert.equal((await call("DELETE", `/v1/spaces/${sid}`, { token: ann })).status, 200);
assert.equal(env.MEDIA.store.size, 0, "deleting a space deletes its images");
assert.equal((await call("GET", "/v1/me", { token: ann })).data.spaces.length, 0);

// --- sign out
assert.equal((await call("DELETE", "/v1/session", { token: ann })).status, 200);
assert.equal((await call("GET", "/v1/me", { token: ann })).status, 401);

// CORS preflight
const preflight = await worker.fetch(new Request("https://t.test/v1/me", { method: "OPTIONS" }), env);
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");

console.log("Notible Teams server self-check passed.");
