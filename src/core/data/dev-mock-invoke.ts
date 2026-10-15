// ponytail: dev-only in-memory backend so Core UI can be visually verified in a
// plain browser tab (no Tauri IPC). Never used when window.__TAURI_INTERNALS__
// exists. Not a data layer to extend — real persistence is the Rust backend.
import type { PluginObject, PluginRelation, PluginType } from "../../../packages/plugin-api/src/index.ts";

const STORE_KEY = "notible-dev-mock-store-v1";

interface Store {
  objects: PluginObject[];
  relations: PluginRelation[];
  types: PluginType[];
}

function seed(): Store {
  const now = Date.now();
  const mk = (id: string, type: string, title: string, parent_id: string | null, extra: Partial<PluginObject> = {}): PluginObject => ({
    id, type, title, content: "", props: "{}", created_at: now, updated_at: now, archived_at: null, trashed_at: null, parent_id, ...extra,
  });
  const objects: PluginObject[] = [
    mk("space-1", "project", "Acme", null),
    mk("folder-1", "folder", "Tickets", "space-1"),
    // A real `space`, so the workspace dashboard surface is reachable in the
    // browser harness. Without one, that view could only be seen by installing
    // the app — which is how it went unverified in the first place.
    mk("space-2", "space", "Workspace", null),
    mk("proj-alpha", "project", "Alpha", "space-2"),
    mk("proj-beta", "project", "Beta", "space-2"),
    mk("task-a1", "task", "Draft the brief", "proj-alpha", { props: JSON.stringify({ status: "open", due: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }) }),
    mk("task-a2", "task", "Review with client", "proj-alpha", { props: JSON.stringify({ status: "open", due: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) }) }),
    mk("task-a3", "task", "Kickoff", "proj-alpha", { props: JSON.stringify({ status: "done" }) }),
    mk("task-b1", "task", "Pick a stack", "proj-beta", { props: JSON.stringify({ status: "done" }) }),
    mk("note-alpha", "note", "Alpha notes", "proj-alpha", { content: JSON.stringify({ type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Ustalenia" }] },
      { type: "taskList", content: [
        { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Dopytać o budżet #klient" }] }] },
        { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Wysłać agendę" }] }] },
      ] },
    ] }) }),
    mk("project-1", "project", "Projects", null),
    mk("proj-notible", "project", "Notible", "project-1"),
    mk("proj-trainlog", "project", "Trainlog", "project-1"),
    mk("note-1", "note", "Meeting notes with a genuinely quite long title to test truncation", null),
    mk("note-2", "note", "Second note", null),
    mk("note-3", "note", "Third note", null),
    mk("wb-1", "whiteboard", "Whiteboard", null, { props: JSON.stringify({ cards: [{ id: "c1", x: 80, y: 80, w: 200, h: 120, text: "Type here...", color: "#bcd8ee" }, { id: "c2", x: 400, y: 200, w: 200, h: 120, text: "Type here...", color: "#c9e6cf" }], connections: [] }) }),
    mk("task-1", "task", "Fix login bug", "proj-notible", { props: JSON.stringify({ status: "open", priority: "high" }) }),
    mk("task-2", "task", "Write docs", "proj-notible", { props: JSON.stringify({ status: "in_progress", priority: "medium" }) }),
    mk("task-3", "task", "Ship release", "proj-notible", { props: JSON.stringify({ status: "done", priority: "low" }) }),
    // Planning (milestone/cycle/release), Finance (financial_entry/time_entry)
    // and Automations (rules live in a container's `_automations` prop) all
    // need seed data too, or those screens render empty in the browser host.
    mk("ms-1", "milestone", "Beta launch", "proj-notible", { props: JSON.stringify({ status: "in-progress", targetDate: new Date(now + 10 * 86400000).toISOString().slice(0, 10), owner: "Alex" }) }),
    mk("cycle-1", "cycle", "Sprint 12", "proj-notible", { props: JSON.stringify({ status: "active", startDate: new Date(now - 3 * 86400000).toISOString().slice(0, 10), targetDate: new Date(now + 4 * 86400000).toISOString().slice(0, 10), capacity: 40 }) }),
    mk("release-1", "release", "0.65.0", "proj-notible", { props: JSON.stringify({ status: "planned", targetDate: new Date(now + 14 * 86400000).toISOString().slice(0, 10), version: "0.65.0" }) }),
    mk("fin-1", "financial_entry", "Server hosting", "proj-notible", { props: JSON.stringify({ kind: "cost", amount: 120, currency: "PLN", date: new Date(now - 5 * 86400000).toISOString().slice(0, 10), category: "Infra", vendor: "Hetzner", status: "paid" }) }),
    mk("fin-2", "financial_entry", "Client retainer", "proj-notible", { props: JSON.stringify({ kind: "income", amount: 4000, currency: "PLN", date: new Date(now - 1 * 86400000).toISOString().slice(0, 10), category: "Retainer", vendor: "Acme", status: "approved" }) }),
    mk("time-1", "time_entry", "Dev work", "proj-notible", { props: JSON.stringify({ date: new Date(now - 2 * 86400000).toISOString().slice(0, 10), person: "Alex", hours: 6, billable: true, billableRate: 150, costRate: 80, currency: "PLN", description: "Feature work" }) }),
  ];
  // proj-notible gets a couple of automation rules directly on the project
  // object's props, so the Automations panel shows real rows in the browser
  // host — that panel reads/writes `_automations` on whatever object it's
  // opened from, not a dedicated object type.
  const notibleProject = objects.find((o) => o.id === "proj-notible");
  if (notibleProject) {
    notibleProject.props = JSON.stringify({
      _automations: [
        { id: "rule-1", version: 2, name: "Notify on task done", enabled: true, trigger: { type: "property_changed", field: "status", value: "done" }, actions: [{ id: "a1", type: "notify", title: "Task done", body: "A task was marked done." }], stopOnError: false },
        { id: "rule-2", version: 2, name: "Weekly digest", enabled: false, trigger: { type: "recurring", frequency: "weekly" }, actions: [{ id: "a2", type: "history_note", value: "Weekly check-in" }], stopOnError: false },
      ],
    });
  }
  const types: PluginType[] = [
    { name: "task", schema: JSON.stringify({ fields: { status: { type: "select", options: ["open", "in_progress", "done"] }, priority: { type: "select", options: ["low", "medium", "high"] }, due: { type: "date" } } }), icon: null, color: null },
    { name: "milestone", schema: JSON.stringify({ fields: { status: { type: "select", options: ["planned", "in-progress", "completed"] }, targetDate: { type: "date" }, owner: { type: "text" } } }), icon: "🎯", color: "#8b5cf6" },
    { name: "cycle", schema: JSON.stringify({ fields: { status: { type: "select", options: ["planned", "active", "completed"] }, startDate: { type: "date" }, targetDate: { type: "date" }, capacity: { type: "number" } } }), icon: "🔄", color: "#0ea5e9" },
    { name: "release", schema: JSON.stringify({ fields: { status: { type: "select", options: ["planned", "ready", "released"] }, targetDate: { type: "date" }, version: { type: "text" } } }), icon: "🚀", color: "#10b981" },
    { name: "financial_entry", schema: JSON.stringify({ fields: { kind: { type: "select", options: ["cost", "income"] }, amount: { type: "number" }, currency: { type: "text" }, date: { type: "date" }, category: { type: "text" }, vendor: { type: "text" }, status: { type: "select", options: ["planned", "approved", "paid", "cancelled"] } } }), icon: "¤", color: "#6f8f78" },
    { name: "time_entry", schema: JSON.stringify({ fields: { date: { type: "date" }, person: { type: "text" }, hours: { type: "number" }, billable: { type: "bool" }, billableRate: { type: "number" }, costRate: { type: "number" }, currency: { type: "text" }, description: { type: "text" } } }), icon: "◷", color: "#6d8299" },
  ];
  return { objects, relations: [], types };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch { /* ignore */ }
  const store = seed();
  save(store);
  return store;
}

