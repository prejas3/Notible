import type { PluginContext, PluginObject } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";

/** Whole-workspace backup/restore is Core's job (Settings → Recovery →
 * "Create database backup"), not this plugin's — this plugin exists for
 * exporting/importing one note/project (and its children) at a time, e.g.
 * to hand off or move a single piece of work. */
export function exportWorkspace(objects: PluginObject[]): string { return JSON.stringify({ format: "notible-plugin-export", version: 1, objects }, null, 2); }

/** One object plus every descendant reachable through parent_id, in
 * top-down order (parents before children) so import can recreate them
 * with working parent links. */
export function collectObjectTree(rootId: string, allObjects: PluginObject[]): PluginObject[] {
  const byParent = new Map<string, PluginObject[]>();
  for (const object of allObjects) {
    const parentId = object.parent_id;
    if (!parentId) continue;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), object]);
  }
  const root = allObjects.find((object) => object.id === rootId);
  if (!root) return [];
  const collected: PluginObject[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    collected.push(current);
    queue.push(...(byParent.get(current.id) ?? []));
  }
  return collected;
}

export async function exportObjectTree(context: PluginContext, input?: unknown) {
  const value = input && typeof input === "object" ? input as { objectId?: unknown } : {};
  if (typeof value.objectId !== "string" || !value.objectId) throw new Error("objectId is required");
  const [root, all] = await Promise.all([context.data.objects.get(value.objectId), context.data.objects.query({ limit: 5000 })]);
  if (!root) throw new Error(`Object not found: ${value.objectId}`);
  const objects = collectObjectTree(value.objectId, all);
  return { pluginId: context.manifest.id, format: "notible-plugin-export", content: exportWorkspace(objects), count: objects.length };
}

export async function exportPluginData(context: PluginContext) { const objects = await context.data.objects.query({ limit: 5000 }); return { pluginId: context.manifest.id, format: "notible-plugin-export", content: exportWorkspace(objects), count: objects.length }; }

interface TiptapNode { type?: string; text?: string; content?: TiptapNode[] }

/** Plain-text run of a Tiptap node tree — good enough for the flattened
 * paragraph-per-line documents both Core's editor and simple notes produce;
 * headings/lists still read as sensible Markdown lines. */
function nodeToMarkdownLine(node: TiptapNode): string {
  if (node.type === "text") return node.text ?? "";
  const inner = (node.content ?? []).map(nodeToMarkdownLine).join("");
  if (node.type === "heading") return `## ${inner}`;
  if (node.type === "listItem" || node.type === "taskItem") return `- ${inner}`;
  return inner;
}

/** Renders one object as a standalone Markdown document ("# Title" plus one
 * line per top-level content block) for "Download as .md". */
export function objectToMarkdown(object: PluginObject): string {
  let doc: { content?: TiptapNode[] } = {};
  try { doc = JSON.parse(object.content || "{}") as { content?: TiptapNode[] }; } catch { /* not JSON content */ }
  const body = (doc.content ?? []).map(nodeToMarkdownLine).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return `# ${object.title || "Untitled"}\n\n${body}\n`;
}

/** Imports a previously exported object tree. `parentId` re-roots the
 * import under a different existing object (e.g. dropping an exported note
 * into another project); omitted, each object keeps its original
 * parent_id from the export. */
export async function importPluginData(context: PluginContext, input?: unknown) {
  const value = input && typeof input === "object" ? input as { objects?: unknown; parentId?: unknown } : {};
  if (!Array.isArray(value.objects)) throw new Error("objects array is required");
  const reroot = typeof value.parentId === "string" && value.parentId ? value.parentId : undefined;
  const idMap = new Map<string, string>();
  const result: PluginObject[] = [];
  for (const candidate of value.objects) {
    if (!candidate || typeof candidate !== "object") continue;
    const object = candidate as Partial<PluginObject>;
    if (typeof object.type !== "string" || typeof object.title !== "string") continue;
    const content = typeof object.content === "string" ? object.content : undefined;
    const props = typeof object.props === "string" ? object.props : "{}";
    const originalParentId = typeof object.parent_id === "string" ? object.parent_id : undefined;
    const parentId = result.length === 0 ? reroot : (originalParentId && idMap.get(originalParentId)) ?? reroot;
    const existing = typeof object.id === "string" && object.id ? await context.data.objects.get(object.id) : null;
    const matched = existing ?? (await context.data.objects.query({ type: object.type, limit: 5000 })).find((candidate2) => candidate2.title === object.title) ?? null;
    const created = matched
      ? await context.data.objects.update(matched.id, { title: object.title, content, props })
      : await context.data.objects.create({ type: object.type, title: object.title, content, props, parentId });
    if (typeof object.id === "string") idMap.set(object.id, created.id);
    result.push(created);
  }
  return { pluginId: context.manifest.id, imported: result.length, objects: result };
}

export const importExportPlugin = createBuiltinSurface({
  manifest: { id: "notible.import-export", name: "Import and export", version: "0.1.0", apiVersion: "0.1", entry: "index.ts", description: "Export or import a single note/project and its children — whole-workspace backups live in Settings → Recovery.", permissions: ["data.read", "data.write", "workspace.ui" ] },
  capability: "import-export",
  commandName: "Export a note or project",
  viewTitle: "Import and export",
  onCommand: async (context, input) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    if ("objects" in value) return importPluginData(context, input);
    if (typeof value.objectId === "string") return exportObjectTree(context, input);
    return exportPluginData(context);
  },
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
  settingsRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
});
