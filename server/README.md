# Notible Cloudflare backend

The Worker provides account registration/login, Google account exchange, workspace
sync, and the existing Claude/OpenAI model proxy.

Passwords are stored as PBKDF2-SHA-256 hashes. Desktop session tokens are kept
in Windows Credential Manager, not in project properties or plain local files.

## Local setup

```sh
cd server
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 execute notible-sync --local --file=./schema.sql
npm run dev
```

The desktop app defaults to the current temporary Worker deployment. For local
development, set `VITE_NOTIBLE_API_URL=http://localhost:8787` or change the
endpoint in **Settings → Account & sync**.

## Cloudflare deployment

```sh
npx wrangler d1 create notible-sync
npx wrangler d1 execute notible-sync --remote --file=./schema.sql
npx wrangler secret put NOTIBLE_APP_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler deploy
```

For an already existing D1 database, run the idempotent relation-sync
migration before deploying the new Worker:

```sh
npx wrangler d1 execute notible-sync --remote --file=./migrations/0002-sync-relation-tombstones.sql
```

Do not deploy the Worker code before this migration has completed. A new local
database receives the same tables from `schema.sql`.

Copy the returned D1 database id into `wrangler.toml` before deploying. Attach
the temporary custom domain to the Worker in Cloudflare and use that HTTPS URL
as the Notible endpoint.

## Synchronization contract

`POST /v1/sync/push` accepts local objects, relations, object tombstones and
relation tombstones. Records merge by stable UUID; an incoming object replaces
the server row only when its `updated_at` is newer. A relation carries its
`created_at`; a relation tombstone carries `deleted_at`. A relation is accepted
only when its creation is newer than the latest deletion marker.

Hard-deleting an object removes its matching server relations. Explicitly
deleting one relation uses a relation tombstone so the edge is not recreated by
an older offline client.

`GET /v1/sync/pull?cursor=0` returns the initial workspace snapshot in pages.
Later requests use the returned cursor and return changed objects or tombstones.
Current relations and relation tombstones are returned as idempotent snapshots;
this keeps the first relation-delete implementation correct while the future
operation log is designed. Relations are merged when both endpoint objects
exist. Trash/archive state is synchronized as explicit fields; hard-deleting a
local row is propagated as a tombstone.

Two existing installations therefore combine their notes and work rather than
one installation replacing the other.

## API summary

- `POST /v1/auth/register` — `{ email, password }`
- `POST /v1/auth/login` — `{ email, password }`
- `POST /v1/auth/google/exchange` — `{ code, code_verifier, redirect_uri }` from the native Google desktop OAuth flow
- `POST /v1/auth/logout`
- `GET /v1/me`
- `POST /v1/sync/push`
- `GET /v1/sync/pull?cursor=<number>`
- `POST /v1/agent/turn` — SSE model proxy
- `GET /v1/market/plugins?q=&category=&sort=&cursor=&limit=` — **public**, listed plugins
- `GET /v1/market/plugins/:id` — **public**, one listed plugin + author + published releases
- `GET /v1/market/plugins/:id/releases` — **public**, published release history

The legacy shared bearer remains accepted for the AI-only setup until all
desktop installations use account sessions.

## Plugin Market (read side — Etap B)

`GET /v1/market/*` is a **public catalog**: the `/v1/*` auth guard exempts it,
so anyone can browse. It is not a trust root — each release carries
`manifestUrl` and the desktop client still verifies the Ed25519 signature and
package SHA-256 itself before installing (see
`src/core/app/usePluginCatalog.ts`).

- Only `publication_status = 'listed'` plugins and `status = 'published'`
  releases are ever returned. `draft`, `delisted`, `pending` and `revoked` are
  invisible here.
- `q` matches name/summary (substring, bind parameter). `category` matches one
  tag in the plugin's JSON `categories`. `sort` is `recent` (default) or
  `name` — any other value falls back to `recent`; it is never interpolated.
- `limit` is clamped to 1–50 (default 25). Pagination is keyset: follow
  `nextCursor` until it is `null`. The cursor is opaque; a malformed one is
  treated as "first page", not an error.

Run the idempotent migration before deploying the Worker that serves these
routes (new local databases get the tables from `schema.sql` once it is
regenerated, or from the migration directly):

```sh
npx wrangler d1 execute notible-sync --local  --file=./migrations/0004-market-core.sql
npx wrangler d1 execute notible-sync --remote --file=./migrations/0004-market-core.sql
```

Write endpoints (submissions, ratings, moderation) and the private R2
quarantine are Etapy C–F and are not implemented. The static
`plugins/index.json` export path is unchanged and still serves current
desktop builds.

## AI proxy access

`POST /v1/agent/turn` spends server-owned Anthropic / OpenAI keys and has no
per-user quota, so it is **not** open to accounts by default:

- Requests carrying `Authorization: Bearer <NOTIBLE_APP_SECRET>` are always
  allowed (the local AI-only workflow).
- Requests carrying an account session token get `403` unless
  `NOTIBLE_AI_ALLOW_SESSIONS=1` is set. Only enable that once a real usage
  limit is in place.

`NOTIBLE_DISABLE_REGISTRATION=1` closes `POST /v1/auth/register`; login and
Google exchange keep working, so existing accounts are unaffected.

Both are plain vars — set via `wrangler secret put` / `[vars]` / `.dev.vars`.
For a private deployment also scope `NOTIBLE_ALLOWED_ORIGIN` to the app origin.

## Google sign-in setup

Google sign-in uses the desktop OAuth client already used by Notible's calendar
connection. The app requests only `openid email profile`, receives the code on
the local loopback callback, and sends the code plus PKCE verifier to the Worker.
The Worker exchanges it with Google using `GOOGLE_CLIENT_SECRET`, verifies the
profile, links the Google subject to an existing user with the same verified
email when possible, and returns only the Notible session to the desktop app.

Set `GOOGLE_CLIENT_SECRET` with `wrangler secret put`; never ship it in the
desktop app, repository, documentation or logs.
The Google Cloud OAuth consent screen must list the desktop client and the
`openid`, `email` and `profile` scopes.
