// Shared wire contract for POST /v1/agent/turn — see server/README.md.

export type Provider = "claude" | "openai";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export type TurnMessage =
  | { role: "user" | "assistant"; content: string | Block[] }
  | { role: "tool"; tool_use_id: string; content: string; is_error?: boolean };

export interface ToolDef {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface TurnRequest {
  provider: Provider;
  model?: string;
  system?: string;
  messages: TurnMessage[];
  tools?: ToolDef[];
}

export interface Env {
  DB: D1Database;
  NOTIBLE_ALLOWED_ORIGIN?: string;
  NOTIBLE_APP_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  /** `"1"` lets ordinary session users call POST /v1/agent/turn (server-owned
   *  model keys). Default: only the NOTIBLE_APP_SECRET holder may. */
  NOTIBLE_AI_ALLOW_SESSIONS?: string;
  /** `"1"` closes POST /v1/auth/register (login and Google exchange stay on). */
  NOTIBLE_DISABLE_REGISTRATION?: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface SyncObject {
  id: string;
  type: string;
  title: string;
  content: string;
  props: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  trashed_at: number | null;
}

export interface SyncRelation {
  from_id: string;
  to_id: string;
  kind: string;
  created_at: number;
}

export interface SyncRelationTombstone {
  from_id: string;
  to_id: string;
  kind: string;
  deleted_at: number;
}

export interface SyncTombstone {
  object_id: string;
  deleted_at: number;
}

export interface SyncOperation {
  operation_id: string;
  event: string;
  object_id: string | null;
  object_type: string;
  occurred_at: number;
  payload: string;
}

// A provider handler streams normalized events into `emit`, which writes SSE.
export type Emit = (event: string, data: unknown) => Promise<void>;

// --- Plugin Market, read side (Etap B) -----------------------------------
// Wire contract for GET /v1/market/plugins[/:id[/releases]] — public, no auth.

export interface MarketReleaseSummary {
  version: string;
  channel: string;
  apiVersion: string;
  minCoreVersion: string;
  maxCoreVersion: string | null;
  permissions: string[];
  changelog: string;
  packageSha256: string;
  packageSize: number;
  /** Signed update manifest; the client verifies it, the API does not vouch. */
  manifestUrl: string;
  publishedAt: number;
}

export interface MarketPluginCard {
  id: string;
  name: string;
  summary: string;
  categories: string[];
  license: string;
  latestVersion: string | null;
  /** Signed update manifest for the newest published release; null when none. */
  manifestUrl: string | null;
  updatedAt: number;
}

export interface MarketPluginDetail extends MarketPluginCard {
  author: { name: string; bio: string } | null;
  releases: MarketReleaseSummary[];
}

export interface MarketListPage {
  items: MarketPluginCard[];
  nextCursor: string | null;
}
