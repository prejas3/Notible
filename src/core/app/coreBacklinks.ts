import type { PluginObject, PluginRelation } from "../../../packages/plugin-api/src/index.ts";

export interface CoreBacklink {
  source: PluginObject;
  context: string;
  target: string;
  /** `context` is then a fixed English label, to be translated where drawn. */
  fromRelation?: boolean;
}

const STRUCTURAL_RELATIONS = new Set(["in"]);

/** Plain words for a relation; the raw kind ("links_to") read as developer jargon. */
const RELATION_LABELS: Record<string, string> = { links_to: "Links here", depends_on: "Depends on this", blocks: "Blocked by this" };

function textFromContent(raw: string) {
  try {
    const document = JSON.parse(raw) as { content?: unknown[] };
    const read = (node: unknown): string => {
      if (!node || typeof node !== "object") return "";
      const value = node as { text?: unknown; content?: unknown[]; type?: unknown };
      if (typeof value.text === "string") return value.text;
      const children = Array.isArray(value.content) ? value.content.map(read).join("") : "";
      return value.type === "paragraph" || value.type === "heading" ? `${children}\n` : children;
    };
    return Array.isArray(document.content) ? document.content.map(read).join("").trim() : raw;
  } catch {
    return raw;
  }
}

function normalize(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function aliasesFor(object: PluginObject) {
  try {
    const props = JSON.parse(object.props || "{}") as Record<string, unknown>;
    const aliases = [props.aliases, props.previousTitles, props.titleAliases]
      .flatMap((value) => Array.isArray(value) ? value : [])
      .filter((value): value is string => typeof value === "string");
    return aliases;
  } catch {
    return [];
  }
}

/** A "#" inside a wikilink is ambiguous: it can start a heading anchor
 * (`[[Note#Section]]`) or simply be part of the title (`[[Feedback 18.08.26 #1]]`,
 * and three objects in this workspace are named exactly like that). Splitting on
 * it unconditionally used to drop the "#1" and leave a link that resolved to
 * nothing, which is why those notes rendered as links but counted zero backlinks.
 * Both readings are returned; resolution prefers the full title and falls back to
 * the part before the anchor. */
export function extractWikilinkTargets(raw: string) {
  const text = textFromContent(raw);
  const targets: string[] = [];
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu;
  for (const match of text.matchAll(pattern)) {
    const whole = match[1]?.trim();
    if (!whole) continue;
    targets.push(whole);
    const anchorAt = whole.indexOf("#");
    const beforeAnchor = anchorAt > 0 ? whole.slice(0, anchorAt).trim() : "";
    if (beforeAnchor && beforeAnchor !== whole) targets.push(beforeAnchor);
  }
  return targets;
}

export function backlinkTargets(object: PluginObject) {
  return new Set([object.id, object.title, ...aliasesFor(object)].map(normalize).filter(Boolean));
}

/**
 * The `[[` the caret is currently inside, if any.
 *
 * Unlike the slash trigger this cannot stop at a space: note titles have spaces
 * in them ("Kafka issue review"), which is exactly why typing the title by hand
 * was never a workable substitute for a picker. It stops at a newline, at a
 * closing bracket, and once the link is already closed.
 */
export function detectWikilinkTrigger(value: string, cursor: number) {
  const upto = value.slice(0, Math.max(0, Math.min(cursor, value.length)));
  const open = upto.lastIndexOf("[[");
  if (open < 0) return null;
  const filter = upto.slice(open + 2);
  // "]" means this link is already closed and the caret is past it; a newline
  // means the user moved on and the "[[" was never a link at all.
  if (filter.includes("]") || filter.includes("\n") || filter.includes("[")) return null;
  // Typing "[[" auto-closes it, so a "]]" usually waits right after the caret.
  // The picked link replaces it too; left alone it trailed the link as "]]]]"
  // and the rest of the sentence went inside the link (E7).
  const end = value.startsWith("]]", cursor) ? cursor + 2 : cursor;
  return { start: open, end, filter };
}

/** Objects worth offering for `[[<filter>`, best first. Substring match on the
 * title, because that is what someone half-remembering a note types. */
export function wikilinkSuggestions(filter: string, objects: PluginObject[], limit = 8) {
  const needle = normalize(filter);
  const scored = objects
    .map((object) => {
      const title = normalize(object.title || "");
      if (!title) return null;
      if (!needle) return { object, rank: 2 };
      const at = title.indexOf(needle);
      if (at < 0) return null;
      // Prefix matches first: typing "kaf" should offer "Kafka issue" before a
      // note that merely mentions it later in a long title.
      return { object, rank: at === 0 ? 0 : 1 };
    })
    .filter((entry): entry is { object: PluginObject; rank: number } => entry !== null);
  scored.sort((left, right) => left.rank - right.rank
    || (right.object.updated_at ?? 0) - (left.object.updated_at ?? 0)
    || left.object.id.localeCompare(right.object.id));
  return scored.slice(0, limit).map((entry) => entry.object);
}

/** Resolve the visible target of a wikilink to a real workspace object. */
export function resolveWikilinkTarget(target: string, objects: PluginObject[]) {
  const whole = normalize(target);
  if (!whole) return null;
  // A note with this title now beats one that only had it before a rename.
  const exact = objects.find((object) => normalize(object.title || "") === whole) ?? objects.find((object) => backlinkTargets(object).has(whole));
  if (exact) return exact;
  // Only now read a "#" as a heading anchor: a title that genuinely contains
  // one wins over the anchor reading. See extractWikilinkTargets.
  const anchorAt = whole.indexOf("#");
  if (anchorAt <= 0) return null;
  const beforeAnchor = normalize(whole.slice(0, anchorAt));
  if (!beforeAnchor || beforeAnchor === whole) return null;
  return objects.find((object) => backlinkTargets(object).has(beforeAnchor)) ?? null;
}

function contextFor(text: string, target: string) {
  const lines = text.split(/\r?\n/u);
  const needle = normalize(target);
  return lines.find((line) => extractWikilinkTargets(line).some((candidate) => normalize(candidate) === needle))?.trim() || `[[${target}]]`;
}

export function resolveBacklinks(target: PluginObject | null, objects: PluginObject[], relations: PluginRelation[] = []): CoreBacklink[] {
  if (!target) return [];
  const targets = backlinkTargets(target);
  const backlinks = objects
    .filter((source) => source.id !== target.id)
    .map((source) => {
      const text = textFromContent(source.content);
      const match = extractWikilinkTargets(text).find((candidate) => targets.has(normalize(candidate)));
      return match ? { source, context: contextFor(text, match), target: match } : null;
    })
    .filter((value): value is CoreBacklink => value !== null)
    .concat(
      relations
        .filter((relation) => relation.to_id === target.id && relation.from_id !== target.id && !STRUCTURAL_RELATIONS.has(relation.kind))
        .map((relation): CoreBacklink | null => {
          const source = objects.find((object) => object.id === relation.from_id);
          return source ? { source, context: RELATION_LABELS[relation.kind] ?? "Links here", fromRelation: true, target: target.title } : null;
        })
        .filter((value): value is CoreBacklink => value !== null),
    );
  const unique = new Map(backlinks.map((backlink) => [backlink.source.id, backlink]));
  return [...unique.values()].sort((left, right) => left.source.title.localeCompare(right.source.title));
}
