import type { PluginContext, PluginType } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";
import { wordsWrittenOn, writingStreak, isoAddDays, type DailyWordLog } from "./typewriter-model.ts";

const NS = "notible.typewriter.";

/** Named manuscript fonts. `stack` is a real CSS font-family with fallbacks
 *  that land on something on both Windows and macOS. Core resolves
 *  `props.font` through `MANUSCRIPT_FONT_MAP` into `--nb-editor-font`. The
 *  three generic keys (`serif`/`sans`/`mono`) stay as aliases so manuscripts
 *  saved before this list still resolve. */
export const MANUSCRIPT_FONTS: { value: string; label: string; group: "serif" | "sans" | "mono"; stack: string }[] = [
  { value: "georgia", label: "Georgia", group: "serif", stack: "Georgia, 'Times New Roman', serif" },
  { value: "times", label: "Times New Roman", group: "serif", stack: "'Times New Roman', Times, serif" },
  { value: "palatino", label: "Palatino", group: "serif", stack: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif" },
  { value: "garamond", label: "Garamond", group: "serif", stack: "'EB Garamond', Garamond, 'Palatino Linotype', 'Times New Roman', serif" },
  { value: "iowan", label: "Iowan Old Style", group: "serif", stack: "'Iowan Old Style', 'Palatino Linotype', Georgia, serif" },
  { value: "arial", label: "Arial", group: "sans", stack: "Arial, Helvetica, sans-serif" },
  { value: "helvetica", label: "Helvetica", group: "sans", stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { value: "verdana", label: "Verdana", group: "sans", stack: "Verdana, Geneva, sans-serif" },
  { value: "system", label: "System UI", group: "sans", stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { value: "courier", label: "Courier New", group: "mono", stack: "'Courier New', Courier, monospace" },
  { value: "courier-prime", label: "Courier Prime", group: "mono", stack: "'Courier Prime', 'Courier New', monospace" },
];

export const MANUSCRIPT_FONT_MAP: Record<string, string> = {
  serif: "var(--notible-font-serif)",
  sans: "var(--notible-font-sans)",
  mono: "var(--notible-font-mono)",
  ...Object.fromEntries(MANUSCRIPT_FONTS.map((font) => [font.value, font.stack])),
};

const FONT_FIELD_OPTIONS = ["serif", "sans", "mono", ...MANUSCRIPT_FONTS.map((font) => font.value)];

export interface TypewriterTypeDefinition {
  name: string;
  icon: string;
  color: string;
  fields: Record<string, { type: string; options?: string[] }>;
  behaviour?: { container?: boolean; treeHidden?: boolean };
}

/** 7 namespaced types. `manuscript`/`part`/`chapter` are containers; `scene`
 * is a real note in the tree; `character`/`location`/`plotline` are treeHidden
 * (linkable + searchable, just not sidebar rows). */
export const TYPEWRITER_TYPE_DEFINITIONS: TypewriterTypeDefinition[] = [
  { name: `${NS}manuscript`, icon: "book-text", color: "#7c4a3f",
    fields: { logline: { type: "text" }, wordTarget: { type: "number" }, deadline: { type: "date" }, font: { type: "select", options: FONT_FIELD_OPTIONS } },
    behaviour: { container: true } },
  { name: `${NS}part`, icon: "book-copy", color: "#8a6d3b", fields: { synopsis: { type: "text" } }, behaviour: { container: true } },
  { name: `${NS}chapter`, icon: "book-marked", color: "#5c6f8a", fields: { synopsis: { type: "text" } }, behaviour: { container: true } },
  { name: `${NS}scene`, icon: "pen-line", color: "#7c4a3f",
    fields: { synopsis: { type: "text" }, status: { type: "select", options: ["idea", "draft", "revised", "final"] }, order: { type: "number" }, wordTarget: { type: "number" }, font: { type: "select", options: FONT_FIELD_OPTIONS } } },
  { name: `${NS}character`, icon: "user", color: "#4a6fa5",
    fields: { fullName: { type: "text" }, aliases: { type: "text" }, oneLine: { type: "text" }, colour: { type: "select", options: ["red", "green", "blue", "violet", "amber"] }, related: { type: "text" } },
    behaviour: { treeHidden: true } },
  { name: `${NS}location`, icon: "map-pin", color: "#3d9970", fields: { oneLine: { type: "text" } }, behaviour: { treeHidden: true } },
  { name: `${NS}plotline`, icon: "spline", color: "#7b6d8d",
    fields: { kind: { type: "select", options: ["main", "subplot", "arc"] } }, behaviour: { treeHidden: true } },
  { name: `${NS}beat`, icon: "git-branch", color: "#6d7f8d",
    fields: { note: { type: "text" }, colour: { type: "select", options: ["red", "amber", "green", "blue", "violet"] } }, behaviour: { treeHidden: true } },
  // Free-form thoughts and research ("Extras"): a Codex entry with its own note body.
  { name: `${NS}memo`, icon: "sticky-note", color: "#8d7b4a", fields: { oneLine: { type: "text" } }, behaviour: { treeHidden: true } },
];

function mergeSchema(existing: PluginType | undefined, incoming: TypewriterTypeDefinition): string {
  let schema: { fields?: Record<string, unknown>; behaviour?: unknown } = {};
  try { schema = existing ? JSON.parse(existing.schema) as { fields?: Record<string, unknown> } : {}; } catch { schema = {}; }
  const next: { fields: Record<string, unknown>; behaviour?: unknown } = {
    ...schema,
    fields: { ...(schema.fields ?? {}), ...incoming.fields },
  };
  if (incoming.behaviour) next.behaviour = incoming.behaviour;
  return JSON.stringify(next);
}

/** Synchronous, no DataApi — safe to call from `onActivate` at plugin load so
 * manuscript text opened before the Typewriter screen still gets the
 * dialogue-dash / font treatment.
 *
 * Every manuscript level is a long-form writing surface. Parts and chapters
 * often carry introductions or connective prose, so they expose the same
 * dialogue rules, font mapping and focus mode as scenes. */
export function registerSceneProseProfile(context: PluginContext) {
  context.editor.registerProseProfile(
    { types: [`${NS}part`, `${NS}chapter`, `${NS}scene`] },
    { dashList: false, focusMode: true, pageBreaks: true, fontProp: "font", fontMap: MANUSCRIPT_FONT_MAP },
  );
}

/** Idempotent type upserts. Called from the surface on mount and from the
 * "Set up Typewriter" command (planning does the same with installPlanning). */
export async function registerTypesAndProfile(context: PluginContext) {
  const existing = await context.data.types.list();
  for (const definition of TYPEWRITER_TYPE_DEFINITIONS) {
    const current = existing.find((candidate) => candidate.name === definition.name);
    // icon/color are plugin-owned, not user-tunable — let the definition win
    // on every upsert so an older emoji icon migrates to the lucide name.
    await context.data.types.upsert(definition.name, mergeSchema(current, definition), definition.icon, definition.color);
  }
  return { pluginId: context.manifest.id, typeCount: TYPEWRITER_TYPE_DEFINITIONS.length, types: TYPEWRITER_TYPE_DEFINITIONS.map((definition) => definition.name) };
}

/** Create `kind` from → to. When `single`, first delete every existing
 *  relation of `kind` originating at `fromId` (pov / setIn are one per scene;
 *  a sync-introduced duplicate is also swept here). */
export async function setSystemicRelation(
  context: PluginContext,
  fromId: string,
  toId: string,
  kind: string,
  options: { single?: boolean } = {},
) {
  if (options.single) {
    const existing = await context.data.relations.list(fromId);
    for (const relation of existing) {
      if (relation.kind === kind && relation.from_id === fromId && relation.to_id !== toId) {
        await context.data.relations.delete(fromId, relation.to_id, kind);
      }
    }
  }
  await context.data.relations.create(fromId, toId, kind);
}

export function removeSystemicRelation(context: PluginContext, fromId: string, toId: string, kind: string) {
  return context.data.relations.delete(fromId, toId, kind);
}

/** Create one manuscript. Returns the raw object so Core's "+" menu can open
 *  it (see `addPluginObject` in CoreOnlyApp). Registers the 7 types first so
 *  the tree treats the new manuscript as a container immediately. */
export async function createManuscript(context: PluginContext, input?: unknown) {
  const value = input && typeof input === "object" ? input as { title?: unknown; parentId?: unknown } : {};
  await registerTypesAndProfile(context).catch(() => {});
  return context.data.objects.create({
    type: `${NS}manuscript`,
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : "Untitled manuscript",
    props: "{}",
    parentId: typeof value.parentId === "string" ? value.parentId : undefined,
  });
}

/** Fire-and-forget a background task, swallowing whatever it rejects with —
 *  same rationale as calendar.ts's own `background()`: invoked from a timer,
 *  nothing downstream awaits it, so an uncaught rejection would surface as
 *  an unhandled rejection at the process level instead of a plugin error. */
function background(task: () => Promise<void>): void {
  task().catch(() => {});
}

const STREAK_CHECK_INTERVAL_MS = 15 * 60 * 1000;
// Only nag in the evening — a lunchtime reminder for something due by
// midnight is just noise.
const STREAK_REMINDER_HOUR = 20;

/** Checks every manuscript with streak tracking (`tw.daily.<id>` in plugin
 *  storage — written by the Progress tab, see typewriter-ui.tsx) for one
 *  that has an active streak through yesterday but no words yet today, and
 *  sends one native notification naming them. At most once per manuscript
 *  per day (`tw.streakNotified.<id>`), and only after STREAK_REMINDER_HOUR
 *  local time. Silently does nothing without the `notifications` permission
 *  or outside the reminder window — this runs on a 15-minute timer for as
 *  long as the plugin is enabled, not only while Progress is open. */
async function checkStreakReminders(context: PluginContext): Promise<void> {
  if (!context.permissions.has("notifications")) return;
  const now = new Date();
  if (now.getHours() < STREAK_REMINDER_HOUR) return;
  const today = now.toISOString().slice(0, 10);
  const yesterday = isoAddDays(today, -1);
  const atRisk: string[] = [];
  for (const key of context.storage.keys()) {
    const manuscriptId = /^tw\.daily\.(.+)$/.exec(key)?.[1];
    if (!manuscriptId) continue;
    const notifiedKey = `tw.streakNotified.${manuscriptId}`;
    if (context.storage.get<string>(notifiedKey) === today) continue;
    const log = context.storage.get<DailyWordLog>(key) ?? {};
    const wroteToday = wordsWrittenOn(log, today);
    if (wroteToday !== null && wroteToday > 0) continue; // already safe today
    if (writingStreak(log, yesterday) <= 0) continue; // nothing at risk
    const manuscript = await context.data.objects.get(manuscriptId).catch(() => null);
    if (!manuscript) continue;
    atRisk.push(manuscript.title || "Untitled manuscript");
    context.storage.set(notifiedKey, today);
  }
  if (atRisk.length === 0) return;
  const body = atRisk.length === 1
    ? `Write something in "${atRisk[0]}" today to keep your streak going.`
    : `Write something today to keep your streak going in: ${atRisk.join(", ")}.`;
  await context.notifications.show({ title: "Your writing streak is at risk", body });
}

export const typewriterPlugin = createBuiltinSurface({
  manifest: {
    id: "notible.typewriter", name: "Typewriter", version: "0.1.0", apiVersion: "0.1", entry: "index.ts",
    description: "Write stories and books — a manuscript outline, a codex of characters and places, and a prose editing mode.",
    permissions: ["data.read", "data.write", "relations.write", "workspace.ui", "editor.extension", "notifications"], sync: "data",
  },
  capability: "typewriter",
  commandName: "Set up Typewriter",
  viewTitle: "Typewriter",
  // No settings panel: everything Typewriter configures lives on the manuscript
  // object's own tabs (Manuscript / Codex / Progress / Board). A separate
  // Settings screen only duplicated them.
  onCommand: async (context) => registerTypesAndProfile(context),
  // Synchronous prose profile now; the async type upserts are best-effort so a
  // host without DataApi at load (the isolation test host) still enables the
  // plugin. The surface mount and the "Set up Typewriter" command re-run them.
  onActivate: (context) => {
    registerSceneProseProfile(context);
    void registerTypesAndProfile(context).catch(() => {});
    // Once immediately (evening reload shouldn't wait up to 15 minutes), then
    // on the recurring timer — same idiom as calendar.ts's own reminders.
    background(() => checkStreakReminders(context));
    context.scheduler.every(STREAK_CHECK_INTERVAL_MS, () => checkStreakReminders(context));
  },
  commands: [
    { id: "new-manuscript", name: "New manuscript", description: "Start a new long-form manuscript",
      creates: { objectType: `${NS}manuscript`, label: "Manuscript" },
      execute: (context, input) => createManuscript(context, input) },
  ],
  // The manuscript screen is a dashboard of tabs, like a project. part/chapter
  // register no tab and fall through to the plain note editor.
  objectTabs: [
    { id: "manuscript", label: "Manuscript", objectTypes: [`${NS}manuscript`], order: 0, viewId: "surface", viewProps: { tab: "manuscript" } },
    { id: "codex", label: "Codex", objectTypes: [`${NS}manuscript`], order: 1, viewId: "surface", viewProps: { tab: "codex" } },
    { id: "progress", label: "Progress", objectTypes: [`${NS}manuscript`], order: 2, viewId: "surface", viewProps: { tab: "progress" } },
    { id: "board", label: "Board", objectTypes: [`${NS}manuscript`], order: 3, viewId: "surface", viewProps: { tab: "board" } },
  ],
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./typewriter-ui"), context }),
});
