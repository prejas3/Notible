import type { CodeBlockContext, PluginObject } from "../../packages/plugin-api/src/index.ts";
import "./surface.css";
import "./queries-ui.css";
import {
  columnsFor,
  coreQueryFor,
  FETCH_LIMIT,
  fieldValue,
  parseQuery,
  resolveQuery,
  schemaFieldsOf,
  type EmbeddedQuery,
  type ResolveResult,
} from "./queries.ts";

/**
 * DOM for ```` ```notible ```` blocks. Semantics live in `queries.ts`.
 *
 * **Every string here comes from a note, and notes come from import, sync,
 * paste and any plugin's `objects.create`.** So this file builds nodes and
 * assigns `textContent`; it never composes markup from strings. That is
 * enforced by `scripts/embedded-queries-check.mjs`, which greps this file for
 * `innerHTML` and friends and fails the build — CSP would stop injected markup
 * from executing, but `style-src 'unsafe-inline'` and `img-src … asset:` would
 * still let it overlay the note and probe for local files.
 */

/** More blocks than this in one note is a scan wearing a query's clothes. */
const MAX_BLOCKS_PER_NOTE = 8;

/** Live mounts per note, so the cap counts blocks rather than renders. The
 * decorator disposes every container before mounting the new ones, so this
 * returns to zero on each pass by itself. */
const liveBlocks = new Map<string, number>();

interface CacheEntry { at: number; result: ResolveResult; query: EmbeddedQuery; columns: string[] }
/**
 * Keyed by note + block text, and **anti-flicker only**.
 *
 * A re-decorate draws the previous answer immediately so the table does not
 * blink through "Running query…", and then the fetch below runs anyway and
 * redraws. So there is deliberately nothing that invalidates this: staleness
 * is bounded by the refetch that always follows, not by a cache event nobody
 * would remember to fire.
 */
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15_000;

/** One queue for the whole app: eight blocks in a note must not put eight
 * concurrent reads on Core's single mutex-guarded connection. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

function el(tag: string, text?: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** The `.core-code-render` container Core gave us — toggling `nq-ready` on it
 * is what lets the editor hide the raw query source once a table is drawn. */
function setReady(root: HTMLElement, ready: boolean) {
  root.parentElement?.classList.toggle("nq-ready", ready);
}

function renderErrors(root: HTMLElement, errors: Array<{ line: string; message: string }>) {
  setReady(root, false);
  const box = el("div", undefined, "nq-errors");
  box.append(el("strong", errors.length === 1 ? "Query error" : `${errors.length} query errors`, "nq-errors-title"));
  const list = el("ul", undefined, "nq-error-list");
  for (const error of errors.slice(0, 6)) {
    const item = document.createElement("li");
    item.append(el("code", error.line, "nq-error-line"));
    item.append(el("span", error.message, "nq-error-message"));
    list.append(item);
  }
  box.append(list);
  root.replaceChildren(box);
}

function summaryText(result: ResolveResult, query: EmbeddedQuery): string {
  const parts: string[] = [];
  parts.push(result.matched === result.objects.length
    ? `${result.matched} ${result.matched === 1 ? "result" : "results"}`
    : `${result.objects.length} of ${result.matched}`);
  if (result.unreadable > 0) parts.push(`${result.unreadable} skipped (unreadable properties)`);
  parts.push(query.types.join(", "));
  return parts.join(" · ");
}

function renderResult(
  root: HTMLElement,
  result: ResolveResult,
  query: EmbeddedQuery,
  columns: string[],
  openObject: (id: string) => void,
) {
  root.replaceChildren();
  setReady(root, true);

  if (query.layout === "count") {
    const box = el("div", undefined, "nq-count");
    box.append(el("strong", String(result.matched), "nq-count-value"));
    box.append(el("span", query.types.join(", "), "nq-count-label"));
    root.append(box);
  } else if (result.objects.length === 0) {
    root.append(el("p", "Nothing matches this query.", "ns-empty"));
  } else if (query.layout === "list") {
    const list = el("div", undefined, "nq-list");
    for (const object of result.objects) list.append(row(object, ["title"], columns, openObject));
    root.append(list);
  } else {
    const table = el("div", undefined, "nq-table");
    const head = el("div", undefined, "nq-row nq-head");
    head.style.setProperty("--nq-columns", String(columns.length));
    for (const column of columns) head.append(el("span", column, "nq-cell"));
    table.append(head);
    for (const object of result.objects) table.append(row(object, columns, columns, openObject));
    root.append(table);
  }

  const footer = el("p", summaryText(result, query), "nq-summary");
  root.append(footer);

  // The honest half. `query_objects` orders by updated_at DESC and caps the
  // rows, so on a big workspace the fetch is the most recently edited slice,
  // not the answer — a task due tomorrow but untouched for a month would
  // simply be missing. Saying so beats rendering a confident wrong table.
  if (result.truncated) {
    root.append(el("p", `⚠ This workspace has more than ${FETCH_LIMIT} of these — the list above is the most recently edited ones, so it may be incomplete.`, "nq-truncated"));
  }
}

function row(
  object: PluginObject,
  columns: string[],
  layoutColumns: string[],
  openObject: (id: string) => void,
): HTMLElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "nq-row";
  node.style.setProperty("--nq-columns", String(layoutColumns.length));
  let props: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(object.props) as unknown;
    if (parsed && typeof parsed === "object") props = parsed as Record<string, unknown>;
  } catch { /* resolveQuery already counted this one; draw what we can */ }
  for (const column of columns) {
    const value = column === "title" ? (object.title || "Untitled") : fieldValue(object, props, column);
    node.append(el("span", value, column === "title" ? "nq-cell nq-cell-title" : "nq-cell"));
  }
  node.addEventListener("click", () => openObject(object.id));
  return node;
}

