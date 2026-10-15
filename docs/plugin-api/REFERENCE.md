# Notible Plugin API — full documentation

Applies to `apiVersion` **1.28** — the contract is frozen on 1.x. Source
contract: `packages/plugin-api/src/index.ts`.

Everything below is public and **stable within 1.x**: adding things is a minor
version and breaks nobody; removing a public token, slot, event or method
requires a major. The host now checks the version at load time — a plugin
declaring a newer minor than the one on offer is rejected with a readable
message, instead of loading and failing somewhere random. Packages written
before the freeze (`apiVersion: "0.1"`) still load. Anything not described here
— Core CSS class names, internal Tauri commands, DOM structure — is private and
may disappear in any release.

- [Plugin shape](#plugin-shape)
- [Manifest](#manifest)
- [Permissions](#permissions)
- [PluginContext](#plugincontext)
- [Data](#data)
- [Commands](#commands)
- [UI: views and slots](#ui-views-and-slots)
- [Overlays: notices, modals, menus](#overlays)
- [Editor](#editor)
- [Help knowledge and the corner helper](#help-knowledge-and-the-corner-helper-new-in-122)
- [Settings](#settings)
- [Events](#events)
- [Storage](#storage)
- [Lifecycle and cleanup](#lifecycle-and-cleanup)
- [What is not here yet](#what-is-not-here-yet)

---

## Plugin shape

```ts
interface NotiblePlugin {
  manifest: PluginManifest;
  onload(context: PluginContext): void | Promise<void>;
  onunload?(): void | Promise<void>;
}
```

The entry module exports this as `default` **or** as a named export `plugin`.
Both forms are accepted.

`onload` may be async — Notible waits for it to finish. If it throws, **the
whole plugin fails to enable**, and any registrations made before the throw are
rolled back.

---

## Manifest

```ts
interface PluginManifest {
  id: string;            // required, immutable
  name: string;          // required
  version: string;       // required
  apiVersion: string;    // required, today "1.21"
  description?: string;
  guide?: string;        // markdown usage notes, ≤ 20 000 chars (new in 1.13)
  author?: string;
  entry?: string;        // path to the module; absent = a code-free package
  styles?: string[];     // CSS sheets, injected by Core
  dependencies?: Record<string, string>;
  minCoreVersion?: string;
  maxCoreVersion?: string | null;
  channel?: "stable" | "beta" | "nightly";
  permissions?: PluginPermission[];
  sync?: "none" | "settings" | "data";
}
```

**`guide`** (new in 1.13) is longer markdown usage notes — a walkthrough, a
"how to get started", the fields your block accepts. Shown in
Settings → Plugins under **Instructions** when your plugin is selected; the
short `description` is still what the list shows. Headings, lists, code fences
and links render. Capped at 20 000 characters — anything longer belongs in
your own docs, linked from here.

**`id`** must match `^[a-z0-9]+(?:[-.][a-z0-9]+)*$`. Note: `acme.focus`,
`acme-focus` and `acme.focuss` are three different, legal identifiers — nobody
reserves them, so pick a prefix that genuinely belongs to you.

**`dependencies`** — a map of `id → version`. Notible refuses to enable a
plugin before its dependencies are enabled, and refuses to disable a dependency
that something else depends on.

**`entry`** decides the package class: with `entry` it is a code package
(a warning at install time), without it a theme — CSS only, installed without a
warning. The manifest must declare at least one of the two.

---

## Permissions

```ts
type PluginPermission =
  | "data.read"        // read objects and relations
  | "data.write"       // create, change, move, trash
  | "relations.write"  // create and delete relations
  | "workspace.ui"     // any drawing: views, slots, overlays
  | "editor.extension" // code-block renderers in the editor
  | "data.sync"        // change journal: workspace replication (new in 1.2)
  | "network"          // OAuth sign-in (1.7); image import from declared hosts (1.28)
  | "notifications"    // native system notifications (new in 1.10)
  | "media.read"       // bytes of a pasted image referenced in a note (new in 1.14)
  | "media.write";     // choose and add an image to managed media (new in 1.27)
```

Rules:

- Registering a **command** requires no permission.
- Registering a view, a slot or settings — and any overlay — requires
  **`workspace.ui`**.
- A code-block renderer requires **`editor.extension`**.
- `context.oauth` requires **`network`** — that is the only thing behind that
  permission today.
- `context.notifications.show(...)` requires **`notifications`**.
- Every `context.data.*` call checks the relevant permission and throws
  `lacks permission …` if you did not declare it.

**Removed in 1.0:** `filesystem.read`, `filesystem.write`, `files.private`,
`files.granted`. No API stood behind them, and the install screen showed them
to the user as access being granted. A package that still declares them will
load (the value is ignored), but don't use them — a file API will come back
with its own names when it exists.

---

## PluginContext

This is the only object you get, and the only one you need.

```ts
interface PluginContext {
  readonly manifest: PluginManifest;
  readonly permissions: PluginPermissions;
  readonly data: DataApi;
  readonly oauth: OauthApi; // new in 1.7
  readonly commands: { register(command: CommandRegistration): Disposable };
  readonly views: { register(view: ViewRegistration): Disposable };
  readonly settings: { register(section: SettingsRegistration): Disposable };
  readonly ui: { registerSlot(slot: string, registration: SlotRegistration): Disposable } & UiApi;
  readonly editor: EditorApi;
  readonly events: PluginEvents;
  readonly storage: PluginStorage;
  readonly help: HelpApi; // new in 1.22
}
```

```ts
interface PluginPermissions {
  has(permission: PluginPermission): boolean;
  require(permission: PluginPermission): void; // throws if missing
}
```

Every `register*` method returns a `Disposable` — you can unregister early, but
you don't have to: Notible cleans everything up when the plugin is disabled.

---

## Signing in to an external account (new in 1.7)

```ts
interface OauthApi {
  readonly google: {
    signIn(provider: string): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }>;
    accessToken(provider: string, refreshToken: string): Promise<{ accessToken: string; expiresIn: number }>;
    revoke(refreshToken: string): Promise<void>;
  };
}
```

`signIn` opens the system browser and returns when the user is done — Notible
listens on `127.0.0.1` and receives the redirect itself. **There is no code to
copy.** Core keeps the socket open for three minutes.

You pass a **provider name**, never a `client_id` or scopes — those belong to
Core. This is not a convenience: if you could pass them, any installed plugin
could show a real Google consent screen asking for any scope, on a client that
belongs to it.

Known providers:

| name | what it grants |
| --- | --- |
| `"google.drive.file"` | files this app created on the user's Drive. Nothing beyond them and no other Google product. |
| `"google.identity"` | new in 1.21: who the user is (`openid email profile`). The result also carries `idToken`, a Google-signed JWT your own server can verify (audience: the Notible Sync client id). Nothing on Drive, no other Google product. No `refreshToken` comes back: it is a one-time sign-in (the other providers always return one). |

The `refreshToken` comes back to you and you store it. Treat it as a
credential: `context.storage` is the webview's `localStorage`, so **every other
installed plugin can read it**. On sign-out call `revoke`, not just delete the
key — otherwise a live grant to the account remains.

```js
const granted = await context.oauth.google.signIn("google.drive.file");
context.storage.set("refreshToken", granted.refreshToken);
// later, when the access token expires:
const { accessToken } = await context.oauth.google.accessToken("google.drive.file", context.storage.get("refreshToken"));
```

---

## Data

Notible does not store notes as files. Everything is an **object** in the
database: a note, a folder, a project, a task, a finance entry. Objects have a
type, a parent and arbitrary properties.

```ts
interface PluginObject {
  id: string;
  type: string;          // "note", "project", "task", your own…
  title: string;
  content: string;       // a document as JSON; markdown lines inside blocks
  props: string;         // JSON with properties, as text
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  trashed_at: number | null;
  parent_id?: string | null;
}
```

`content` and `props` are **text containing JSON**, not objects. Parse and
serialize them yourself.

### Objects

```ts
context.data.objects.get(id): Promise<PluginObject | null>
context.data.objects.create(input): Promise<PluginObject>
context.data.objects.update(id, patch, expectedUpdatedAt?): Promise<PluginObject>
context.data.objects.setType(id, newType, expectedUpdatedAt?): Promise<PluginObject>  // new in 1.17
context.data.objects.move(id, parentId | null): Promise<PluginObject>
context.data.objects.trash(id): Promise<PluginObject | null>
context.data.objects.query(query?): Promise<PluginObject[]>
```

```ts
interface PluginObjectInput  { type: string; title: string; content?: string; props?: string; parentId?: string }
interface PluginObjectPatch  { title?: string; content?: string; props?: string }
interface PluginObjectQuery  { parentId?: string; type?: string; tag?: string; includeArchived?: boolean; limit?: number }
```

**`expectedUpdatedAt`** is concurrency control. Pass the `updated_at` of the
object you read; if someone changed it in the meantime, the write is rejected
instead of silently overwriting their change. Omit it if you deliberately want
to overwrite.

```js
const note = await context.data.objects.get(id);
await context.data.objects.update(id, { title: "New" }, note.updated_at);
```

### Relations

```ts
context.data.relations.list(objectId): Promise<PluginRelation[]>
context.data.relations.create(fromId, toId, kind): Promise<PluginRelation>
context.data.relations.delete(fromId, toId, kind): Promise<boolean>
```

`kind` is any string you like — name it so it doesn't collide with someone
else's (`acme.blocks`, not `blocks`).

### Types

A type is the definition of your own kind of object: a name, a field schema, an
icon, a colour.

```ts
context.data.types.list(): Promise<PluginType[]>
context.data.types.upsert(name, schema, icon?, color?): Promise<PluginType>
```

`schema` is JSON as text, in the shape `{"fields":{...}}`. `upsert` **merges**
with the existing definition, so running it twice does not destroy fields
someone else added.

### Content index

Notes hold their content as a document, and Markdown syntax lives inside it.
Core reads what has structure out of it — **headings, tags, wikilinks and
tasks** — and exposes it as a query. This is the basis for plugins like "show
me every open task" or "where does this tag appear".

```ts
interface ContentIndexEntry {
  object_id: string;
  kind: "heading" | "tag" | "link" | "task";
  value: string;
  level: number | null;    // heading depth 1–6, otherwise null
  checked: boolean | null; // whether a task is checked, otherwise null
  line: number;            // line number, zero-based
}

context.data.index.query(query?): Promise<ContentIndexEntry[]>
context.data.index.forObject(objectId): Promise<ContentIndexEntry[]>
```

```ts
interface ContentIndexQuery {
  kind?: "heading" | "tag" | "link" | "task";
  value?: string;      // exact match, case-insensitive
  objectId?: string;
  limit?: number;      // default 500, maximum 5000
}
```

```js
// Every open task in the workspace.
const tasks = await context.data.index.query({ kind: "task", limit: 1000 });
const open = tasks.filter((t) => !t.checked);

// In how many notes does #project appear?
const hits = await context.data.index.query({ kind: "tag", value: "project" });
const notes = new Set(hits.map((h) => h.object_id));
```

What is recognised:

| Kind | Syntax |
|---|---|
| `heading` | `#` to `######` at the start of a line, a space after the marks |
| `task` | `- [ ] text` or `- [x] text` (also with `*`) |
| `link` | `[[target]]`, `[[target\|label]]`, `[[target#section]]` — only the target is stored |
| `tag` | `#word` that is not a heading; `-`, `_`, `/` allowed |

Two things worth knowing:

- **The index is computed on demand**, by reading object content, not held in a
  table. It therefore cannot be stale — including for changes arriving over
  sync, which never pass through the UI. The cost is scanning notes at query
  time.
- The result is **bounded**: at most 2000 entries per note and 200 characters
  per value. One malicious note cannot hang the app.

Requires `data.read`.

### Document projection

```ts
context.data.document.get(objectId): Promise<DocumentBlock[]>
```

An ordered list of the blocks of a single note — what a table of contents, an
outline or an export needs. The content index answers "where in the workspace
does this tag appear"; the projection answers "what is in this note, in order".

```ts
interface DocumentBlock {
  kind: "paragraph" | "heading" | "code" | "quote" | "list" | "task" | "image" | "divider";
  text: string;            // without the Markdown marker
  level: number | null;    // heading depth 1-6
  language: string | null; // language of a code block
  checked: boolean | null; // task state
  line: number;            // block index, matching `line` in the content index
}
```

Two things worth knowing:

- **Computed on demand**, like the content index, so it cannot be stale.
- **Read-only, deliberately.** Writing would require a faithful reverse
  conversion, and Core's document conversion is lossy in that direction — a
  write API built on it would silently rewrite notes. Change a note through
  `objects.update` with ordinary Markdown.

Requires `data.read`.

### Data sources

```ts
context.data.dataSources.list(): Promise<PluginDataSource[]>
context.data.dataSources.upsert(name, definition, id?): Promise<PluginDataSource>
context.data.dataSources.delete(id): Promise<boolean>
```

### Pasted image bytes (new in 1.14)

Requires the **`media.read`** permission.

```ts
context.data.media.read(ref: string): Promise<string>  // base64
```

Note content stores a pasted image only as a reference — `media/<uuid>.<ext>`,
never the bytes. `media.read` hands you those bytes (base64) for one
reference, so a plugin can embed the image in something it renders — a
report, an export. `ref` must be exactly `media/<uuid-v4>.<ext>` with `<ext>`
one of `png|jpg|jpeg|gif|webp|bmp`. SVG is refused: it can carry script, and
the point of the call is to turn the bytes into an `<img>`/`data:` URI.

It is a thin wrapper over the same primitive `data.sync.media.read` uses, so
you no longer declare the heavyweight `data.sync` just to read one image.
**Enforcement of whether plugins may read pasted images at all is the user
toggle**, "Let plugins read pasted images" in Settings → Files & links — off
by default, for every plugin at once, because this runtime cannot tell
plugins apart. `read` rejects (and says so) when it is off, when the file is
missing, when it is over 20 MB, or when `ref` is malformed or an SVG.

### Image picker (new in 1.27)

Requires **`media.write`**.

```ts
context.data.media.pickImage(): Promise<string | null>
```

This opens Notible's native picker and returns a managed
`media/<uuid>.<ext>` reference, or `null` when the user cancels. A plugin never
supplies a path. Core accepts PNG, JPEG, GIF, WebP and BMP only, verifies magic
bytes, caps the file at 20 MB, and writes it under a fresh UUID without
overwriting. Property references use the same cleanup and sync paths as pasted
note images.

### Image import from a URL (new in 1.28)

Requires **`media.write`** and **`network`**, and a `networkHosts` list in
`plugin.json`.

```json
{
  "permissions": ["data.read", "data.write", "media.write", "network"],
  "networkHosts": ["openlibrary.org", "covers.openlibrary.org", "*.archive.org"]
}
```

```ts
context.data.media.importImageFromUrl(url: string): Promise<string>
```

Core downloads the image and returns a managed `media/<uuid>.<ext>` reference,
the same kind `pickImage` returns: `media.read` gives it back to this plugin,
and cleanup and sync treat it like a pasted image. A plugin never supplies a
path or a filename.

Core checks all of this in Rust, against the plugin's **stored** manifest
(installed, trusted, active), not against anything the call passes in:

- `https://` only, a host name (not an IP address), no user:password in the URL;
- the host, and every redirect hop (at most 3), must match `networkHosts`.
  `example.org` matches only itself; `*.example.org` matches any subdomain,
  not `example.org` itself;
- every address the host resolves to must be public: loopback, private,
  link-local, CGNAT, unique-local and similar ranges are refused, and the
  connection goes to the addresses that were checked;
- 15 seconds for the whole chain, 20 MB at most (streamed, stopped at the cap);
- PNG, JPEG, WebP or GIF, decided by the first bytes, never by the URL or the
  `Content-Type`; the file is written under a fresh UUID, never overwriting.

Each rejection is an `Error` whose message says which rule failed.

**`networkHosts` is a disclosure, not a sandbox, for everything except this
call.** `networkHosts` needs the `network` permission, and the install dialog and the
plugin's Details list the hosts ("Talks to: …"). But plugin code runs in the
app's own JavaScript realm, so Core cannot stop a plain `fetch()` to any
other host. Declare every host your plugin talks to anyway: the user decides
on that list. Only `importImageFromUrl` is **enforced** against it, because
there Core makes the request itself.

**Known limitation: the caller's plugin id.** All plugins share one realm, so
Core cannot prove which plugin is calling. A plugin can call this import
under another installed plugin's id and use that plugin's declared hosts
(the file is then recorded as that plugin's). It still cannot reach a host
that no trusted, active plugin declared, or a private address. `pickImage`
and `media.read` work on the same model.

### Change journal — replication (new in 1.2)

Requires the **`data.sync`** permission. This is a separate door from
`objects.query` and the only one you may build synchronisation on.

```ts
context.data.sync.export(): Promise<SyncSnapshot>
context.data.sync.apply(request: SyncApplyRequest): Promise<SyncApplyResult>
context.data.sync.markOutboxAttempts(operationIds: string[]): Promise<void>
```

`apply` takes an optional `expected` map (object id → the local `updated_at`
you planned against, `null` for "not here"). Inside its transaction Core
refuses any listed row whose `updated_at` moved since, because the user saved
in between, and returns those ids in `staleObjects` so you can retry them
against the new text. Moving, trashing, restoring and archiving leave
`updated_at` alone, so Core also refuses a listed id changed that way after the
export whose `cursor` you pass back in `apply`. Nothing about a refused id is
applied: not its row, its tombstone or its relations. Sending `expected` at all,
even `{}`, turns this check on for every id the request touches: rows, object
tombstones, and the `from_id` of relations and relation tombstones, so a
tombstone-only or relation-only apply is checked too. Without `expected`
nothing is checked. For rows it does take, it also writes the row's
`parent_id` through the `in` relation, which supersedes the peer's own `in`
relations for that object. Rows not in `expected` behave as before.

`context.data.sync.sandboxFolder?` (`available`, `list`, `read`, `write`,
`remove`) is for agent sandboxes only: a local folder that two sandboxes
share in place of a cloud drive, so sync can be tested end to end. A real
build has no code behind it and every call is refused, so don't build on it.
`list` gives each file a `modified` revision (a content digest), and
`write(name, data, { ifAbsent: true })` creates a file only if it is not there
yet, returning false when another writer got there first.
See `docs/AGENT_SANDBOX.md`.

`objects.query` is for reading a slice of the workspace and is unfit for
replication in four ways: it cuts off at 5000 rows with no offset, hides
archived and trashed objects, strips `props.$._projectCalendarEvents`, and
shows only the first `in` relation. A plugin that replicates through it infers
deletion from an object's absence — and sooner or later throws a live note into
the trash on the other device.

`export` reads the journal Core keeps on every write: real tombstones, every
kind of relation, a stable `deviceId`, untouched `props`, no limit and no
filters. `apply` writes objects under their own `id`s and timestamps — which
`objects.create`/`update` deliberately disallow — in a single transaction,
resolving tombstone versus change by `updated_at`.

```ts
interface SyncSnapshot {
  deviceId: string;      // stable for this workspace on this machine
  cursor: number;
  objects: PluginObject[];
  relations: SyncRelation[];
  tombstones: SyncTombstone[];
  relationTombstones: SyncRelationTombstone[];
  outbox: SyncOutboxEntry[];
}
```

Object `id`s are global UUIDs for the whole workspace, so you don't need to
keep your own identity mapping. Two projects with the same title, created
independently on two devices, have two different `id`s and **stay two
objects**. Merging them is a product decision — replication does not do it
behind the user's back.

Three things to watch out for:

- **Do not apply changes to a note open in the editor.** Autosave will
  overwrite them from a buffer that doesn't know about them. Queue them until
  it closes.
- **Filter out your own writes** if you react to `object.updated` — otherwise
  `apply` fires an event that fires another `apply`.
- **Validate someone else's snapshot before writing.** `props` and `type` from
  a foreign device are opaque JSON: parse into `Object.create(null)`, reject
  `__proto__`, `constructor`, `prototype` keys, check `type` against
  `types.list()` and enforce size limits.

---

## Commands

```ts
interface CommandRegistration {
  id: string;                  // unique within your plugin
  name: string;                // shown in the command palette
  description?: string;
  hotkey?: string;             // e.g. "Mod+Shift+P" — Core executes it
  whileTyping?: boolean;       // new in 1.23: also while typing (Ctrl/Alt chords only)
  creates?: CommandCreatesMeta;
  insertsBlock?: { language: string }; // new in 1.24: "/" inserts a fenced block
  objectMenu?: CommandObjectMenuMeta;
  execute(input?: unknown): unknown | Promise<unknown>;
}
```

**Slash blocks (1.24).** A command with `insertsBlock: { language }` appears in
the note's "/" menu. Picking it calls `execute()` once; the string it resolves
to becomes the body of a ```` ```language ```` block at the caret (a body with a
line starting ```` ``` ```` is refused). `language` must be a lowercase id.
`creates.slashMenu: false` keeps a `creates` command in "+" only, so a plugin
offering both a standalone object and a block shows one "/" entry.

`Mod` is Ctrl on Windows/Linux and Cmd on macOS; modifiers in any order.
**Core actually executes this shortcut.** The first registration wins: a
shortcut already taken by another plugin or by the app itself is ignored, not
silently overridden. Nothing fires while you type in a field or in a note,
unless the command sets `whileTyping: true` (new in 1.23) — honoured only for a
binding with `Mod` (Ctrl/Cmd) or Alt, so plain keys and Shift+letter always stay
text. Use it for a shortcut people reach for mid-sentence, like opening a helper. The
user can rebind it or disable it in Settings → Hotkeys; your declaration is
then only a default.

**`creates`** pulls the command into the "+" menu as a first-class create
action, next to "New note":

```ts
interface CommandCreatesMeta {
  objectType: string;  // the object type the command creates
  label: string;       // the menu label
  icon?: string;
}
```

**`objectMenu`** is the twin of `creates` for commands that act on an
*existing* object: it inserts an entry into the right-click menu on a row in
the sidebar. `objectTypes` filters by object type, so "Export to PDF" can
appear on a note and "Summarise progress" on a project — without showing up on
each other. Omitting the list means all types.

```ts
interface CommandObjectMenuMeta {
  label: string;           // label in the right-click menu
  objectTypes?: string[];  // e.g. ["note", "task"]; absent = all rows
}
```

`execute` then receives `{ objectId, objectType }`. Entry order is registration
order; the icon and place in the menu are set by Core. After a command
finishes, Core reloads the object list, so data changes are visible
immediately.

An exception thrown in `execute` is reported to the host and does not disable
the plugin.

---

## UI: views and slots

### The mount contract

Everything a plugin draws goes through one function:

```ts
type ViewMount = (context: ViewMountContext) => Disposable | void;

interface ViewMountContext {
  container: HTMLElement;      // an element the host created — yours to fill
  plugin: PluginContext;       // the same context as in onload
  objectId?: string;           // when the surface is about an object
  containerId?: string;        // when it is inside a container
  theme: { mode: "paper" | "night"; token(name: string): string };
  openObject(id: string): Promise<void>;
  notifyChanged(): void;       // tell the host data changed
}
```

The host creates the element, calls `mount`, and invokes the returned
`Disposable` when the surface goes away. **Do not assume `mount` runs once** —
a panel can be removed and mounted again at any time, so keep state outside it
(see `examples/pomodoro`).

You do not need React or any host library. You may bring your own.

### Slots

```ts
context.ui.registerSlot(name, { id, mount });
```

| Name | Where it appears |
|---|---|
| `workspace.sidebar` | below the object tree |
| `workspace.ribbon` | the bar above the sidebar actions |
| `editor.toolbar` | the note editor's action row |
| `editor.footer` | next to the word and character counters |
| `object.properties` | below the Properties panel |
| `settings.section` | a separate "Plugin panels" entry in Settings |
| `workspace.corner` | one floating box, bottom-left of the note area (new in 1.22, see [the corner helper](#help-knowledge-and-the-corner-helper-new-in-122)) |

A name outside this list is **reported and skipped**, but does not disable the
plugin — the rest of the registrations work normally.

Order between plugins in the same slot is **undefined**. Do not build anything
on it.

### Views

```ts
context.views.register({ id, title, mount });
```

A view is a full-screen surface for an object, not a fragment. `objectId` and
`containerId` in `ViewMountContext` say what it is about.

### Styles

Use host tokens instead of your own colours — that way your panel works
automatically in the light and dark themes:

```js
box.style.color = "var(--notible-text)";
box.style.background = "var(--notible-surface)";
box.style.borderColor = "var(--notible-border)";
```

You can also read a value with `theme.token("--notible-text")` and check
`theme.mode`.

The full public vocabulary (API 1.x). Removing any of these is a *major*
change:

| Group | Tokens |
| --- | --- |
| Backgrounds | `--notible-background`, `--notible-surface`, `--notible-raised`, `--notible-hover`, `--notible-active` |
| Borders | `--notible-border`, `--notible-border-subtle` |
| Text | `--notible-text`, `--notible-muted`, `--notible-faint` |
| Accent | `--notible-accent`, `--notible-accent-hover`, `--notible-on-accent`, `--notible-selected`, `--notible-selected-soft` |
| Status | `--notible-danger`, `--notible-danger-surface`, `--notible-success`, `--notible-success-surface`, `--notible-warning` |
| Categories | `--notible-color-blue`, `-green`, `-amber`, `-red`, `-violet` |
| Highlight | `--notible-highlight-yellow`, `-green`, `-blue`, `-pink`, `-purple`, `-orange` |
| Other | `--notible-scroll-thumb`, `--notible-scroll-thumb-strong`, `--notible-font-sans`, `--notible-font-serif` |

A theme overrides them on `:root` — then the whole of Notible changes, not only
plugin panels:

```css
:root { --notible-accent: #2f6f4f; --notible-surface: #f7fbf8; }
```

> `--core-*` are now **private** host aliases. They are not a contract and may
> disappear without notice — do not use them in a plugin.

### Your own stylesheet

Declare CSS files in the manifest and Core injects them when the plugin is
enabled and removes them when it is disabled:

```json
{ "styles": ["theme.css"] }
```

Rules:

- at most **16** files, each with a `.css` extension, inside the plugin
  directory;
- namespace class names with your prefix. A plugin **does not style Core** —
  `.core-*` classes are private and will change without warning;
- order between plugins is **undefined**;
- the trust-decision screen is a **native system window**, drawn outside the
  webview. No theme can reach it — not because Core detaches something, but
  because CSS doesn't reach there at all.

**A package without `entry`, with only `styles[]`, is a theme.** It installs
without a warning, because there is nothing to execute, and this app's CSP
contains no remote scheme in `img-src`, `font-src` or `style-src` — so the CSS
has nowhere to send what it sees.

---

## Overlays

Every overlay belongs to Core. The plugin supplies content; the host is
responsible for the element, the focus trap, Escape handling and stacking
order.

```ts
interface UiApi {
  notice(message: string, options?: {
    timeoutMs?: number;
    action?: { label: string; onSelect(): void | Promise<void> };  // 1.25
  }): Disposable;
  modal(options: { title: string; mount: ViewMount }): Disposable;
  menu(items: MenuItem[], at: { x: number; y: number }): Disposable;
  suggest<T>(items: T[], render: (item: T) => string, options?: { placeholder?: string }): Promise<T | null>;
  openObject(id: string): Promise<void>;   // 1.1
  openView(viewId: string): Promise<boolean>;  // 1.8
}
```

```js
context.ui.notice("Saved", { timeoutMs: 2000 });

const picked = await context.ui.suggest(
  notes,
  (n) => n.title,
  { placeholder: "Pick a note…" },
);
if (picked) await context.data.objects.trash(picked.id);

context.ui.menu(
  [
    { id: "open", label: "Open", onSelect: () => {} },
    { id: "del", label: "Delete", separatorBefore: true, onSelect: () => {} },
  ],
  { x: event.clientX, y: event.clientY },
);
```

`suggest` returns `null` when the user closes the dialog without a choice.

A notice can carry one button (1.25): `action.label` is capped at 40
characters; clicking it closes the notice and calls `onSelect`. The click
counts as a user gesture in your plugin, so `onSelect` may call
`openPluginSettings`. Older Cores ignore `action` and show the text alone.

```js
context.ui.notice("Sync kept your edit to 'Plan'.", {
  timeoutMs: 10000,
  action: { label: "Open", onSelect: () => context.ui.openObject(id) },
});
```

### `openObject` — navigation (new in 1.1)

```js
const { id } = await context.data.objects.create({ type: "note", title: "2026-08-18" });
await context.ui.openObject(id);   // the same transition as clicking in the sidebar
```

Until 1.0 only a mounted view (`ViewMountContext.openObject`) could navigate, so
a command behind a keyboard shortcut could create today's note but could not
open it. `context.ui.openObject` is available anywhere you have `context` — in
a command, in an event handler, in a settings panel. It requires the
`workspace.ui` permission, because it changes what the user has on screen. An
unknown id does nothing. Inside `mount()` both routes are equivalent.

### `openView` — opening your own view (new in 1.8)

```js
context.views.register({ id: "surface", title: "My panel", mount });

// anywhere you have context — in a command, a slot, an event handler:
if (!(await context.ui.openView("surface"))) {
  openMyModal();   // this host has nowhere to show a view
}
```

The method sits on `ui`, not on `views`, deliberately: `views.*` is
registration, and `ui.*` is "change what the user is looking at" — where
`openObject` already lives. Until 1.7 a plugin could open an OBJECT but could
not open its own screen, so a sidebar button could not navigate to its own
navigation card and you had to leave a modal as a workaround.

`viewId` is resolved only among **this** plugin's views. There is no argument
for someone else's id and you cannot open another plugin's view — the caller's
id is supplied by the host, not by the call. This is a decision, not an
oversight: the screen the user opened is the screen they trusted.

It returns `true` when the shell actually navigated, and `false` when this host
has nowhere to render views. Only the second case is worth working around —
hence the boolean. **A view the plugin never registered throws** (with the
plugin name and view id) instead of returning `false`: a typo is a programmer
error, not an environment difference, and the two must be distinguishable.

Requires `workspace.ui`. It does not grant access to anything the plugin didn't
already have — it shows the plugin's own surface.

**Do not draw your own overlays on `document.body`.** Not only because they
will look different from the rest of the app — trust-decision screens must be
indistinguishable from real ones, and custom overlays are exactly that
problem.

All `ui.*` methods require `workspace.ui`.

---

## Help knowledge and the corner helper (new in 1.22)

Everything a "helper" plugin needs — a small character in a corner that
answers questions only from what the user's build can actually do.

### `context.help` — what this build knows

```ts
interface HelpApi {
  topics(): HelpTopic[];                       // same array until something changes
  onChange(listener: () => void): Disposable;  // a plugin turned on/off, installed, removed
}
interface HelpTopic {
  id: string;                    // "core:writing-notes", "plugin:notible.tables"
  title: string;
  source: "core" | "plugin";
  pluginId?: string;             // the plugin it belongs to
  state: "enabled" | "disabled" | "failed";
  summary: string;               // first paragraph / manifest description
  keywords: string;
  sections: HelpTopicSection[];  // full text — ONLY when state is "enabled"
  helpPageId?: string;           // for ui.openHelp
}
interface HelpTopicSection { heading: string; slug: string; text: string } // Markdown
```

Topics come from Core's Help pages and from every plugin Notible knows about —
built in or installed, on or off. A page about a plugin follows that plugin's
state. A topic that is not `"enabled"` keeps its `summary` but has no
`sections`: answer "this is in X — turn it on" rather than teaching a feature
the user cannot reach. Anything not in the list is "I don't have information
about that yet".

No permission: the text is public (Help, manifest descriptions, guides).
Install paths, versions and settings are never exposed. `onChange` is disposed
with your plugin.

### `ui.openHelp` and `ui.openPluginSettings`

```js
button.onclick = () => context.ui.openHelp(topic.helpPageId, section.slug);
turnOn.onclick = () => context.ui.openPluginSettings("notible.planning");
```

`openHelp` opens Core's Help at a page and heading (an unknown page opens the
first one). `openPluginSettings` opens **Settings → Plugins** with that plugin
selected; it never turns anything on — the switch stays the user's.

Both require `workspace.ui` and **only work right after the user clicked or
pressed a key inside your plugin's own UI** (a slot, view or modal you mounted),
or ran one of your commands — within a second. A call from a timer, a load
handler or after a click elsewhere in the app rejects, and so does a second
call within a second. For half a second after `openPluginSettings`, the Plugins screen
ignores clicks, so a click aimed at your button cannot land on a switch.

### `ui.renderMarkdown`

```js
el.innerHTML = context.ui.renderMarkdown(section.text);
```

Turns Markdown into HTML that is safe for `innerHTML`: raw HTML is escaped,
links are inert (`data-url`, no `href`) and images are dropped (so a text can't
paint a fake Notible banner). Use it for every Help text and guide —
never insert them as HTML yourself. No permission.

### The `workspace.corner` slot

```js
context.ui.registerSlot("workspace.corner", { id: "helper", mount: ({ container }) => { /* draw */ } });
```

- **One occupant.** The user picks it in **Settings → Plugins → Corner helper**
  (or "None"). With no choice, the first plugin by id gets it. Others are not
  mounted.
- **Size:** at most `min(380px, 40vw)` × `min(560px, 70vh)`, clipped. Collapsed
  vs open is your state — start small.
- **Placement:** bottom-left of the note area, clear of Notible's own update
  card and notices. Core draws a caption "Helper · name (id)" under your box;
  it is outside your container and you cannot remove it. A plugin that is not
  built in or signed is captioned "name, unverified"; a name containing
  "Notible" shows as "Community plugin" unless the plugin is Notible's own.
- **Hidden, not unmounted,** while Settings, Help or a modal is open and in
  focus mode — your state survives. Check `yourElement.getClientRects().length === 0` on an element you put in the container (the container itself is `display: contents`, and `offsetParent` is always null inside the fixed corner)
  if you need to know.
- Requires `workspace.ui`, like every slot.

---

## Settings

You **declare** settings, and Notible draws them.

```ts
context.settings.register({ id, title, schema });
```

```ts
interface SettingsSchema {
  sections: Array<{ title?: string; description?: string; fields: SettingsField[] }>;
}

type SettingsField =
  | { kind: "text";   key; label; description?; default?: string; placeholder?: string }
  | { kind: "number"; key; label; description?; default?: number; min?; max?; step? }
  | { kind: "toggle"; key; label; description?; default?: boolean }
  | { kind: "select"; key; label; description?; default?: string; options: Array<{ value: string; label: string }> }
  | { kind: "folder"; key; label; description? }   // stores a directory path, NOT an object id
  | { kind: "hotkey"; key; label; description?; commandId: string };
```

Values go into `context.storage` under the `key` — that is where you read them:

```js
const minutes = context.storage.get("minutes") ?? 25;
```

The panel appears in Settings → **Plugin panels**.

If you really need something the schema cannot express, pass a `mount` instead
— but then you are responsible for its look and accessibility.

`kind: "hotkey"` lets the user record a new shortcut. The value goes into
Core's settings, not into the plugin's `storage` under `key` — a plugin cannot
overwrite which keys the user chose.

---

## Events

```ts
context.events.on(name, handler): Disposable
context.events.emit(name, payload): void
```

Events emitted by Core:

| Event | Payload |
|---|---|
| `object.created` | `{ id, type }` |
| `object.updated` | `{ id, type }` |
| `object.trashed` | `{ id, type }` |
| `object.opened` | `{ id, type, view? }` — `view` (Core 0.90.1+): `"editor"` when the note editor shows it, `"tab"` when a plugin's object tab does |
| `relation.created` | `{ fromId, toId, kind }` (new in 1.9) |
| `relation.deleted` | `{ fromId, toId, kind }` (new in 1.9) |
| `workspace.changed` | `{}` |
| `theme.changed` | `{ mode: "paper" \| "night" }` |
| `app.ready` | `{}` |

These are **notifications, not hooks**. A handler cannot cancel or change what
happened — which is why plugin order never becomes significant.

Events also fire when another plugin makes the change, so watch out for loops:
reacting to `object.updated` by writing to the same object is an easy way to
get infinite recursion.

You can emit your own events — name them with your prefix.

Subscriptions are removed automatically when the plugin is disabled.

---

## Scheduler (new in 1.9)

```ts
context.scheduler.every(intervalMs, task): Disposable
```

Runs `task` on a fixed interval while the plugin is enabled — not only while
its own view is currently open. `intervalMs` is clamped to a minimum of one
minute; a plugin has no legitimate reason to poll more often, and an
accidentally over-aggressive interval should not be possible. An error thrown
(or a rejected promise) from `task` goes to the plugin's error log instead of
becoming an unhandled rejection — subsequent runs still happen.

There is no `at(date, task)` equivalent and no cron-style expressions: a plugin
that wants "every day at 9:00" checks its own condition inside the task passed
to `every` (this is exactly what the built-in Automations plugin does for a
`recurring` rule), instead of Core parsing schedules on someone's behalf.

---

## Notifications (new in 1.10)

```ts
context.notifications.show(options: { title: string; body?: string }): Promise<void>
```

Requires the **`notifications`** permission. Shows a native system
notification — visible even when the app window is minimised or unfocused,
which is what sets it apart from ordinary in-window UI. This is what was
missing for reminders in Habits or a `recurring` rule in Automations to
actually reach the user.

The promise resolves when the system has received the request to show the
notification — not when the user saw it, because no platform reports that back.
There is no click callback: a notification is fire-and-forget, because the
system's notification centre is not part of this app's UI.

A subscription is removed automatically when the plugin is disabled, the same
as `events.on`.

It requires no permission of its own — it only runs the plugin's own code, the
same way `events.on` runs it in response to a notification.

## Themed form controls (new in 1.11)

```ts
context.ui.mountSelect(el: HTMLElement, options: SelectMountOptions): Disposable
context.ui.mountDatePicker(el: HTMLElement, options: DatePickerMountOptions): Disposable
```

These render a dropdown / calendar in the host's style and colours (the active
theme) into an element the plugin owns. The `Disposable` removes them.
`onChange` receives the chosen value / an ISO `yyyy-mm-dd` date — never a DOM
event. `SelectMountOptions` is `{ value, options: {value,label,disabled?}[],
placeholder?, disabled?, ariaLabel?, onChange }`; `DatePickerMountOptions` is
`{ value, time?, min?, max?, disabled?, ariaLabel?, onChange }`.

Requires `workspace.ui` like other visible actions. It is not a security
boundary — Notible does not sandbox plugin code, so a plugin can draw any
control anyway; these exist only so its fields look like the rest of the app.

## Writing an export file (new in 1.15)

```ts
const path = await context.ui.exportFile("tasks.csv", csvText); // → absolute path
context.ui.notice(`Exported to ${path}`);
```

Writes `content` to `<app data>/exports/<filename>` and resolves to the
absolute path. Core sanitises `filename` (path separators are replaced; a name
that sanitises to empty rejects), so the file always lands inside that one
folder. Requires `workspace.ui`. It is a thin wrapper over Core's existing
export path — no new permission, and the folder is one the user can already
open. Chunk very large content in the caller.

## Writing a binary export file (new in 1.16)

```ts
const path = await context.ui.exportBinary("report.xlsx", base64Bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
```

The binary twin of `exportFile` — pass base64-encoded bytes (a generated
spreadsheet, a rendered image) instead of text. Same sanitised `<app data>/exports/`
destination, same `workspace.ui` gate, same returned path. 50 MB cap. `mime`
is advisory. Build the base64 in the caller (`btoa` over a binary string).

## Writing a binary export file where the user picks (new in 1.19)

```ts
const path = await context.ui.exportBinaryAs("Manuscript.docx", base64Bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
if (path) context.ui.notice(`Saved to ${path}`);
// path is null if the user cancelled the dialog — not an error.
```

Like `exportBinary`, but through a native "Save As" dialog instead of the
fixed `<app data>/exports/` folder — the user picks both the destination
folder and the file name; `filename` only seeds the dialog's default name.
Same `workspace.ui` gate, same 50 MB cap. Resolves to `null` on cancel rather
than throwing, so check the result before treating it as success.
`exportFile`/`exportBinary` are unchanged — reach for this one specifically
when the user needs to choose where a file goes (sharing a manuscript with a
beta reader, say), not when Core's own exports folder is good enough.

---

## Domain types (new in 1.12)

A type defined by a plugin (`context.data.types.upsert(name, schema, …)`) may
carry a `behaviour` key in its `schema` (JSON):

```jsonc
{
  "fields": { /* … */ },
  "behaviour": {
    "container": true,    // expands in the tree, is a target for "Move to"
    "treeHidden": true     // does not show as a tree row, but [[link]] and search still find it
  }
}
```

**Namespace rule:** a plugin may only flag a type whose name starts with its
own `id` (`acme.book`, not `note` and not another plugin's `acme`). The Rust
command `upsert_type` enforces this — JS does not check it.

This is **name-collision protection, not a security boundary.** Notible does
not sandbox plugin code — plugin code runs in the same realm as Core — so the
flag only says "this type is mine and should behave this way", not "nobody else
can touch it".

## Prose profile (new in 1.12)

```ts
context.editor.registerProseProfile(match: ProseMatch, profile: ProseProfile): Disposable
```

Requires the **`editor.extension`** permission. Lets a plugin change the note
editor's behaviour for selected objects.

`match` is either `{ types?: string[] }` — type names **belonging to the
plugin** (the same namespace rule; built-in names like `note` are rejected) —
or `{ propEquals: { key, value } }`, where `key` must be prefixed with the
plugin's `id` (`acme.role`).

`profile` is `{ dashList?, fontProp?, fontMap?, focusMode?, pageBreaks? }`:

- **`dashList`** — when `false`, typing `- ` at the start of a line does **not**
  turn it into a list, and reopening the note keeps the literal dash instead of
  re-parsing it as a bullet. It does not change the Markdown dialect, only the
  live behaviour while typing — the serializer stays independent of the
  profile.
- **`fontProp`** / **`fontMap`** — Core reads `props[fontProp]`, maps it
  through `fontMap`, and sets `--nb-editor-font` on the editor content.
- **`focusMode`** — when `true`, the note's prose treatment (a narrow measure,
  typewriter-centred caret, dimmed paragraphs) rides on Core's own focus mode:
  the same button that hides the sidebar, Properties and toolbar chrome also
  applies the prose treatment. One button, one concept — there is no separate
  toggle.
- **`pageBreaks`** — when `true`, the editor draws a faint, dashed, unnumbered rule
  after every ~3300 characters of text (about one printed A4 page of body text),
  at the text line where that page would end. Counting characters rather than
  pixels keeps it right when paragraph spacing or the font change, but it is an
  estimate, not a print layout. Optional field: no API version bump.

The **first** registration for a given type / property key wins
(first-registration-wins).

---

## Storage

```ts
interface PluginStorage {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
  keys(): string[];
}
```

Synchronous, private to your plugin, **survives an app restart**. Values are
serialized to JSON, so keep data there, not functions or DOM elements.

Two things worth knowing:

- Storage is **not in the workspace database backup**. Do not keep anything
  there whose loss would hurt the user — save real data as objects through
  `context.data`.
- Uninstalling a plugin **deletes** its storage. Disabling does not.

### Store (1.25)

`context.store` keeps larger data than `context.storage`: up to 4 MB per value
and 256 MB per plugin, in its own database file. All methods are async.

| Method | Does |
|---|---|
| `get(key)` / `set(key, value)` / `delete(key)` | One text value. Keys are 1-512 bytes. |
| `getMany(keys)` / `setMany(entries)` / `deleteMany(keys)` | One transaction each. A `setMany` over a cap rejects as a whole. |
| `keys(prefix?)` | Sorted keys starting with `prefix`; `_` and `%` are literal. |
| `deletePrefix(prefix)` | Deletes every key starting with a non-empty `prefix`; returns the count. |

The store holds data **derived from this workspace**. Restoring a backup
empties it, and so does uninstalling the plugin's last version. Backups never
include it. It is not a secret store: every plugin runs in the same page.

A restore reloads the app; a write still in flight from before the restore is
refused, so treat a failed write as "start over", never as fatal. A plugin
loaded from the dev host (`npm run dev:plugins`) is not registered, so its
store is in memory only and empties on every reload.

---

## Lifecycle and cleanup

```
install → warning → onload(context) → active
                                        ↓
                        disable → onunload() → inactive
                                        ↓
                                uninstall → storage deleted
```

Notible cleans up automatically: command, view, settings and slot
registrations, and event subscriptions. **You must clean up yourself**
everything outside the API — `setInterval`, `setTimeout`, `addEventListener` on
`window`, open connections:

```js
onload(context) {
  this._timer = setInterval(() => {}, 1000);
},
onunload() {
  clearInterval(this._timer);
},
```

The `container` element from `mount` is cleared by the host, but return
anything you attached outside it in a `Disposable`.

---

## Editor

```ts
context.editor.registerCodeBlockRenderer(language, render): Disposable
```

Draw code blocks tagged with a given language — diagrams, charts, whatever.
Requires `editor.extension`.

```js
context.editor.registerCodeBlockRenderer("mermaid", ({ container, source }) => {
  container.textContent = `diagram: ${source.length} characters`;
  return { dispose: () => container.replaceChildren() };
});
```

### Renderer lifecycle (new in 1.3)

Your renderer is **not called once per block**. The host unmounts every
renderer and calls them again when it redraws a note: when it opens, and — from
1.3 — shortly after data changes anywhere in the workspace. This lets a block
showing live data keep up with it.

Two obligations follow, both important if you do anything asynchronous:

- **Be idempotent.** Draw into the `container` you got *this time*.
- **Stop after `dispose()`.** Any `await` can finish after your container is
  gone. Writing to it is invisible at best and at worst draws your result a
  second time, next to the new mount.

```js
context.editor.registerCodeBlockRenderer("mine", ({ container, plugin }) => {
  let disposed = false;
  void plugin.data.objects.query({ type: "task", limit: 50 }).then((rows) => {
    if (disposed) return;            // the container may already be gone
    container.textContent = `${rows.length} tasks`;
  });
  return { dispose: () => { disposed = true; container.replaceChildren(); } };
});
```

The contract is **deliberately narrow**. Core's editor is `CoreMarkdownEditor`
— a contenteditable over plain Markdown, not a ProseMirror document. There is
therefore no node schema and no transactions to expose, and pretending there
were would be a promise Core cannot keep.

This is why it is safe: **the original block stays in the document**, visible
and editable, and you draw below it, in a separate element with
`contenteditable="false"`. The serializer reads only that source block, so a
broken renderer — or an uninstalled plugin — costs you a drawing, never a note.
The source stays visible on purpose: hiding it made the block uneditable.

One renderer per language; a second plugin claiming a taken language is
rejected, the same as with shortcuts.

### Printing a drawing outside the editor (new in 1.20)

```ts
const svg = await context.editor.renderCodeBlockSvg("mermaid", source, { mode: "paper" });
// svg: finished SVG markup, or null when nothing draws this language as SVG
```

For output outside a note — a printed report, an export. No permission
needed. It rejects when the source cannot be drawn (a diagram with a syntax
error), so catch it and fall back to showing the source. `mode` is `paper`
(default, for print) or `night`. Core's own Mermaid renderer supports it.

A renderer opts in with a third argument:

```js
context.editor.registerCodeBlockRenderer("mine", render, {
  toSvg: async (source, mode) => `<svg xmlns="http://www.w3.org/2000/svg">…</svg>`,
});
```

### Persistent renderers and writing back (1.24)

`{ persistent: true }` keeps a mount alive across redraws while the block's
source is unchanged, so an interactive widget (a grid, a form) keeps focus and
state. Default renderers are still disposed and called again on every redraw.

The context also carries `readOnly` and `updateSource(next): boolean`. It
replaces the block's source in the note, as one note undo step, and the note
saves it. Your own write does not remount a persistent renderer. It returns
`false` when the block is gone. A change from elsewhere (undo, sync, editing
the source) remounts you with the new source.

A persistent renderer shares the document with the note editor. Core keeps note
keystrokes away from your container; you must ignore document- and
window-level events whose target is outside it.

```js
context.editor.registerCodeBlockRenderer("counter", ({ container, source, updateSource }) => {
  const button = document.createElement("button");
  button.textContent = source || "0";
  button.onclick = () => { button.textContent = String(Number(button.textContent) + 1); updateSource(button.textContent); };
  container.append(button);
}, { persistent: true });
```

## What is not here yet

An honest list so you don't waste time looking:

| Area | State |
|---|---|
| Broader editor extensions | code-block renderers only; no node schema, because Core is not ProseMirror |
| Writing the document projection | read-only; the reverse conversion is lossy |
| File access | no API; permissions removed, will return with the API |
| Running external processes | **deliberately out of scope, permanently** |
| Mobile and web builds | out of scope |

Direction of travel: `2026-08-16-plugin-api-design.md` (internal, not published).

### Conflict recovery (1.26)

`context.ui.openSyncConflicts(copyId?)` opens Core's Resolve conflict view for one copy, or its pending list when omitted. It requires `workspace.ui` and a real user gesture, with the same navigation rate limit as `openHelp`. It never saves, trashes or approves a resolution; Core owns those user choices.

`SyncConflictDescriptor` contains `originalId`, `copyId` and `fields` (content, title, props, parent_id, type, archived_at, trashed_at). SyncSnapshot exports optional `conflicts`; SyncApplyRequest may pass these alongside copy objects. Core ignores malformed descriptors, missing copies and stale pairs, never restores a note from metadata, never changes an existing pairing, and only widens the unresolved field set. Transport these with encrypted snapshots, including unchanged copies on retry/relay. Descriptors survive database backups and do not live in the plugin cache.
