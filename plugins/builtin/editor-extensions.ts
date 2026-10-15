import type { CodeBlockContext } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";

export const CODE_LANGUAGES = ["plain", "javascript", "typescript", "python", "rust", "sql", "json", "css", "html", "markdown"] as const;
export function normalizeCodeLanguage(value: unknown): string { const normalized = String(value ?? "plain").trim().toLocaleLowerCase(); return CODE_LANGUAGES.includes(normalized as typeof CODE_LANGUAGES[number]) ? normalized : "plain"; }
export function inspectCode(input: unknown) { const value = input && typeof input === "object" ? input as { language?: unknown; source?: unknown } : {}; const source = String(value.source ?? ""); return { language: normalizeCodeLanguage(value.language), lines: source ? source.split(/\r?\n/).length : 0, characters: source.length }; }

export type CompareLine = { left?: string; right?: string; kind: "same" | "added" | "removed" | "changed" };

/** Align two snippets by their longest common subsequence. Adjacent removed
 * and added lines are paired as changes so the two panes remain readable. */
export function compareCodeLines(leftSource: string, rightSource: string): CompareLine[] | null {
  const left = leftSource.split(/\r?\n/u);
  const right = rightSource.split(/\r?\n/u);
  if (left.length + right.length > 2000) return null;
  const lengths = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let l = left.length - 1; l >= 0; l -= 1) {
    for (let r = right.length - 1; r >= 0; r -= 1) {
      lengths[l][r] = left[l] === right[r] ? lengths[l + 1][r + 1] + 1 : Math.max(lengths[l + 1][r], lengths[l][r + 1]);
    }
  }
  const raw: CompareLine[] = [];
  let l = 0, r = 0;
  while (l < left.length || r < right.length) {
    if (l < left.length && r < right.length && left[l] === right[r]) { raw.push({ left: left[l++], right: right[r++], kind: "same" }); continue; }
    if (r < right.length && (l === left.length || lengths[l][r + 1] >= lengths[l + 1][r])) raw.push({ right: right[r++], kind: "added" });
    else raw.push({ left: left[l++], kind: "removed" });
  }
  const aligned: CompareLine[] = [];
  for (let index = 0; index < raw.length;) {
    if (raw[index].kind === "same") { aligned.push(raw[index++]); continue; }
    const group: CompareLine[] = [];
    while (index < raw.length && raw[index].kind !== "same") group.push(raw[index++]);
    const removed = group.filter((line) => line.kind === "removed");
    const added = group.filter((line) => line.kind === "added");
    const pairs = Math.min(removed.length, added.length);
    for (let pair = 0; pair < pairs; pair += 1) aligned.push({ left: removed[pair].left, right: added[pair].right, kind: "changed" });
    aligned.push(...removed.slice(pairs), ...added.slice(pairs));
  }
  return aligned;
}

export function splitComparisonSource(source: string): [string, string, boolean] {
  const lines = source.split(/\r?\n/u);
  const divider = lines.findIndex((line) => line.trim() === "=====");
  return divider < 0 ? [source, "", false] : [lines.slice(0, divider).join("\n"), lines.slice(divider + 1).join("\n"), true];
}

export function renderCodeComparison({ container, source, plugin }: CodeBlockContext) {
  const [leftSource, rightSource, hasDivider] = splitComparisonSource(source);
  const compared = compareCodeLines(leftSource, rightSource);
  const root = document.createElement("div");
  root.className = "core-code-comparison";
  const panes = document.createElement("div");
  panes.className = "core-code-comparison-panes";
  const rows = compared ?? [];
  const plain = [leftSource.split(/\r?\n/u), rightSource.split(/\r?\n/u)];
  for (const [side, title] of [plugin.i18n.t("Previous version"), plugin.i18n.t("New version")].entries()) {
    const pane = document.createElement("section");
    pane.className = "core-code-comparison-pane";
    const heading = document.createElement("strong");
    heading.textContent = title;
    pane.append(heading);
    const list = document.createElement("ol");
    const lines = compared ? rows : plain[side].map((value) => side === 0 ? { left: value, kind: "same" as const } : { right: value, kind: "same" as const });
    for (const row of lines) {
      const item = document.createElement("li");
      item.className = `is-${row.kind}`;
      const value = side === 0 ? row.left : row.right;
      item.textContent = value ?? " ";
      if (value === undefined) item.classList.add("is-empty");
      list.append(item);
    }
    pane.append(list);
    panes.append(pane);
  }
  root.append(panes);
  if (!hasDivider) {
    const notice = document.createElement("p");
    notice.className = "core-code-comparison-note";
    notice.textContent = plugin.i18n.t("Add a ===== line between the two snippets.");
    root.append(notice);
  }
  if (!compared) {
    const notice = document.createElement("p");
    notice.className = "core-code-comparison-note";
    notice.textContent = plugin.i18n.t("This comparison is too large for line-by-line marks.");
    root.append(notice);
  }
  container.append(root);
  container.classList.add("nq-ready");
  return { dispose: () => { container.classList.remove("nq-ready"); root.remove(); } };
}