function save(store: Store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* ignore */ }
}

let store = load();
let autostartEnabled = false;

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

// In-memory version history (not persisted): enough for the panel to be exercised in the harness.
const mockHistory: Array<{ id: number; object_id: string; ts: number; source: string; patch: string }> = [];
let mockHistoryId = 0;

function mockLocales(): Array<{ locale: string; name: string; version: string | null; author: string | null; strings: unknown; source: string; dropped_keys: number }> {
  try { return JSON.parse(localStorage.getItem("notible-dev-mock-locales") ?? "[]"); } catch { return []; }
}

export function isDevMockActive(): boolean {
  return typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window) && import.meta.env.DEV;
}

export async function devInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  await new Promise((r) => setTimeout(r, 30));
  switch (cmd) {
    case "list_root_objects":
      return clone(store.objects.filter((o) => !o.parent_id && !o.trashed_at)) as T;
    case "list_objects":
      return clone(store.objects.filter((o) => !o.trashed_at)) as T;
    case "search_objects": {
      const q = String(args.query ?? "").toLowerCase();
      return clone(store.objects.filter((o) => !o.trashed_at && o.title.toLowerCase().includes(q))) as T;
    }
    case "search_objects_text": {
      const q = String(args.query ?? "").trim().toLowerCase();
      return clone(store.objects.filter((o) => !o.trashed_at && q && [o.title, o.content, o.props].some((part) => String(part ?? "").toLowerCase().includes(q)))) as T;
    }
    case "get_object":
      return clone(store.objects.find((o) => o.id === args.id) ?? null) as T;
    case "query_objects": {
      let list = store.objects.filter((o) => !o.trashed_at);
      if (args.parentId !== undefined) list = list.filter((o) => o.parent_id === args.parentId);
      if (args.type) list = list.filter((o) => o.type === args.type);
      return clone(list) as T;
    }
    case "create_object": {
      const id = `obj-${Math.random().toString(36).slice(2, 10)}`;
      const now = Date.now();
      const obj: PluginObject = {
        id, type: String(args.type), title: String(args.title ?? "Untitled"), content: String(args.content ?? ""), props: String(args.props ?? "{}"),
        created_at: now, updated_at: now, archived_at: null, trashed_at: null, parent_id: (args.parentId as string) ?? null,
      };
      store.objects.push(obj);
      save(store);
      return clone(obj) as T;
    }
    case "update_object": {
      const obj = store.objects.find((o) => o.id === args.id);
      if (!obj) throw new Error("not found");
      // Same optimistic lock as Rust, so the editor's conflict path can be exercised in the harness.
      if (args.expectedUpdatedAt !== undefined && args.expectedUpdatedAt !== null && args.expectedUpdatedAt !== obj.updated_at) throw new Error("conflict");
      if (args.title !== undefined) obj.title = String(args.title);
      if (args.content !== undefined) obj.content = String(args.content);
      if (args.props !== undefined) obj.props = String(args.props);
      obj.updated_at = Math.max(Date.now(), obj.updated_at + 1);
      mockHistory.push({ id: ++mockHistoryId, object_id: obj.id, ts: Date.now(), source: "local", patch: JSON.stringify({ title: obj.title, content: obj.content, props: obj.props }) });
      save(store);
      return clone(obj) as T;
    }
    // Hive #7: no synthetic conflict writes in the plain-browser data mock.
    case "sync_conflict_descriptors":
    case "sync_conflict_list": return [] as T;
    case "sync_conflict_pair": throw new Error("unlinked");
    case "sync_conflict_resolve":
    case "sync_conflict_undo": throw new Error("Conflict recovery requires the desktop app.");
    case "list_integration_events":
      return [] as T;
    case "list_history":
      return mockHistory.filter((h) => h.object_id === args.objectId).reverse().map(({ id, ts, source, patch }) => ({ id, ts, source, size: patch.length })) as T;
    case "get_history_entry":
      return clone(mockHistory.find((h) => h.object_id === args.objectId && h.id === args.id) ?? null) as T;
    case "restore_version": {
      const entry = mockHistory.find((h) => h.object_id === args.objectId && h.id === args.versionId);
      const obj = store.objects.find((o) => o.id === args.objectId);
      if (!entry || !obj) throw new Error("That version no longer exists.");
      Object.assign(obj, JSON.parse(entry.patch), { updated_at: Math.max(Date.now(), obj.updated_at + 1) });
      mockHistory.push({ id: ++mockHistoryId, object_id: obj.id, ts: Date.now(), source: "restore", patch: entry.patch });
      save(store);
      return clone(obj) as T;
    }
    case "delete_history_entry": {
      const index = mockHistory.findIndex((h) => h.object_id === args.objectId && h.id === args.id);
      if (index >= 0) mockHistory.splice(index, 1);
      return (index >= 0) as T;
    }
    case "clear_history": {
      const before = mockHistory.length;
      for (let i = mockHistory.length - 1; i >= 0; i--) if (mockHistory[i].object_id === args.objectId) mockHistory.splice(i, 1);
      return (before - mockHistory.length) as T;
    }
    case "move_object": {
      const obj = store.objects.find((o) => o.id === args.id);
      if (!obj) throw new Error("not found");
      obj.parent_id = (args.parentId as string) ?? null;
      save(store);
      return clone(obj) as T;
    }
    case "trash_object": {
      const obj = store.objects.find((o) => o.id === args.id);
      if (obj) { obj.trashed_at = Date.now(); save(store); }
      return clone(obj ?? null) as T;
    }
    case "restore_object": {
      const obj = store.objects.find((o) => o.id === args.id);
      if (obj) { obj.trashed_at = null; save(store); }
      return clone(obj ?? null) as T;
    }
    case "list_trash":
      return clone(store.objects.filter((o) => o.trashed_at)) as T;
    case "list_relations":
      return clone(store.relations.filter((r) => r.from_id === args.objectId || r.to_id === args.objectId)) as T;
    case "list_relations_bulk": {
      const ids = new Set((args.ids as string[] | undefined) ?? []);
      return clone(store.relations.filter((r) => ids.has(r.from_id) || ids.has(r.to_id))) as T;
    }
    case "project_document": {
      // Flatten the note's Tiptap doc JSON into one { text } block per line —
      // enough for word counts, Codex previews and Typewriter's compile.
      const obj = store.objects.find((o) => o.id === args.objectId);
      let doc: { content?: Array<{ content?: Array<{ text?: string }> }> } = {};
      try { doc = obj ? JSON.parse(obj.content) : {}; } catch { doc = {}; }
      const blocks = (doc.content ?? []).map((node) => ({ text: node.content?.map((c) => c.text ?? "").join("") ?? "" }));
      return clone(blocks) as T;
    }
    case "create_relation": {
      const relation: PluginRelation = { from_id: String(args.fromId), to_id: String(args.toId), kind: String(args.kind) };
      store.relations.push(relation);
      save(store);
      return clone(relation) as T;
    }
    case "delete_relation": {
      const before = store.relations.length;
      store.relations = store.relations.filter((r) => !(r.from_id === args.fromId && r.to_id === args.toId && r.kind === args.kind));
      save(store);
      return (store.relations.length < before) as T;
    }
    case "list_types":
      return clone(store.types) as T;
    case "upsert_type": {
      const name = String(args.name);
      const next: PluginType = { name, schema: String(args.schema ?? "{}"), icon: (args.icon as string) ?? null, color: (args.color as string) ?? null };
      const index = store.types.findIndex((t) => t.name === name);
      if (index >= 0) store.types[index] = next; else store.types.push(next);
      save(store);
      return clone(next) as T;
    }
    case "list_data_sources":
      return clone([]) as T;
    case "list_plugin_registry":
      return clone([]) as T;
    case "get_backup_retention":
      return 10 as T;
    case "list_backups":
      // A handful of fake backups, because an empty list is exactly the case
      // where the Recovery collection (summary + <details> + row menu) cannot
      // be looked at in the dev host.
      return clone(Array.from({ length: 14 }, (_, index) => ({
        filename: `notible-2026-08-${String(20 - index).padStart(2, "0")}.db`,
        path: `/dev-mock/backups/notible-${index}.db`,
        modified_at: Date.now() - index * 86_400_000,
        size: 4_200_000 + index * 11_000,
      }))) as T;
    case "backups_directory":
      return "(dev mock — no real backups directory)" as T;
    case "list_locales":
      // No filesystem here. The real command validates in Rust; the dev host
      // keeps installed language packs in localStorage so the screen can be tried.
      return clone(mockLocales()) as T;
    case "install_locale": {
      const parsed = JSON.parse(String((args as { json?: string } | undefined)?.json ?? "{}")) as { locale?: string; name?: string; version?: string; author?: string; strings?: unknown };
      if (!parsed.locale || !/^[A-Za-z0-9-]{1,12}$/.test(parsed.locale) || parsed.locale === "en" || !parsed.name || !parsed.strings) throw new Error("that language file is not valid");
      const bundle = { locale: parsed.locale, name: parsed.name, version: parsed.version ?? null, author: parsed.author ?? null, strings: parsed.strings, source: `${parsed.locale}.json`, dropped_keys: 0 };
      localStorage.setItem("notible-dev-mock-locales", JSON.stringify([...mockLocales().filter((pack) => pack.locale !== bundle.locale), bundle]));
      return clone(bundle) as T;
    }
    case "read_theme_asset":
      // A 1x1 transparent PNG: enough for the dev host to show a theme wiring up.
      return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" as T;
    case "remove_locale":
      localStorage.setItem("notible-dev-mock-locales", JSON.stringify(mockLocales().filter((pack) => pack.locale !== (args as { tag?: string } | undefined)?.tag)));
      return undefined as T;
    case "set_tray_texts":
      // No native tray in the dev-mock browser host.
      return undefined as T;
    case "media_directory":
      // No filesystem here. An empty path makes expandMediaReference leave
      // the stored form alone, which renders as a broken image rather than
      // as a wrong one.
      return "" as T;
    case "media_sharing_status":
      return false as T;
    case "set_media_sharing":
      return Boolean(args.allowed) as T;
    case "calendar_sharing_status":
      return false as T;
    case "set_calendar_sharing":
      return Boolean(args.allowed) as T;
    case "calendar_oauth_status":
      return { provider: args.provider, configured: true, connected: false } as T;
    // No browser, no loopback socket in the dev host — refuse rather than fake.
    case "calendar_connect":
      throw new Error("Calendar sign-in is not available in the dev host.");
    case "calendar_disconnect":
      return undefined as T;
    case "calendar_list_sources":
      return clone([]) as T;
    case "calendar_sync_project":
      return clone([]) as T;
    case "sync_media_missing":
      return clone([]) as T;
    // There is no browser to open and no loopback socket in the dev host, so
    // sign-in is refused rather than faked. A fake grant would make the sync
    // panel look connected and then fail on the first Drive call, which reads
    // as a bug in the plugin rather than as "this scenario has no Google".
    case "plugin_google_login":
    case "plugin_google_access_token":
      throw new Error("Google sign-in is not available in the dev host.");
    case "plugin_google_revoke":
      return undefined as T;
    case "sweep_orphan_media":
      return { files: 0, bytes: 0, deleted: Boolean(args.delete) } as T;
    case "is_autostart_enabled":
      return autostartEnabled as T;
    case "set_autostart":
      autostartEnabled = Boolean(args.enabled);
      return undefined as T;
    case "save_media":
      // No filesystem in this dev-mock scenario — hand back a data URI so
      // pasted images still render; convertFileSrc() passes it through
      // untouched since it's not a bare filesystem path.
      return `data:image/${args.ext};base64,${args.dataBase64}` as T;
    case "query_content_index": {
      // A deliberately small stand-in. The real index is parsed in Rust from
      // note bodies; duplicating that parser here would mean two of them and
      // one would rot. This returns enough for the harness to render the
      // sections that read it.
      const query = (args ?? {}) as { kind?: string; value?: string; objectId?: string };
      const found = store.objects.flatMap((object) => {
        if (query.objectId && object.id !== query.objectId) return [];
        const doc = object.content && object.content.startsWith("{") ? object.content : "";
        if (!doc) return [];
        const entries: Array<Record<string, unknown>> = [];
        for (const match of doc.matchAll(/"type":"heading","attrs":\{"level":(\d+)\},"content":\[\{"type":"text","text":"([^"]*)"/g)) {
          entries.push({ object_id: object.id, kind: "heading", value: match[2], level: Number(match[1]), checked: null, line: 0 });
        }
        for (const match of doc.matchAll(/"checked":(true|false)\},"content":\[\{"type":"paragraph","content":\[\{"type":"text","text":"([^"]*)"/g)) {
          entries.push({ object_id: object.id, kind: "task", value: match[2], level: null, checked: match[1] === "true", line: 0 });
        }
        return entries;
      });
      return found.filter((entry) => !query.kind || entry.kind === query.kind) as T;
    }
    default:
      console.warn(`[dev-mock-invoke] unhandled command: ${cmd}`, args);
      return (Array.isArray(args) ? [] : null) as T;
  }
}
