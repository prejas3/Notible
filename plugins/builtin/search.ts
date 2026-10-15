import type { PluginContext, PluginObject } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";

export function matchesSearch(object: PluginObject, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [object.title, object.content, object.props].map((value) => value.toLocaleLowerCase()).some((value) => value.includes(needle));
}

export async function searchWorkspace(context: PluginContext, input?: unknown) {
  const query = input && typeof input === "object" && "query" in input ? String((input as { query?: unknown }).query ?? "") : String(input ?? "");
  const objects = await context.data.objects.query({ limit: 5000 });
  const results = objects.filter((object) => matchesSearch(object, query));
  return { pluginId: context.manifest.id, query, results, count: results.length };
}

function textFromContent(raw: string): string {
  try {
    const document = JSON.parse(raw) as { content?: unknown[] };
    const read = (node: unknown): string => {
      if (!node || typeof node !== "object") return "";
      const value = node as { text?: unknown; content?: unknown[] };
      if (typeof value.text === "string") return value.text;
      return Array.isArray(value.content) ? value.content.map(read).join("") : "";
    };
    return Array.isArray(document.content) ? document.content.map(read).join(" ") : raw;
  } catch {
    return raw;
  }
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function wikilinkTargets(raw: string): string[] {
  const text = textFromContent(raw);
  const pattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/gu;
  return [...text.matchAll(pattern)].map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value));
}

function aliasesOf(object: PluginObject): string[] {
  try {
    const props = JSON.parse(object.props || "{}") as Record<string, unknown>;
    return [props.aliases, props.previousTitles, props.titleAliases].flatMap((value) => Array.isArray(value) ? value : []).filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

/** A source object counts as linking to the target if either a real
 * relation points at it, OR its content contains a `[[wikilink]]` matching
 * the target's title or a known alias — the same two-source rule Core's own
 * note backlinks use, so this plugin's results aren't a narrower, second
 * implementation of the same feature. */
export async function listBacklinks(context: PluginContext, input?: unknown) {
  const objectId = input && typeof input === "object" ? (input as { objectId?: unknown }).objectId : input;
  if (typeof objectId !== "string" || !objectId) throw new Error("objectId is required");
  const target = await context.data.objects.get(objectId);
  if (!target) throw new Error(`Object not found: ${objectId}`);
  const targetNeedles = new Set([target.id, target.title, ...aliasesOf(target)].map(normalize).filter(Boolean));
  const objects = await context.data.objects.query({ limit: 5000 });
  const linked = await Promise.all(objects.filter((object) => object.id !== objectId).map(async (object) => {
    const viaWikilink = wikilinkTargets(object.content).some((candidate) => targetNeedles.has(normalize(candidate)));
    if (viaWikilink) return object;
    const relations = await context.data.relations.list(object.id);
    return relations.some((relation) => relation.to_id === objectId) ? object : null;
  }));
  return { pluginId: context.manifest.id, objectId, results: linked.filter((object): object is PluginObject => object !== null) };
}

export const searchPlugin = createBuiltinSurface({
  manifest: { id: "notible.search", name: "Search and backlinks", version: "0.1.0", apiVersion: "0.1", entry: "index.ts", description: "Advanced search, backlinks, activity and graph surfaces.", permissions: ["data.read", "workspace.ui"], },
  capability: "search",
  commandName: "Search workspace",
  viewTitle: "Search",
  settingsTitle: "Search settings",
  onCommand: searchWorkspace,
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
  settingsRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
});
