import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { PluginContext, PluginObject, PluginRelation } from "../../packages/plugin-api/src/index.ts";
import { inManuscript, sceneReadingRank } from "./typewriter-model.ts";
import { removeSpot } from "./link-geometry.ts";
import "./surface.css";
import "./typewriter.css";
import { useT, tr } from "./i18n.tsx";
import { Check, ChevronRight } from "lucide-react";

const NS = "notible.typewriter.";
const TYPE = {
  part: `${NS}part`,
  chapter: `${NS}chapter`,
  scene: `${NS}scene`,
  beat: `${NS}beat`,
} as const;
const LEADS = "tw.leads";
/** Board card -> Codex entry (character / location / plotline / memo). */
const MENTIONS = "tw.mentions";

/** Codex kinds a card can link to; the colour matches the Codex avatars. */
const ENTITY_KINDS = [
  { type: `${NS}character`, label: "Characters", colour: "var(--notible-accent)" },
  { type: `${NS}location`, label: "Locations", colour: "var(--notible-success)" },
  { type: `${NS}plotline`, label: "Plotlines", colour: "var(--notible-warning)" },
  { type: `${NS}memo`, label: tr("Memos"), colour: "var(--notible-highlight-purple)" },
] as const;

/** Card box and snap grid — the SVG connector maths and the CSS both read these. */
const CARD_W = 200;
const CARD_H = 56;
const GRID = 20;
const FRAME_HEAD = 22;
const snap = (n: number) => Math.round(n / GRID) * GRID;

interface Props {
  context: PluginContext;
  manuscriptId: string;
}

interface XY { x: number; y: number; }
/** A visual group (scene, chapter, ...). Its rectangle is derived from its members. */
interface Frame { id: string; title: string; members: string[]; }
/** A label on the loose timeline ruler; `jump` marks a leap in time. */
interface Marker { id: string; label: string; x: number; jump?: boolean; }
type MenuKind = "beat" | "scene" | "frame" | "marker";
type Sub = "colour" | "link" | "frame" | null;

function propsOf(object: PluginObject): Record<string, unknown> {
  try { const v = JSON.parse(object.props) as unknown; return v && typeof v === "object" ? v as Record<string, unknown> : {}; }
  catch { return {}; }
}
function orderOf(object: PluginObject): number {
  const v = Number(propsOf(object).order);
  return Number.isFinite(v) ? v : 0;
}
function statusOf(object: PluginObject): string {
  const v = propsOf(object).status;
  return typeof v === "string" ? v : "idea";
}
const BEAT_COLOURS = ["red", "amber", "green", "blue", "violet"] as const;
const COLOUR_LABEL: Record<(typeof BEAT_COLOURS)[number], string> = { red: tr("Red"), amber: tr("Amber"), green: tr("Green"), blue: tr("Blue"), violet: tr("Violet") };
function colourOf(object: PluginObject): string | undefined {
  const v = propsOf(object).colour;
  return typeof v === "string" && (BEAT_COLOURS as readonly string[]).includes(v) ? v : undefined;
}

function readFrames(value: unknown): Frame[] {
  if (!Array.isArray(value)) return [];
  return value.filter((f): f is Frame => Boolean(f) && typeof f.id === "string" && Array.isArray(f.members))
    .map((f) => ({ id: f.id, title: typeof f.title === "string" ? f.title : "", members: f.members.filter((m: unknown) => typeof m === "string") }));
}
function readMarkers(value: unknown): Marker[] {
  if (!Array.isArray(value)) return [];
  return value.filter((m): m is Marker => Boolean(m) && typeof m.id === "string" && Number.isFinite(m.x))
    .map((m) => ({ id: m.id, label: typeof m.label === "string" ? m.label : "", x: m.x, jump: m.jump ? true : undefined }));
}
const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

type Side = "top" | "right" | "bottom" | "left";
const SIDES: Side[] = ["top", "right", "bottom", "left"];
function sidePoint(at: XY, side: Side): XY {
  if (side === "top") return { x: at.x + CARD_W / 2, y: at.y };
  if (side === "bottom") return { x: at.x + CARD_W / 2, y: at.y + CARD_H };
  if (side === "left") return { x: at.x, y: at.y + CARD_H / 2 };
  return { x: at.x + CARD_W, y: at.y + CARD_H / 2 };
}

/**
 * Right-angle route between two cards. Leaves each card through the edge that
 * faces the other one, along whichever axis has more clearance between them
 * (H-V-H sideways, V-H-V when stacked). The SVG arrow marker orients itself
 * from the last segment, so vertical entries get a correctly rotated head.
 * `mx`/`my` is the midpoint, where the remove button sits.
 */
function routeLink(from: XY, to: XY): { d: string; mx: number; my: number; pts: XY[] } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dy) - CARD_H > Math.abs(dx) - CARD_W) {
    const down = dy >= 0;
    const sx = from.x + CARD_W / 2;
    const sy = down ? from.y + CARD_H : from.y;
    const tx = to.x + CARD_W / 2;
    const ty = down ? to.y : to.y + CARD_H;
    const midY = (sy + ty) / 2;
    return { d: `M ${sx} ${sy} V ${midY} H ${tx} V ${ty}`, mx: (sx + tx) / 2, my: midY, pts: [{ x: sx, y: sy }, { x: sx, y: midY }, { x: tx, y: midY }, { x: tx, y: ty }] };
  }
  const rightward = dx >= 0;
  const sx = rightward ? from.x + CARD_W : from.x;
  const sy = from.y + CARD_H / 2;
  const tx = rightward ? to.x : to.x + CARD_W;
  const ty = to.y + CARD_H / 2;
  const midX = (sx + tx) / 2;
  return { d: `M ${sx} ${sy} H ${midX} V ${ty} H ${tx}`, mx: midX, my: (sy + ty) / 2, pts: [{ x: sx, y: sy }, { x: midX, y: sy }, { x: midX, y: ty }, { x: tx, y: ty }] };
}