// One counter for the whole session — mermaid.render needs a DOM id unique
// across every diagram it has ever drawn, not just the ones on screen now.
let mermaidRenderCounter = 0;
// Any object write (sync, automations, autosave) re-runs every decorator, so
// an unchanged diagram used to be torn down and redrawn async — its source
// popped open and the note jumped for a frame ("the whole note blinks").
// Keyed by theme + source. ponytail: unbounded, one SVG per distinct source
// seen this session; add an LRU cap if notes ever churn through thousands.
const mermaidSvgCache = new Map<string, string>();

type Mermaid = typeof import("mermaid")["default"];
/** "auto" is the Notible theme: Mermaid's `base` coloured from the app's tokens. */
export type MermaidTheme = "auto" | "default" | "neutral" | "forest" | "base";
export const MERMAID_THEMES: MermaidTheme[] = ["auto", "default", "neutral", "forest", "base"];
export const MERMAID_COLOR_KEYS = ["background", "nodeFill", "nodeBorder", "nodeText", "line", "groupFill", "groupBorder"] as const;
export type MermaidColorKey = typeof MERMAID_COLOR_KEYS[number];
export interface MermaidAppearance { theme: MermaidTheme; handDrawn: boolean; elk: boolean; colors: Partial<Record<MermaidColorKey, string>> }

export const MERMAID_THEME_KEY = "mermaid.theme";
export const MERMAID_HAND_DRAWN_KEY = "mermaid.handDrawn";
export const MERMAID_ELK_KEY = "mermaid.elk";
export const mermaidColorStorageKey = (key: MermaidColorKey) => `mermaid.color.${key}`;
/** Only plain #rrggbb reaches Mermaid and the SVG style attribute (MERMAID-COLORS). */
export const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value);

/** Each picker overrides every Mermaid variable that draws that part, so it
 * works on the fixed themes too, not only on `base`. */
const MERMAID_COLOR_VARIABLES: Record<MermaidColorKey, string[]> = {
  // Not edgeLabelBackground: a label chip keeps its theme colour, so its text
  // stays readable on any picked background.
  background: ["background"],
  // edgeLabelBackground: Mermaid colours every label span, edge labels too,
  // with the node text colour, so their chips must share the node fill.
  nodeFill: ["primaryColor", "mainBkg", "nodeBkg", "actorBkg", "labelBoxBkgColor", "stateBkg", "edgeLabelBackground"],
  nodeBorder: ["primaryBorderColor", "nodeBorder", "actorBorder", "labelBoxBorderColor"],
  nodeText: ["primaryTextColor", "nodeTextColor", "actorTextColor", "labelTextColor", "stateLabelColor"],
  line: ["lineColor", "defaultLinkColor", "arrowheadColor", "signalColor", "transitionColor"],
  groupFill: ["clusterBkg", "compositeBackground"],
  groupBorder: ["clusterBorder", "compositeBorder"],
};

export function mermaidAppearance(plugin: Pick<CodeBlockContext["plugin"], "storage">): MermaidAppearance {
  const storedTheme = plugin.storage.get<string>(MERMAID_THEME_KEY);
  const colors: MermaidAppearance["colors"] = {};
  for (const key of MERMAID_COLOR_KEYS) {
    const value = plugin.storage.get<string>(mermaidColorStorageKey(key));
    if (isHexColor(value)) colors[key] = value.toLowerCase();
  }
  return {
    theme: MERMAID_THEMES.includes(storedTheme as MermaidTheme) ? storedTheme as MermaidTheme : "auto",
    handDrawn: plugin.storage.get<boolean>(MERMAID_HAND_DRAWN_KEY) ?? false,
    elk: plugin.storage.get<boolean>(MERMAID_ELK_KEY) ?? false,
    colors,
  };
}

