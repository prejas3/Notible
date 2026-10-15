import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { BookCopy, BookMarked, ChevronRight, Flame, GripVertical, PenLine } from "lucide-react";
import { Select, Combobox, DatePicker } from "../../src/core/ui/index.ts";
import type { PluginContext, PluginObject, PluginRelation } from "../../packages/plugin-api/src/index.ts";
import { MANUSCRIPT_FONTS, registerTypesAndProfile, removeSystemicRelation, setSystemicRelation } from "./typewriter.ts";
import TypewriterCodex, { REL } from "./typewriter-codex.tsx";
import TypewriterBoard from "./typewriter-board.tsx";
import { aggregateSubtree, inManuscript, renumberFootnotes, wordCount, wordsPerDay, wordsWrittenOn, writingStreak, buildHeatmapWeeks, isoAddDays, type DailyWordLog } from "./typewriter-model.ts";
import { useT } from "./i18n.tsx";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Heatmap cell intensity bucket. Thresholds are a rough, hardcoded guess at
 *  a reasonable daily prose range (a "good session" starts somewhere around
 *  300-800 words) — not tuned against real data, fine to adjust later. */
function heatBucket(words: number | null): "none" | "zero" | "low" | "mid" | "high" {
  if (words === null) return "none";
  if (words <= 0) return "zero";
  if (words < 300) return "low";
  if (words < 800) return "mid";
  return "high";
}

/** Flatten an outline into { id, parentId, words } rows for aggregateSubtree. */
function flattenForAggregate(nodes: OutlineNode[], parentId: string, words: Map<string, number>): { id: string; parentId: string | null; words: number; isScene: boolean }[] {
  const out: { id: string; parentId: string | null; words: number; isScene: boolean }[] = [];
  for (const node of nodes) {
    out.push({ id: node.object.id, parentId, words: words.get(node.object.id) ?? 0, isScene: node.object.type === TYPE.scene });
    out.push(...flattenForAggregate(node.children, node.object.id, words));
  }
  return out;
}
import "./surface.css";
import "./typewriter.css";

interface Props {
  context: unknown;
  /** Set by Core when this surface is mounted as a manuscript object tab
   *  (API 1.5): the manuscript is fixed and its picker is hidden. */
  initialContainerId?: string;
  /** Which single pane to show, when mounted as an object tab. Its presence
   *  also hides this component's own tab strip. */
  tab?: "manuscript" | "codex" | "progress" | "board";
}

/** The 7 type upserts are idempotent but not free; once per session is
 *  enough. Reset never — a session that lost its types can reload. */
let typesEnsured = false;

const NS = "notible.typewriter.";
const TYPE = {
  manuscript: `${NS}manuscript`,
  part: `${NS}part`,
  chapter: `${NS}chapter`,
  scene: `${NS}scene`,
  character: `${NS}character`,
  location: `${NS}location`,
  plotline: `${NS}plotline`,
} as const;

const FONT_GROUP_LABEL: Record<string, string> = { serif: "Serif", sans: "Sans", mono: "Monospace" };
/** "Theme default" + disabled group headers + the named fonts, for <Select>. */
const FONT_SELECT_OPTIONS: { value: string; label: string; disabled?: boolean }[] = [
  { value: "", label: "Theme default" },
  ...(["serif", "sans", "mono"] as const).flatMap((group) => [
    { value: `__group_${group}`, label: `— ${FONT_GROUP_LABEL[group]} —`, disabled: true },
    ...MANUSCRIPT_FONTS.filter((font) => font.group === group).map((font) => ({ value: font.value, label: font.label })),
  ]),
];

/** Outline-row glyphs — same lucide set Core uses for these types. */
const ROW_ICON: Record<string, typeof BookCopy> = {
  [TYPE.part]: BookCopy,
  [TYPE.chapter]: BookMarked,
  [TYPE.scene]: PenLine,
};

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