interface Box { x: number; y: number; w: number; h: number; level: number; }

/** Every frame's rectangle: the bounding box of its members plus padding that
 *  grows with nesting depth, so an outer frame always encloses an inner one. */
function frameBoxes(frames: Frame[], positions: Map<string, XY>): Map<string, Box> {
  const byId = new Map(frames.map((f) => [f.id, f]));
  const out = new Map<string, Box>();
  const visiting = new Set<string>();
  const build = (frame: Frame): Box | null => {
    const known = out.get(frame.id);
    if (known) return known;
    if (visiting.has(frame.id)) return null; // corrupt cycle from sync: ignore
    visiting.add(frame.id);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, depth = 0;
    for (const id of frame.members) {
      const at = positions.get(id);
      let b: { x: number; y: number; w: number; h: number } | null = null;
      if (at) b = { x: at.x, y: at.y, w: CARD_W, h: CARD_H };
      else {
        const child = byId.get(id);
        const cb = child ? build(child) : null;
        if (cb) { b = cb; depth = Math.max(depth, cb.level); }
      }
      if (!b) continue;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    visiting.delete(frame.id);
    if (!Number.isFinite(x0)) return null;
    const level = depth + 1;
    const pad = 10 + level * 8;
    const box = { x: x0 - pad, y: y0 - pad - FRAME_HEAD, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 + FRAME_HEAD, level };
    out.set(frame.id, box);
    return box;
  };
  frames.forEach(build);
  return out;
}

/** Node ids a selection entry stands for: itself, or every card inside a frame. */
function nodesUnder(id: string, frames: Map<string, Frame>, seen = new Set<string>()): string[] {
  const frame = frames.get(id);
  if (!frame) return [id];
  if (seen.has(id)) return [];
  seen.add(id);
  return frame.members.flatMap((member) => nodesUnder(member, frames, seen));
}

function SubMenu({ label, open, onToggle, flipped, children }: { label: string; open: boolean; onToggle: (open: boolean) => void; flipped: boolean; children: ReactNode }) {
  return (
    <div className="tw-menu-item" onMouseEnter={() => onToggle(true)} onMouseLeave={() => onToggle(false)}>
      <button type="button" className="tw-menu-parent" aria-haspopup="menu" aria-expanded={open} onClick={() => onToggle(!open)}>
        <span>{label}</span>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      {open && <div className={`tw-menu tw-submenu${flipped ? " is-flipped" : ""}`} role="menu">{children}</div>}
    </div>
  );
}

/**
 * Story board as a mind map: beats (free nodes) and scenes laid out on an
 * invisible 20px grid, joined by right-angle "leads to" connectors. Positions
 * live in the manuscript's `tw.board` prop, frames in `tw.frames`, timeline
 * markers in `tw.timeline`; connectors are `tw.leads` relations and Codex links
 * `tw.mentions` relations. Drag a card to move it (snapped); Shift-click or drag
 * the background to select several and move them together; drag a dot on a
 * card's edge onto another card to connect.
 */
export default function TypewriterBoard({ context, manuscriptId }: Props) {
  const t = useT();
  const [beats, setBeats] = useState<PluginObject[]>([]);
  const [scenes, setScenes] = useState<PluginObject[]>([]);
  const [containers, setContainers] = useState<PluginObject[]>([]);
  const [entities, setEntities] = useState<PluginObject[]>([]);
  const [links, setLinks] = useState<PluginRelation[]>([]);
  const [mentions, setMentions] = useState<PluginRelation[]>([]);
  const [saved, setSaved] = useState<Record<string, XY>>({});
  const [frames, setFrames] = useState<Frame[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [manuscript, setManuscript] = useState<PluginObject | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{ id: string; kind: MenuKind; x: number; y: number } | null>(null);
  const [sub, setSub] = useState<Sub>(null);
  const [selected, setSelected] = useState<string[]>([]);

  // Live pointer interactions (state for rendering, refs for the window handlers).
  const [drag, setDrag] = useState<{ id: string; startX: number; startY: number; delta: XY; origins: Record<string, XY> } | null>(null);
  const [connect, setConnect] = useState<{ from: string; side: Side; at: XY } | null>(null);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [mdrag, setMdrag] = useState<{ id: string; startX: number; x0: number; x: number } | null>(null);
  const busy = Boolean(drag || connect || band || mdrag);
  const busyRef = useRef(false);
  busyRef.current = busy;
  /** A reload asked for mid-gesture; runs when the gesture ends (see below). */
  const pendingLoadRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(false);
  const wasMultiRef = useRef(false);
  const bandAddRef = useRef(false);

  const load = useCallback(async () => {
    if (busyRef.current) { pendingLoadRef.current = true; return; }
    setError("");
    try {
      const [beatRows, sceneRows, parts, chapters, ms, ...entityRows] = await Promise.all([
        context.data.objects.query({ type: TYPE.beat, limit: 2000 }),
        context.data.objects.query({ type: TYPE.scene, limit: 5000 }),
        context.data.objects.query({ type: TYPE.part, limit: 1000 }),
        context.data.objects.query({ type: TYPE.chapter, limit: 2000 }),
        context.data.objects.get(manuscriptId),
        ...ENTITY_KINDS.map((kind) => context.data.objects.query({ type: kind.type, limit: 2000 })),
      ]);
      const mine = (list: PluginObject[]) => list.filter((row) => inManuscript(row.props, manuscriptId));
      const myBeats = mine(beatRows);
      const myScenes = mine(sceneRows);
      setBeats(myBeats);
      setScenes(myScenes);
      setContainers([...mine(parts), ...mine(chapters)]);
      setEntities(entityRows.flatMap((rows) => mine(rows)));
      setManuscript(ms);
      const msProps = propsOf(ms ?? { props: "{}" } as PluginObject);
      const board = msProps["tw.board"];
      setSaved(board && typeof board === "object" ? board as Record<string, XY> : {});
      setFrames(readFrames(msProps["tw.frames"]));
      setMarkers(readMarkers(msProps["tw.timeline"]));
      const ids = [...myBeats.map((b) => b.id), ...myScenes.map((s) => s.id)];
      const grouped = ids.length ? (await context.data.relations.listForObjects(ids)) ?? {} : {};
      const seen = new Set<string>();
      const flat: PluginRelation[] = [];
      const cards: PluginRelation[] = [];
      for (const list of Object.values(grouped)) for (const rel of list) {
        const key = `${rel.from_id}|${rel.to_id}|${rel.kind}`;
        if ((rel.kind !== LEADS && rel.kind !== MENTIONS) || seen.has(key)) continue;
        seen.add(key);
        (rel.kind === LEADS ? flat : cards).push(rel);
      }
      setLinks(flat);
      setMentions(cards);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }, [context, manuscriptId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const sub = context.events.on("object.updated", () => void load());
    return () => sub.dispose();
  }, [context, load]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  // Reading order for auto-placing scenes that have no saved position.
  const rank = useMemo(
    () => sceneReadingRank(
      scenes.map((s) => ({ id: s.id, parentId: s.parent_id ?? null, order: orderOf(s) })),
      [{ id: manuscriptId, parentId: null, order: 0 }, ...containers.map((c) => ({ id: c.id, parentId: c.parent_id ?? null, order: orderOf(c) }))],
    ),
    [scenes, containers, manuscriptId],
  );

  const baseNodes = useMemo(() => {
    const scenesOrdered = [...scenes].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    const list: { id: string; kind: "beat" | "scene"; object: PluginObject }[] = [
      ...scenesOrdered.map((object) => ({ id: object.id, kind: "scene" as const, object })),
      ...beats.map((object) => ({ id: object.id, kind: "beat" as const, object })),
    ];
    const pos = new Map<string, XY>();
    const taken = new Set<string>();
    for (const node of list) {
      const savedPos = saved[node.id];
      if (savedPos && Number.isFinite(savedPos.x) && Number.isFinite(savedPos.y)) {
        pos.set(node.id, { x: savedPos.x, y: savedPos.y });
        taken.add(`${savedPos.x},${savedPos.y}`);
      }
    }
    let auto = 0;
    const slot = (): XY => {
      let at: XY;
      do {
        at = { x: 40 + (auto % 4) * (CARD_W + 40), y: 40 + Math.floor(auto / 4) * (CARD_H + 48) };
        auto += 1;
      } while (taken.has(`${at.x},${at.y}`));
      taken.add(`${at.x},${at.y}`);
      return at;
    };
    for (const node of list) {
      if (!pos.has(node.id)) pos.set(node.id, slot());
    }
    return list.map((node) => ({ ...node, at: pos.get(node.id)! }));
  }, [scenes, beats, rank, saved]);

  // A card mid-drag shows at its origin + the snapped delta, as does everything
  // else selected with it (and every card inside a dragged frame).
  const nodes = useMemo(() => baseNodes.map((node) => {
    const origin = drag?.origins[node.id];
    return origin && drag ? { ...node, at: { x: origin.x + drag.delta.x, y: origin.y + drag.delta.y } } : node;
  }), [baseNodes, drag]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  // Frames minus members that no longer exist (deleted cards, sync leftovers).
  const liveFrames = useMemo(() => {
    const ids = new Set([...baseNodes.map((n) => n.id), ...frames.map((f) => f.id)]);
    return frames.map((f) => ({ ...f, members: f.members.filter((m) => ids.has(m)) })).filter((f) => f.members.length > 0);
  }, [frames, baseNodes]);
  const frameById = useMemo(() => new Map(liveFrames.map((f) => [f.id, f])), [liveFrames]);
  const boxes = useMemo(() => frameBoxes(liveFrames, new Map(nodes.map((n) => [n.id, n.at]))), [liveFrames, nodes]);
  const parentFrameOf = useCallback((id: string) => liveFrames.find((f) => f.members.includes(id)), [liveFrames]);

  const mentionsByNode = useMemo(() => {
    const map = new Map<string, PluginObject[]>();
    for (const rel of mentions) {
      const entity = entityById.get(rel.to_id);
      if (!entity) continue;
      map.set(rel.from_id, [...(map.get(rel.from_id) ?? []), entity]);
    }
    return map;
  }, [mentions, entityById]);

  // Line geometry + the hovered connection. The remove button is drawn in a
  // layer above every line, so a crossing line can never take its clicks.
  const geoms = useMemo(() => links.flatMap((rel) => {
    const from = nodeById.get(rel.from_id);
    const to = nodeById.get(rel.to_id);
    return from && to ? [{ rel, key: `${rel.from_id}|${rel.to_id}`, ...routeLink(from.at, to.at) }] : [];
  }), [links, nodeById]);
  const spots = useMemo(() => {
    const cards = nodes.map((n) => ({ x: n.at.x, y: n.at.y, w: CARD_W, h: CARD_H }));
    return new Map(geoms.map((g) => [g.key, removeSpot(g.pts, geoms.filter((o) => o !== g).map((o) => o.pts), cards)]));
  }, [geoms, nodes]);
  const [hoverLink, setHoverLink] = useState<string | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const enterLink = (key: string) => { window.clearTimeout(hoverTimer.current); setHoverLink(key); };
  const leaveLink = () => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setHoverLink(null), 80); };

  // Writes are chained so two quick edits never race on `updated_at`.
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const persistProps = useCallback((patch: Record<string, unknown>) => {
    if (!manuscript) return;
    chainRef.current = chainRef.current.then(async () => {
      try {
        const fresh = await context.data.objects.get(manuscript.id);
        const merged = { ...propsOf(fresh ?? manuscript), ...patch };
        await context.data.objects.update(manuscript.id, { props: JSON.stringify(merged) }, fresh?.updated_at ?? manuscript.updated_at);
      } catch (value) {
        setError(value instanceof Error ? value.message : String(value));
      }
    });
  }, [context, manuscript]);
  // A click on the board starts a drag/band before the rename input blurs, so the
  // rename's reload lands mid-gesture; run it once the gesture and its writes finish.
  useEffect(() => {
    if (busy || !pendingLoadRef.current) return;
    pendingLoadRef.current = false;
    void chainRef.current.then(load);
  }, [busy, load]);
  const savePositions = (next: Record<string, XY>) => { setSaved(next); persistProps({ "tw.board": next }); };
  const saveFrames = (next: Frame[]) => { setFrames(next); persistProps({ "tw.frames": next }); };
  const saveMarkers = (next: Marker[]) => { setMarkers(next); persistProps({ "tw.timeline": next }); };

  const toCanvas = (point: { clientX: number; clientY: number }): XY => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    return { x: point.clientX - (rect?.left ?? 0) + (canvas?.scrollLeft ?? 0), y: point.clientY - (rect?.top ?? 0) + (canvas?.scrollTop ?? 0) };
  };

  // --- drag cards / frames (below a small threshold it counts as a click) ----
  function startDrag(event: ReactPointerEvent, id: string) {
    if (event.button !== 0) return;
    setMenu(null);
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      setSelected((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
      return;
    }
    const group = selected.includes(id) ? selected : [id];
    wasMultiRef.current = selected.length > 1 && selected.includes(id);
    if (!selected.includes(id)) setSelected([id]);
    const origins: Record<string, XY> = {};
    for (const nodeId of new Set(group.flatMap((entry) => nodesUnder(entry, frameById)))) {
      const node = nodeById.get(nodeId);
      if (node) origins[nodeId] = node.at;
    }
    movedRef.current = false;
    setDrag({ id, startX: event.clientX, startY: event.clientY, delta: { x: 0, y: 0 }, origins });
  }
  function activate(id: string) {
    const node = nodeById.get(id);
    if (node) {
      if (node.kind === "scene") void context.ui.openObject(node.id);
      else setEditing({ id: node.id, value: node.object.title || "" });
      return;
    }
    const frame = frameById.get(id);
    if (frame) setEditing({ id, value: frame.title });
  }
  const finishDrag = () => {
    const cur = drag;
    setDrag(null);
    if (!cur) return;
    if (movedRef.current) {
      const next = { ...saved };
      for (const [id, origin] of Object.entries(cur.origins)) next[id] = { x: origin.x + cur.delta.x, y: origin.y + cur.delta.y };
      savePositions(next);
      joinFrameAt(cur);
    } else if (wasMultiRef.current) setSelected([cur.id]);
    else activate(cur.id);
  };
  const finishDragRef = useRef(finishDrag);
  finishDragRef.current = finishDrag;
  const dragging = Boolean(drag);
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      setDrag((cur) => {
        if (!cur) return cur;
        const rx = event.clientX - cur.startX;
        const ry = event.clientY - cur.startY;
        if (Math.abs(rx) + Math.abs(ry) > 4) movedRef.current = true;
        if (!movedRef.current) return cur;
        // Keep every moved card on the canvas (origins are on the grid, so the clamp is too).
        const minX = Math.min(...Object.values(cur.origins).map((o) => o.x));
        const minY = Math.min(...Object.values(cur.origins).map((o) => o.y));
        return { ...cur, delta: { x: Math.max(snap(rx), -minX), y: Math.max(snap(ry), -minY) } };
      });
    };
    const up = () => finishDragRef.current();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [dragging]);

  // --- rubber-band selection on the empty canvas ----------------------------
  function startBand(event: ReactPointerEvent) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    setMenu(null);
    const p = toCanvas(event);
    bandAddRef.current = event.shiftKey || event.ctrlKey || event.metaKey;
    setBand({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  const finishBand = () => {
    const cur = band;
    setBand(null);
    if (!cur) return;
    if (Math.abs(cur.x1 - cur.x0) + Math.abs(cur.y1 - cur.y0) < 4) { if (!bandAddRef.current) setSelected([]); return; }
    const left = Math.min(cur.x0, cur.x1), right = Math.max(cur.x0, cur.x1);
    const top = Math.min(cur.y0, cur.y1), bottom = Math.max(cur.y0, cur.y1);
    const hit = nodes.filter((n) => n.at.x < right && n.at.x + CARD_W > left && n.at.y < bottom && n.at.y + CARD_H > top).map((n) => n.id);
    setSelected(bandAddRef.current ? [...new Set([...selected, ...hit])] : hit);
  };
  const finishBandRef = useRef(finishBand);
  finishBandRef.current = finishBand;
  const banding = Boolean(band);
  useEffect(() => {
    if (!banding) return;
    const move = (event: PointerEvent) => { const p = toCanvas(event); setBand((cur) => cur && ({ ...cur, x1: p.x, y1: p.y })); };
    const up = () => finishBandRef.current();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [banding]);

  // --- drag a handle to connect ----------------------------------------------
  function startConnect(event: ReactPointerEvent, from: string, side: Side) {
    event.preventDefault();
    event.stopPropagation();
    setConnect({ from, side, at: { x: event.clientX, y: event.clientY } });
  }
  useEffect(() => {
    if (!connect) return;
    const move = (event: PointerEvent) => setConnect((cur) => cur && ({ ...cur, at: { x: event.clientX, y: event.clientY } }));
    const up = (event: PointerEvent) => {
      const target = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-node-id]");
      const to = target?.dataset.nodeId;
      setConnect((cur) => {
        if (cur && to && to !== cur.from && !links.some((l) => l.from_id === cur.from && l.to_id === to)) {
          void context.data.relations.create(cur.from, to, LEADS).then(load).catch((v) => setError(String(v)));
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [connect, links, context, load]);

  // --- drag a timeline marker sideways ---------------------------------------
  function startMarkerDrag(event: ReactPointerEvent, marker: Marker) {
    if (event.button !== 0) return;
    setMenu(null);
    movedRef.current = false;
    setMdrag({ id: marker.id, startX: event.clientX, x0: marker.x, x: marker.x });
  }
  const finishMarkerDrag = () => {
    const cur = mdrag;
    setMdrag(null);
    if (!cur) return;
    if (movedRef.current) saveMarkers(markers.map((m) => m.id === cur.id ? { ...m, x: cur.x } : m));
    else { const marker = markers.find((m) => m.id === cur.id); if (marker) setEditing({ id: marker.id, value: marker.label }); }
  };
  const finishMarkerRef = useRef(finishMarkerDrag);
  finishMarkerRef.current = finishMarkerDrag;
  const markerDragging = Boolean(mdrag);
  useEffect(() => {
    if (!markerDragging) return;
    const move = (event: PointerEvent) => {
      setMdrag((cur) => {
        if (!cur) return cur;
        const raw = event.clientX - cur.startX;
        if (Math.abs(raw) > 4) movedRef.current = true;
        return movedRef.current ? { ...cur, x: Math.max(0, snap(cur.x0 + raw)) } : cur;
      });
    };
    const up = () => finishMarkerRef.current();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [markerDragging]);

  async function addNode() {
    try {
      const created = await context.data.objects.create({
        type: TYPE.beat,
        title: "New node",
        props: JSON.stringify({ "tw.manuscriptId": manuscriptId }),
      });
      // Avoid landing on any card currently on the canvas, saved or auto-laid.
      const used = new Set(nodes.map((n) => `${n.at.x},${n.at.y}`));
      let slot = 0;
      let at: XY = { x: 40, y: 40 };
      while (used.has(`${at.x},${at.y}`)) { slot += 1; at = { x: 40 + (slot % 4) * (CARD_W + 40), y: 40 + Math.floor(slot / 4) * (CARD_H + 48) }; }
      savePositions({ ...saved, [created.id]: at });
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  function addMarker() {
    const x = markers.length ? Math.max(...markers.map((m) => m.x)) + 160 : 40;
    const marker: Marker = { id: newId("m"), label: `Day ${markers.length + 1}`, x };
    saveMarkers([...markers, marker]);
    setEditing({ id: marker.id, value: marker.label });
  }

  // --- frames ------------------------------------------------------------------
  function groupSelected() {
    const ids = selected.filter((id) => nodeById.has(id) || frameById.has(id));
    if (ids.length < 2) return;
    const taken = new Set(ids);
    const next = liveFrames
      .map((f) => ({ ...f, members: f.members.filter((m) => !taken.has(m)) }))
      .filter((f) => f.members.length > 0);
    const frame: Frame = { id: newId("f"), title: "Frame", members: ids };
    saveFrames([...next, frame]);
    setSelected([frame.id]);
    setEditing({ id: frame.id, value: frame.title });
  }
  function ungroup(frameId: string) {
    const target = frameById.get(frameId);
    if (!target) return;
    saveFrames(liveFrames.filter((f) => f.id !== frameId).map((f) => (
      f.members.includes(frameId) ? { ...f, members: f.members.flatMap((m) => m === frameId ? target.members : [m]) } : f
    )));
    setSelected([]);
  }
  /** A single card dropped inside a frame it doesn't belong to joins the
   *  innermost frame under its centre (frames only grow around members). */
  function joinFrameAt(cur: { id: string; origins: Record<string, XY>; delta: XY }) {
    const origin = cur.origins[cur.id];
    // ponytail: single-card drops only; a multi-select drop keeps its frames.
    if (!origin || Object.keys(cur.origins).length !== 1) return;
    const cx = origin.x + cur.delta.x + CARD_W / 2;
    const cy = origin.y + cur.delta.y + CARD_H / 2;
    const target = [...boxes.entries()]
      .filter(([, b]) => cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h)
      .sort((a, b) => a[1].w * a[1].h - b[1].w * b[1].h)[0]?.[0];
    if (!target || frameById.get(target)?.members.includes(cur.id)) return;
    moveToFrame([cur.id], target);
  }
  /** Cards leave whatever frame holds them and join `target`. */
  function moveToFrame(ids: string[], target: string) {
    const moving = new Set(ids);
    saveFrames(liveFrames
      .map((f) => ({ ...f, members: [...f.members.filter((m) => !moving.has(m)), ...(f.id === target ? ids : [])] }))
      .filter((f) => f.members.length > 0));
  }
  function removeFromFrame(id: string) {
    saveFrames(liveFrames.map((f) => ({ ...f, members: f.members.filter((m) => m !== id) })).filter((f) => f.members.length > 0));
  }

  async function deleteLink(rel: PluginRelation) {
    try { await context.data.relations.delete(rel.from_id, rel.to_id, rel.kind); await load(); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
  }

  async function toggleMention(nodeId: string, entityId: string) {
    const existing = mentions.find((rel) => rel.from_id === nodeId && rel.to_id === entityId);
    try {
      if (existing) await context.data.relations.delete(nodeId, entityId, MENTIONS);
      else await context.data.relations.create(nodeId, entityId, MENTIONS);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function setBeatColour(id: string, colour: string) {
    const beat = beats.find((b) => b.id === id);
    if (!beat) return;
    try {
      const next = { ...propsOf(beat), colour: colour || undefined };
      await context.data.objects.update(id, { props: JSON.stringify(next) }, beat.updated_at);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function deleteBeat(id: string) {
    try {
      await context.data.objects.trash(id);
      const next = { ...saved };
      delete next[id];
      savePositions(next);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  async function commitEdit() {
    if (!editing) return;
    const { id } = editing;
    setEditing(null);
    if (frameById.has(id)) {
      saveFrames(liveFrames.map((f) => f.id === id ? { ...f, title: editing.value.trim() || "Frame" } : f));
      return;
    }
    if (markers.some((m) => m.id === id)) {
      saveMarkers(markers.map((m) => m.id === id ? { ...m, label: editing.value.trim() || "Marker" } : m));
      return;
    }
    const value = editing.value.trim() || "New node";
    setBeats((list) => list.map((b) => b.id === id ? { ...b, title: value } : b));
    try { await context.data.objects.update(id, { title: value }); await load(); }
    catch (v) { setError(String(v)); }
  }

  function openMenu(event: ReactMouseEvent, id: string, kind: MenuKind) {
    event.preventDefault();
    event.stopPropagation();
    setSub(null);
    if (kind !== "marker" && !selected.includes(id)) setSelected([id]);
    setMenu({ id, kind, x: event.clientX, y: event.clientY });
  }

  if (error) return <p className="ns-message ns-message-error">{error}</p>;

  const extentX = Math.max(720, ...nodes.map((n) => n.at.x + CARD_W + 60), ...markers.map((m) => m.x + 200), ...[...boxes.values()].map((b) => b.x + b.w + 40));
  const extentY = Math.max(420, ...nodes.map((n) => n.at.y + CARD_H + 60), ...[...boxes.values()].map((b) => b.y + b.h + 40));
  const sortedMarkers = [...markers].sort((a, b) => a.x - b.x);
  const flipped = menu ? menu.x + 360 > window.innerWidth : false;
  const nodeInputProps = (onDone: () => void) => ({
    className: "tw-board-node-input",
    autoFocus: true,
    onFocus: (event: { currentTarget: HTMLInputElement }) => event.currentTarget.select(),
    onPointerDown: (event: ReactPointerEvent) => event.stopPropagation(),
    onBlur: onDone,
    onKeyDown: (event: ReactKeyboardEvent) => { if (event.key === "Enter") onDone(); if (event.key === "Escape") setEditing(null); },
  });
  const menuNodeMentions = menu ? mentionsByNode.get(menu.id) ?? [] : [];

  return (
    <div className="tw-board">
      <div className="tw-board-toolbar">
        <button type="button" className="tw-btn" onClick={() => void addNode()}>{t("Add node")}</button>
        <button type="button" className="tw-btn" onClick={addMarker}>{t("Add timeline marker")}</button>
        <button type="button" className="tw-btn" disabled={selected.length < 2} onClick={groupSelected}>{t("Group into frame")}</button>
        {nodes.length > 0 && <span className="ns-muted tw-board-hint" title={t("Drag a card to move it (snaps to a grid). Shift-click or drag the background to select several. Drag a dot on a card's edge onto another card to connect. Right-click for more.")}>{t("Drag to move · Shift-click to select · right-click for more")}</span>}
      </div>

      {nodes.length === 0 ? (
        // A compact, centred start instead of a huge empty canvas (V-SURFACES-07).
        <div className="tw-empty-start">
          <strong>{t("The board is empty")}</strong>
          <p className="ns-muted">{t("Add a card, or write scenes in the Manuscript tab — they appear here by themselves.")}</p>
          <button type="button" className="tw-btn tw-btn-primary" onClick={() => void addNode()}>{t("Add node")}</button>
        </div>
      ) : (
        <div
          ref={canvasRef}
          className={`tw-board-canvas${connect ? " is-connecting" : ""}${drag && movedRef.current ? " is-moving" : ""}`}
          style={{ width: extentX, height: extentY }}
          onPointerDown={startBand}
        >
          {markers.length > 0 && (
            <div className="tw-board-ruler" style={{ width: extentX }}>
              {sortedMarkers.map((marker) => (
                <div
                  key={marker.id}
                  className={`tw-board-marker${marker.jump ? " is-jump" : ""}${mdrag?.id === marker.id ? " is-dragging" : ""}`}
                  style={{ left: mdrag?.id === marker.id ? mdrag.x : marker.x }}
                  onPointerDown={(event) => startMarkerDrag(event, marker)}
                  onContextMenu={(event) => openMenu(event, marker.id, "marker")}
                >
                  {editing?.id === marker.id ? (
                    <input {...nodeInputProps(() => void commitEdit())} value={editing.value} onChange={(event) => setEditing({ id: marker.id, value: event.target.value })} />
                  ) : (
                    <span className="tw-board-marker-label">{marker.jump && <span className="tw-board-marker-jump" aria-hidden="true">//</span>}{marker.label}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {[...boxes.entries()].sort((a, b) => b[1].level - a[1].level).map(([id, box]) => {
            const frame = frameById.get(id);
            if (!frame) return null;
            return (
              <div
                key={id}
                className={`tw-board-frame${selected.includes(id) ? " is-selected" : ""}`}
                data-level={Math.min(box.level, 3)}
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              >
                <div className="tw-board-frame-head" onPointerDown={(event) => startDrag(event, id)} onContextMenu={(event) => openMenu(event, id, "frame")}>
                  {editing?.id === id ? (
                    <input {...nodeInputProps(() => void commitEdit())} value={editing.value} onChange={(event) => setEditing({ id, value: event.target.value })} />
                  ) : (
                    <span className="tw-board-frame-title">{frame.title || t("Frame")}</span>
                  )}
                </div>
              </div>
            );
          })}

          <svg className="tw-board-links" width={extentX} height={extentY} aria-hidden="true">
            <defs>
              <marker id="tw-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill="context-stroke" />
              </marker>
            </defs>
            {geoms.map((g) => (
              <g key={g.key} className={`tw-board-link-group${hoverLink === g.key ? " is-hover" : ""}`}>
                {/* Wide invisible stroke = comfortable hover target for the thin line. */}
                <path className="tw-board-link-hit" d={g.d} onPointerEnter={() => enterLink(g.key)} onPointerLeave={leaveLink} />
                <path className="tw-board-link" d={g.d} markerEnd="url(#tw-arrow)" />
              </g>
            ))}
            {geoms.filter((g) => g.key === hoverLink).map((g) => {
              const at = spots.get(g.key) ?? { x: g.mx, y: g.my };
              return (
                <g key={`del-${g.key}`} className="tw-board-link-del" transform={`translate(${at.x} ${at.y})`} onPointerEnter={() => enterLink(g.key)} onPointerLeave={leaveLink} onClick={() => { setHoverLink(null); void deleteLink(g.rel); }}>
                  <title>{t("Remove connection")}</title>
                  <circle r="9" />
                  <path d="M -3.2 -3.2 L 3.2 3.2 M 3.2 -3.2 L -3.2 3.2" />
                </g>
              );
            })}
            {connect && nodeById.get(connect.from) && (() => {
              const from = nodeById.get(connect.from)!;
              const p = toCanvas({ clientX: connect.at.x, clientY: connect.at.y });
              const start = sidePoint(from.at, connect.side);
              return <path className="tw-board-link is-live" d={`M ${start.x} ${start.y} L ${p.x} ${p.y}`} />;
            })()}
          </svg>

          {nodes.map((node) => {
            const linked = mentionsByNode.get(node.id) ?? [];
            return (
              <div
                key={node.id}
                className={`tw-board-node${node.kind === "scene" ? " is-scene" : ""}${drag && node.id in drag.origins ? " is-dragging" : ""}${selected.includes(node.id) ? " is-selected" : ""}`}
                data-node-id={node.id}
                data-status={node.kind === "scene" ? statusOf(node.object) : undefined}
                data-colour={node.kind === "beat" ? colourOf(node.object) : undefined}
                style={{ left: node.at.x, top: node.at.y, width: CARD_W, height: CARD_H }}
                onPointerDown={(event) => startDrag(event, node.id)}
                onContextMenu={(event) => openMenu(event, node.id, node.kind)}
              >
                {node.kind === "scene" && <span className="tw-board-card-dot" aria-hidden="true" />}
                <div className="tw-board-node-body">
                  {editing?.id === node.id ? (
                    <input {...nodeInputProps(() => void commitEdit())} value={editing.value} onChange={(event) => setEditing({ id: node.id, value: event.target.value })} />
                  ) : (
                    // Click without moving = open (scene) / rename (beat); see finishDrag.
                    <span className="tw-board-node-title">
                      {node.object.title || (node.kind === "scene" ? t("Untitled scene") : t("New node"))}
                    </span>
                  )}
                  {linked.length > 0 && (
                    <span className="tw-board-chips">
                      {linked.slice(0, 3).map((entity) => (
                        <span key={entity.id} className="tw-board-chip" title={entity.title}>
                          <i style={{ background: ENTITY_KINDS.find((k) => k.type === entity.type)?.colour }} aria-hidden="true" />
                          {entity.title || t("Untitled")}
                        </span>
                      ))}
                      {linked.length > 3 && <span className="tw-board-chip-more">+{linked.length - 3}</span>}
                    </span>
                  )}
                </div>
                {SIDES.map((side) => (
                  <span
                    key={side}
                    className={`tw-board-node-handle is-${side}`}
                    aria-hidden="true"
                    title={t("Drag onto another card to connect")}
                    onPointerDown={(event) => startConnect(event, node.id, side)}
                  />
                ))}
              </div>
            );
          })}

          {band && (
            <div
              className="tw-board-band"
              style={{ left: Math.min(band.x0, band.x1), top: Math.min(band.y0, band.y1), width: Math.abs(band.x1 - band.x0), height: Math.abs(band.y1 - band.y0) }}
            />
          )}
        </div>
      )}

      {menu && (
        <div className="tw-menu" style={{ top: menu.y, left: menu.x }} onClick={(event) => event.stopPropagation()}>
          {menu.kind === "scene" && <button type="button" onClick={() => { void context.ui.openObject(menu.id); setMenu(null); }}>{t("Open")}</button>}
          {(menu.kind === "beat" || menu.kind === "frame" || menu.kind === "marker") && (
            <button type="button" onClick={() => {
              const label = menu.kind === "frame" ? frameById.get(menu.id)?.title : menu.kind === "marker" ? markers.find((m) => m.id === menu.id)?.label : nodeById.get(menu.id)?.object.title;
              setEditing({ id: menu.id, value: label || "" });
              setMenu(null);
            }}>{t("Rename")}</button>
          )}
          {menu.kind === "marker" && (
            <button type="button" onClick={() => { saveMarkers(markers.map((m) => m.id === menu.id ? { ...m, jump: m.jump ? undefined : true } : m)); setMenu(null); }}>
              <span>{t("Time jump")}</span>{markers.find((m) => m.id === menu.id)?.jump && <Check size={14} aria-hidden="true" />}
            </button>
          )}
          {menu.kind === "beat" && (
            <SubMenu label={t("Colour")} open={sub === "colour"} onToggle={(open) => setSub(open ? "colour" : null)} flipped={flipped}>
              {[undefined, ...BEAT_COLOURS].map((colour) => {
                const current = colourOf(nodeById.get(menu.id)?.object ?? {} as PluginObject);
                return (
                  <button key={colour ?? "none"} type="button" role="menuitemradio" aria-checked={current === colour} onClick={() => { void setBeatColour(menu.id, colour ?? ""); setMenu(null); }}>
                    <span>{colour ? t(COLOUR_LABEL[colour]) : t("None")}</span>
                    {current === colour && <Check size={14} aria-hidden="true" />}
                  </button>
                );
              })}
            </SubMenu>
          )}
          {(menu.kind === "beat" || menu.kind === "scene") && (
            <SubMenu label={t("Link to Codex")} open={sub === "link"} onToggle={(open) => setSub(open ? "link" : null)} flipped={flipped}>
              {entities.length === 0 && <span className="tw-menu-label">{t("No Codex entries yet")}</span>}
              {ENTITY_KINDS.map((kind) => {
                const list = entities.filter((e) => e.type === kind.type).sort((a, b) => a.title.localeCompare(b.title));
                if (list.length === 0) return null;
                return (
                  <div key={kind.type}>
                    <span className="tw-menu-label">{t(kind.label)}</span>
                    {list.map((entity) => (
                      <button key={entity.id} type="button" role="menuitemcheckbox" aria-checked={menuNodeMentions.some((m) => m.id === entity.id)} onClick={() => void toggleMention(menu.id, entity.id)}>
                        <span>{entity.title || t("Untitled")}</span>
                        {menuNodeMentions.some((m) => m.id === entity.id) && <Check size={14} aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                );
              })}
            </SubMenu>
          )}
          {(menu.kind === "beat" || menu.kind === "scene") && liveFrames.some((f) => f.id !== parentFrameOf(menu.id)?.id) && (
            <SubMenu label={t("Add to frame")} open={sub === "frame"} onToggle={(open) => setSub(open ? "frame" : null)} flipped={flipped}>
              {liveFrames.filter((f) => f.id !== parentFrameOf(menu.id)?.id).map((f) => (
                <button key={f.id} type="button" onClick={() => {
                  // The right-clicked card, plus every other selected card with it.
                  moveToFrame(selected.includes(menu.id) ? selected.filter((id) => nodeById.has(id)) : [menu.id], f.id);
                  setMenu(null);
                }}>{f.title || t("Frame")}</button>
              ))}
            </SubMenu>
          )}
          {selected.length > 1 && selected.includes(menu.id) && menu.kind !== "marker" && <button type="button" onClick={() => { groupSelected(); setMenu(null); }}>{t("Group into frame")}</button>}
          {menu.kind !== "marker" && parentFrameOf(menu.id) && <button type="button" onClick={() => { removeFromFrame(menu.id); setMenu(null); }}>{t("Remove from frame")}</button>}
          {menu.kind === "frame" && <button type="button" onClick={() => { ungroup(menu.id); setMenu(null); }}>{t("Ungroup")}</button>}
          {menu.kind === "beat" && <button type="button" className="is-danger" onClick={() => { void deleteBeat(menu.id); setMenu(null); }}>{t("Delete")}</button>}
          {menu.kind === "marker" && <button type="button" className="is-danger" onClick={() => { saveMarkers(markers.filter((m) => m.id !== menu.id)); setMenu(null); }}>{t("Delete")}</button>}
        </div>
      )}
    </div>
  );
}
