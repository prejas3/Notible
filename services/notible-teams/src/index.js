// Notible Teams prototype server (Cloudflare Worker + D1 + R2).
//
// Holds who is in which space and opaque ciphertext; never a key, never a
// note. Design and threat model:
// 2026-09-29-notible-teams-prototype-design.md (internal, not published)

const SESSION_DAYS = 60;
const INVITE_HOURS = 24;
const MAX_BODY = 900_000;          // one items PUT
const MAX_ITEM = 1_500_000;        // one ciphertext (D1 rows stop near 2 MB)
const MAX_ITEMS_PER_PUT = 100;
const MAX_MEDIA = 20 * 1024 * 1024;
const PAGE = 500;
const MEDIA_NAME = /^[A-Za-z0-9._-]{1,120}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

const CORS = {
  // Bearer tokens only, no cookies: any origin may call, none gets ambient
  // credentials. The plugin runs inside the app webview.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
});

const encoder = new TextEncoder();

function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(text) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const randomToken = () => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));

// ------------------------------------------------------------ Google tokens

// ponytail: module-level cache, lives as long as the isolate. Google rotates
// keys over days, so an hour is plenty.
let jwksCache = { keys: null, until: 0 };

async function googleKeys(env, now) {
  if (env.JWKS_JSON) return JSON.parse(env.JWKS_JSON).keys; // tests only
  if (jwksCache.keys && jwksCache.until > now) return jwksCache.keys;
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!response.ok) throw new HttpError(502, "Could not reach Google to check the sign-in.");
  jwksCache = { keys: (await response.json()).keys, until: now + 3_600_000 };
  return jwksCache.keys;
}

/** A Google ID token for our client, or an HttpError. Returns its claims. */
export async function verifyIdToken(token, env, now = Date.now()) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) throw new HttpError(401, "Malformed sign-in token.");
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
  } catch {
    throw new HttpError(401, "Malformed sign-in token.");
  }
  if (header.alg !== "RS256") throw new HttpError(401, "Unexpected token algorithm.");
  const jwk = (await googleKeys(env, now)).find((key) => key.kid === header.kid);
  if (!jwk) throw new HttpError(401, "Unknown signing key.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlToBytes(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new HttpError(401, "Invalid signature.");
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new HttpError(401, "Wrong issuer.");
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, "Token was issued for another app.");
  if (claims.azp && claims.azp !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, "Token was issued for another app.");
  if (!(Number(claims.exp) * 1000 > now)) throw new HttpError(401, "Sign-in token expired. Sign in again.");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new HttpError(401, "Google has not verified this e-mail address.");
  if (!claims.sub || !claims.email) throw new HttpError(401, "Token has no identity.");
  return claims;
}

function allowed(env, email) {
  return String(env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(String(email).toLowerCase());
}

// ------------------------------------------------------------------ helpers

async function body(request, limit = MAX_BODY) {
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, "Request too large.");
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, "Body is not JSON."); }
}

async function signedIn(request, env, now) {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Not signed in.");
  const row = await env.DB.prepare(
    "SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.expires_at > ?2",
  ).bind(await sha256Hex(token), now).first();
  if (!row) throw new HttpError(401, "Session expired. Sign in again.");
  return { ...row, tokenHash: await sha256Hex(token) };
}

async function space(env, spaceId, userId) {
  if (!ID.test(spaceId)) throw new HttpError(404, "No such space.");
  const row = await env.DB.prepare(
    "SELECT s.id, s.root_id, s.owner_id, s.seq FROM spaces s JOIN members m ON m.space_id = s.id WHERE s.id = ?1 AND m.user_id = ?2",
  ).bind(spaceId, userId).first();
  // Same answer for "does not exist" and "not yours".
  if (!row) throw new HttpError(404, "No such space.");
  return row;
}