let colorProbe: CanvasRenderingContext2D | null = null;
/** A CSS colour as #rrggbb (Mermaid's colour maths only reads hex); a
 * translucent token is laid over `under` the way it shows on screen. */
export function cssColorToHex(value: string, under = "#ffffff"): string | null {
  if (typeof document === "undefined" || !value.trim()) return null;
  colorProbe ??= document.createElement("canvas").getContext("2d");
  if (!colorProbe) return null;
  colorProbe.fillStyle = "#010203";
  colorProbe.fillStyle = value.trim();
  const parsed = String(colorProbe.fillStyle);
  if (parsed === "#010203" && value.trim().toLowerCase() !== "#010203") return null;
  if (isHexColor(parsed)) return parsed.toLowerCase();
  const channels = /rgba?\(([^)]+)\)/u.exec(parsed)?.[1].split(",").map(Number);
  if (!channels || channels.length < 3 || channels.some(Number.isNaN)) return null;
  const alpha = channels[3] ?? 1;
  const base = [1, 3, 5].map((index) => parseInt((isHexColor(under) ? under : "#ffffff").slice(index, index + 2), 16));
  return `#${channels.slice(0, 3).map((channel, index) => Math.round(channel * alpha + base[index] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}

/** An app token (`--notible-<name>`) as hex, as the app shows it right now. */
export function notibleColor(name: string, under?: string): string | null {
  if (typeof document === "undefined") return null;
  return cssColorToHex(getComputedStyle(document.documentElement).getPropertyValue(`--notible-${name}`), under);
}

/** The Notible theme: Mermaid's `base` coloured from the live app tokens,
 * read at render time so a theme switch or theme pack shows on the next redraw. */
function notibleThemeVariables(dark: boolean): Record<string, string | boolean> | null {
  const surface = notibleColor("surface");
  if (!surface) return null;
  const c = (name: string) => notibleColor(name, surface);
  const [raised, hover, border, text, muted, accent, note, warning] = ["raised", "hover", "border", "text", "muted", "accent", "highlight-yellow", "warning"].map(c);
  if (!raised || !hover || !border || !text || !muted || !accent || !note || !warning) return null;
  return {
    darkMode: dark, background: surface,
    primaryColor: raised, primaryBorderColor: accent, primaryTextColor: text, nodeBorder: accent,
    secondaryColor: hover, secondaryBorderColor: border, secondaryTextColor: text,
    tertiaryColor: hover, tertiaryBorderColor: border, tertiaryTextColor: text,
    clusterBkg: hover, clusterBorder: border,
    lineColor: muted, arrowheadColor: muted, textColor: text, titleColor: text, edgeLabelBackground: surface,
    noteBkgColor: note, noteBorderColor: warning, noteTextColor: text,
  };
}

/** Everything handed to `mermaid.initialize` from the user's settings — and,
 * serialised, the SVG cache identity, so no setting can miss either. */
export function mermaidConfig(appearance: MermaidAppearance, dark: boolean, source = "") {
  // ponytail: tokens exist only for the mode the app shows. Asked for the other
  // one (a report printed on paper while the app is in Night), Notible falls
  // back to Mermaid's neutral/dark, which is what Auto drew before #41.
  const showing = typeof document !== "undefined" && document.documentElement.classList.contains("core-night") === dark;
  // A theme set in the diagram itself wins outright: Mermaid rebuilds that
  // theme from initialize()'s themeVariables, so ours (Notible tokens, picks)
  // would bleed into it. Its own themeVariables still apply (MERMAID-SOURCE-THEME).
  const ownTheme = mermaidSourceTheme(source) !== null;
  const notible = !ownTheme && appearance.theme === "auto" && showing ? notibleThemeVariables(dark) : null;
  const themeVariables: Record<string, string | boolean> = { ...notible };
  // Auto node text on a picked node fill: dark or light ink, whichever reads.
  const fill = appearance.colors.nodeFill;
  const colors = ownTheme ? {} : { ...appearance.colors, ...(fill && !appearance.colors.nodeText ? { nodeText: readableInk(fill) } : {}) };
  for (const key of MERMAID_COLOR_KEYS) {
    const color = colors[key];
    if (color) for (const variable of MERMAID_COLOR_VARIABLES[key]) themeVariables[variable] = color;
  }
  return {
    theme: appearance.theme !== "auto" ? appearance.theme : notible ? "base" as const : dark ? "dark" as const : "neutral" as const,
    themeVariables,
    look: appearance.handDrawn ? "handDrawn" as const : "classic" as const,
    layout: appearance.elk ? "elk" : "dagre",
  };
}

/** The theme a diagram sets itself — front matter `config:` → `theme:`, or a
 * `%%{init: {"theme": …}}%%` directive — or null. ponytail: a regex, not a YAML
 * parser; it only has to spot that a theme is named, and which. */
export function mermaidSourceTheme(source: string): string | null {
  const frontMatter = /^\s*---[^\n]*\n([\s\S]*?)\n\s*---/u.exec(source)?.[1];
  const fromFrontMatter = frontMatter && /(?:^|[\s{,])theme\s*:\s*["']?([\w-]+)/mu.exec(frontMatter)?.[1];
  if (fromFrontMatter) return fromFrontMatter.toLowerCase();
  for (const directive of source.matchAll(/%%\{([\s\S]*?)\}%%/gu)) {
    const theme = /["']?theme["']?\s*:\s*["']?([\w-]+)/u.exec(directive[1])?.[1];
    if (theme) return theme.toLowerCase();
  }
  return null;
}

/** Mermaid's light palettes need the soft panel in Night. The effective theme
 * decides: the diagram's own (`dark` → none) over the setting; a picked
 * background paints the SVG instead. */
export function mermaidSoftPanel(appearance: MermaidAppearance, dark: boolean, source = ""): boolean {
  if (!dark) return false;
  const own = mermaidSourceTheme(source);
  if (own) return !own.includes("dark");
  return appearance.theme !== "auto" && !appearance.colors.background;
}

/** Near-black or near-white, whichever contrasts more with `hex` (WCAG relative luminance). */
export function readableInk(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#1f2733" : "#f4f7fb";
}

function mermaidCacheKey(source: string, config: ReturnType<typeof mermaidConfig>): string {
  return `${JSON.stringify(config)}\n${source}`;
}

/** A picked diagram background is painted on the SVG itself, so it also
 * travels into copies, exports and printed reports. */
function withBackground(svg: string, color: string | undefined): string {
  if (!isHexColor(color)) return svg;
  return svg.replace(/^<svg\b[^>]*/u, (tag) => /\sstyle="/u.test(tag)
    ? tag.replace(/\sstyle="/u, () => ` style="background-color: ${color}; `)
    : `${tag} style="background-color: ${color}"`);
}
let mermaidLoading: Promise<Mermaid> | null = null;
let mermaidQueue: Promise<unknown> = Promise.resolve();
/** Mermaid plus the official ELK layout engine, loaded once, on first use.
 * ELK is opt-in per diagram (`config: layout: elk`); dagre stays the default. */
