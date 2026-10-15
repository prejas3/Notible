import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { runClaude } from "./anthropic";
import { runOpenAI } from "./openai";
import { agentTurnAllowed, registrationAllowed } from "./auth-gate";
import { marketApp } from "./market";
import type { AuthUser, Env, SyncObject, SyncOperation, SyncRelation, SyncRelationTombstone, SyncTombstone, TurnRequest } from "./types";

type Variables = { user: AuthUser };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const SESSION_DAYS = 30;
const MAX_SYNC_BATCH = 500;

app.use("*", cors({
  origin: (origin, c) => {
    const configured = c.env.NOTIBLE_ALLOWED_ORIGIN?.trim();
    const allowed = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420"]);
    if (configured) allowed.add(configured);
    return origin && allowed.has(origin) ? origin : null;
  },
  allowHeaders: ["Authorization", "Content-Type"],
  allowMethods: ["GET", "POST", "OPTIONS"],
}));

function now() { return Date.now(); }
function id() { return crypto.randomUUID(); }
function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}
function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
function jsonError(c: any, message: string, status = 400) {
  return c.json({ error: message }, status);
}
async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(bytes));
}
async function hashPassword(password: string) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120_000, hash: "SHA-256" }, key, 256);
  return `pbkdf2$120000$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}
async function verifyPassword(password: string, encoded: string) {
  const [scheme, iterations, saltText, expected] = encoded.split("$");
  if (scheme !== "pbkdf2" || !iterations || !saltText || !expected) return false;
  const salt = Uint8Array.from(atob(saltText.replace(/-/g, "+").replace(/_/g, "/") + "=="), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Number(iterations), hash: "SHA-256" }, key, 256);
  return (await digest(bytesToBase64Url(new Uint8Array(bits)))) === (await digest(expected));
}
async function issueSession(env: Env, user: AuthUser, workspaceId: string) {
  const token = randomToken();
  const timestamp = now();
  const expiresAt = timestamp + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id(), user.id, await digest(token), expiresAt, timestamp).run();
  return { accessToken: token, expiresAt, user, workspace: { id: workspaceId, name: "My workspace" } };
}
async function currentUser(c: any): Promise<AuthUser | null> {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !c.env.DB) return null;
  const row = await c.env.DB.prepare("SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
    .bind(await digest(token), now()).first() as AuthUser | null;
  return row ?? null;
}
async function workspaceForUser(env: Env, userId: string) {
  return env.DB.prepare("SELECT w.id, w.name FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.created_at LIMIT 1")
    .bind(userId).first<{ id: string; name: string }>();
}

// Auth endpoints are public; all other /v1 routes require a session or the
// legacy shared secret used by the local AI-only setup.
app.use("/v1/*", async (c, next) => {
  if (c.req.path.startsWith("/v1/auth/")) return next();
  // The plugin-market catalog is public: anyone may browse listed plugins and
  // their published releases. Market writes (ratings, submissions) are not GET
  // and still fall through to the guard.
  if (c.req.method === "GET" && c.req.path.startsWith("/v1/market/")) return next();
  const user = await currentUser(c);
  const legacy = c.env.NOTIBLE_APP_SECRET && c.req.header("Authorization") === `Bearer ${c.env.NOTIBLE_APP_SECRET}`;
  if (!user && !legacy) return c.json({ error: "unauthorized" }, 401);
  if (user) c.set("user", user);
  await next();
});

app.post("/v1/auth/register", async (c) => {
  if (!registrationAllowed(c.env)) return jsonError(c, "registration is disabled", 403);
  if (!c.env.DB) return jsonError(c, "auth database is not configured", 503);
  const body = await c.req.json<{ email?: unknown; password?: unknown }>().catch(() => null);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) return jsonError(c, "valid email is required");
  if (password.length < 10) return jsonError(c, "password must contain at least 10 characters");
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return jsonError(c, "account already exists", 409);
  const user = { id: id(), email };
  const workspaceId = id();
  const timestamp = now();
  const passwordHash = await hashPassword(password);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").bind(user.id, email, passwordHash, timestamp),
    c.env.DB.prepare("INSERT INTO workspaces (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").bind(workspaceId, user.id, "My workspace", timestamp),
    c.env.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").bind(workspaceId, user.id),
  ]);
  return c.json(await issueSession(c.env, user, workspaceId), 201);
});

app.post("/v1/auth/login", async (c) => {
  if (!c.env.DB) return jsonError(c, "auth database is not configured", 503);
  const body = await c.req.json<{ email?: unknown; password?: unknown }>().catch(() => null);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  const row = await c.env.DB.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").bind(email).first<{ id: string; email: string; password_hash: string }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) return jsonError(c, "invalid email or password", 401);
  const workspace = await workspaceForUser(c.env, row.id);
  if (!workspace) return jsonError(c, "workspace not found", 500);
  return c.json(await issueSession(c.env, { id: row.id, email: row.email }, workspace.id));
});

app.post("/v1/auth/google/exchange", async (c) => {
  if (!c.env.DB) return jsonError(c, "auth database is not configured", 503);
  const body = await c.req.json<{ code?: unknown; code_verifier?: unknown; redirect_uri?: unknown }>().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const codeVerifier = typeof body?.code_verifier === "string" ? body.code_verifier.trim() : "";
  const redirectUri = typeof body?.redirect_uri === "string" ? body.redirect_uri.trim() : "";
  if (!code || !codeVerifier || !redirectUri) return jsonError(c, "Google authorization code is required");
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return jsonError(c, "Google sign-in is not configured", 503);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) return jsonError(c, "Google authorization code was rejected; try again.", 401);
  const token = await tokenResponse.json<{ access_token?: unknown }>().catch(() => null);
  const accessToken = typeof token?.access_token === "string" ? token.access_token.trim() : "";
  if (!accessToken) return jsonError(c, "Google did not return an access token", 401);

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileResponse.ok) return jsonError(c, "Google authorization could not be verified", 401);
  const profile = await profileResponse.json<{ sub?: string; email?: string; email_verified?: boolean }>().catch(() => null);
  const subject = typeof profile?.sub === "string" ? profile.sub.trim() : "";
  const email = normalizeEmail(profile?.email);
  if (!subject || !email || profile?.email_verified !== true) return jsonError(c, "Google did not return a verified email", 401);

  const linked = await c.env.DB.prepare("SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND subject = ?")
    .bind(subject).first<{ user_id: string }>();
  let user: AuthUser;
  if (linked) {
    const existing = await c.env.DB.prepare("SELECT id, email FROM users WHERE id = ?").bind(linked.user_id).first<AuthUser>();
    if (!existing) return jsonError(c, "Google account link is invalid", 500);
    user = existing;
  } else {
    const existing = await c.env.DB.prepare("SELECT id, email FROM users WHERE email = ?").bind(email).first<AuthUser>();
    if (existing) {
      user = existing;
    } else {
      user = { id: id(), email };
      const workspaceId = id();
      const timestamp = now();
      const unusablePassword = `oauth$google$${randomToken()}`;
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").bind(user.id, email, unusablePassword, timestamp),
        c.env.DB.prepare("INSERT INTO workspaces (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").bind(workspaceId, user.id, "My workspace", timestamp),
        c.env.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").bind(workspaceId, user.id),
      ]);
    }
    await c.env.DB.prepare("INSERT OR IGNORE INTO oauth_accounts (provider, subject, user_id, created_at) VALUES ('google', ?, ?, ?)")
      .bind(subject, user.id, now()).run();
  }

  const workspace = await workspaceForUser(c.env, user.id);
  if (!workspace) return jsonError(c, "workspace not found", 500);
  return c.json(await issueSession(c.env, user, workspace.id));
});

app.post("/v1/auth/logout", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  if (auth.startsWith("Bearer ") && c.env.DB) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await digest(auth.slice(7).trim())).run();
  return c.json({ ok: true });
});

app.get("/v1/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ user: "local", plan: "self", limits: null });
  const workspace = await workspaceForUser(c.env, user.id);
  return c.json({ user, workspace, plan: "free", limits: null });
});

function validateSyncObject(value: unknown): value is SyncObject {
  const item = value as Partial<SyncObject>;
  return !!item && typeof item.id === "string" && typeof item.type === "string" && typeof item.title === "string" && typeof item.content === "string" && typeof item.props === "string" && typeof item.updated_at === "number";
}

function validateSyncTombstone(value: unknown): value is SyncTombstone {
  const item = value as Partial<SyncTombstone>;
  return !!item && typeof item.object_id === "string" && item.object_id.length > 0 && typeof item.deleted_at === "number";
}

function validateSyncRelationTombstone(value: unknown): value is SyncRelationTombstone {
  const item = value as Partial<SyncRelationTombstone>;
  return !!item && typeof item.from_id === "string" && typeof item.to_id === "string"
    && typeof item.kind === "string" && typeof item.deleted_at === "number";
}

function validateSyncOperation(value: unknown): value is SyncOperation {
  const item = value as Partial<SyncOperation>;
  return !!item
    && typeof item.operation_id === "string" && item.operation_id.length > 0 && item.operation_id.length <= 240
    && typeof item.event === "string" && item.event.length > 0 && item.event.length <= 120
    && (item.object_id === null || typeof item.object_id === "string")
    && typeof item.object_type === "string" && item.object_type.length <= 120
    && typeof item.occurred_at === "number"
    && typeof item.payload === "string" && item.payload.length <= 200_000;
}

app.post("/v1/sync/push", async (c) => {
  const user = c.get("user");
  if (!user) return jsonError(c, "session required", 401);
  const workspace = await workspaceForUser(c.env, user.id);
  if (!workspace) return jsonError(c, "workspace not found", 404);
  const body = await c.req.json<{
    objects?: unknown[];
    relations?: unknown[];
    tombstones?: unknown[];
    relation_tombstones?: unknown[];
    operations?: unknown[];
  }>().catch(() => null);
  const objects = (body?.objects ?? []).filter(validateSyncObject).slice(0, MAX_SYNC_BATCH);
  const relations = (body?.relations ?? []).filter((value): value is SyncRelation => {
    const item = value as Partial<SyncRelation>;
    return !!item && typeof item.from_id === "string" && typeof item.to_id === "string" && typeof item.kind === "string";
  }).map((item) => ({ ...item, created_at: typeof item.created_at === "number" ? item.created_at : 0 })).slice(0, MAX_SYNC_BATCH);
  const tombstones = (body?.tombstones ?? []).filter(validateSyncTombstone).slice(0, MAX_SYNC_BATCH);
  const relationTombstones = (body?.relation_tombstones ?? []).filter(validateSyncRelationTombstone).slice(0, MAX_SYNC_BATCH);
  const operations = (body?.operations ?? []).filter(validateSyncOperation).slice(0, MAX_SYNC_BATCH);
  const statements: D1PreparedStatement[] = [];
  const freshOperationIds = new Set<string>();
  const freshObjectIds = new Set<string>();
  const freshTombstoneIds = new Set<string>();
  const seenOperationIds = new Set<string>();
  for (const operation of operations) {
    if (seenOperationIds.has(operation.operation_id)) continue;
    seenOperationIds.add(operation.operation_id);
    const existing = await c.env.DB.prepare(
      "SELECT operation_id FROM sync_operations WHERE workspace_id = ? AND operation_id = ?",
    ).bind(workspace.id, operation.operation_id).first<{ operation_id: string }>();
    if (existing) continue;
    freshOperationIds.add(operation.operation_id);
    if (operation.object_id && operation.event.startsWith("object.")) {
      if (operation.event === "object.deleted") freshTombstoneIds.add(operation.object_id);
      else freshObjectIds.add(operation.object_id);
    }
    statements.push(c.env.DB.prepare(
      `INSERT OR IGNORE INTO sync_operations
        (workspace_id, operation_id, event, object_id, object_type, occurred_at, payload, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(workspace.id, operation.operation_id, operation.event, operation.object_id, operation.object_type, operation.occurred_at, operation.payload, now()));
  }
  const hasObjectOperationEnvelope = operations.some((operation) => operation.event.startsWith("object."));
  let acceptedObjects = 0;
  let acceptedTombstones = 0;
  let acceptedRelationTombstones = 0;
  for (const tombstone of tombstones) {
    if (hasObjectOperationEnvelope && !freshTombstoneIds.has(tombstone.object_id)) continue;
    const currentObject = await c.env.DB.prepare("SELECT updated_at FROM sync_objects WHERE workspace_id = ? AND id = ?")
      .bind(workspace.id, tombstone.object_id).first<{ updated_at: number }>();
    const currentTombstone = await c.env.DB.prepare("SELECT deleted_at FROM sync_tombstones WHERE workspace_id = ? AND object_id = ?")
      .bind(workspace.id, tombstone.object_id).first<{ deleted_at: number }>();
    if ((currentObject && currentObject.updated_at > tombstone.deleted_at)
      || (currentTombstone && currentTombstone.deleted_at >= tombstone.deleted_at)) continue;
    statements.push(c.env.DB.prepare("DELETE FROM sync_relations WHERE workspace_id = ? AND (from_id = ? OR to_id = ?)")
      .bind(workspace.id, tombstone.object_id, tombstone.object_id));
    statements.push(c.env.DB.prepare("DELETE FROM sync_objects WHERE workspace_id = ? AND id = ? AND updated_at <= ?")
      .bind(workspace.id, tombstone.object_id, tombstone.deleted_at));
    statements.push(c.env.DB.prepare(`
      INSERT INTO sync_tombstones (workspace_id, object_id, deleted_at) VALUES (?, ?, ?)
      ON CONFLICT(workspace_id, object_id) DO UPDATE SET deleted_at = MAX(sync_tombstones.deleted_at, excluded.deleted_at)
    `).bind(workspace.id, tombstone.object_id, tombstone.deleted_at));
    statements.push(c.env.DB.prepare("INSERT INTO sync_changes (workspace_id, object_id, object_type, changed_at, payload) VALUES (?, ?, 'deleted', ?, ?)")
      .bind(workspace.id, tombstone.object_id, tombstone.deleted_at, JSON.stringify({ deleted: true, ...tombstone })));
    acceptedTombstones += 1;
  }
  for (const tombstone of relationTombstones) {
    const currentRelation = await c.env.DB.prepare(
      "SELECT created_at FROM sync_relation_state WHERE workspace_id = ? AND from_id = ? AND to_id = ? AND kind = ?",
    ).bind(workspace.id, tombstone.from_id, tombstone.to_id, tombstone.kind).first<{ created_at: number }>();
    const currentTombstone = await c.env.DB.prepare(
      "SELECT deleted_at FROM sync_relation_tombstones WHERE workspace_id = ? AND from_id = ? AND to_id = ? AND kind = ?",
    ).bind(workspace.id, tombstone.from_id, tombstone.to_id, tombstone.kind).first<{ deleted_at: number }>();
    if ((currentRelation && currentRelation.created_at > tombstone.deleted_at)
      || (currentTombstone && currentTombstone.deleted_at >= tombstone.deleted_at)) continue;
    statements.push(c.env.DB.prepare(
      "DELETE FROM sync_relations WHERE workspace_id = ? AND from_id = ? AND to_id = ? AND kind = ?",
    ).bind(workspace.id, tombstone.from_id, tombstone.to_id, tombstone.kind));
    statements.push(c.env.DB.prepare(
      "INSERT INTO sync_relation_tombstones (workspace_id, from_id, to_id, kind, deleted_at) VALUES (?, ?, ?, ?, ?)\n       ON CONFLICT(workspace_id, from_id, to_id, kind) DO UPDATE SET deleted_at = MAX(sync_relation_tombstones.deleted_at, excluded.deleted_at)",
    ).bind(workspace.id, tombstone.from_id, tombstone.to_id, tombstone.kind, tombstone.deleted_at));
    acceptedRelationTombstones += 1;
  }
  for (const object of objects) {
    if (hasObjectOperationEnvelope && !freshObjectIds.has(object.id)) continue;
    const tombstone = await c.env.DB.prepare("SELECT deleted_at FROM sync_tombstones WHERE workspace_id = ? AND object_id = ?")
      .bind(workspace.id, object.id).first<{ deleted_at: number }>();
    if (tombstone && tombstone.deleted_at >= object.updated_at) continue;
    const current = await c.env.DB.prepare("SELECT updated_at FROM sync_objects WHERE workspace_id = ? AND id = ?")
      .bind(workspace.id, object.id).first<{ updated_at: number }>();
    if (current && object.updated_at <= current.updated_at) continue;
    if (tombstone) statements.push(c.env.DB.prepare("DELETE FROM sync_tombstones WHERE workspace_id = ? AND object_id = ?").bind(workspace.id, object.id));
    statements.push(c.env.DB.prepare(`
      INSERT INTO sync_objects (workspace_id, id, type, title, content, props, created_at, updated_at, archived_at, trashed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, id) DO UPDATE SET
        type=excluded.type, title=excluded.title, content=excluded.content, props=excluded.props,
        created_at=MIN(sync_objects.created_at, excluded.created_at), updated_at=excluded.updated_at,
        archived_at=excluded.archived_at, trashed_at=excluded.trashed_at
      WHERE excluded.updated_at > sync_objects.updated_at
    `).bind(workspace.id, object.id, object.type, object.title, object.content, object.props, object.created_at, object.updated_at, object.archived_at ?? null, object.trashed_at ?? null));
    statements.push(c.env.DB.prepare("INSERT INTO sync_changes (workspace_id, object_id, object_type, changed_at, payload) VALUES (?, ?, ?, ?, ?)").bind(workspace.id, object.id, object.type, object.updated_at, JSON.stringify(object)));
    acceptedObjects += 1;
  }
  for (const relation of relations) {
    const tombstone = await c.env.DB.prepare(
      "SELECT deleted_at FROM sync_relation_tombstones WHERE workspace_id = ? AND from_id = ? AND to_id = ? AND kind = ?",
    ).bind(workspace.id, relation.from_id, relation.to_id, relation.kind).first<{ deleted_at: number }>();
    if (tombstone && (relation.created_at === 0 || tombstone.deleted_at > relation.created_at)) continue;
    statements.push(c.env.DB.prepare(
      "DELETE FROM sync_relation_tombstones WHERE workspace_id = ? AND from_id = ? AND to_id = ? AND kind = ?",
    ).bind(workspace.id, relation.from_id, relation.to_id, relation.kind));
    statements.push(c.env.DB.prepare(
      "INSERT OR IGNORE INTO sync_relations (workspace_id, from_id, to_id, kind) VALUES (?, ?, ?, ?)",
    ).bind(workspace.id, relation.from_id, relation.to_id, relation.kind));
    statements.push(c.env.DB.prepare(
      `INSERT INTO sync_relation_state (workspace_id, from_id, to_id, kind, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, from_id, to_id, kind) DO UPDATE SET created_at = MAX(sync_relation_state.created_at, excluded.created_at)`,
    ).bind(workspace.id, relation.from_id, relation.to_id, relation.kind, relation.created_at));
  }
  if (statements.length) await c.env.DB.batch(statements);
  const cursor = await c.env.DB.prepare("SELECT COALESCE(MAX(seq), 0) AS cursor FROM sync_changes WHERE workspace_id = ?").bind(workspace.id).first<{ cursor: number }>();
  return c.json({
    accepted: acceptedObjects,
    deleted: acceptedTombstones,
    relation_tombstones: acceptedRelationTombstones,
    relations: relations.length,
    cursor: cursor?.cursor ?? 0,
    acknowledged_operations: operations.map((operation) => operation.operation_id),
    accepted_operations: freshOperationIds.size,
  });
});