function parseProps(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

function orderOf(object: PluginObject): number {
  const value = parseProps(object.props).order;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Which child types a row of `parentType` may hold. */
function canContain(parentType: string, childType: string): boolean {
  if (parentType === TYPE.manuscript) return childType === TYPE.part || childType === TYPE.chapter;
  if (parentType === TYPE.part) return childType === TYPE.chapter;
  if (parentType === TYPE.chapter) return childType === TYPE.scene;
  return false;
}

/** part/chapter/scene rows for one manuscript, sorted into reading order. */
interface OutlineNode {
  object: PluginObject;
  children: OutlineNode[];
}

function buildOutline(manuscriptId: string, rows: PluginObject[]): OutlineNode[] {
  const mine = rows.filter((row) => row.id === manuscriptId || inManuscript(row.props, manuscriptId));
  const byParent = new Map<string, PluginObject[]>();
  for (const row of mine) {
    if (row.id === manuscriptId) continue;
    const key = row.parent_id ?? manuscriptId;
    const bucket = byParent.get(key);
    if (bucket) bucket.push(row);
    else byParent.set(key, [row]);
  }
  const sortRows = (list: PluginObject[]) =>
    [...list].sort((a, b) => orderOf(a) - orderOf(b) || a.created_at - b.created_at);
  const nodeFor = (object: PluginObject): OutlineNode => ({
    object,
    children: sortRows(byParent.get(object.id) ?? []).map(nodeFor),
  });
  return sortRows(byParent.get(manuscriptId) ?? []).map(nodeFor);
}

export default function TypewriterSurface({ context: rawContext, initialContainerId, tab: forcedPane }: Props) {
  const context = rawContext as PluginContext;
  const t = useT();
  const asTab = Boolean(forcedPane);
  const [tab, setTab] = useState<"manuscript" | "codex" | "progress" | "board">(
    forcedPane === "codex" || forcedPane === "progress" || forcedPane === "board" ? forcedPane : "manuscript",
  );
  const [manuscripts, setManuscripts] = useState<PluginObject[]>([]);
  const [manuscriptId, setManuscriptId] = useState(initialContainerId ?? "");
  const [rows, setRows] = useState<PluginObject[]>([]);
  const [characters, setCharacters] = useState<PluginObject[]>([]);
  const [locations, setLocations] = useState<PluginObject[]>([]);
  const [plotlines, setPlotlines] = useState<PluginObject[]>([]);
  const [sceneRels, setSceneRels] = useState<Map<string, PluginRelation[]>>(new Map());
  const [openScene, setOpenScene] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string } | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; where: "before" | "after" | "inside" } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const dropHintRef = useRef<typeof dropHint>(null);
  dragRef.current = drag;
  dropHintRef.current = dropHint;

  const loadManuscripts = useCallback(async () => {
    if (initialContainerId) { setManuscriptId(initialContainerId); return []; }
    const list = await context.data.objects.query({ type: TYPE.manuscript, limit: 200 });
    setManuscripts(list);
    const stored = context.storage.get<string>("tw.lastManuscript");
    setManuscriptId((current) => current || (stored && list.some((m) => m.id === stored) ? stored : list[0]?.id ?? ""));
    return list;
  }, [context, initialContainerId]);

  const loadRows = useCallback(async () => {
    if (!manuscriptId) { setRows([]); return; }
    const [parts, chapters, scenes, chars, locs, plots, manuscript] = await Promise.all([
      context.data.objects.query({ type: TYPE.part, limit: 1000 }),
      context.data.objects.query({ type: TYPE.chapter, limit: 2000 }),
      context.data.objects.query({ type: TYPE.scene, limit: 5000 }),
      context.data.objects.query({ type: TYPE.character, limit: 2000 }),
      context.data.objects.query({ type: TYPE.location, limit: 2000 }),
      context.data.objects.query({ type: TYPE.plotline, limit: 2000 }),
      context.data.objects.get(manuscriptId),
    ]);
    const mine = (list: PluginObject[]) => list.filter((row) => inManuscript(row.props, manuscriptId));
    const all = [...mine(parts), ...mine(chapters), ...mine(scenes)];
    setRows(manuscript ? [manuscript, ...all] : all);
    setCharacters(mine(chars));
    setLocations(mine(locs));
    setPlotlines(mine(plots));
  }, [context, manuscriptId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        if (!typesEnsured) { await registerTypesAndProfile(context); typesEnsured = true; }
        if (!cancelled) await loadManuscripts();
      } catch (value) {
        if (!cancelled) setError(errorMessage(value));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [context, loadManuscripts]);

  useEffect(() => { void loadRows().catch((value) => setError(errorMessage(value))); }, [loadRows]);

  useEffect(() => {
    if (manuscriptId && !initialContainerId) context.storage.set("tw.lastManuscript", manuscriptId);
  }, [context, manuscriptId, initialContainerId]);

  useEffect(() => {
    const close = () => setMenu(null);
    if (menu) {
      window.addEventListener("click", close);
      window.addEventListener("resize", close);
      return () => { window.removeEventListener("click", close); window.removeEventListener("resize", close); };
    }
  }, [menu]);

  const outline = useMemo(
    () => (manuscriptId ? buildOutline(manuscriptId, rows) : []),
    [manuscriptId, rows],
  );
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const charById = useMemo(() => new Map(characters.map((row) => [row.id, row])), [characters]);
  const locById = useMemo(() => new Map(locations.map((row) => [row.id, row])), [locations]);
  const plotById = useMemo(() => new Map(plotlines.map((row) => [row.id, row])), [plotlines]);

  const manuscript = useMemo(() => rowsById.get(manuscriptId) ?? null, [rowsById, manuscriptId]);
  const manuscriptProps = useMemo(() => (manuscript ? parseProps(manuscript.props) : {}), [manuscript]);

  const sceneIds = useMemo(
    () => rows.filter((row) => row.type === TYPE.scene).map((row) => row.id),
    [rows],
  );
  // Prose lives in scenes, but a part or chapter opens as a plain note too —
  // so count body text on every content row and roll it into the total.
  const countedIds = useMemo(
    () => rows.filter((row) => row.type === TYPE.scene || row.type === TYPE.part || row.type === TYPE.chapter).map((row) => row.id),
    [rows],
  );
  const [wordCounts, setWordCounts] = useState<Map<string, number>>(new Map());
  const [counting, setCounting] = useState(false);

  const countScene = useCallback(async (id: string) => {
    try {
      const blocks = await context.data.document.get(id);
      const n = wordCount(blocks);
      context.storage.set(`tw.wc.${id}`, { n });
      setWordCounts((prev) => new Map(prev).set(id, n));
    } catch { /* a just-trashed row — leave its last known count */ }
  }, [context]);

  useEffect(() => {
    if (countedIds.length === 0) { setWordCounts(new Map()); return; }
    let cancelled = false;
    const seeded = new Map<string, number>();
    for (const id of countedIds) {
      const cached = context.storage.get<{ n: number }>(`tw.wc.${id}`);
      if (cached && typeof cached.n === "number") seeded.set(id, cached.n);
    }
    setWordCounts(seeded);
    (async () => {
      setCounting(true);
      for (let i = 0; i < countedIds.length && !cancelled; i += 20) {
        await Promise.all(countedIds.slice(i, i + 20).map(countScene));
      }
      if (!cancelled) setCounting(false);
    })();
    return () => { cancelled = true; };
  }, [countedIds, context, countScene]);

  useEffect(() => {
    const sub = context.events.on<{ id: string; type: string }>("object.updated", ({ id, type }) => {
      if ((type === TYPE.scene || type === TYPE.part || type === TYPE.chapter) && countedIds.includes(id)) void countScene(id);
    });
    return () => sub.dispose();
  }, [context, countedIds, countScene]);

  // Every relation touching a scene of this manuscript, grouped by scene id.
  const loadSceneRels = useCallback(async () => {
    if (sceneIds.length === 0) { setSceneRels(new Map()); return; }
    try {
      const grouped = await context.data.relations.listForObjects(sceneIds);
      const next = new Map<string, PluginRelation[]>();
      for (const id of sceneIds) next.set(id, grouped[id] ?? []);
      setSceneRels(next);
    } catch { /* best effort */ }
  }, [context, sceneIds]);
  useEffect(() => { void loadSceneRels(); }, [loadSceneRels]);

  // sceneId -> POV character id (tw.pov, one per scene).
  const povByScene = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, rels] of sceneRels) {
      const pov = rels.find((rel) => rel.kind === REL.pov && rel.from_id === id);
      if (pov) map.set(id, pov.to_id);
    }
    return map;
  }, [sceneRels]);

  const aggregateRows = useMemo(
    () => flattenForAggregate(outline, manuscriptId, wordCounts),
    [outline, manuscriptId, wordCounts],
  );
  const manuscriptTotal = useMemo(
    () => aggregateRows.reduce((sum, row) => sum + row.words, 0),
    [aggregateRows],
  );

  // One cumulative-total snapshot per calendar day, keyed by manuscript —
  // enough to derive "words written today" and a streak (writingStreak in
  // typewriter-model.ts) without a change log. Local to this device/storage,
  // not synced.
  const [dailyLog, setDailyLog] = useState<DailyWordLog>({});
  useEffect(() => {
    if (!manuscriptId || counting) return;
    const key = `tw.daily.${manuscriptId}`;
    const log = context.storage.get<DailyWordLog>(key) ?? {};
    const today = todayISO();
    const yesterday = isoAddDays(today, -1);
    const next = { ...log, [today]: manuscriptTotal };
    // The first day this manuscript is ever tracked has no prior day to diff
    // against, so wordsWrittenOn/writingStreak would see it as a permanent
    // gap — someone's very first writing session would show no progress and
    // no streak, forever, which is backwards. Seed yesterday at 0 so day one
    // counts. (A manuscript that already had a lot of text before tracking
    // started gets a one-time "streak day 1" credit for all of it — a
    // harmless welcome bonus, not something repeatable.) Checked on every
    // visit, not just when today's total changes, so a manuscript that hit
    // this exact gap before this fix shipped — logged only today, opened
    // again with the same word count — gets repaired too.
    if (Object.keys(log).length <= 1 && log[yesterday] === undefined) next[yesterday] = 0;
    if (next[today] === log[today] && next[yesterday] === log[yesterday]) {
      if (Object.keys(dailyLog).length === 0) setDailyLog(log);
      return;
    }
    // Keep the log from growing forever — a year of days is plenty for any
    // streak or heatmap this surface will ever show.
    const dates = Object.keys(next).sort();
    for (const stale of dates.slice(0, Math.max(0, dates.length - 365))) delete next[stale];
    context.storage.set(key, next);
    setDailyLog(next);
  }, [manuscriptId, manuscriptTotal, counting, context, dailyLog]);
  const streak = useMemo(() => writingStreak(dailyLog, todayISO()), [dailyLog]);
  const wordsToday = useMemo(() => wordsWrittenOn(dailyLog, todayISO()), [dailyLog]);
  const heatmap = useMemo(() => buildHeatmapWeeks(dailyLog, todayISO(), 10), [dailyLog]);

  function notifyWorkspace() {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("notible:workspace-changed"));
  }

  async function withBusy(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await work(); } catch (value) { setError(errorMessage(value)); } finally { setBusy(false); }
  }

  async function createManuscript() {
    await withBusy(async () => {
      const created = await context.data.objects.create({ type: TYPE.manuscript, title: "Untitled manuscript", props: "{}" });
      await loadManuscripts();
      setManuscriptId(created.id);
      notifyWorkspace();
    });
  }

  type CompiledRow = { kind: "heading"; level: number; title: string } | { kind: "hr" } | { kind: "text"; text: string };

  /** Walk the outline once, collecting headings and body text (a part/chapter's
   *  own prose, then its scenes) in document order. Shared by both the Markdown
   *  compile and the DOCX export so the "what counts as this node's text" rule
   *  — own text plus every descendant, scenes separated by "* * *" — only
   *  lives in one place. Footnotes are renumbered across the whole manuscript
   *  once every body has been read, same as before. */
  async function collectManuscriptRows(): Promise<{ rows: CompiledRow[]; notes: string[] }> {
    const rows: CompiledRow[] = [];
    const slots: number[] = []; // indices into `rows` holding a `text` placeholder, one per bodies[i]
    const bodies: string[][] = [];
    let firstScene = true;
    const level: Record<string, number> = { [TYPE.part]: 1, [TYPE.chapter]: 2, [TYPE.scene]: 3 };
    const walk = async (nodes: OutlineNode[]) => {
      for (const node of nodes) {
        const title = node.object.title || "Untitled";
        if (node.object.type === TYPE.scene) {
          if (!firstScene) rows.push({ kind: "hr" });
          firstScene = false;
          rows.push({ kind: "heading", level: level[node.object.type] ?? 3, title });
          const blocks = await context.data.document.get(node.object.id);
          bodies.push((blocks ?? []).flatMap((block) => (block.text ?? "").split("\n")));
          slots.push(rows.push({ kind: "text", text: "" }) - 1);
        } else {
          rows.push({ kind: "heading", level: level[node.object.type] ?? 2, title });
          // A part/chapter can carry its own prose directly (the default way
          // to write) in addition to — or instead of — child scenes. That
          // text compiles right after the heading, no "* * *" (it is lead-in
          // text, not a scene break).
          const blocks = await context.data.document.get(node.object.id);
          const ownLines = (blocks ?? []).flatMap((block) => (block.text ?? "").split("\n"));
          if (ownLines.some((line) => line.trim())) {
            bodies.push(ownLines);
            slots.push(rows.push({ kind: "text", text: "" }) - 1);
          }
        }
        await walk(node.children);
      }
    };
    await walk(outline);
    const { scenes: numbered, notes } = renumberFootnotes(bodies);
    const expanded: CompiledRow[] = [];
    let slot = 0;
    for (let i = 0; i < rows.length; i++) {
      if (slots[slot] === i) {
        for (const text of numbered[slot] ?? []) expanded.push({ kind: "text", text });
        slot++;
      } else {
        expanded.push(rows[i]);
      }
    }
    // A blank line between source paragraphs is a paragraph *boundary*, not
    // content of its own — each remaining row already becomes its own
    // paragraph downstream (a Markdown line, a Word Paragraph), which is
    // already visually separated (Word doubly so, via the double-spacing
    // style). Keeping the blank rows turned every paragraph break into an
    // extra empty paragraph — a visible gap on top of the spacing that was
    // already there.
    const collapsed = expanded.filter((row) => row.kind !== "text" || row.text.trim() !== "");
    return { rows: collapsed, notes };
  }

  /** Flatten the whole outline into one Markdown string: part = "# ",
   *  chapter = "## ", scene = "### " + its body, scenes split by "* * *". */
  async function compileManuscript() {
    if (!manuscript) return;
    await withBusy(async () => {
      const { rows, notes } = await collectManuscriptRows();
      const compiled: string[] = [];
      for (const row of rows) {
        if (row.kind === "heading") compiled.push(`${"#".repeat(row.level)} ${row.title}`, "");
        else if (row.kind === "hr") compiled.push("", "* * *", "");
        else compiled.push(row.text);
      }
      if (notes.length) compiled.push("", "## Notes", "", ...notes);
      const text = `# ${manuscript.title || "Untitled manuscript"}\n\n${compiled.join("\n")}`.trimEnd();
      const content = JSON.stringify({
        type: "doc",
        content: text.split("\n").map((line) => line
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" }),
      });
      const created = await context.data.objects.create({
        type: "note",
        title: `${manuscript.title || "Manuscript"} — compiled`,
        content,
        props: "{}",
      });
      notifyWorkspace();
      await context.ui.openObject(created.id);
    });
  }

  /** Standard manuscript format: 12pt Times New Roman, double-spaced, first
   *  line of each paragraph indented — the format agents/publishers expect
   *  for review, because DOCX should be a real editable export, not
   *  just a print-to-PDF view. */
  async function exportManuscriptDocx() {
    if (!manuscript) return;
    await withBusy(async () => {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import("docx");
      const { rows, notes } = await collectManuscriptRows();
      const headingLevels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
      const children = [
        new Paragraph({ text: manuscript.title || "Untitled manuscript", heading: HeadingLevel.TITLE }),
      ];
      for (const row of rows) {
        if (row.kind === "heading") {
          children.push(new Paragraph({ text: row.title, heading: headingLevels[row.level - 1] ?? HeadingLevel.HEADING_3 }));
        } else if (row.kind === "hr") {
          children.push(new Paragraph({ text: "* * *", alignment: AlignmentType.CENTER }));
        } else {
          children.push(new Paragraph({ children: [new TextRun(row.text)], indent: { firstLine: 720 } }));
        }
      }
      if (notes.length) {
        children.push(new Paragraph({ text: "Notes", heading: HeadingLevel.HEADING_2 }));
        for (const note of notes) children.push(new Paragraph({ text: note }));
      }
      const doc = new Document({
        styles: { default: { document: { run: { font: "Times New Roman", size: 24 }, paragraph: { spacing: { line: 480 } } } } },
        sections: [{ properties: {}, children }],
      });
      const base64 = await Packer.toBase64String(doc);
      const filename = `${(manuscript.title || "Manuscript").replace(/[^\p{L}\p{N}_-]+/gu, "-")}.docx`;
      // exportBinaryAs opens a native "Save As" dialog — the user picks the
      // folder (Desktop, a synced drive, wherever), not a fixed app-data one.
      // null means the user cancelled the dialog, not an error.
      const path = await context.ui.exportBinaryAs(filename, base64, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      if (path) context.ui.notice(`Saved to ${path}`, { timeoutMs: 8000 });
    });
  }

  /** Print / Save-as-PDF, the same reparent-and-`window.print()` technique
   *  ReportIt uses — there is no real PDF generator in this codebase (see
   *  [[notible-typewriter-longform-features-backlog]]), Chromium's own
   *  print-to-PDF is the mechanism. Unlike ReportIt's report (which measures
   *  manual A4 "sheets" for exact header/footer placement on every page),
   *  a manuscript is just flowing prose — the browser's own pagination
   *  across an ordinary tall document is exactly right, no per-page layout
   *  work needed. The print stylesheet is injected and removed alongside
   *  the print host rather than living in typewriter.css, because `@page`
   *  is a page-level, unscoped rule: a static one here would collide with
   *  ReportIt's own `@page` the moment both plugins are enabled. */
  async function printManuscript() {
    if (!manuscript) return;
    if (typeof window.print !== "function") { context.ui.notice("Printing is not available in this host."); return; }
    await withBusy(async () => {
      const { rows } = await collectManuscriptRows();
      const host = document.createElement("div");
      host.id = "tw-print-host";
      const title = document.createElement("h1");
      title.textContent = manuscript.title || "Untitled manuscript";
      host.append(title);
      const headingTag: Record<number, string> = { 1: "h2", 2: "h3", 3: "h4" };
      for (const row of rows) {
        if (row.kind === "heading") {
          const el = document.createElement(headingTag[row.level] ?? "h4");
          el.textContent = row.title;
          host.append(el);
        } else if (row.kind === "hr") {
          host.append(document.createElement("hr"));
        } else {
          const p = document.createElement("p");
          p.textContent = row.text;
          host.append(p);
        }
      }
      const style = document.createElement("style");
      style.textContent = `
        @page { size: A4; margin: 20mm; }
        @media print {
          body > *:not(#tw-print-host) { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; width: auto !important; height: auto !important; overflow: visible !important; }
          #tw-print-host { font-family: Georgia, "Times New Roman", serif; color: #000; }
          #tw-print-host h1, #tw-print-host h2, #tw-print-host h3, #tw-print-host h4 { break-after: avoid; }
          #tw-print-host p { line-height: 1.6; margin: 0 0 1em; text-indent: 1.5em; }
          #tw-print-host hr { border: 0; text-align: center; margin: 2em 0; }
          #tw-print-host hr::after { content: "* * *"; }
        }
      `;
      const savedTitle = document.title;
      document.title = manuscript.title || "Manuscript";
      document.head.append(style);
      document.body.append(host);
      const cleanup = () => {
        host.remove();
        style.remove();
        document.title = savedTitle;
        window.removeEventListener("afterprint", cleanup);
      };
      window.addEventListener("afterprint", cleanup);
      requestAnimationFrame(() => window.print());
    });
  }

  type Snapshot = { at: string; words: number; lines: string[] };

  /** A lightweight safety net before a big rewrite (Scrivener's Snapshot).
   *  Plugins can only *read* document content (`context.data.document.get` —
   *  there is no write counterpart), so this cannot overwrite the scene/
   *  chapter in place; it stores the text under `tw.snap.<id>` and "viewing"
   *  a snapshot opens it as a separate plain note to copy back from by hand. */
  async function snapshotNow(id: string) {
    await withBusy(async () => {
      const blocks = await context.data.document.get(id);
      const lines = (blocks ?? []).flatMap((block) => (block.text ?? "").split("\n"));
      const words = wordCount(blocks ?? []);
      const key = `tw.snap.${id}`;
      const existing = context.storage.get<Snapshot[]>(key) ?? [];
      // A handful of recent snapshots is what this is for — a runaway list
      // would just be silent storage growth nobody asked for.
      const next = [...existing, { at: new Date().toISOString(), words, lines }].slice(-20);
      context.storage.set(key, next);
      context.ui.notice(`Snapshot saved — ${words.toLocaleString()} words.`);
    });
  }

  async function openSnapshot(id: string, index: number) {
    await withBusy(async () => {
      const snapshots = context.storage.get<Snapshot[]>(`tw.snap.${id}`) ?? [];
      const snap = snapshots[index];
      if (!snap) return;
      const row = rowsById.get(id);
      const stamp = new Date(snap.at).toLocaleString();
      const content = JSON.stringify({
        type: "doc",
        content: snap.lines.map((line) => line
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" }),
      });
      const created = await context.data.objects.create({
        type: "note",
        title: `${row?.title || "Untitled"} — snapshot ${stamp}`,
        content,
        props: "{}",
      });
      notifyWorkspace();
      await context.ui.openObject(created.id);
    });
  }

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renameCancelled = useRef(false);

  async function addChild(parentId: string, type: string, title: string) {
    await withBusy(async () => {
      const siblings = rows.filter((row) => row.parent_id === parentId);
      const order = siblings.length ? Math.max(...siblings.map(orderOf)) + 100 : 100;
      // A new scene inherits the manuscript's font once, as a starting value —
      // the prose profile only ever reads the scene's own prop.
      const font = manuscriptProps.font;
      const props: Record<string, unknown> = { "tw.manuscriptId": manuscriptId, order };
      if (type === TYPE.scene && typeof font === "string") props.font = font;
      const created = await context.data.objects.create({ type, title, parentId, props: JSON.stringify(props) });
      await loadRows();
      notifyWorkspace();
      setRenamingId(created.id);
    });
  }

  /** Story-structure scaffolds (Save the Cat / three-act, the two most common
   *  ones in tools like Plottr/Novelist). Each act becomes a Part, each beat
   *  a Chapter with its standard one-line purpose pre-filled as `synopsis` —
   *  a prop the outline row and the Board card already render, so nothing
   *  new is needed to see it. Deliberately just these two: opinionated story
   *  structure is exactly the kind of thing a "write it your own way" author
   *  may not want, so this stays optional and out of the way
   *  rather than becoming a bigger template system. */
  const STRUCTURE_TEMPLATES: { id: string; label: string; acts: { title: string; beats: { title: string; synopsis: string }[] }[] }[] = [
    {
      id: "three-act",
      label: "Three-Act Structure",
      acts: [
        { title: "Act 1 — Setup", beats: [
          { title: "Opening Image", synopsis: "A snapshot of the hero's world before the story begins." },
          { title: "Inciting Incident", synopsis: "The event that sets the story in motion." },
          { title: "Plot Point 1", synopsis: "The hero commits to the journey, leaving the old world behind." },
        ] },
        { title: "Act 2 — Confrontation", beats: [
          { title: "Rising Action", synopsis: "Escalating obstacles test the hero and raise the stakes." },
          { title: "Midpoint", synopsis: "A major twist or revelation shifts the story's direction." },
          { title: "Plot Point 2", synopsis: "The lowest point — the hero appears to have lost." },
        ] },
        { title: "Act 3 — Resolution", beats: [
          { title: "Climax", synopsis: "The final confrontation where the main conflict is resolved." },
          { title: "Resolution", synopsis: "The new normal — loose ends tied off." },
        ] },
      ],
    },
    {
      id: "save-the-cat",
      label: "Save the Cat! (15 beats)",
      acts: [
        { title: "Act 1", beats: [
          { title: "Opening Image", synopsis: "A snapshot of the hero's world before the story begins." },
          { title: "Theme Stated", synopsis: "Someone states, in passing, what the story is really about." },
          { title: "Set-Up", synopsis: "Introduce the hero's world, flaws and supporting cast." },
          { title: "Catalyst", synopsis: "The event that sets the story in motion." },
          { title: "Debate", synopsis: "The hero hesitates — should they really go?" },
        ] },
        { title: "Act 2A", beats: [
          { title: "Break into Two", synopsis: "The hero commits and enters a new, unfamiliar world." },
          { title: "B Story", synopsis: "A secondary story begins, often carrying the story's theme." },
          { title: "Fun and Games", synopsis: "The promise of the premise — what the story is 'about'." },
          { title: "Midpoint", synopsis: "A false victory or false defeat raises the stakes." },
        ] },
        { title: "Act 2B", beats: [
          { title: "Bad Guys Close In", synopsis: "External and internal pressure mounts on the hero." },
          { title: "All Is Lost", synopsis: "The hero's lowest point — often marked by a symbolic 'death'." },
          { title: "Dark Night of the Soul", synopsis: "The hero processes the loss before finding a new resolve." },
        ] },
        { title: "Act 3", beats: [
          { title: "Break into Three", synopsis: "Armed with a new insight, the hero commits to the final push." },
          { title: "Finale", synopsis: "The hero confronts and resolves the main conflict." },
          { title: "Final Image", synopsis: "A mirror of the opening image, showing how much has changed." },
        ] },
      ],
    },
  ];

  /** Only offered on an empty manuscript — scaffolding on top of an existing
   *  outline would just be confusing clutter, not a starting point. */
  async function applyStructureTemplate(templateId: string) {
    const template = STRUCTURE_TEMPLATES.find((t) => t.id === templateId);
    if (!manuscriptId || !template) return;
    await withBusy(async () => {
      let order = 100;
      for (const act of template.acts) {
        const part = await context.data.objects.create({
          type: TYPE.part, title: act.title, parentId: manuscriptId,
          props: JSON.stringify({ "tw.manuscriptId": manuscriptId, order }),
        });
        order += 100;
        let beatOrder = 100;
        for (const beat of act.beats) {
          await context.data.objects.create({
            type: TYPE.chapter, title: beat.title, parentId: part.id,
            props: JSON.stringify({ "tw.manuscriptId": manuscriptId, order: beatOrder, synopsis: beat.synopsis }),
          });
          beatOrder += 100;
        }
      }
      await loadRows();
      notifyWorkspace();
    });
  }

  /** Inline rename of a freshly added part/chapter/scene: the default title is selected, so typing names it. */
  async function commitRename(object: PluginObject, value: string) {
    setRenamingId(null);
    const next = value.trim();
    if (!next || next === object.title) return;
    await withBusy(async () => {
      await context.data.objects.update(object.id, { title: next }, object.updated_at);
      await loadRows();
      notifyWorkspace();
    });
  }

  async function setManuscriptProp(key: string, value: unknown) {
    if (!manuscript) return;
    await withBusy(async () => {
      await context.data.objects.update(
        manuscript.id,
        { props: JSON.stringify({ ...parseProps(manuscript.props), [key]: value }) },
        manuscript.updated_at,
      );
      await loadRows();
    });
  }

  async function setSceneStatus(scene: PluginObject, status: string) {
    await setSceneField(scene.id, "status", status);
  }

  async function setSceneField(sceneId: string, key: string, value: unknown) {
    const scene = rowsById.get(sceneId);
    if (!scene) return;
    await withBusy(async () => {
      await context.data.objects.update(
        scene.id,
        { props: JSON.stringify({ ...parseProps(scene.props), [key]: value }) },
        scene.updated_at,
      );
      await loadRows();
    });
  }

  /** Swap `order` with the previous/next sibling under the same parent. */
  async function moveRow(id: string, direction: -1 | 1) {
    const row = rowsById.get(id);
    if (!row) return;
    const parentId = row.parent_id ?? manuscriptId;
    const siblings = [...rows.filter((r) => (r.parent_id ?? manuscriptId) === parentId && r.id !== manuscriptId)]
      .sort((a, b) => orderOf(a) - orderOf(b) || a.created_at - b.created_at);
    const index = siblings.findIndex((s) => s.id === id);
    const target = siblings[index + direction];
    if (!target) return;
    await withBusy(async () => {
      const rowOrder = orderOf(row);
      const targetOrder = orderOf(target);
      await context.data.objects.update(row.id, { props: JSON.stringify({ ...parseProps(row.props), order: targetOrder }) }, row.updated_at);
      const fresh = await context.data.objects.get(target.id);
      await context.data.objects.update(target.id, { props: JSON.stringify({ ...parseProps(target.props), order: rowOrder }) }, fresh?.updated_at ?? target.updated_at);
      await loadRows();
    });
  }

  /** Drop the dragged row at the hinted position: reparent if needed, then
   *  give it a fractional `order` between its new neighbours. */
  const applyDrop = useCallback(async () => {
    const d = dragRef.current;
    const h = dropHintRef.current;
    setDrag(null);
    setDropHint(null);
    if (!d || !h || d.id === h.id) return;
    const dragged = rowsById.get(d.id);
    const target = rowsById.get(h.id);
    if (!dragged || !target) return;

    const newParentId = h.where === "inside" ? h.id : (target.parent_id ?? manuscriptId);
    const parentType = rowsById.get(newParentId)?.type ?? TYPE.manuscript;
    if (!canContain(parentType, dragged.type)) return;

    const sibs = rows
      .filter((r) => (r.parent_id ?? manuscriptId) === newParentId && r.id !== d.id && r.id !== manuscriptId)
      .sort((a, b) => orderOf(a) - orderOf(b) || a.created_at - b.created_at);

    let newOrder: number;
    if (h.where === "inside") {
      newOrder = sibs.length ? Math.max(...sibs.map(orderOf)) + 100 : 100;
    } else {
      const idx = sibs.findIndex((s) => s.id === h.id);
      const targetOrder = orderOf(target);
      if (h.where === "before") {
        const prev = sibs[idx - 1];
        newOrder = prev ? (orderOf(prev) + targetOrder) / 2 : targetOrder - 50;
      } else {
        const next = sibs[idx + 1];
        newOrder = next ? (targetOrder + orderOf(next)) / 2 : targetOrder + 50;
      }
    }

    await withBusy(async () => {
      if ((dragged.parent_id ?? manuscriptId) !== newParentId) {
        await context.data.objects.move(d.id, newParentId);
      }
      const fresh = await context.data.objects.get(d.id);
      await context.data.objects.update(
        d.id,
        { props: JSON.stringify({ ...parseProps(fresh?.props ?? dragged.props), "tw.manuscriptId": manuscriptId, order: newOrder }) },
        fresh?.updated_at,
      );
      await loadRows();
    });
  }, [rowsById, rows, manuscriptId, context, loadRows]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const el = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-tw-id]");
      const id = el?.dataset.twId;
      if (!el || !id || id === drag.id) { setDropHint(null); return; }
      const dragged = rowsById.get(drag.id);
      const target = rowsById.get(id);
      if (!dragged || !target) { setDropHint(null); return; }
      const rect = el.getBoundingClientRect();
      const rel = (event.clientY - rect.top) / rect.height;
      const canInside = canContain(target.type, dragged.type) && rel > 0.25 && rel < 0.75;
      setDropHint({ id, where: canInside ? "inside" : rel < 0.5 ? "before" : "after" });
    };
    const onUp = () => { void applyDrop(); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, rowsById, applyDrop]);

  async function setPov(sceneId: string, characterId: string) {
    await withBusy(async () => {
      await setSystemicRelation(context, sceneId, characterId, REL.pov, { single: true });
      await loadRows();
    });
  }

  async function clearPov(sceneId: string) {
    const current = povByScene.get(sceneId);
    if (!current) return;
    await withBusy(async () => {
      await removeSystemicRelation(context, sceneId, current, REL.pov);
      await loadRows();
    });
  }

  async function addLink(sceneId: string, otherId: string, kind: string, single = false) {
    if (!otherId) return;
    await withBusy(async () => {
      const from = kind === REL.covers ? otherId : sceneId;
      const to = kind === REL.covers ? sceneId : otherId;
      await setSystemicRelation(context, from, to, kind, { single });
      await loadRows();
    });
  }

  async function removeLink(sceneId: string, otherId: string, kind: string) {
    await withBusy(async () => {
      const from = kind === REL.covers ? otherId : sceneId;
      const to = kind === REL.covers ? sceneId : otherId;
      await removeSystemicRelation(context, from, to, kind);
      await loadRows();
    });
  }

  function renderChips(sceneId: string, ids: string[], pool: Map<string, PluginObject>, kind: string) {
    if (ids.length === 0) return <span className="ns-muted">none</span>;
    return ids.map((id) => (
      <span key={id} className="tw-chip">
        {pool.get(id)?.title || "Untitled"}
        <button type="button" aria-label={t("Remove")} disabled={busy} onClick={() => void removeLink(sceneId, id, kind)}>×</button>
      </span>
    ));
  }

  function renderScenePanel(sceneId: string) {
    const rels = sceneRels.get(sceneId) ?? [];
    const presentIds = rels.filter((r) => r.kind === REL.present && r.from_id === sceneId).map((r) => r.to_id);
    const setInId = rels.find((r) => r.kind === REL.setIn && r.from_id === sceneId)?.to_id ?? "";
    const coversIds = rels.filter((r) => r.kind === REL.covers && r.to_id === sceneId).map((r) => r.from_id);
    const opt = (list: PluginObject[], exclude: string[]) =>
      list.filter((row) => !exclude.includes(row.id)).map((row) => ({ value: row.id, label: row.title || "Untitled" }));
    return (
      <div className="tw-scene-panel">
        <div className="tw-links">
          <span className="tw-links-title">{t("Present")}</span>
          <div className="tw-links-chips">{renderChips(sceneId, presentIds, charById, REL.present)}</div>
          {opt(characters, presentIds).length > 0 && (
            <Combobox value="" placeholder={t("Add character…")} ariaLabel={t("Add character present")}
              options={opt(characters, presentIds)} onChange={(id) => void addLink(sceneId, id, REL.present)} />
          )}
        </div>
        <div className="tw-links">
          <span className="tw-links-title">{t("Setting")}</span>
          <div className="tw-links-chips">{setInId ? renderChips(sceneId, [setInId], locById, REL.setIn) : <span className="ns-muted">none</span>}</div>
          <Combobox value="" placeholder={t("Set location…")} ariaLabel={t("Set scene location")}
            options={opt(locations, setInId ? [setInId] : [])} onChange={(id) => void addLink(sceneId, id, REL.setIn, true)} />
        </div>
        <div className="tw-links">
          <span className="tw-links-title">{t("Plotlines")}</span>
          <div className="tw-links-chips">{renderChips(sceneId, coversIds, plotById, REL.covers)}</div>
          {opt(plotlines, coversIds).length > 0 && (
            <Combobox value="" placeholder={t("Add plotline…")} ariaLabel={t("Add plotline")}
              options={opt(plotlines, coversIds)} onChange={(id) => void addLink(sceneId, id, REL.covers)} />
          )}
        </div>
      </div>
    );
  }

  async function trashRow(id: string) {
    await withBusy(async () => {
      await context.data.objects.trash(id);
      await loadRows();
      notifyWorkspace();
    });
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function openMenu(event: ReactMouseEvent, id: string) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ id, x: event.clientX, y: event.clientY });
  }

  const menuRow = menu ? rowsById.get(menu.id) ?? null : null;

  function renderNode(node: OutlineNode, depth: number) {
    const { object } = node;
    const isScene = object.type === TYPE.scene;
    const isCollapsed = collapsed.has(object.id);
    const props = parseProps(object.props);
    const status = typeof props.status === "string" ? props.status : "idea";
    const synopsis = typeof props.synopsis === "string" ? props.synopsis.trim() : "";
    const words = isScene
      ? wordCounts.get(object.id) ?? 0
      // A part/chapter's own text counts alongside its descendants' — it is
      // real prose, not just a container for scenes.
      : (wordCounts.get(object.id) ?? 0) + aggregateSubtree(aggregateRows, object.id).words;
    const target = typeof props.wordTarget === "number" ? props.wordTarget : 0;
    // A scene with no explicit target still needs a useful visual meter. A
    // quiet 1,000-word working target keeps the bar informative without
    // mutating user data; an explicit target always wins.
    const meterTarget = target > 0 ? target : 1000;
    const pct = Math.min(100, Math.round((words / meterTarget) * 100));
    const statusOptions = [
      { value: "idea", label: t("Idea") },
      { value: "draft", label: t("Draft") },
      { value: "revised", label: t("Revised") },
      { value: "final", label: t("Final") },
    ];
    return (
      <div key={object.id} className="tw-node">
        <div
          className={`tw-row${drag?.id === object.id ? " is-dragging" : ""}${dropHint?.id === object.id ? ` drop-${dropHint.where}` : ""}`}
          data-tw-id={object.id}
          data-tw-kind={object.type === TYPE.part ? "part" : object.type === TYPE.chapter ? "chapter" : "scene"}
          style={{ paddingLeft: `${depth * 18}px` }}
          onContextMenu={(event) => openMenu(event, object.id)}
        >
          <span
            className="tw-row-drag"
            aria-hidden="true"
            title={t("Drag to reorder")}
            onPointerDown={(event) => { event.preventDefault(); setDrag({ id: object.id }); setMenu(null); }}
          ><GripVertical size={14} /></span>
          {!isScene && (
            <button type="button" className="tw-twist" aria-expanded={!isCollapsed} aria-label={isCollapsed ? "Expand" : "Collapse"} onClick={() => toggleCollapse(object.id)}>
              <ChevronRight size={14} />
            </button>
          )}
          {isScene && (
            <button type="button" className="tw-twist" aria-expanded={openScene === object.id} aria-label={openScene === object.id ? "Hide links" : "Show links"} onClick={() => setOpenScene((current) => current === object.id ? null : object.id)}>
              <ChevronRight size={14} />
            </button>
          )}
          {renamingId === object.id ? (
            <input
              className="tw-row-rename"
              autoFocus
              defaultValue={object.title}
              aria-label={t("Title")}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => { if (renameCancelled.current) { renameCancelled.current = false; return; } void commitRename(object, event.currentTarget.value); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") { renameCancelled.current = true; setRenamingId(null); }
              }}
            />
          ) : (
          <button type="button" className="tw-row-title" onClick={() => void context.ui.openObject(object.id)}>
            {(() => { const Glyph = ROW_ICON[object.type]; return Glyph ? <Glyph size={13} className="tw-row-icon" aria-hidden="true" /> : null; })()}
            <span>{object.title || "Untitled"}</span>
          </button>
          )}
          {synopsis && <span className="tw-row-synopsis">{synopsis}</span>}
          {isScene && povByScene.has(object.id) && (
            <span className="tw-row-pov">{charById.get(povByScene.get(object.id)!)?.title ?? "POV"}</span>
          )}
          {isScene && (
            <span className="tw-row-status" onClick={(event) => event.stopPropagation()}>
              <Select
                value={status}
                options={statusOptions}
                onChange={(value) => void setSceneStatus(object, value)}
                ariaLabel={`Status of ${object.title}`}
                className="tw-scene-status-select"
              />
            </span>
          )}
          <span className="tw-row-meter" title={target > 0 ? `${words.toLocaleString()} / ${target.toLocaleString()} ${t("words")}` : `${words.toLocaleString()} ${t("words")}`}>
            <span className="tw-row-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
            <span className="tw-row-count">{words.toLocaleString()} {t("words")}</span>
          </span>
        </div>
        {isScene && openScene === object.id && renderScenePanel(object.id)}
        {!isScene && !isCollapsed && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  if (loading) return <section className="ns-surface"><p className="ns-surface-intro">{t("Loading…")}</p></section>;

  const showCodex = asTab ? forcedPane === "codex" : tab === "codex";
  const showBoard = asTab ? forcedPane === "board" : tab === "board";
  const showProgress = asTab ? forcedPane === "progress" : tab === "progress";
  const showOutline = asTab ? forcedPane === "manuscript" : tab === "manuscript";
  const showManuscriptPane = showOutline || showProgress;

  return (
    <section className={`ns-surface${showBoard ? " tw-surface-wide" : ""}`} data-plugin-view="notible.typewriter">
      {!asTab && (
        <div className="tw-manuscript-head">
          {manuscripts.length > 0 ? (
            <Select
              value={manuscriptId}
              options={manuscripts.map((m) => ({ value: m.id, label: m.title || "Untitled manuscript" }))}
              onChange={setManuscriptId}
              ariaLabel={t("Manuscript")}
            />
          ) : (
            <span className="ns-muted">{t("No manuscripts yet.")}</span>
          )}
          <button type="button" className="ns-btn ns-btn-primary" disabled={busy} onClick={() => void createManuscript()}>{t("New manuscript")}</button>
        </div>
      )}

      {!asTab && (
        <div className="tw-tabs">
          <button type="button" className={tab === "manuscript" ? "is-active" : ""} onClick={() => setTab("manuscript")}>{t("Manuscript")}</button>
          <button type="button" className={tab === "codex" ? "is-active" : ""} onClick={() => setTab("codex")}>{t("Codex")}</button>
          <button type="button" className={tab === "progress" ? "is-active" : ""} onClick={() => setTab("progress")}>{t("Progress")}</button>
          <button type="button" className={tab === "board" ? "is-active" : ""} onClick={() => setTab("board")}>{t("Board")}</button>
        </div>
      )}

      {error && <p className="ns-message ns-message-error">{error}</p>}

      {/* Manuscript/Codex/Progress/Board switch via Core's own object-tab bar
          (this surface always mounts with a forced pane — see objectTabs in
          typewriter.ts) — so the binder shows up as page texture only: a
          die-cut tab, a stitched spine, three punch holes. No second,
          Typewriter-drawn tab strip duplicating Core's. */}
      <div className="tw-binder-book">
      <header className="tw-page-heading">
        {manuscript && <p className="tw-binder-page-tab">{manuscript.title || "Untitled manuscript"}</p>}
        <div className="tw-page-heading-line">
          <h2>{showCodex ? t("Codex") : showProgress ? t("Progress") : showBoard ? t("Board") : t("Manuscript")}</h2>
          <span className="tw-page-summary">
            {showCodex
              ? `${characters.length} ${t("Characters")} · ${locations.length} ${t("Locations")} · ${plotlines.length} ${t("Plotlines")}`
              : `${sceneIds.length} ${t("Scenes")} · ${manuscriptTotal.toLocaleString()} ${t("words")}`}
          </span>
        </div>
      </header>

      {showManuscriptPane && (
        <div className="tw-manuscript">

          {showProgress && manuscript && (() => {
            const target = typeof manuscriptProps.wordTarget === "number" ? manuscriptProps.wordTarget : 0;
            const deadline = typeof manuscriptProps.deadline === "string" ? manuscriptProps.deadline : "";
            const perDay = wordsPerDay(manuscriptTotal, target, deadline, todayISO());
            const pct = target > 0 ? Math.min(100, Math.round((manuscriptTotal / target) * 100)) : 0;
            const ringR = 42;
            const ringC = 2 * Math.PI * ringR;
            return (
              <div className="tw-progress">
                <div className="tw-progress-head">
                  <div className="tw-progress-ring" aria-hidden={target === 0}>
                    <svg width="100" height="100" viewBox="0 0 100 100">
                      <circle className="tw-progress-ring-track" cx="50" cy="50" r={ringR} />
                      {target > 0 && (
                        <circle
                          className="tw-progress-ring-fill"
                          cx="50" cy="50" r={ringR}
                          strokeDasharray={ringC}
                          strokeDashoffset={ringC * (1 - pct / 100)}
                          transform="rotate(-90 50 50)"
                        />
                      )}
                    </svg>
                    <span className="tw-progress-ring-pct">{target > 0 ? `${pct}%` : "—"}</span>
                  </div>
                  <div className="tw-progress-line">
                    <strong>{manuscriptTotal.toLocaleString()}</strong>
                    <span className="ns-muted">{target > 0 ? ` / ${target.toLocaleString()} words` : " words"}</span>
                    {counting && <span className="ns-muted"> · counting…</span>}
                    <span className="ns-muted tw-progress-hint">{t("Total body text across every part, chapter and scene in this manuscript.")}</span>
                  </div>
                </div>
                <div className="tw-progress-streak">
                  <Flame size={15} className="tw-progress-streak-flame" aria-hidden="true" data-active={streak > 0} />
                  <span>
                    {streak > 0 ? `${streak} ${streak === 1 ? "day" : "days"} in a row` : "No streak yet"}
                    {wordsToday !== null && wordsToday > 0 && <span className="ns-muted"> · {wordsToday.toLocaleString()} words today</span>}
                    {(wordsToday === null || wordsToday <= 0) && <span className="ns-muted"> · write anything today to {streak > 0 ? "keep it going" : "start one"}</span>}
                  </span>
                </div>
                <div className="tw-heatmap" role="img" aria-label={t("Writing activity over the last 10 weeks")}>
                  {heatmap.map((week) => (
                    <div className="tw-heatmap-week" key={week[0].date}>
                      {week.map((day) => (
                        <span
                          key={day.date}
                          className={`tw-heatmap-day tw-heat-${heatBucket(day.words)}`}
                          title={day.words === null ? day.date : `${day.date}: ${day.words.toLocaleString()} words`}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="tw-progress-controls">
                  <label>Target
                    <input type="number" min={0} step={1000} value={target || ""} disabled={busy}
                      onChange={(event) => void setManuscriptProp("wordTarget", Number(event.target.value) || 0)} />
                  </label>
                  <label>Deadline
                    <DatePicker value={deadline || null} ariaLabel={t("Manuscript deadline")}
                      onChange={(value) => void setManuscriptProp("deadline", value)} />
                  </label>
                  <label>Font
                    <Select value={typeof manuscriptProps.font === "string" ? manuscriptProps.font : ""}
                      options={FONT_SELECT_OPTIONS}
                      ariaLabel={t("Manuscript default font")}
                      onChange={(value) => void setManuscriptProp("font", value.startsWith("__group_") ? undefined : (value || undefined))} />
                  </label>
                  {perDay !== null && (
                    <span className="ns-muted">
                      {perDay === 0 ? "Target reached or past deadline" : `${perDay.toLocaleString()} words/day to finish`}
                    </span>
                  )}
                </div>
                <div className="tw-progress-compile">
                  <button type="button" className="tw-btn" disabled={busy} onClick={() => void compileManuscript()}>{t("Compile to a note")}</button>
                  <span className="ns-muted">Flattens every part, chapter and scene into one plain note (parts and chapters become headings, scenes are separated by <code>* * *</code>) — for a read-through or further editing inside Notible.</span>
                </div>
                <div className="tw-progress-compile">
                  <button type="button" className="tw-btn" disabled={busy} onClick={() => void exportManuscriptDocx()}>{t("Export as Word (.docx)")}</button>
                  <span className="ns-muted">{t("Standard manuscript format (Times New Roman, double-spaced, indented paragraphs) — for sending to a beta reader, agent or editor outside Notible.")}</span>
                </div>
                <div className="tw-progress-compile">
                  <button type="button" className="tw-btn" disabled={busy} onClick={() => void printManuscript()}>{t("Export as PDF (print)")}</button>
                  <span className="ns-muted">{t('Opens the system print dialog — choose "Save as PDF" as the printer. Same content as Word, plain-paginated.')}</span>
                </div>
              </div>
            );
          })()}

          {showOutline && manuscriptId && (
            <div className="tw-manuscript-actions">
              <button type="button" className="tw-btn" disabled={busy} onClick={() => void addChild(manuscriptId, TYPE.part, "New part")}>{t("Add part")}</button>
              <button type="button" className="tw-btn" disabled={busy} onClick={() => void addChild(manuscriptId, TYPE.chapter, "New chapter")}>{t("Add chapter")}</button>
              {outline.length === 0 && STRUCTURE_TEMPLATES.map((template) => (
                <button key={template.id} type="button" className="tw-btn" disabled={busy} onClick={() => void applyStructureTemplate(template.id)}>
                  Start from {template.label}
                </button>
              ))}
            </div>
          )}

          {showOutline && (
            <div className="tw-tree">
              {outline.length === 0
                ? <p className="ns-muted">{t("Add a chapter and write straight into it. Split it into scenes only if you want per-scene POV/status tracking — or start from a story-structure template above.")}</p>
                : outline.map((node) => renderNode(node, 0))}
            </div>
          )}
        </div>
      )}

      {showCodex && (
        <div>{manuscriptId
          ? <TypewriterCodex context={context} manuscriptId={manuscriptId} />
          : <p className="ns-surface-intro">{t("Create a manuscript first.")}</p>}</div>
      )}

      {showBoard && (
        <div>{manuscriptId
          ? <TypewriterBoard context={context} manuscriptId={manuscriptId} />
          : <p className="ns-surface-intro">{t("Create a manuscript first.")}</p>}</div>
      )}
      </div>

      {menu && menuRow && (
        <div className="tw-menu" style={{ top: menu.y, left: menu.x }} onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { void context.ui.openObject(menu.id); setMenu(null); }}>{t("Open")}</button>
          {menuRow.type !== TYPE.scene && (
            <button type="button" onClick={() => { void addChild(menu.id, menuRow.type === TYPE.part ? TYPE.chapter : TYPE.scene, menuRow.type === TYPE.part ? "New chapter" : "New scene"); setMenu(null); }}>
              {menuRow.type === TYPE.part ? "Add chapter inside" : "Add scene inside"}
            </button>
          )}
          <button type="button" onClick={() => { void moveRow(menu.id, -1); setMenu(null); }}>{t("Move up")}</button>
          <button type="button" onClick={() => { void moveRow(menu.id, 1); setMenu(null); }}>{t("Move down")}</button>
          {menuRow.type === TYPE.scene && characters.length > 0 && (
            <>
              <span className="tw-menu-label">{t("Set POV")}</span>
              {characters.map((character) => (
                <button key={character.id} type="button" onClick={() => { void setPov(menu.id, character.id); setMenu(null); }}>
                  {character.title || "Untitled"}
                </button>
              ))}
              {povByScene.has(menu.id) && (
                <button type="button" onClick={() => { void clearPov(menu.id); setMenu(null); }}>{t("Clear POV")}</button>
              )}
              {(["serif", "sans", "mono"] as const).map((group) => (
                <div key={group}>
                  <span className="tw-menu-label">{`Font · ${FONT_GROUP_LABEL[group]}`}</span>
                  {MANUSCRIPT_FONTS.filter((font) => font.group === group).map((font) => (
                    <button key={font.value} type="button" onClick={() => { void setSceneField(menu.id, "font", font.value); setMenu(null); }}>
                      {parseProps(menuRow.props).font === font.value ? `✓ ${font.label}` : font.label}
                    </button>
                  ))}
                </div>
              ))}
              {typeof parseProps(menuRow.props).font === "string" && (
                <button type="button" onClick={() => { void setSceneField(menu.id, "font", ""); setMenu(null); }}>{t("Clear font (use manuscript default)")}</button>
              )}
            </>
          )}
          {(() => {
            const snapshots = context.storage.get<Snapshot[]>(`tw.snap.${menu.id}`) ?? [];
            return (
              <>
                <button type="button" onClick={() => { void snapshotNow(menu.id); setMenu(null); }}>
                  Snapshot text now{snapshots.length > 0 ? ` (${snapshots.length} saved)` : ""}
                </button>
                {snapshots.length > 0 && (
                  <>
                    <span className="tw-menu-label">{t("Snapshots")}</span>
                    {snapshots.slice().reverse().map((snap, i) => (
                      <button key={snap.at} type="button" onClick={() => { void openSnapshot(menu.id, snapshots.length - 1 - i); setMenu(null); }}>
                        {new Date(snap.at).toLocaleString()} · {snap.words.toLocaleString()} words
                      </button>
                    ))}
                  </>
                )}
              </>
            );
          })()}
          <button type="button" className="is-danger" onClick={() => { void trashRow(menu.id); setMenu(null); }}>{t("Delete")}</button>
        </div>
      )}
    </section>
  );
}