function loadMermaid(): Promise<Mermaid> {
  mermaidLoading ??= Promise.all([import("mermaid"), import("@mermaid-js/layout-elk")])
    .then(([{ default: mermaid }, { default: elkLayouts }]) => { mermaid.registerLayoutLoaders(elkLayouts); return mermaid; })
    .catch((error: unknown) => { mermaidLoading = null; throw error; });
  return mermaidLoading;
}

/**
 * Renderer for ```` ```mermaid ```` blocks — the real Mermaid project
 * (https://mermaid.js.org, MIT licensed), loaded dynamically so it costs
 * nothing until a note actually has a mermaid block. Notible does not fork
 * or vendor it: diagram syntax, supported diagram types and rendering
 * behaviour are entirely Mermaid's, upstream.
 *
 * `securityLevel: "strict"` sanitises labels/text in the diagram source
 * before rendering — the same caution `notible.queries` documents for its
 * own note-text-driven rendering: this source can arrive via sync, import
 * or paste, not just local typing, so it is untrusted input. A diagram's own
 * `config:` front matter can change looks but not securityLevel (Mermaid
 * keeps it in its secure-keys list).
 */
/** One diagram as SVG markup (cached). Also what `editor.renderCodeBlockSvg`
 *  hands a plugin printing a report. Rejects on a syntax error. */