/**
 * The syntax reference, next to the thing it describes.
 *
 * It used to be a panel in Settings, which is the one place nobody looks for a
 * feature they have not met yet. Native <details>, so there is no state to
 * keep and the keyboard works for free.
 */
function helpDetails(): HTMLElement {
  const details = el("details", undefined, "nq-help");
  // A bare "?" is a puzzle, not a label. Whoever meets this block for the
  // first time has to be able to tell what it IS before the key list means
  // anything to them.
  const summary = el("summary", "How this block works");
  summary.title = "Query syntax";
  details.append(summary);
  details.append(el(
    "p",
    "This block is a question, not a list you maintain. You describe what you want to see; Notible answers with whatever matches right now, every time the note is opened. Nothing here is a copy — click a row and you are in the real object.",
    "nq-doc-note",
  ));
  const example = el("pre", "type: task\nstatus: open\ndue: <= +7d\nsort: due\nas: table", "nq-doc-example");
  details.append(el("p", "Open tasks due within a week, soonest first:", "nq-doc-note"));
  details.append(example);
  const list = el("ul", undefined, "nq-doc-keys");
  for (const [token, description] of [
    ["type", "Required. One to four types, comma separated."],
    ["parent: here", "Only objects inside this note's container."],
    ["<field>: a, b", "Any field on the type's schema. A comma means “either”."],
    ["due", "Accepts <= +7d, < today, >= 2026-09-01 or none."],
    ["text", "Part of the title."],
    ["sort", "A field, optionally desc. Empty values always sort last."],
    ["limit", "50 by default, 200 at most."],
    ["as", "table, list or count."],
    ["fields", "Table columns."],
  ]) {
    const item = el("li");
    item.append(el("code", token), document.createTextNode(` — ${description}`));
    list.append(item);
  }
  details.append(list);
  details.append(el("p", "An unknown key is an error shown in the block, never silently skipped — a filter that vanished is a query lying about your workspace.", "nq-doc-note"));
  return details;
}

export function renderQueryBlock({ container, source, objectId, plugin }: CodeBlockContext) {
  const root = el("div", undefined, "nq-root");
  container.append(root);
  container.append(helpDetails());

  const noteKey = objectId ?? "-";
  const live = (liveBlocks.get(noteKey) ?? 0) + 1;
  liveBlocks.set(noteKey, live);

  let disposed = false;
  const dispose = () => {
    disposed = true;
    const remaining = (liveBlocks.get(noteKey) ?? 1) - 1;
    if (remaining > 0) liveBlocks.set(noteKey, remaining);
    else liveBlocks.delete(noteKey);
    root.remove();
  };

  if (live > MAX_BLOCKS_PER_NOTE) {
    root.append(el("p", `This note has more than ${MAX_BLOCKS_PER_NOTE} query blocks; the rest are shown as plain code.`, "nq-truncated"));
    return { dispose };
  }

  const cacheKey = `${noteKey} ${source}`;
  const cached = cache.get(cacheKey);
  const openObject = (id: string) => { void plugin.ui.openObject(id); };

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    renderResult(root, cached.result, cached.query, cached.columns, openObject);
  } else {
    root.append(el("p", "Running query…", "nq-loading"));
  }

  void enqueue(async () => {
    // Checked before the work and again after every await: the editor disposes
    // and remounts every block on a re-decorate, so a resolve in flight can
    // outlive its own container. Writing into a detached node is the mild
    // failure; writing into the *previous* mount's node while the new one also
    // renders is the one that shows two tables.
    if (disposed) return;
    try {
      const types = await plugin.data.types.list();
      if (disposed) return;
      const declared = new Set(types.map((type) => type.name));

      const firstPass = parseQuery(source, new Set(["title", "updated"]));
      const wanted = firstPass.ok ? firstPass.query.types : [];
      const known = schemaFieldsOf(types, wanted.length > 0 ? wanted : [...declared]);
      const parsed = parseQuery(source, known);
      if (!parsed.ok) { renderErrors(root, parsed.errors); return; }
      const query = parsed.query;

      const unknownTypes = query.types.filter((type) => !declared.has(type));
      if (unknownTypes.length > 0) {
        renderErrors(root, [{ line: `type: ${query.types.join(", ")}`, message: `no such type: ${unknownTypes.join(", ")}` }]);
        return;
      }

      let parentId: string | undefined;
      if (query.parentHere && objectId) {
        const note = await plugin.data.objects.get(objectId);
        if (disposed) return;
        parentId = note?.parent_id ?? undefined;
      }

      const fetched: PluginObject[] = [];
      let truncated = false;
      for (const type of query.types) {
        const batch = await plugin.data.objects.query(coreQueryFor(query, type, parentId));
        if (disposed) return;
        if (batch.length >= FETCH_LIMIT) truncated = true;
        fetched.push(...batch);
      }

      const result = resolveQuery(query, fetched, truncated);
      const columns = columnsFor(query, known);
      cache.set(cacheKey, { at: Date.now(), result, query, columns });
      if (disposed) return;
      renderResult(root, result, query, columns, openObject);
    } catch (error) {
      if (disposed) return;
      renderErrors(root, [{ line: "", message: error instanceof Error ? error.message : String(error) }]);
    }
  });

  return { dispose };
}