async function deleteMedia(env, prefix) {
  let cursor;
  do {
    const listed = await env.MEDIA.list({ prefix, cursor });
    if (listed.objects.length) await env.MEDIA.delete(listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

// ------------------------------------------------------------------- routes

async function route(request, env, now) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  const segments = path.split("/").filter(Boolean); // ["v1", ...]
  if (segments[0] !== "v1") throw new HttpError(404, "Not found.");

  // POST /v1/session
  if (path === "/v1/session" && method === "POST") {
    const { idToken } = await body(request);
    const claims = await verifyIdToken(idToken, env, now);
    if (!allowed(env, claims.email)) throw new HttpError(403, "This Google account is not on the Notible Teams test list.");
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET email = ?2, name = ?3",
    ).bind(claims.sub, claims.email, String(claims.name ?? ""), now).run();
    const token = randomToken();
    await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)")
      .bind(await sha256Hex(token), claims.sub, now + SESSION_DAYS * 86_400_000).run();
    return json({ session: token, user: { id: claims.sub, email: claims.email, name: claims.name ?? "" } });
  }

  const user = await signedIn(request, env, now);

  if (path === "/v1/session" && method === "DELETE") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(user.tokenHash).run();
    return json({ ok: true });
  }

  if (path === "/v1/me" && method === "GET") {
    const { results: spaces } = await env.DB.prepare(
      "SELECT s.id, s.root_id, s.owner_id, s.seq FROM spaces s JOIN members m ON m.space_id = s.id WHERE m.user_id = ?1 ORDER BY s.created_at",
    ).bind(user.id).all();
    const { results: people } = await env.DB.prepare(
      "SELECT m.space_id, u.id, u.email, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.space_id IN (SELECT space_id FROM members WHERE user_id = ?1) ORDER BY m.joined_at",
    ).bind(user.id).all();
    return json({
      user: { id: user.id, email: user.email, name: user.name },
      spaces: spaces.map((s) => ({
        id: s.id, rootId: s.root_id, ownerId: s.owner_id, seq: s.seq,
        members: people.filter((p) => p.space_id === s.id).map(({ id, email, name }) => ({ id, email, name })),
      })),
    });
  }

  if (path === "/v1/spaces" && method === "POST") {
    const { rootId } = await body(request);
    if (!ID.test(String(rootId ?? ""))) throw new HttpError(400, "rootId is not an object id.");
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO spaces (id, root_id, owner_id, seq, created_at) VALUES (?1, ?2, ?3, 0, ?4)").bind(id, rootId, user.id, now),
      env.DB.prepare("INSERT INTO members (space_id, user_id, joined_at) VALUES (?1, ?2, ?3)").bind(id, user.id, now),
    ]);
    return json({ id, rootId, ownerId: user.id, seq: 0 });
  }

  if (path === "/v1/invites/redeem" && method === "POST") {
    const { token } = await body(request);
    // Atomic single use; the invite dies with its creator's membership.
    const invite = await env.DB.prepare(
      `UPDATE invites SET used_by = ?1
       WHERE token_hash = ?2 AND used_by IS NULL AND expires_at > ?3
         AND EXISTS (SELECT 1 FROM members m WHERE m.space_id = invites.space_id AND m.user_id = invites.created_by)
       RETURNING space_id`,
    ).bind(user.id, await sha256Hex(String(token ?? "")), now).first();
    if (!invite) throw new HttpError(410, "This invite code is used, expired, or no longer valid.");
    await env.DB.prepare("INSERT OR IGNORE INTO members (space_id, user_id, joined_at) VALUES (?1, ?2, ?3)")
      .bind(invite.space_id, user.id, now).run();
    return json({ spaceId: invite.space_id });
  }

  if (segments[1] !== "spaces" || !segments[2]) throw new HttpError(404, "Not found.");
  const current = await space(env, segments[2], user.id);
  const sub = segments[3] ?? "";

  if (!sub && method === "DELETE") {
    if (current.owner_id !== user.id) throw new HttpError(403, "Only the owner can delete the space.");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM items WHERE space_id = ?1").bind(current.id),
      env.DB.prepare("DELETE FROM invites WHERE space_id = ?1").bind(current.id),
      env.DB.prepare("DELETE FROM members WHERE space_id = ?1").bind(current.id),
      env.DB.prepare("DELETE FROM spaces WHERE id = ?1").bind(current.id),
    ]);
    await deleteMedia(env, `${current.id}/`);
    return json({ ok: true });
  }

  if (sub === "invites" && method === "POST" && segments.length === 4) {
    const token = randomToken();
    await env.DB.prepare("INSERT INTO invites (token_hash, space_id, created_by, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(await sha256Hex(token), current.id, user.id, now + INVITE_HOURS * 3_600_000).run();
    return json({ token, expiresAt: now + INVITE_HOURS * 3_600_000 });
  }

  if (sub === "members" && method === "DELETE" && segments.length === 5) {
    const target = segments[4];
    const self = target === user.id;
    if (self && current.owner_id === user.id) throw new HttpError(400, "The owner cannot leave; delete the space instead.");
    if (!self && current.owner_id !== user.id) throw new HttpError(403, "Only the owner can remove members.");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM members WHERE space_id = ?1 AND user_id = ?2").bind(current.id, target),
      env.DB.prepare("DELETE FROM invites WHERE space_id = ?1 AND created_by = ?2 AND used_by IS NULL").bind(current.id, target),
    ]);
    return json({ ok: true });
  }

  if (sub === "items" && method === "PUT" && segments.length === 4) {
    const { items } = await body(request);
    if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS_PER_PUT) throw new HttpError(400, `Send 1-${MAX_ITEMS_PER_PUT} items.`);
    const statements = [];
    for (const item of items) {
      const key = String(item?.key ?? "");
      const baseSeq = Number(item?.baseSeq);
      const ciphertext = String(item?.ciphertext ?? "");
      if (!key || key.length > 300 || !Number.isInteger(baseSeq) || baseSeq < 0 || !ciphertext || ciphertext.length > MAX_ITEM) {
        throw new HttpError(400, "Malformed item.");
      }
      // One transaction for the whole batch (D1 batch). Each item takes the
      // next seq inside it, so seq order is commit order and a reader's
      // cursor never jumps over an item. The write only lands if the item is
      // still at the version the writer last saw (baseSeq; 0 = new).
      statements.push(
        env.DB.prepare("UPDATE spaces SET seq = seq + 1 WHERE id = ?1").bind(current.id),
        baseSeq === 0
          ? env.DB.prepare(
            "INSERT INTO items (space_id, item_key, seq, author_id, ciphertext) SELECT ?1, ?2, seq, ?3, ?4 FROM spaces WHERE id = ?1 ON CONFLICT(space_id, item_key) DO NOTHING",
          ).bind(current.id, key, user.id, ciphertext)
          : env.DB.prepare(
            "UPDATE items SET seq = (SELECT seq FROM spaces WHERE id = ?1), author_id = ?3, ciphertext = ?4 WHERE space_id = ?1 AND item_key = ?2 AND seq = ?5",
          ).bind(current.id, key, user.id, ciphertext, baseSeq),
        env.DB.prepare("SELECT seq FROM spaces WHERE id = ?1").bind(current.id),
      );
    }
    const results = await env.DB.batch(statements);
    return json({
      results: items.map((item, index) => {
        const written = results[index * 3 + 1].meta.changes === 1;
        return written
          ? { key: item.key, seq: results[index * 3 + 2].results[0].seq }
          : { key: item.key, conflict: true };
      }),
    });
  }

  if (sub === "items" && method === "GET" && segments.length === 4) {
    const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
    const { results } = await env.DB.prepare(
      "SELECT item_key AS key, seq, author_id AS author, ciphertext FROM items WHERE space_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3",
    ).bind(current.id, since, PAGE + 1).all();
    return json({ items: results.slice(0, PAGE), more: results.length > PAGE });
  }

  if (sub === "export" && method === "GET" && segments.length === 4) {
    const { results } = await env.DB.prepare(
      "SELECT item_key AS key, seq, author_id AS author, ciphertext FROM items WHERE space_id = ?1 ORDER BY seq",
    ).bind(current.id).all();
    return json({ space: { id: current.id, rootId: current.root_id }, items: results });
  }

  if (sub === "media" && segments.length === 5) {
    const name = segments[4];
    if (!MEDIA_NAME.test(name)) throw new HttpError(400, "Bad media name.");
    // Built from the id that just passed the membership check, never from
    // anything else in the request.
    const key = `${current.id}/${name}`;
    if (method === "PUT") {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_MEDIA) throw new HttpError(413, "Image too large.");
      await env.MEDIA.put(key, bytes);
      return json({ ok: true });
    }
    if (method === "GET") {
      const object = await env.MEDIA.get(key);
      if (!object) throw new HttpError(404, "No such image.");
      return new Response(object.body, { headers: { ...CORS, "Content-Type": "application/octet-stream" } });
    }
  }

  throw new HttpError(404, "Not found.");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      return await route(request, env, Date.now());
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "Server error." }, 500);
    }
  },
};