export function mermaidSvg(source: string, dark: boolean, appearance: MermaidAppearance = { theme: "auto", handDrawn: false, elk: false, colors: {} }): Promise<string> {
  const config = mermaidConfig(appearance, dark, source);
  const cacheKey = mermaidCacheKey(source, config);
  const cached = mermaidSvgCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  // initialize() is global: two renders with different settings (the settings
  // preview and a note) must not interleave between initialize and render.
  const run = mermaidQueue.then(async () => {
    const mermaid = await loadMermaid();
    // suppressErrorRendering: on a syntax error Mermaid otherwise draws its
    // own "bomb" SVG into a temp node on <body> and never removes it — they
    // piled up under the app UI. The error is shown in the block instead.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      ...config,
      suppressErrorRendering: true,
    });
    const id = `notible-mermaid-${mermaidRenderCounter++}`;
    try {
      const drawn = (await mermaid.render(id, source)).svg;
      const svg = mermaidSourceTheme(source) ? drawn : withBackground(drawn, appearance.colors.background);
      mermaidSvgCache.set(cacheKey, svg);
      return svg;
    } catch (error) {
      // Belt and braces: Mermaid's render scratch node is "d" + id.
      document.getElementById(`d${id}`)?.remove();
      throw error;
    }
  });
  mermaidQueue = run.catch(() => undefined);
  return run;
}

/** Mermaid's SVG is HTML-flavoured (an unclosed `<br>` in a multi-line label).
 *  Fine for innerHTML in the editor, but `toSvg` promises standalone SVG, and
 *  a report puts it in an <img>, which is strict XML and showed a broken
 *  picture. Parse as HTML (no scripts run in a DOMParser document), write XML. */
function svgAsXml(svg: string): string {
  const node = new DOMParser().parseFromString(svg, "text/html").body.querySelector("svg");
  return node ? new XMLSerializer().serializeToString(node) : svg;
}

export function renderMermaidDiagram({ container, source, plugin, theme }: CodeBlockContext) {
  const root = document.createElement("div");
  root.className = "core-mermaid-diagram";
  container.append(root);
  let disposed = false;
  // ponytail: a live theme switch shows on the next redraw, not instantly.
  const dark = theme.mode === "night";
  const appearance = mermaidAppearance(plugin);
  // Mermaid's fixed themes are light palettes: in Night they sit on a soft
  // panel (core-only.css), chosen from the effective theme (the diagram's own wins).
  if (mermaidSoftPanel(appearance, dark, source)) root.classList.add("has-fixed-light-theme");
  const cacheKey = mermaidCacheKey(source, mermaidConfig(appearance, dark, source));
  const show = (svg: string) => {
    root.innerHTML = svg;
    root.append(diagramActions(root, plugin));
    // Same contract as notible.queries: a drawn block hides its source
    // until the "mermaid · edit" bar is clicked (core-only.css). An error
    // never gets here, so a broken diagram keeps its code in view.
    container.classList.add("nq-ready");
  };
  const cached = mermaidSvgCache.get(cacheKey);
  if (cached) {
    show(cached);
    return { dispose: () => { root.remove(); } };
  }
  void (async () => {
    try {
      const svg = await mermaidSvg(source, dark, appearance);
      if (disposed) return;
      show(svg);
    } catch (error) {
      if (disposed) return;
      root.classList.add("core-mermaid-diagram-error");
      root.textContent = `Mermaid couldn't render this diagram: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  return { dispose: () => { disposed = true; root.remove(); } };
}

/** Hover bar on a drawn diagram: full-screen view, copy as image, save as SVG / PNG. */
function diagramActions(root: HTMLElement, plugin: CodeBlockContext["plugin"]): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "core-mermaid-actions";
  const svg = () => root.querySelector<SVGSVGElement>(":scope > svg")!;
  const add = (label: string, title: string, run: (button: HTMLButtonElement) => Promise<unknown> | void) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    // Keep the caret where it is — a click here must not open the source.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void Promise.resolve(run(button)).catch((error: unknown) => {
        plugin.ui.notice(`Diagram: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    bar.append(button);
  };
  add("Expand", "Full screen — scroll to zoom, drag to move", () => openDiagramViewer(svg()));
  add("Copy image", "Copy as a PNG picture, ready to paste into mail or a document", async (button) => {
    // The ClipboardItem gets a promise so the write starts inside the click's
    // user gesture; awaiting the PNG first can lose it.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": diagramPng(svg()) })]);
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = "Copy image"; }, 1200);
  });
  add("SVG", "Save as SVG…", () => plugin.ui.exportBinaryAs("diagram.svg", toBase64(new TextEncoder().encode(svgMarkup(svg()))), "image/svg+xml"));
  add("PNG", "Save as PNG…", async () => plugin.ui.exportBinaryAs("diagram.png", toBase64(new Uint8Array(await (await diagramPng(svg())).arrayBuffer())), "image/png"));
  return bar;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Standalone SVG: explicit size from the viewBox instead of Mermaid's
 * `width="100%"` + max-width, so it opens at its real size anywhere. */
function svgMarkup(svg: SVGSVGElement): string {
  const { width, height } = svg.viewBox.baseVal;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.style.maxWidth = "";
  return new XMLSerializer().serializeToString(clone);
}

/** The note's own background behind the diagram, so a dark-theme diagram
 * doesn't turn into light text on a transparent (usually white) paste. */
function backgroundBehind(node: Element | null): string {
  for (; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/u.test(color)) return color;
  }
  return "#ffffff";
}

