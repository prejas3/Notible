// Plugin Market — read side (Etap B). Public, no auth: browse listed plugins,
// their metadata and their published releases. Writes (submissions, ratings,
// moderation) are Etapy C–F and live elsewhere.
//
// The API is a catalog, not a trust root: a release carries `manifestUrl` and
// the client still verifies the Ed25519 signature and package hash itself
// before installing (see src/core/app/usePluginCatalog.ts).
//
// Split into pure helpers (query parsing, cursor codec, row mapping — covered
// by server/test/market-check.mjs) and thin route wiring that runs
// parameterized SQL.

import { Hono } from "hono";
import type {
  Env,
  MarketPluginCard,
  MarketPluginDetail,
  MarketReleaseSummary,
} from "./types";

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 50;
export const MAX_SEARCH_LEN = 100;

/** Sort name → keyset column. The cursor is keyed on this column plus `id`, so
 * pagination stays stable regardless of which sort is chosen. */
const SORTS = {
  recent: { column: "updated_at", dir: "DESC" as const, cmp: "<" as const },
  name: { column: "name", dir: "ASC" as const, cmp: ">" as const },
} satisfies Record<string, { column: string; dir: "ASC" | "DESC"; cmp: "<" | ">" }>;

export type SortName = keyof typeof SORTS;

export interface Cursor {
  /** Value of the sort column on the last row of the previous page. */
  key: string | number;
  id: string;
}

export interface ListQuery {
  search: string | null;
  category: string | null;
  sort: SortName;
  limit: number;
  cursor: Cursor | null;
}

function b64urlEncode(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecode(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return atob(padded);
}

export function encodeCursor(cursor: Cursor): string {
  return b64urlEncode(JSON.stringify([cursor.key, cursor.id]));
}

/** Opaque and defensive: any malformed value decodes to `null`, which the
 * caller treats as "start from the first page" rather than an error. */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(raw));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [key, id] = parsed;
    if (typeof id !== "string" || !id) return null;
    if (typeof key !== "string" && typeof key !== "number") return null;
    return { key, id };
  } catch {
    return null;
  }
}

export function parseListQuery(params: URLSearchParams): ListQuery {
  const rawSearch = (params.get("q") ?? "").trim().slice(0, MAX_SEARCH_LEN);
  const rawCategory = (params.get("category") ?? "").trim().toLowerCase();
  const category = /^[a-z0-9-]{1,40}$/.test(rawCategory) ? rawCategory : null;
  const sortParam = params.get("sort") ?? "";
  const sort: SortName = sortParam in SORTS ? (sortParam as SortName) : "recent";
  const limitRaw = Number(params.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limitRaw)))
    : DEFAULT_LIMIT;
  return {
    search: rawSearch || null,
    category,
    sort,
    limit,
    cursor: decodeCursor(params.get("cursor")),
  };
}

/**
 * Build the listing query. Keyset pagination on `(<sort column>, id)`; one row
 * over the limit is fetched so the caller knows whether a next page exists.
 * Every user value is a bind parameter — the only interpolated fragments come
 * from the `SORTS` whitelist.
 */
export function buildListSql(q: ListQuery): { sql: string; binds: unknown[] } {
  const s = SORTS[q.sort];
  const where: string[] = ["p.publication_status = 'listed'"];
  const binds: unknown[] = [];
  if (q.search) {
    where.push("(p.name LIKE '%' || ? || '%' OR p.summary LIKE '%' || ? || '%')");
    binds.push(q.search, q.search);
  }
  if (q.category) {
    where.push("p.categories LIKE '%\"' || ? || '\"%'");
    binds.push(q.category);
  }
  if (q.cursor) {
    where.push(`(p.${s.column} ${s.cmp} ? OR (p.${s.column} = ? AND p.id ${s.cmp} ?))`);
    binds.push(q.cursor.key, q.cursor.key, q.cursor.id);
  }
  const sql =
    `SELECT p.id, p.name, p.summary, p.categories, p.license, p.updated_at,
       (SELECT r.version FROM market_releases r
         WHERE r.plugin_id = p.id AND r.status = 'published'
         ORDER BY r.published_at DESC LIMIT 1) AS latest_version,
       (SELECT r.manifest_url FROM market_releases r
         WHERE r.plugin_id = p.id AND r.status = 'published'
         ORDER BY r.published_at DESC LIMIT 1) AS latest_manifest_url
     FROM market_plugins p
     WHERE ${where.join(" AND ")}
     ORDER BY p.${s.column} ${s.dir}, p.id ${s.dir}
     LIMIT ?`;
  binds.push(q.limit + 1);
  return { sql, binds };
}

function safeJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export interface PluginRow {
  id: string;
  name: string;
  summary: string;
  categories: string;
  license: string;
  updated_at: number;
  latest_version: string | null;
  latest_manifest_url: string | null;
}

