import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Plus, Minus, Square, BoxSelect, Image as ImageIcon, Table2, Check, ChevronRight, MoreHorizontal } from "lucide-react";
import type { PluginContext, PluginObject } from "../../packages/plugin-api/src/index.ts";
import { freeSpot, removeSpot } from "./link-geometry.ts";
import { ensureContainerBoard, parseWhiteboard, type CanvasNode, type WhiteboardDocument } from "./whiteboard.ts";
import "./surface.css";
import "./canvas-ui.css";
import { PluginI18nProvider, useT } from "./i18n.tsx";

interface Props {
  context: unknown;
  host?: { openObject(id: string): Promise<void>; notifyChanged(): void };
  /** The board object id — or, when `containerBoard` is set, a container id. */
  initialContainerId?: string;
  /** Container "Whiteboard" tab: `initialContainerId` is a folder/project/space,
   * resolved to that container's dedicated child board on mount. */
  containerBoard?: boolean;
}

interface XY { x: number; y: number; }

/** Node colour is a ribbon down the left edge (a fill on a shape), never a full
 *  fill on a card — the same language as the Typewriter board. */
const NODE_COLOURS = ["red", "amber", "green", "blue", "violet"] as const;
type NodeColour = (typeof NODE_COLOURS)[number];
const COLOUR_LABEL: Record<NodeColour, string> = { red: "Red", amber: "Amber", green: "Green", blue: "Blue", violet: "Violet" };
/** Boards saved before ribbons stored a pastel fill per card; map each to the
 *  nearest ribbon so they keep a colour instead of losing it. */
const LEGACY_COLOUR: Record<string, NodeColour> = { "#e3d5b8": "amber", "#cfe0d2": "green", "#cddbe8": "blue", "#e4cdc9": "red", "#d9d2e3": "violet" };
function colourOf(node: CanvasNode): NodeColour | undefined {
  const value = node.color;
  if (!value) return undefined;
  if ((NODE_COLOURS as readonly string[]).includes(value)) return value as NodeColour;
  return LEGACY_COLOUR[value.toLowerCase()];
}

const SHAPES = [
  { value: "rectangle", label: "Rectangle" },
  { value: "rounded", label: "Rounded" },
  { value: "ellipse", label: "Ellipse" },
  { value: "diamond", label: "Diamond" },
] as const;

const TABLE_ROW_H = 30;
const tableHeight = (rows: number) => 18 + rows * TABLE_ROW_H;

const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
function errorMessage(value: unknown) { return value instanceof Error ? value.message : String(value); }

function iconOf(type: string): string {
  return ({ task: "☑", issue: "🐞", note: "📄", project: "📁", folder: "📂" } as Record<string, string>)[type] ?? "●";
}

/** Right-angle (elbow) connector path between two node boxes, draw.io-style:
 * exit/enter whichever pair of facing sides is shortest, with a single bend
 * on the axis of greater separation. One-to-many/many-to-one just means
 * several of these sharing an endpoint node — nothing extra needed here. */
function elbowPoints(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): XY[] {
  const acx = a.x + a.width / 2, acy = a.y + a.height / 2;
  const bcx = b.x + b.width / 2, bcy = b.y + b.height / 2;
  const dx = bcx - acx, dy = bcy - acy;
  if (Math.abs(dx) > Math.abs(dy)) {
    const sx = dx > 0 ? a.x + a.width : a.x, sy = acy;
    const ex = dx > 0 ? b.x : b.x + b.width, ey = bcy;
    const midX = (sx + ex) / 2;
    return [{ x: sx, y: sy }, { x: midX, y: sy }, { x: midX, y: ey }, { x: ex, y: ey }];
  }
  const sx = acx, sy = dy > 0 ? a.y + a.height : a.y;
  const ex = bcx, ey = dy > 0 ? b.y : b.y + b.height;
  const midY = (sy + ey) / 2;
  return [{ x: sx, y: sy }, { x: sx, y: midY }, { x: ex, y: midY }, { x: ex, y: ey }];
}
const pathOf = (pts: XY[]) => `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")}`;
function elbowPath(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): string {
  return pathOf(elbowPoints(a, b));
}

type Sub = "add" | "colour" | "shape" | "table" | null;