async function diagramPng(svg: SVGSVGElement): Promise<Blob> {
  const { width, height } = svg.viewBox.baseVal;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup(svg))}`;
  await image.decode();
  const scale = 2; // sharp on HiDPI screens and when zoomed in a document
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = backgroundBehind(svg);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("couldn't create the PNG"))), "image/png"));
}

/** Full-screen view: wheel zooms around the cursor, drag pans, Esc closes.
 * Resizes the SVG itself rather than CSS-scaling it, so text stays sharp. */
export function openDiagramViewer(svg: SVGSVGElement) {
  const { width, height } = svg.viewBox.baseVal;
  const overlay = document.createElement("div");
  overlay.className = "core-mermaid-viewer";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Diagram");
  overlay.tabIndex = -1;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.style.maxWidth = "none";
  const bar = document.createElement("div");
  bar.className = "core-mermaid-viewer-bar";
  const button = (label: string, run: () => void) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.addEventListener("click", run);
    element.addEventListener("pointerdown", (event) => event.stopPropagation());
    bar.append(element);
  };
  let scale = 1, x = 0, y = 0;
  const apply = () => {
    clone.setAttribute("width", String(width * scale));
    clone.setAttribute("height", String(height * scale));
    clone.style.transform = `translate(${x}px, ${y}px)`;
  };
  const place = (next: number) => {
    scale = next;
    x = (overlay.clientWidth - width * scale) / 2;
    y = (overlay.clientHeight - height * scale) / 2;
    apply();
  };
  const fit = () => place(Math.min((overlay.clientWidth * 0.92) / width, (overlay.clientHeight * 0.88) / height));
  const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } };
  const close = () => { overlay.remove(); window.removeEventListener("keydown", onKey, true); };
  button("Fit", fit);
  button("100%", () => place(1));
  button("Close", close);
  overlay.addEventListener("wheel", (event) => {
    event.preventDefault();
    const next = Math.min(20, Math.max(0.1, scale * Math.exp(-event.deltaY * 0.0015)));
    x = event.clientX - (event.clientX - x) * (next / scale);
    y = event.clientY - (event.clientY - y) * (next / scale);
    scale = next;
    apply();
  }, { passive: false });
  overlay.addEventListener("pointerdown", (event) => {
    const startX = event.clientX - x, startY = event.clientY - y;
    overlay.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => { x = moveEvent.clientX - startX; y = moveEvent.clientY - startY; apply(); };
    overlay.addEventListener("pointermove", move);
    overlay.addEventListener("pointerup", () => overlay.removeEventListener("pointermove", move), { once: true });
  });
  overlay.append(clone, bar);
  document.body.append(overlay);
  window.addEventListener("keydown", onKey, true);
  overlay.focus();
  fit();
}

const EDITOR_EXTENSIONS_GUIDE = [
  "## Diagrams",
  "",
  "A mermaid code block turns into a real diagram — flowcharts, sequence diagrams, class diagrams, state diagrams, Gantt charts, and more.",
  "",
  "## How to add one",
  "",
  "- Easiest: in a note type / and pick Mermaid diagram. A working flowchart is inserted and drawn straight away — change its lines to make it yours.",
  "- By hand: the block needs three backticks followed by the word mermaid, alone on the first line. The diagram goes on the lines below it. The block closes with three backticks alone on their own last line. Three apostrophes do not work, and nothing else may share the opening or closing line — not even the first line of the diagram.",
  "- To edit a drawn diagram, click the mermaid · edit bar above it. The code opens underneath; click anywhere outside the block and the diagram comes back.",
  "- If the syntax is wrong the code stays visible with Mermaid's error message under it.",
  "- Hover a drawn diagram for Expand (full screen: scroll to zoom, drag to move, Esc closes), Copy image (a picture for mail or documents), and SVG / PNG (save to a file).",
  "",
  "## Changing how a diagram looks",
  "",
  "Defaults for every diagram on this device (theme, colours, hand-drawn look, ELK) are in Settings, Diagram appearance, with a live preview.",
  "",
  "Settings go at the very top of the diagram's code, between two --- lines. They are part of the note, so the diagram looks the same on every device. theme can be default, neutral, dark, forest or base; look: handDrawn gives a sketch style; layout: elk switches to a second layout engine that often arranges bigger diagrams more neatly. Every option: [Mermaid configuration](https://mermaid.js.org/config/schema-docs/config.html).",
  "",
  "```mermaid",
  "---",
  "config:",
  "  look: handDrawn",
  "  layout: elk",
  "---",
  "flowchart LR",
  "  A[Idea] --> B[Draft] --> C[Review]",
  "  C -->|changes| B",
  "  C --> D[Done]",
  "```",
  "",
  "This is the actual, open-source [Mermaid](https://mermaid.js.org) project (MIT licence) loaded directly — not a Notible fork, not a rewrite. Diagram syntax, the list of supported diagram types, and rendering behaviour all come from Mermaid itself, not from us. In their own words, Mermaid is a text-first way to build diagrams that stays easy to keep up to date as the thing it describes changes — so treat their docs, not this note, as the source of truth for syntax.",
  "",
  "## Examples",
  "",
  "Flowchart:",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Start] --> B{Decision}",
  "  B -->|Yes| C[Do it]",
  "  B -->|No| D[Skip it]",
  "```",
  "",
  "Sequence diagram:",
  "",
  "```mermaid",
  "sequenceDiagram",
  "  Alice->>Bob: Hello Bob",
  "  Bob-->>Alice: Hi Alice",
  "```",
  "",
  "For the full syntax reference (20+ diagram types), a browser sandbox to prototype in, and troubleshooting: [mermaid.js.org](https://mermaid.js.org) and the [Live Editor](https://mermaid.live).",
  "",
  "## Compare code",
  "",
  "Type / and choose Code comparison, or create a compare code block. Put the earlier snippet first, a line containing only ===== between them, and the newer snippet last. Notible marks added, removed and changed lines; large comparisons stay side by side without marks.",
  "",
  "Comparison blocks stay plain Markdown. Print and export intentionally keep the raw fenced source instead of converting the comparison panes to an image.",
].join("\n");

export const editorExtensionsPlugin = createBuiltinSurface({
  manifest: {
    id: "notible.editor-extensions", name: "Editor extensions", version: "0.1.0", apiVersion: "0.1", entry: "index.ts",
    description: "Code blocks, language support, diff, and Mermaid diagrams.",
    guide: EDITOR_EXTENSIONS_GUIDE,
    permissions: ["workspace.ui", "editor.extension"],
  },
  capability: "editor-extensions",
  commandName: "Inspect code block",
  viewTitle: "Editor extensions",
  settingsTitle: (t) => t("Diagram appearance"),
  // Custom panel (colour pickers + live preview), lazy so Settings doesn't load it up front.
  settingsRender: (context) => ({ kind: "react-loader", loader: () => import("./mermaid-settings-ui"), context }),
  onCommand: (_context, input) => inspectCode(input),
  codeBlocks: (context) => [
    { language: "mermaid", render: renderMermaidDiagram, toSvg: async (source, mode) => svgAsXml(await mermaidSvg(source, mode === "night", mermaidAppearance(context))) },
    { language: "compare", render: renderCodeComparison },
  ],
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
});