export function rowToCard(row: PluginRow): MarketPluginCard {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    categories: safeJsonArray(row.categories),
    license: row.license,
    latestVersion: row.latest_version ?? null,
    // The signed update manifest for the newest published release, so the
    // client can verify and install straight from the list without a second
    // round trip. null when the plugin has no published release yet.
    manifestUrl: row.latest_manifest_url ?? null,
    updatedAt: row.updated_at,
  };
}

export interface ReleaseRow {
  version: string;
  channel: string;
  api_version: string;
  min_core_version: string;
  max_core_version: string | null;
  permissions: string;
  changelog: string;
  package_sha256: string;
  package_size: number;
  manifest_url: string;
  published_at: number | null;
}

export function rowToReleaseSummary(row: ReleaseRow): MarketReleaseSummary {
  return {
    version: row.version,
    channel: row.channel,
    apiVersion: row.api_version,
    minCoreVersion: row.min_core_version,
    maxCoreVersion: row.max_core_version ?? null,
    permissions: safeJsonArray(row.permissions),
    changelog: row.changelog,
    packageSha256: row.package_sha256,
    packageSize: row.package_size,
    manifestUrl: row.manifest_url,
    publishedAt: row.published_at ?? 0,
  };
}

/** The keyset value for the row that ends a page, given the active sort. */
export function cursorForRow(row: PluginRow, sort: SortName): Cursor {
  return { key: sort === "name" ? row.name : row.updated_at, id: row.id };
}

const RELEASE_COLUMNS =
  "version, channel, api_version, min_core_version, max_core_version, permissions, changelog, package_sha256, package_size, manifest_url, published_at";

/**
 * Its own Hono sub-app so it can be `app.route()`-mounted without inheriting
 * the parent's `Variables` typing. All routes here are public — the parent's
 * `/v1/*` auth guard must exempt `GET /v1/market/*`.
 */
export const marketApp = new Hono<{ Bindings: Env }>();

{
  const app = marketApp;
  app.get("/v1/market/plugins", async (c) => {
    if (!c.env.DB) return c.json({ error: "market database is not configured" }, 503);
    const q = parseListQuery(new URL(c.req.url).searchParams);
    const { sql, binds } = buildListSql(q);
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all<PluginRow>();
    const hasMore = results.length > q.limit;
    const page = hasMore ? results.slice(0, q.limit) : results;
    const last = page[page.length - 1];
    return c.json({
      items: page.map(rowToCard),
      nextCursor: hasMore && last ? encodeCursor(cursorForRow(last, q.sort)) : null,
    });
  });

  app.get("/v1/market/plugins/:id", async (c) => {
    if (!c.env.DB) return c.json({ error: "market database is not configured" }, 503);
    const pluginId = c.req.param("id");
    const row = await c.env.DB.prepare(
      `SELECT p.id, p.name, p.summary, p.categories, p.license, p.updated_at,
         a.public_name AS author_name, a.bio AS author_bio
       FROM market_plugins p
       LEFT JOIN market_authors a ON a.user_id = p.owner_user_id
       WHERE p.id = ? AND p.publication_status = 'listed'`,
    ).bind(pluginId).first<PluginRow & { author_name: string | null; author_bio: string | null }>();
    if (!row) return c.json({ error: "not found" }, 404);
    const releases = await c.env.DB.prepare(
      `SELECT ${RELEASE_COLUMNS} FROM market_releases
       WHERE plugin_id = ? AND status = 'published'
       ORDER BY published_at DESC`,
    ).bind(pluginId).all<ReleaseRow>();
    const newest = releases.results[0] ?? null;
    const detail: MarketPluginDetail = {
      ...rowToCard({
        ...row,
        latest_version: newest?.version ?? null,
        latest_manifest_url: newest?.manifest_url ?? null,
      }),
      author: row.author_name ? { name: row.author_name, bio: row.author_bio ?? "" } : null,
      releases: releases.results.map(rowToReleaseSummary),
    };
    return c.json(detail);
  });

  app.get("/v1/market/plugins/:id/releases", async (c) => {
    if (!c.env.DB) return c.json({ error: "market database is not configured" }, 503);
    const pluginId = c.req.param("id");
    const listed = await c.env.DB.prepare(
      "SELECT 1 FROM market_plugins WHERE id = ? AND publication_status = 'listed'",
    ).bind(pluginId).first();
    if (!listed) return c.json({ error: "not found" }, 404);
    const releases = await c.env.DB.prepare(
      `SELECT ${RELEASE_COLUMNS} FROM market_releases
       WHERE plugin_id = ? AND status = 'published'
       ORDER BY published_at DESC`,
    ).bind(pluginId).all<ReleaseRow>();
    return c.json({ items: releases.results.map(rowToReleaseSummary) });
  });
}