function SubMenu({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  return (
    <div className="canvas-menu-item" onMouseEnter={() => onToggle(true)} onMouseLeave={() => onToggle(false)}>
      <button type="button" className="canvas-menu-parent" aria-haspopup="menu" aria-expanded={open} onClick={() => onToggle(!open)}>
        <span>{label}</span>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      {open && <div className="canvas-menu canvas-submenu" role="menu">{children}</div>}
    </div>
  );
}

function CanvasBoardInner({ context: rawContext, host, initialContainerId, containerBoard }: Props) {
  const t = useT();
  const context = rawContext as PluginContext;
  const [objectId, setObjectId] = useState(containerBoard ? "" : (initialContainerId ?? ""));
  const [object, setObject] = useState<PluginObject | null>(null);
  const [doc, setDoc] = useState<WhiteboardDocument | null>(null);
  const [linkedTitles, setLinkedTitles] = useState<Map<string, PluginObject>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [taskPick, setTaskPick] = useState<Set<string> | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkPickerFor, setLinkPickerFor] = useState<string | null>(null);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<PluginObject[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [connectDragFrom, setConnectDragFrom] = useState<string | null>(null);
  const [connectPreview, setConnectPreview] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string | null; at: XY } | null>(null);
  const [sub, setSub] = useState<Sub>(null);
  const updatedAtRef = useRef(0);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageAt = useRef<XY | null>(null);
  const drag = useRef<{ kind: "node" | "resize" | "pan" | "connect"; id?: string; startX: number; startY: number; origin: { x: number; y: number; width?: number; height?: number }; carry?: Record<string, { x: number; y: number }>; typeInto?: HTMLTextAreaElement } | null>(null);
  // The node whose text box takes focus after the next render (a new card is ready to type in).
  const [focusNode, setFocusNode] = useState<string | null>(null);
  useEffect(() => {
    if (!focusNode) return;
    surfaceRef.current?.querySelector<HTMLTextAreaElement>(`[data-node-id="${focusNode}"] textarea`)?.focus();
    setFocusNode(null);
  });
  // Distance in canvas units within which a dragged edge/center snaps to
  // another node's matching edge/center, PowerPoint-style.
  const SNAP_THRESHOLD = 6;

  useEffect(() => {
    if (!containerBoard || !initialContainerId) return;
    let cancelled = false;
    ensureContainerBoard(context, initialContainerId)
      .then((id) => { if (!cancelled) setObjectId(id); })
      .catch((value) => { if (!cancelled) setError(errorMessage(value)); });
    return () => { cancelled = true; };
  }, [containerBoard, initialContainerId, context]);

  useEffect(() => {
    if (!objectId) return;
    (async () => {
      try {
        const current = await context.data.objects.get(objectId);
        if (!current) { setError("Whiteboard not found."); return; }
        setObject(current);
        updatedAtRef.current = current.updated_at;
        const parsed = parseWhiteboard(current.content);
        setDoc(parsed);
        const ids = parsed.nodes.filter((node) => node.kind === "note" && node.linkedObjectId).map((node) => node.linkedObjectId as string);
        if (ids.length > 0) {
          const found = await Promise.all(ids.map((id) => context.data.objects.get(id)));
          setLinkedTitles(new Map(found.filter((value): value is PluginObject => Boolean(value)).map((value) => [value.id, value])));
        }
      } catch (value) { setError(errorMessage(value)); }
    })();
  }, [context, objectId]);

  // The debounced write, kept so switching boards or closing the panel within
  // the 450 ms writes it at once instead of dropping the last change.
  const pendingWrite = useRef<(() => void) | null>(null);
  const openIdRef = useRef(objectId);
  openIdRef.current = objectId;
  useEffect(() => {
    if (!dirty || !doc || !object) return;
    const run = async () => {
      pendingWrite.current = null;
      try {
        const updated = await context.data.objects.update(object.id, { content: JSON.stringify(doc) }, updatedAtRef.current);
        // A flushed write for the board just left must not stamp the new board's lock.
        if (openIdRef.current === object.id) updatedAtRef.current = updated.updated_at;
        setDirty(false);
        host?.notifyChanged();
      } catch (value) { setError(errorMessage(value)); }
    };
    pendingWrite.current = () => void run();
    const timer = window.setTimeout(run, 450);
    return () => window.clearTimeout(timer);
  }, [dirty, doc, object, context, host]);
  useEffect(() => () => pendingWrite.current?.(), [objectId]);

  useEffect(() => {
    if (!linkPickerOpen) return;
    const query = linkQuery.trim();
    const timer = window.setTimeout(async () => {
      try {
        const all = await context.data.objects.query({ limit: 200 });
        const needle = query.toLocaleLowerCase();
        setLinkResults(all.filter((candidate) => candidate.id !== objectId && (!needle || candidate.title.toLocaleLowerCase().includes(needle))).slice(0, 30));
      } catch { setLinkResults([]); }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [linkPickerOpen, linkQuery, context, objectId]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", onKey); };
  }, [menu]);

  const byId = useMemo(() => new Map((doc?.nodes ?? []).map((node) => [node.id, node])), [doc]);

  // Connection geometry + the hovered one. The remove "×" is drawn above every
  // line and placed where no other line runs, like on the Typewriter board.
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const enterEdge = (id: string) => { window.clearTimeout(hoverTimer.current); setHoverEdge(id); };
  const leaveEdge = () => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setHoverEdge(null), 80); };
  const edgeGeoms = useMemo(() => (doc?.edges ?? []).flatMap((edge) => {
    const a = byId.get(edge.from); const b = byId.get(edge.to);
    if (!a || !b) return [];
    const pts = elbowPoints(a, b);
    return [{ edge, pts, d: pathOf(pts) }];
  }), [doc, byId]);
  const edgeSpots = useMemo(() => {
    const boxes = (doc?.nodes ?? []).filter((node) => node.kind !== "section").map((node) => ({ x: node.x, y: node.y, w: node.width, h: node.height }));
    return new Map(edgeGeoms.map((g) => [g.edge.id, removeSpot(g.pts, edgeGeoms.filter((o) => o !== g).map((o) => o.pts), boxes)]));
  }, [edgeGeoms, doc]);

  function patch(next: Partial<WhiteboardDocument>) {
    setDoc((current) => current ? { ...current, ...next } : current);
    setDirty(true);
  }

  const [reportOpen, setReportOpen] = useState(false);

  /** Every add-node helper drops the new node a little below-right of the last
   * one so a burst of clicks doesn't stack them exactly; from the right-click
   * menu it lands centred on the pointer instead. */
  function place(extra: Partial<CanvasNode> & Pick<CanvasNode, "kind" | "width" | "height">, at?: XY): CanvasNode {
    // From the toolbar: the first free spot in view, never on top of another card (T11).
    // Sections are frames, so cards may sit inside them.
    const boxes = (doc?.nodes ?? []).filter((node) => node.kind !== "section").map((node) => ({ x: node.x, y: node.y, w: node.width, h: node.height }));
    const spot = at ? { x: at.x - extra.width / 2, y: at.y - extra.height / 2 } : freeSpot(boxes, extra.width, extra.height, { x: 40 - (doc?.viewport.x ?? 0), y: 40 - (doc?.viewport.y ?? 0) });
    return { id: uid("node"), x: spot.x, y: spot.y, ...extra };
  }

  function addNode(node: CanvasNode) {
    if (!doc) return;
    patch({ nodes: [...doc.nodes, node] });
    setSelected(node.id);
  }
  function addCard(at?: XY) { const node = place({ kind: "card", width: 220, height: 140, text: "" }, at); addNode(node); setFocusNode(node.id); }
  function addShape(at?: XY) { addNode(place({ kind: "shape", shape: "rectangle", width: 180, height: 120, text: "" }, at)); }
  function addSection(at?: XY) { addNode(place({ kind: "section", width: 480, height: 300, text: "New section" }, at)); }
  function addTable(at?: XY) { addNode(place({ kind: "table", width: 320, height: tableHeight(2), rows: [["Column A", "Column B"], ["", ""]] }, at)); }
  function addImage(file: File, at?: XY) {
    if (!doc) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      if (!dataUrl.startsWith("data:")) { setError("Could not read that image."); return; }
      setDoc((current) => current ? { ...current, nodes: [...current.nodes, place({ kind: "image", width: 260, height: 190, text: file.name, imageUrl: dataUrl }, at)] } : current);
      setDirty(true);
    };
    reader.onerror = () => setError("Could not read that image.");
    reader.readAsDataURL(file);
  }
  function pickImage(at?: XY) {
    imageAt.current = at ?? null;
    fileRef.current?.click();
  }

  const boardReport = useMemo(() => {
    if (!doc || !object) return "";
    const nodeLines = doc.nodes
      .map((node) => node.kind === "note"
        ? `- **link**: ${linkedTitles.get(node.linkedObjectId ?? "")?.title ?? node.linkedObjectId ?? ""}`
        : (node.text ?? "").trim() ? `- **${node.kind}**: ${(node.text ?? "").trim()}` : "")
      .filter(Boolean);
    const edgeLines = doc.edges.map((edge) => `- ${byId.get(edge.from)?.text || byId.get(edge.from)?.linkedObjectId || edge.from} → ${byId.get(edge.to)?.text || byId.get(edge.to)?.linkedObjectId || edge.to}`);
    return `# ${object.title || "Whiteboard"}\n\n## Board content\n${nodeLines.join("\n") || "No content yet."}\n\n## Connections\n${edgeLines.join("\n") || "No connections yet."}\n`;
  }, [doc, object, byId, linkedTitles]);

  async function exportBoardJson() {
    if (!doc || !object) return;
    try {
      const path = await context.ui.exportFile(`${(object.title || "whiteboard").replace(/[^\p{L}\p{N}_-]+/gu, "-")}.whiteboard.json`, JSON.stringify(doc, null, 2));
      context.ui.notice(t("Exported to {path}", { path }));
    } catch (value) { context.ui.notice(t("Export failed: {message}", { message: errorMessage(value) })); }
  }
  async function exportReportMarkdown() {
    if (!object) return;
    try {
      const path = await context.ui.exportFile(`${(object.title || "whiteboard").replace(/[^\p{L}\p{N}_-]+/gu, "-")}-report.md`, boardReport);
      context.ui.notice(t("Exported to {path}", { path }));
    } catch (value) { context.ui.notice(t("Export failed: {message}", { message: errorMessage(value) })); }
  }
  async function createReportNote() {
    if (!object) return;
    try {
      const created = await context.data.objects.create({ type: "note", title: `${object.title || "Whiteboard"} report`, content: boardReport, props: JSON.stringify({ sourceWhiteboardId: object.id }) });
      setReportOpen(false);
      void host?.openObject(created.id);
    } catch (value) { setError(errorMessage(value)); }
  }
  /** Cards that could become tasks: text, and not linked to anything yet. */
  const taskCandidates = () => (doc?.nodes ?? []).filter((node) => node.kind === "card" && (node.text ?? "").trim() && !node.linkedObjectId);
  /** T12: choose the cards first (the selected card alone, or all of them), then confirm. */
  function openTaskPicker() {
    const candidates = taskCandidates();
    if (candidates.length === 0) { context.ui.notice(t("No unlinked cards with text to convert.")); return; }
    const only = candidates.find((node) => node.id === selected);
    setTaskPick(new Set(only ? [only.id] : candidates.map((node) => node.id)));
  }
  async function createTasksFromCards(ids: Set<string>) {
    if (!doc || !object) return;
    const candidates = taskCandidates().filter((node) => ids.has(node.id));
    setTaskPick(null);
    if (candidates.length === 0) return;
    try {
      // Into the whiteboard's own project or folder, not the top level (S4).
      const parentId = object.parent_id ?? undefined;
      const made = await Promise.all(candidates.map((node) => context.data.objects.create({ type: "task", title: (node.text ?? "").trim(), parentId, props: JSON.stringify({ status: "triage", sourceWhiteboardId: object.id }) })));
      setLinkedTitles((current) => { const next = new Map(current); made.forEach((task) => next.set(task.id, task)); return next; });
      patch({ nodes: doc.nodes.map((node) => {
        const index = candidates.findIndex((candidate) => candidate.id === node.id);
        return index < 0 ? node : { ...node, kind: "note", linkedObjectId: made[index].id };
      }) });
      context.ui.notice(t("Created {count} linked tasks", { count: String(made.length) }));
    } catch (value) { setError(errorMessage(value)); }
  }

  function addLink(target: PluginObject) {
    if (!doc) return;
    // Linking is a property of one shape: with a shape selected (linkPickerFor
    // set), attach the note to that existing node instead of creating a new
    // one; only fall back to creating a fresh linked card when nothing was
    // selected when the picker was opened.
    if (linkPickerFor) {
      updateNode(linkPickerFor, { kind: "note", linkedObjectId: target.id });
      setSelected(linkPickerFor);
    } else {
      const node: CanvasNode = { id: uid("node"), kind: "note", x: 80 - doc.viewport.x, y: 80 - doc.viewport.y, width: 200, height: 90, linkedObjectId: target.id };
      patch({ nodes: [...doc.nodes, node] });
      setSelected(node.id);
    }
    setLinkedTitles((current) => new Map(current).set(target.id, target));
    setLinkPickerOpen(false);
    setLinkPickerFor(null);
    setLinkQuery("");
  }

  function openLinkPicker(nodeId: string | null) {
    if (linkPickerOpen && linkPickerFor === nodeId) { setLinkPickerOpen(false); setLinkPickerFor(null); return; }
    setLinkPickerFor(nodeId);
    setLinkPickerOpen(true);
  }

  function updateNode(id: string, fields: Partial<CanvasNode>) {
    if (!doc) return;
    patch({ nodes: doc.nodes.map((node) => node.id === id ? { ...node, ...fields } : node) });
  }

  function removeNode(id: string) {
    if (!doc) return;
    patch({ nodes: doc.nodes.filter((node) => node.id !== id), edges: doc.edges.filter((edge) => edge.from !== id && edge.to !== id) });
    if (selected === id) setSelected(null);
  }

  function duplicateNode(id: string) {
    const source = byId.get(id);
    if (!doc || !source) return;
    const copy: CanvasNode = { ...source, id: uid("node"), x: source.x + 28, y: source.y + 28, rows: source.rows?.map((row) => [...row]) };
    patch({ nodes: [...doc.nodes, copy] });
    setSelected(copy.id);
  }

  /** Later nodes draw on top; a section stays behind everything regardless. */
  function reorderNode(id: string, where: "front" | "back") {
    const source = byId.get(id);
    if (!doc || !source) return;
    const rest = doc.nodes.filter((node) => node.id !== id);
    patch({ nodes: where === "front" ? [...rest, source] : [source, ...rest] });
  }

  function editTable(id: string, action: "row+" | "col+" | "row-" | "col-") {
    const node = byId.get(id);
    if (!node?.rows) return;
    let rows = node.rows.map((row) => [...row]);
    const cols = rows[0]?.length ?? 1;
    if (action === "row+") rows.push(Array.from({ length: cols }, () => ""));
    if (action === "col+") rows = rows.map((row) => [...row, ""]);
    if (action === "row-" && rows.length > 1) rows.pop();
    if (action === "col-" && cols > 1) rows = rows.map((row) => row.slice(0, -1));
    updateNode(id, { rows, height: tableHeight(rows.length) });
  }

  function connect(targetId: string) {
    if (!doc) return;
    if (!connectFrom) { setConnectFrom(targetId); return; }
    if (connectFrom !== targetId) patch({ edges: [...doc.edges, { id: uid("edge"), from: connectFrom, to: targetId }] });
    setConnectFrom(null);
  }

  function removeEdge(id: string) {
    if (!doc) return;
    patch({ edges: doc.edges.filter((edge) => edge.id !== id) });
  }

  function zoomBy(delta: number) {
    if (!doc) return;
    patch({ viewport: { ...doc.viewport, zoom: Math.min(2, Math.max(0.4, doc.viewport.zoom + delta)) } });
  }

  function openMenu(event: React.MouseEvent, nodeId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    if (nodeId) setSelected(nodeId);
    setSub(null);
    setMenu({ x: event.clientX, y: event.clientY, nodeId, at: pointerToCanvas(event) ?? { x: 80, y: 80 } });
  }

  function onSurfacePointerDown(event: React.PointerEvent) {
    if (event.target !== surfaceRef.current && !(event.target as HTMLElement).classList.contains("canvas-world")) return;
    setSelected(null);
    setMenu(null);
    if (!doc) return;
    drag.current = { kind: "pan", startX: event.clientX, startY: event.clientY, origin: { x: doc.viewport.x, y: doc.viewport.y } };
  }
  function onNodePointerDown(event: React.PointerEvent, node: CanvasNode) {
    if (event.button !== 0) return;
    // Only fields that need a real caret and the resize handle opt out —
    // .canvas-node-link is a <button> too, but it covers nearly the whole
    // body of a "note" card, so excluding all buttons here would silently
    // make note cards draggable only from the thin header strip again.
    const target = event.target as HTMLElement;
    // A card's text box fills the card, so it also drags the card (T11): a press that moves drags,
    // a press that doesn't puts the caret there on release. While typing in it, it is just text.
    const typeInto = target instanceof HTMLTextAreaElement && document.activeElement !== target ? target : undefined;
    if (!typeInto && target.closest("textarea,input,[data-resize-handle]")) return;
    if (typeInto) event.preventDefault();
    event.stopPropagation();
    setSelected(node.id);
    setMenu(null);
    // A section is a frame: dragging it carries every node that sits fully inside it.
    const carry: Record<string, { x: number; y: number }> = {};
    if (node.kind === "section" && doc) {
      for (const other of doc.nodes) {
        if (other.id !== node.id && other.x >= node.x && other.y >= node.y && other.x + other.width <= node.x + node.width && other.y + other.height <= node.y + node.height) carry[other.id] = { x: other.x, y: other.y };
      }
    }
    drag.current = { kind: "node", id: node.id, startX: event.clientX, startY: event.clientY, origin: { x: node.x, y: node.y }, carry, typeInto };
  }
  function onResizePointerDown(event: React.PointerEvent, node: CanvasNode) {
    event.stopPropagation();
    drag.current = { kind: "resize", id: node.id, startX: event.clientX, startY: event.clientY, origin: { x: node.x, y: node.y, width: node.width, height: node.height } };
  }
  /** Drag-to-connect from a node's edge handle — an alternative to the
   * click-through "Connect" toolbar flow, not a replacement for it. */
  function onConnectHandlePointerDown(event: React.PointerEvent, node: CanvasNode) {
    event.stopPropagation();
    setSelected(node.id);
    setConnectDragFrom(node.id);
    drag.current = { kind: "connect", id: node.id, startX: event.clientX, startY: event.clientY, origin: { x: 0, y: 0 } };
  }
  function pointerToCanvas(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || !doc) return null;
    return { x: (event.clientX - rect.left) / doc.viewport.zoom - doc.viewport.x, y: (event.clientY - rect.top) / doc.viewport.zoom - doc.viewport.y };
  }
  function snap(value: number, size: number, others: number[]): { value: number; guide: number | null } {
    const edges = [value, value + size / 2, value + size];
    for (const edge of edges) {
      const match = others.find((other) => Math.abs(other - edge) <= SNAP_THRESHOLD);
      if (match !== undefined) return { value: value + (match - edge), guide: match };
    }
    return { value, guide: null };
  }

  function onPointerMove(event: React.PointerEvent) {
    const state = drag.current;
    if (!state || !doc) return;
    if (state.kind === "connect") { setConnectPreview(pointerToCanvas(event)); return; }
    const dx = (event.clientX - state.startX) / doc.viewport.zoom;
    const dy = (event.clientY - state.startY) / doc.viewport.zoom;
    if (state.kind === "pan") { patch({ viewport: { ...doc.viewport, x: state.origin.x + dx, y: state.origin.y + dy } }); return; }
    if (state.kind === "node" && state.id) {
      const moving = doc.nodes.find((node) => node.id === state.id);
      const others = doc.nodes.filter((node) => node.id !== state.id && !state.carry?.[node.id]);
      let nextX = state.origin.x + dx;
      let nextY = state.origin.y + dy;
      let guideX: number | null = null;
      let guideY: number | null = null;
      if (moving) {
        const xs = others.flatMap((node) => [node.x, node.x + node.width / 2, node.x + node.width]);
        const ys = others.flatMap((node) => [node.y, node.y + node.height / 2, node.y + node.height]);
        const snappedX = snap(nextX, moving.width, xs);
        const snappedY = snap(nextY, moving.height, ys);
        nextX = snappedX.value; guideX = snappedX.guide;
        nextY = snappedY.value; guideY = snappedY.guide;
      }
      setGuides({ x: guideX, y: guideY });
      const carry = state.carry ?? {};
      patch({ nodes: doc.nodes.map((node) => node.id === state.id ? { ...node, x: nextX, y: nextY } : carry[node.id] ? { ...node, x: carry[node.id].x + (nextX - state.origin.x), y: carry[node.id].y + (nextY - state.origin.y) } : node) });
      return;
    }
    if (state.kind === "resize" && state.id) {
      const node = doc.nodes.find((candidate) => candidate.id === state.id);
      // A table's height follows its rows; only its width is resized by hand.
      updateNode(state.id, { width: Math.max(120, (state.origin.width ?? 120) + dx), ...(node?.kind === "table" ? {} : { height: Math.max(70, (state.origin.height ?? 70) + dy) }) });
    }
  }
  function onPointerUp(event: React.PointerEvent) {
    const state = drag.current;
    if (state?.typeInto && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 4) {
      const box = state.typeInto;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
    if (state?.kind === "connect" && state.id && doc) {
      const point = pointerToCanvas(event);
      const target = point ? doc.nodes.find((node) => node.id !== state.id && point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height) : undefined;
      if (target) patch({ edges: [...doc.edges, { id: uid("edge"), from: state.id, to: target.id }] });
    }
    drag.current = null;
    setGuides({ x: null, y: null });
    setConnectDragFrom(null);
    setConnectPreview(null);
  }
  function onWheel(event: React.WheelEvent) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 0.1 : -0.1);
  }

  if (error) return <div className="canvas-error" role="alert">{error}</div>;
  if (!doc || !object) return <div className="canvas-loading">{t("Loading canvas…")}</div>;

  const menuNode = menu?.nodeId ? byId.get(menu.nodeId) : undefined;
  const menuFlipped = menu ? menu.x + 360 > window.innerWidth : false;
  const run = (action: () => void) => () => { action(); setMenu(null); };

  return <div className="canvas-shell" data-plugin-surface="notible.whiteboard">
    <div className="canvas-toolbar">
      <button type="button" onClick={() => addCard()}><Plus size={14} /> {t("Card")}</button>
      <button type="button" onClick={() => addShape()}><Square size={14} /> {t("Shape")}</button>
      <button type="button" onClick={() => addSection()}><BoxSelect size={14} /> {t("Section")}</button>
      <button type="button" onClick={() => addTable()}><Table2 size={14} /> {t("Table")}</button>
      <button type="button" onClick={() => pickImage()}><ImageIcon size={14} /> {t("Image")}</button>
      <input ref={fileRef} className="canvas-file-input" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) addImage(file, imageAt.current ?? undefined); event.currentTarget.value = ""; }} />
      <span className="canvas-spacer" />
      <button type="button" className="canvas-icon-button canvas-more" aria-label={t("More whiteboard actions")} title={t("More whiteboard actions")} onClick={(event) => { event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect(); setSub(null); setMenu({ x: box.right - 4, y: box.bottom + 4, nodeId: null, at: { x: 200 - doc.viewport.x, y: 160 - doc.viewport.y } }); }}><MoreHorizontal size={14} /></button>
      <div className="canvas-zoom-group">
        <button type="button" className="canvas-icon-button" onClick={() => zoomBy(-0.1)} aria-label={t("Zoom out")}><Minus size={14} /></button>
        <span className="canvas-zoom">{Math.round(doc.viewport.zoom * 100)}%</span>
        <button type="button" className="canvas-icon-button" onClick={() => zoomBy(0.1)} aria-label={t("Zoom in")}><Plus size={14} /></button>
      </div>
    </div>
    {connectFrom && <p className="canvas-hint">{t('Click any other card to draw an arrow to it, or right-click it again and choose "Connect to…" to cancel.')}</p>}
    {linkPickerOpen && <div className="canvas-link-picker">
      <input autoFocus placeholder={t("Search notes, tasks, projects…")} value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} />
      <div className="canvas-link-results">{linkResults.map((result) => <button type="button" key={result.id} onClick={() => addLink(result)}><span>{iconOf(result.type)}</span>{result.title || "Untitled"}<small>{result.type}</small></button>)}{linkResults.length === 0 && <p className="canvas-muted">{t("No matches.")}</p>}</div>
    </div>}
    <div
      className="canvas-surface"
      ref={surfaceRef}
      onPointerDown={onSurfacePointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={onWheel}
      onContextMenu={(event) => { const target = event.target as HTMLElement; if (target === surfaceRef.current || target.classList.contains("canvas-world")) openMenu(event, null); }}
      style={{ backgroundPosition: `${doc.viewport.x * doc.viewport.zoom}px ${doc.viewport.y * doc.viewport.zoom}px`, backgroundSize: `${24 * doc.viewport.zoom}px ${24 * doc.viewport.zoom}px` }}
    >
      <div className="canvas-world" style={{ transform: `translate(${doc.viewport.x}px, ${doc.viewport.y}px) scale(${doc.viewport.zoom})` }}>
        <svg className="canvas-edges"><defs><marker id="canvas-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs>
          {edgeGeoms.map((g) => (
            <g key={g.edge.id} className={`canvas-edge-group${hoverEdge === g.edge.id ? " is-hover" : ""}`}>
              {/* Wide invisible stroke = comfortable hover target for the thin line. */}
              <path className="canvas-edge-hit" d={g.d} onPointerEnter={() => enterEdge(g.edge.id)} onPointerLeave={leaveEdge} />
              <path className="canvas-edge-line" d={g.d} fill="none" markerEnd="url(#canvas-arrow)" />
            </g>
          ))}
          {edgeGeoms.filter((g) => g.edge.id === hoverEdge).map((g) => {
            const at = edgeSpots.get(g.edge.id) ?? g.pts[1];
            return (
              <g key={`del-${g.edge.id}`} className="canvas-edge-del" transform={`translate(${at.x} ${at.y})`} onPointerEnter={() => enterEdge(g.edge.id)} onPointerLeave={leaveEdge} onClick={() => { setHoverEdge(null); removeEdge(g.edge.id); }}>
                <title>{t("Remove connection")}</title>
                <circle r="9" />
                <path d="M -3.2 -3.2 L 3.2 3.2 M 3.2 -3.2 L -3.2 3.2" />
              </g>
            );
          })}
          {connectDragFrom && connectPreview && (() => {
            const from = byId.get(connectDragFrom);
            if (!from) return null;
            return <path className="canvas-edge-line canvas-edge-preview" d={elbowPath(from, { x: connectPreview.x, y: connectPreview.y, width: 0, height: 0 })} fill="none" />;
          })()}
        </svg>
        {guides.x !== null && <div className="canvas-guide canvas-guide-v" style={{ left: guides.x }} />}
        {guides.y !== null && <div className="canvas-guide canvas-guide-h" style={{ top: guides.y }} />}
        {doc.nodes.length === 0 && <div className="canvas-empty">{t("Add a card or link a note to start mapping this board.")}</div>}
        {doc.nodes.map((node) => {
          const linked = node.linkedObjectId ? linkedTitles.get(node.linkedObjectId) : undefined;
          const colour = colourOf(node);
          return <div
            key={node.id}
            data-node-id={node.id}
            title={node.kind === "card" ? t("Drag to move · dots on the edges draw arrows") : undefined}
            className={`canvas-node canvas-node-${node.kind}${selected === node.id ? " selected" : ""}${connectFrom === node.id || connectDragFrom === node.id ? " connecting" : ""}`}
            data-colour={colour}
            data-shape={node.kind === "shape" ? (node.shape ?? "rectangle") : undefined}
            style={{ left: node.x, top: node.y, width: node.width, ...(node.kind === "table" ? { minHeight: node.height } : { height: node.height }) }}
            onClick={() => { setSelected(node.id); if (connectFrom && connectFrom !== node.id) connect(node.id); }}
            onContextMenu={(event) => openMenu(event, node.id)}
            onPointerDown={(event) => onNodePointerDown(event, node)}
          >
            {node.kind !== "shape" && node.kind !== "section" && <div className="canvas-node-handle" />}
            {node.kind === "note"
              ? <button type="button" className="canvas-node-link" onDoubleClick={() => node.linkedObjectId && void host?.openObject(node.linkedObjectId)}><span className="canvas-node-icon">{iconOf(linked?.type ?? "note")}</span><strong>{linked?.title || "Untitled"}</strong><small>{linked?.type}</small></button>
              : node.kind === "image"
              ? (node.imageUrl ? <img className="canvas-node-picture" src={node.imageUrl} alt={node.text ?? ""} draggable={false} /> : <div className="canvas-node-image-empty">{t("No image")}</div>)
              : node.kind === "table"
              ? <div className="canvas-table-grid" style={{ gridTemplateColumns: `repeat(${node.rows?.[0]?.length ?? 1}, minmax(0, 1fr))` }}>{(node.rows ?? []).flatMap((row, ri) => row.map((cell, ci) => <input key={`${ri}-${ci}`} value={cell} onChange={(event) => { const rows = (node.rows ?? []).map((r) => [...r]); rows[ri][ci] = event.target.value; updateNode(node.id, { rows }); }} />))}</div>
              : node.kind === "section"
              ? <input className="canvas-node-section-label" value={node.text ?? ""} placeholder={t("Section")} onChange={(event) => updateNode(node.id, { text: event.target.value })} />
              : node.kind === "shape"
              ? <>
                  {node.shape === "diamond" && <svg className="canvas-shape-bg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="50,1 99,50 50,99 1,50" vectorEffect="non-scaling-stroke" /></svg>}
                  <div className="canvas-shape-text" data-value={`${node.text ?? ""} `}><textarea value={node.text ?? ""} placeholder={t("Label")} rows={1} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); event.currentTarget.blur(); } }} onChange={(event) => updateNode(node.id, { text: event.target.value })} /></div>
                </>
              : <textarea value={node.text ?? ""} placeholder={t("Type here…")} onChange={(event) => updateNode(node.id, { text: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); event.currentTarget.blur(); } }} />}
            {node.kind !== "section" && <span className="canvas-resize-handle" data-resize-handle onPointerDown={(event) => onResizePointerDown(event, node)} />}
            {(["n", "e", "s", "w"] as const).map((side) => <span key={side} className={`canvas-connect-handle canvas-connect-handle-${side}`} data-connect-handle onPointerDown={(event) => onConnectHandlePointerDown(event, node)} />)}
          </div>;
        })}
        {/* A section sits behind its cards, so its resize grip is drawn here, above
            every card: it can always be grabbed, even under an overlapping card. */}
        {doc.nodes.filter((node) => node.kind === "section").map((node) => (
          <span
            key={`grip-${node.id}`}
            className="canvas-section-grip"
            data-resize-handle
            style={{ left: node.x + node.width - 22, top: node.y + node.height - 22 }}
            onPointerDown={(event) => { setSelected(node.id); onResizePointerDown(event, node); }}
          />
        ))}
      </div>
    </div>
    {menu && <div className="canvas-menu" data-flipped={menuFlipped || undefined} style={{ top: menu.y, left: menu.x }} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      {!menuNode ? <>
        <SubMenu label={t("Add")} open={sub === "add"} onToggle={(open) => setSub(open ? "add" : null)}>
          <button type="button" onClick={run(() => addCard(menu.at))}>{t("Card")}</button>
          <button type="button" onClick={run(() => addShape(menu.at))}>{t("Shape")}</button>
          <button type="button" onClick={run(() => addSection(menu.at))}>{t("Section")}</button>
          <button type="button" onClick={run(() => addTable(menu.at))}>{t("Table")}</button>
          <button type="button" onClick={run(() => pickImage(menu.at))}>{t("Image…")}</button>
          <button type="button" onClick={run(() => openLinkPicker(null))}>{t("Link to note…")}</button>
        </SubMenu>
        <button type="button" onClick={run(() => setReportOpen(true))} title={t("Every card and arrow as a text outline, to read, export or save as a note")}>{t("Report: the board as text…")}</button>
        <button type="button" onClick={run(() => openTaskPicker())}>{t("Create tasks from cards…")}</button>
        <button type="button" onClick={run(() => void exportBoardJson())}>{t("Export")}</button>
        <button type="button" onClick={run(() => patch({ viewport: { x: 0, y: 0, zoom: 1 } }))}>{t("Reset view")}</button>
      </> : <>
        {menuNode.kind !== "section" && menuNode.kind !== "image" && (
          <SubMenu label={t("Colour")} open={sub === "colour"} onToggle={(open) => setSub(open ? "colour" : null)}>
            {[undefined, ...NODE_COLOURS].map((option) => (
              <button key={option ?? "none"} type="button" role="menuitemradio" aria-checked={colourOf(menuNode) === option} onClick={run(() => updateNode(menuNode.id, { color: option }))}>
                <span>{option ? COLOUR_LABEL[option] : "None"}</span>
                {colourOf(menuNode) === option && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
          </SubMenu>
        )}
        {menuNode.kind === "shape" && (
          <SubMenu label={t("Form")} open={sub === "shape"} onToggle={(open) => setSub(open ? "shape" : null)}>
            {SHAPES.map((option) => (
              <button key={option.value} type="button" role="menuitemradio" aria-checked={(menuNode.shape ?? "rectangle") === option.value} onClick={run(() => updateNode(menuNode.id, { shape: option.value }))}>
                <span>{option.label}</span>
                {(menuNode.shape ?? "rectangle") === option.value && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
          </SubMenu>
        )}
        {menuNode.kind === "table" && (
          <SubMenu label={t("Table")} open={sub === "table"} onToggle={(open) => setSub(open ? "table" : null)}>
            <button type="button" onClick={run(() => editTable(menuNode.id, "row+"))}>{t("Add row")}</button>
            <button type="button" onClick={run(() => editTable(menuNode.id, "col+"))}>{t("Add column")}</button>
            <button type="button" onClick={run(() => editTable(menuNode.id, "row-"))}>{t("Remove last row")}</button>
            <button type="button" onClick={run(() => editTable(menuNode.id, "col-"))}>{t("Remove last column")}</button>
          </SubMenu>
        )}
        {menuNode.kind !== "section" && <button type="button" onClick={run(() => openLinkPicker(menuNode.id))}>{t("Link to note…")}</button>}
        {menuNode.kind !== "section" && <button type="button" onClick={run(() => connect(menuNode.id))}>{connectFrom === menuNode.id ? "Cancel connecting" : "Connect to…"}</button>}
        {menuNode.kind !== "section" && <button type="button" onClick={run(() => duplicateNode(menuNode.id))}>{t("Duplicate")}</button>}
        {menuNode.kind !== "section" && <button type="button" onClick={run(() => reorderNode(menuNode.id, "front"))}>{t("Bring to front")}</button>}
        {menuNode.kind !== "section" && <button type="button" onClick={run(() => reorderNode(menuNode.id, "back"))}>{t("Send to back")}</button>}
        <button type="button" className="is-danger" onClick={run(() => removeNode(menuNode.id))}>{t("Delete")}</button>
      </>}
    </div>}
    {taskPick && <div className="canvas-report-backdrop" onClick={() => setTaskPick(null)}>
      <section className="canvas-report canvas-task-pick" role="dialog" aria-modal="true" aria-label={t("Create tasks from cards")} onClick={(event) => event.stopPropagation()}>
        <header><div><strong>{t("Create tasks from cards")}</strong><span>{t("Each ticked card becomes a task and links to it.")}</span></div></header>
        <ul>{taskCandidates().map((node) => <li key={node.id}><label><input type="checkbox" checked={taskPick.has(node.id)} onChange={() => setTaskPick((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })} /> {(node.text ?? "").trim()}</label></li>)}</ul>
        <footer>
          <button type="button" onClick={() => setTaskPick(null)}>{t("Cancel")}</button>
          <button type="button" className="btn-primary" disabled={taskPick.size === 0} onClick={() => void createTasksFromCards(taskPick)}>{t("Create {count} tasks", { count: taskPick.size })}</button>
        </footer>
      </section>
    </div>}
    {reportOpen && <div className="canvas-report-backdrop" onClick={() => setReportOpen(false)}>
      <section className="canvas-report" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><strong>{t("Board report")}</strong><span>{doc.nodes.length} {t("elements")} · {doc.edges.length} {t("connections")}</span></div>
          <button type="button" onClick={() => setReportOpen(false)}>{t("Close")}</button>
        </header>
        <pre>{boardReport}</pre>
        <footer>
          <button type="button" onClick={() => void exportReportMarkdown()}>{t("Export Markdown")}</button>
          <button type="button" className="canvas-report-primary" onClick={() => void createReportNote()}>{t("Create report note")}</button>
        </footer>
      </section>
    </div>}
  </div>;
}

/** Translation for every component below, from the plugin's own context. The
 * provider has to sit outside the component that consumes it, so the surface
 * proper is `CanvasBoardInner`. */
export default function CanvasBoard(props: Props) {
  return <PluginI18nProvider context={props.context as PluginContext}><CanvasBoardInner {...props} /></PluginI18nProvider>;
}