app.get("/v1/sync/pull", async (c) => {
  const user = c.get("user");
  if (!user) return jsonError(c, "session required", 401);
  const workspace = await workspaceForUser(c.env, user.id);
  if (!workspace) return jsonError(c, "workspace not found", 404);
  const cursor = Math.max(0, Number(c.req.query("cursor") ?? "0") || 0);
  const limit = Math.min(MAX_SYNC_BATCH, Math.max(1, Number(c.req.query("limit") ?? "500") || 500));
  const offset = Math.max(0, Number(c.req.query("offset") ?? "0") || 0);
  let objects: SyncObject[];
  let tombstones: SyncTombstone[] = [];
  let nextCursor = cursor;
  let pageCount = 0;
  if (cursor === 0) {
    const result = await c.env.DB.prepare("SELECT id, type, title, content, props, created_at, updated_at, archived_at, trashed_at FROM sync_objects WHERE workspace_id = ? ORDER BY updated_at, id LIMIT ? OFFSET ?").bind(workspace.id, limit, offset).all<SyncObject>();
    objects = result.results;
    tombstones = (await c.env.DB.prepare("SELECT object_id, deleted_at FROM sync_tombstones WHERE workspace_id = ? ORDER BY deleted_at, object_id").bind(workspace.id).all<SyncTombstone>()).results;
    pageCount = objects.length;
    const latest = await c.env.DB.prepare("SELECT COALESCE(MAX(seq), 0) AS cursor FROM sync_changes WHERE workspace_id = ?").bind(workspace.id).first<{ cursor: number }>();
    nextCursor = latest?.cursor ?? 0;
  } else {
    const result = await c.env.DB.prepare("SELECT seq, payload FROM sync_changes WHERE workspace_id = ? AND seq > ? ORDER BY seq LIMIT ?").bind(workspace.id, cursor, limit).all<{ seq: number; payload: string }>();
    const byId = new Map<string, SyncObject>();
    const deletedById = new Map<string, SyncTombstone>();
    for (const row of result.results) {
      nextCursor = row.seq;
      try {
        const payload = JSON.parse(row.payload) as Partial<SyncObject> & { deleted?: boolean; object_id?: string; deleted_at?: number };
        if (payload.deleted && typeof payload.object_id === "string" && typeof payload.deleted_at === "number") deletedById.set(payload.object_id, { object_id: payload.object_id, deleted_at: payload.deleted_at });
        else if (typeof payload.id === "string") byId.set(payload.id, payload as SyncObject);
      } catch { /* ignore malformed historical rows */ }
    }
    objects = [...byId.values()];
    tombstones = [...deletedById.values()];
    pageCount = result.results.length;
  }
  const relations = (await c.env.DB.prepare(
    `SELECT r.from_id, r.to_id, r.kind, COALESCE(s.created_at, 0) AS created_at
     FROM sync_relations r
     LEFT JOIN sync_relation_state s
       ON s.workspace_id = r.workspace_id AND s.from_id = r.from_id AND s.to_id = r.to_id AND s.kind = r.kind
     WHERE r.workspace_id = ?`,
  ).bind(workspace.id).all<SyncRelation>()).results;
  const relation_tombstones = (await c.env.DB.prepare(
    "SELECT from_id, to_id, kind, deleted_at FROM sync_relation_tombstones WHERE workspace_id = ? ORDER BY deleted_at, from_id, to_id, kind",
  ).bind(workspace.id).all<SyncRelationTombstone>()).results;
  return c.json({ objects, tombstones, relations, relation_tombstones, cursor: nextCursor, offset: cursor === 0 ? offset + objects.length : 0, hasMore: pageCount >= limit });
});

app.post("/v1/agent/turn", async (c) => {
  // The `/v1/*` guard admits either a session or the legacy shared secret.
  // The model proxy spends server-owned provider keys and has no per-user
  // quota, so a plain session may only use it when the operator opts in.
  // The shared-secret (local AI-only) workflow is unaffected.
  const hasLegacySecret = !!c.env.NOTIBLE_APP_SECRET
    && c.req.header("Authorization") === `Bearer ${c.env.NOTIBLE_APP_SECRET}`;
  if (!agentTurnAllowed({ hasSession: !!c.get("user"), hasLegacySecret }, c.env)) {
    return c.json({ error: "AI proxy is not enabled for accounts on this server" }, 403);
  }
  let req: TurnRequest;
  try { req = await c.req.json<TurnRequest>(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  if (req.provider !== "claude" && req.provider !== "openai") return c.json({ error: "provider must be 'claude' or 'openai'" }, 400);
  return streamSSE(c, async (stream) => {
    const emit = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });
    try { if (req.provider === "claude") await runClaude(req, c.env, emit); else await runOpenAI(req, c.env, emit); }
    catch (err) { await emit("error", { message: err instanceof Error ? err.message : String(err) }); }
  });
});

app.route("/", marketApp);

export default app;
