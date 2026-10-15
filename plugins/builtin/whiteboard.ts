import type { PluginContext } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";

/** Obsidian-Canvas-style node. `card` = freeform text; `note` = link to a
 * workspace object; `shape` = a labelled diagram form (rectangle, rounded, ellipse, diamond); `section` = a large frame
 * you drop other nodes onto; `image` = an inline picture (data: URI, so the
 * board is self-contained and syncs with its own content); `table` = a small
 * editable grid. */
export interface CanvasNode {
  id: string;
  kind: "card" | "note" | "shape" | "section" | "image" | "table";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  linkedObjectId?: string;
  color?: string;
  shape?: "rectangle" | "rounded" | "ellipse" | "diamond";
  imageUrl?: string;
  rows?: string[][];
}
export interface CanvasEdge { id: string; from: string; to: string; label?: string; }
export interface WhiteboardDocument { version: 1; nodes: CanvasNode[]; edges: CanvasEdge[]; viewport: { x: number; y: number; zoom: number } }
export const EMPTY_WHITEBOARD: WhiteboardDocument = { version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };

export function parseWhiteboard(content: string): WhiteboardDocument { try { const value = JSON.parse(content) as Partial<WhiteboardDocument>; if (value.version === 1 && Array.isArray(value.nodes) && Array.isArray(value.edges)) return { ...EMPTY_WHITEBOARD, ...value, viewport: { ...EMPTY_WHITEBOARD.viewport, ...value.viewport } }; } catch { /* legacy or empty content */ } return EMPTY_WHITEBOARD; }

export async function createWhiteboard(context: PluginContext, input?: unknown) {
  const value = input && typeof input === "object" ? input as { title?: unknown; parentId?: unknown } : {};
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : "Whiteboard";
  const object = await context.data.objects.create({ type: "whiteboard", title, content: JSON.stringify(EMPTY_WHITEBOARD), props: "{}", parentId: typeof value.parentId === "string" ? value.parentId : undefined });
  return { pluginId: context.manifest.id, object };
}

/**
 * The dedicated whiteboard for a folder/project/space, for the container's
 * "Whiteboard" tab. It is a real child `whiteboard` object (so it versions,
 * syncs and opens like any board) marked `props._containerBoard: true` so the
 * tab finds the same one on every open instead of making a new one. Created
 * lazily on first open — same pattern as `ensureDefaultView` for views.
 */
export async function ensureContainerBoard(context: PluginContext, containerId: string): Promise<string> {
  const children = await context.data.objects.query({ parentId: containerId, type: "whiteboard", limit: 100 });
  const existing = children.find((child) => {
    try { return (JSON.parse(child.props || "{}") as { _containerBoard?: unknown })._containerBoard === true; }
    catch { return false; }
  });
  if (existing) return existing.id;
  const created = await context.data.objects.create({
    type: "whiteboard",
    title: "Whiteboard",
    content: JSON.stringify(EMPTY_WHITEBOARD),
    props: JSON.stringify({ _containerBoard: true }),
    parentId: containerId,
  });
  return created.id;
}

export async function updateWhiteboard(context: PluginContext, input?: unknown) {
  const value = input && typeof input === "object" ? input as { objectId?: unknown; document?: unknown } : {};
  if (typeof value.objectId !== "string") throw new Error("objectId is required");
  const current = await context.data.objects.get(value.objectId);
  if (!current) throw new Error(`Whiteboard not found: ${value.objectId}`);
  const document = value.document && typeof value.document === "object" ? value.document as WhiteboardDocument : parseWhiteboard(current.content);
  if (document.version !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new Error("Invalid whiteboard document");
  const updated = await context.data.objects.update(current.id, { content: JSON.stringify({ ...EMPTY_WHITEBOARD, ...document, viewport: { ...EMPTY_WHITEBOARD.viewport, ...document.viewport } }) }, current.updated_at);
  return { pluginId: context.manifest.id, object: updated };
}

export const whiteboardPlugin = createBuiltinSurface({
  manifest: { id: "notible.whiteboard", name: "Whiteboard", version: "0.1.0", apiVersion: "0.1", entry: "index.ts", description: "Freeform whiteboards and visual workspace blocks.", permissions: ["data.read", "data.write", "workspace.ui", "editor.extension"], sync: "data" },
  capability: "whiteboard",
  commandName: "Create whiteboard",
  viewTitle: "Whiteboard",
  // No Settings panel: a whiteboard is created from the "+" menu and edited on
  // its own Board tab — a settings section only listed boards and repeated the
  // description. The Board object tab satisfies the surface check.
  onCommand: async (context, input) => input && typeof input === "object" && "objectId" in input ? updateWhiteboard(context, input) : createWhiteboard(context, input),
  commands: [
    { id: "create-canvas", name: "Create whiteboard", description: "A freeform board for cards, shapes and linked notes.", creates: { objectType: "whiteboard", label: "Whiteboard", icon: "🖼️" }, execute: (context, input) => createWhiteboard(context, input).then((result) => result.object) },
  ],
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
  extraViews: [
    { id: "canvas", title: "Canvas", render: (context) => ({ kind: "react-loader", loader: () => import("./canvas-ui"), context }) },
  ],
  objectTabs: [
    { id: "canvas", label: "Board", objectTypes: ["whiteboard"], order: 0, viewId: "canvas" },
    // A folder/project/space gets a "Whiteboard" tab bound to its own
    // dedicated child board (resolved by `containerBoard` in canvas-ui), not to
    // the container object itself — the container keeps its plain note body.
    { id: "board", label: "Whiteboard", description: "A freeform canvas — cards, shapes, sections, linked notes.", objectTypes: ["folder", "project", "space"], order: 60, viewProps: { containerBoard: true }, viewId: "canvas" },
  ],
});
