// Theme pack CSS: tokenize, filter, and REBUILD the sheet from tokens.
//
// A theme is a stranger's stylesheet that the whole app will wear. It is pure
// CSS (no script), and the CSP already gives a stylesheet nowhere to send data.
// What is left to guard against is the stylesheet fetching things it should not,
// and the stylesheet defeating Core's own rules:
//
//   * every fetch token other than `url("<relative file in the package>")` is
//     removed (`@import`, `image-set()`, `cross-fade()`, `element()`, `src()`, ...);
//   * `!important` is stripped, so Core's own `!important` rules on critical UI
//     (see `.core-critical` in core-only.css) always outrank the theme;
//   * the output is generated from the parsed tokens, never patched into the
//     original text, so the browser parses exactly what was checked. CSS escapes
//     are decoded before any name is compared, and comments are dropped.
//
// Anything not understood is dropped, not passed through.

export const MAX_THEME_CSS_BYTES = 512 * 1024;
const MAX_DEPTH = 24;
const MAX_ASSETS = 24;
const ASSET_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "woff2"];
/** At-rules a theme may use. Everything else (@import, @layer, @charset, ...) is dropped. */
const ALLOWED_AT_RULES = new Set(["media", "supports", "container", "keyframes", "-webkit-keyframes", "font-face", "property"]);
/** Functions that fetch or paint from somewhere other than a checked url(). */
const FORBIDDEN_FUNCTIONS = new Set(["image-set", "-webkit-image-set", "cross-fade", "-webkit-cross-fade", "element", "-moz-element", "paint", "src", "image", "-webkit-image"]);

type Kind = "ws" | "ident" | "function" | "atkw" | "hash" | "string" | "url" | "num" | "delim" | "punct" | "bad";
interface Token { kind: Kind; value: string; }

// --- tokenizer ---------------------------------------------------------------------------------

const isDigit = (c: string) => c >= "0" && c <= "9";
const isHex = (c: string) => isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
const isNewline = (c: string) => c === "\n" || c === "\r" || c === "\f";
const isWs = (c: string) => c === " " || c === "\t" || isNewline(c);
const isNameStart = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c.charCodeAt(0) >= 128;
const isNameChar = (c: string) => isNameStart(c) || isDigit(c) || c === "-";

class Scanner {
  i = 0;
  readonly s: string;
  constructor(source: string) { this.s = source; }
  peek(n = 0) { return this.s[this.i + n] ?? ""; }
  validEscape(at = 0) { return this.peek(at) === "\\" && this.peek(at + 1) !== "" && !isNewline(this.peek(at + 1)); }
  /** Consume one escape (the backslash is at `i`) and return the character it stands for. */
  escape(): string {
    this.i += 1; // backslash
    const c = this.peek();
    if (c === "") return "�";
    if (isHex(c)) {
      let hex = "";
      while (hex.length < 6 && isHex(this.peek())) { hex += this.peek(); this.i += 1; }
      if (isWs(this.peek())) { if (this.peek() === "\r" && this.peek(1) === "\n") this.i += 1; this.i += 1; }
      const code = Number.parseInt(hex, 16);
      return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? "�" : String.fromCodePoint(code);
    }
    this.i += 1;
    return c;
  }
  startsIdent(at = 0): boolean {
    const a = this.peek(at);
    if (a === "-") { const b = this.peek(at + 1); return isNameStart(b) || b === "-" || this.validEscape(at + 1); }
    return isNameStart(a) || this.validEscape(at);
  }
  name(): string {
    let out = "";
    for (;;) {
      const c = this.peek();
      if (isNameChar(c)) { out += c; this.i += 1; }
      else if (this.validEscape()) out += this.escape();
      else return out;
    }
  }
  startsNumber(): boolean {
    const a = this.peek();
    if (a === "+" || a === "-") return isDigit(this.peek(1)) || (this.peek(1) === "." && isDigit(this.peek(2)));
    if (a === ".") return isDigit(this.peek(1));
    return isDigit(a);
  }
  number(): string {
    const start = this.i;
    if (this.peek() === "+" || this.peek() === "-") this.i += 1;
    while (isDigit(this.peek())) this.i += 1;
    if (this.peek() === "." && isDigit(this.peek(1))) { this.i += 1; while (isDigit(this.peek())) this.i += 1; }
    if ((this.peek() === "e" || this.peek() === "E") && (isDigit(this.peek(1)) || ((this.peek(1) === "+" || this.peek(1) === "-") && isDigit(this.peek(2))))) {
      this.i += 2; while (isDigit(this.peek())) this.i += 1;
    }
    return this.s.slice(start, this.i);
  }
}

function escapeIdent(value: string): string {
  let out = "";
  [...value].forEach((ch, index) => {
    const code = ch.codePointAt(0)!;
    const plain = /[A-Za-z_-]/.test(ch) || code >= 128 || (index > 0 && isDigit(ch));
    const dashDigit = index === 1 && value[0] === "-" && isDigit(ch);
    out += plain && !dashDigit ? ch : `\\${code.toString(16)} `;
  });
  return out;
}

function quote(value: string): string {
  let out = "\"";
  for (const ch of value) {
    if (ch === "\"" || ch === "\\") out += `\\${ch}`;
    else if (ch === "\n" || ch === "\r" || ch === "\f") out += `\\${ch.codePointAt(0)!.toString(16)} `;
    else out += ch;
  }
  return `${out}"`;
}

function tokenize(source: string): Token[] {
  const sc = new Scanner(source);
  const out: Token[] = [];
  while (sc.i < source.length) {
    const c = sc.peek();
    if (c === "/" && sc.peek(1) === "*") {
      const end = source.indexOf("*/", sc.i + 2);
      sc.i = end === -1 ? source.length : end + 2;
      out.push({ kind: "ws", value: " " }); // a comment separates tokens like a space
      continue;
    }
    if (isWs(c)) { while (isWs(sc.peek())) sc.i += 1; out.push({ kind: "ws", value: " " }); continue; }
    if (c === "\"" || c === "'") {
      sc.i += 1;
      let value = "";
      let bad = false;
      for (;;) {
        const d = sc.peek();
        if (d === "" ) break;
        if (d === c) { sc.i += 1; break; }
        if (isNewline(d)) { bad = true; break; }
        if (d === "\\") {
          if (isNewline(sc.peek(1))) { sc.i += 2; continue; }
          if (sc.peek(1) === "") { sc.i += 1; continue; }
          value += sc.escape();
        } else { value += d; sc.i += 1; }
      }
      out.push({ kind: bad ? "bad" : "string", value });
      continue;
    }
    if (c === "#") {
      if (isNameChar(sc.peek(1)) || sc.validEscape(1)) { sc.i += 1; out.push({ kind: "hash", value: sc.name() }); }
      else { sc.i += 1; out.push({ kind: "delim", value: "#" }); }
      continue;
    }
    if (c === "@") {
      if (sc.startsIdent(1)) { sc.i += 1; out.push({ kind: "atkw", value: sc.name() }); }
      else { sc.i += 1; out.push({ kind: "delim", value: "@" }); }
      continue;
    }
    if (sc.startsNumber()) {
      let text = sc.number();
      if (sc.peek() === "%") { sc.i += 1; text += "%"; }
      else if (sc.startsIdent()) text += escapeIdent(sc.name());
      out.push({ kind: "num", value: text });
      continue;
    }
    if (sc.startsIdent()) {
      const name = sc.name();
      if (sc.peek() === "(") {
        sc.i += 1;
        if (name.toLowerCase() === "url") {
          let j = sc.i;
          while (isWs(sc.s[j] ?? "")) j += 1;
          const q = sc.s[j] ?? "";
          if (q !== "\"" && q !== "'") {
            // Unquoted url( ... ): one token, ends at ")".
            sc.i = j;
            let value = "";
            let bad = false;
            for (;;) {
              const d = sc.peek();
              if (d === "") break;
              if (d === ")") { sc.i += 1; break; }
              if (isWs(d)) { while (isWs(sc.peek())) sc.i += 1; if (sc.peek() !== ")" && sc.peek() !== "") bad = true; continue; }
              if (d === "\"" || d === "'" || d === "(") { bad = true; sc.i += 1; continue; }
              if (d === "\\") { if (sc.validEscape()) value += sc.escape(); else { bad = true; sc.i += 1; } continue; }
              value += d; sc.i += 1;
            }
            out.push({ kind: bad ? "bad" : "url", value });
            continue;
          }
        }
        out.push({ kind: "function", value: name });
      } else out.push({ kind: "ident", value: name });
      continue;
    }
    if (";:,{}()[]".includes(c)) { sc.i += 1; out.push({ kind: "punct", value: c }); continue; }
    // <!-- and --> are legacy noise; anything else is a delimiter character.
    sc.i += 1;
    out.push({ kind: "delim", value: c });
  }
  return out;
}

// --- structure -----------------------------------------------------------------------------------

interface Decl { type: "decl"; name: string; value: Token[]; }
interface Rule { type: "rule"; at: string | null; prelude: Token[]; block: Node[] | null; }
type Node = Decl | Rule;

class Sanitizer {
  notes: string[] = [];
  assets: string[] = [];
  private note(message: string) { if (this.notes.length < 20) this.notes.push(message); }

  /** Read items until the matching "}" (or the end), returning them and the new index. */
  parseBlock(tokens: Token[], start: number, depth: number, topLevel: boolean): { nodes: Node[]; next: number } {
    const nodes: Node[] = [];
    let i = start;
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.kind === "punct" && t.value === "}") { if (topLevel) { i += 1; continue; } return { nodes, next: i + 1 }; }
      if (t.kind === "punct" && t.value === ";") { i += 1; continue; }
      if (t.kind === "ws") { i += 1; continue; }
      // Collect one item: up to ";" or a "{" block, tracking nested brackets.
      const item: Token[] = [];
      let nest = 0;
      let blockStart = -1;
      while (i < tokens.length) {
        const u = tokens[i];
        if (u.kind === "punct" && (u.value === "(" || u.value === "[")) nest += 1;
        else if (u.kind === "function") nest += 1;
        else if (u.kind === "punct" && (u.value === ")" || u.value === "]")) nest = Math.max(0, nest - 1);
        if (nest === 0 && u.kind === "punct" && u.value === "{") { blockStart = i; break; }
        if (nest === 0 && u.kind === "punct" && (u.value === ";" || u.value === "}")) break;
        item.push(u);
        i += 1;
      }
      if (blockStart >= 0) {
        if (depth >= MAX_DEPTH) { this.note("nesting is too deep"); i = this.skipBlock(tokens, blockStart + 1); continue; }
        const inner = this.parseBlock(tokens, blockStart + 1, depth + 1, false);
        i = inner.next;
        const prelude = trim(item);
        const first = prelude[0];
        if (first?.kind === "atkw") {
          const name = first.value.toLowerCase();
          if (!ALLOWED_AT_RULES.has(name)) { this.note(`@${name} is not allowed`); continue; }
          nodes.push({ type: "rule", at: name, prelude: prelude.slice(1), block: inner.nodes });
        } else if (prelude.length > 0) {
          const bad = prelude.some((p) => p.kind === "bad");
          if (bad) { this.note("a rule with a malformed selector was dropped"); continue; }
          nodes.push({ type: "rule", at: null, prelude, block: inner.nodes });
        }
      } else {
        const decl = this.parseDeclaration(trim(item));
        if (decl) nodes.push(decl);
      }
      if (i < tokens.length && tokens[i].kind === "punct" && tokens[i].value === ";") i += 1;
      else if (i < tokens.length && tokens[i].kind === "punct" && tokens[i].value === "}") { if (topLevel) i += 1; else return { nodes, next: i + 1 }; }
    }
    return { nodes, next: i };
  }

  private skipBlock(tokens: Token[], from: number): number {
    let depth = 1;
    let i = from;
    while (i < tokens.length && depth > 0) {
      const t = tokens[i];
      if (t.kind === "punct" && t.value === "{") depth += 1;
      else if (t.kind === "punct" && t.value === "}") depth -= 1;
      i += 1;
    }
    return i;
  }

  private parseDeclaration(item: Token[]): Decl | null {
    if (item.length === 0) return null;
    const first = item[0];
    if (first.kind === "atkw") { this.note(`@${first.value.toLowerCase()} is not allowed`); return null; }
    const colon = item.findIndex((t) => t.kind === "punct" && t.value === ":");
    if (first.kind !== "ident" || colon < 1) return null;
    const name = first.value;
    let value = trim(item.slice(colon + 1));
    // "!important" (any case, any spacing) is removed: Core's own important rules must win.
    for (let k = value.length - 1; k >= 1; k -= 1) {
      if (value[k].kind === "ident" && value[k].value.toLowerCase() === "important") {
        let j = k - 1;
        while (j >= 0 && value[j].kind === "ws") j -= 1;
        if (j >= 0 && value[j].kind === "delim" && value[j].value === "!") { value = trim(value.slice(0, j)); this.note("!important was removed"); }
        break;
      }
    }
    // A theme may decorate with empty pseudo-elements, but not write text:
    // `content: "Update required"` over a plugin's label or Core's own words
    // would put sentences on screen that nobody wrote (Nib review, 02.10).
    if (name.toLowerCase() === "content" && value.some((t) => (t.kind === "string" && t.value !== "") || (t.kind === "function" && ["attr", "counter", "counters"].includes(t.value.toLowerCase())))) {
      this.note("content with text was dropped: a theme may not write words on screen");
      return null;
    }
    const vetted = this.vet(value);
    if (vetted === null) { this.note(`${name} was dropped: it loads something a theme may not load`); return null; }
    return { type: "decl", name, value: vetted };
  }

  /** Check every token of a value; return it with url()s replaced by asset placeholders, or null to drop the declaration. */
  private vet(value: Token[]): Token[] | null {
    const out: Token[] = [];
    for (let i = 0; i < value.length; i += 1) {
      const t = value[i];
      if (t.kind === "bad") return null;
      if (t.kind === "function") {
        const fn = t.value.toLowerCase();
        if (FORBIDDEN_FUNCTIONS.has(fn)) return null;
        if (fn === "url") {
          // url( "path" ) — a function token followed by exactly one string and ")".
          let j = i + 1;
          while (value[j]?.kind === "ws") j += 1;
          const arg = value[j];
          let k = j + 1;
          while (value[k]?.kind === "ws") k += 1;
          if (!arg || arg.kind !== "string" || value[k]?.kind !== "punct" || value[k].value !== ")") return null;
          const placeholder = this.placeholder(arg.value);
          if (placeholder === null) return null;
          out.push({ kind: "url", value: placeholder });
          i = k;
          continue;
        }
      }
      if (t.kind === "url") {
        const placeholder = this.placeholder(t.value);
        if (placeholder === null) return null;
        out.push({ kind: "url", value: placeholder });
        continue;
      }
      out.push(t);
    }
    return out;
  }

  /** A relative file inside the package with an allowed extension, or null. */
  private placeholder(raw: string): string | null {
    let path = raw.trim().replace(/^\.\//u, "");
    if (!path || path.includes("\\") || path.includes(":") || path.startsWith("/") || path.includes("?") || path.includes("#") || /[\0-\x1f]/u.test(path)) return null;
    if (path.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    if (!ASSET_EXTENSIONS.includes(extension)) return null;
    let index = this.assets.indexOf(path);
    if (index === -1) {
      if (this.assets.length >= MAX_ASSETS) return null;
      this.assets.push(path);
      index = this.assets.length - 1;
    }
    path = `theme-asset:${index}`;
    return path;
  }
}

function trim(tokens: Token[]): Token[] {
  let a = 0;
  let b = tokens.length;
  while (a < b && tokens[a].kind === "ws") a += 1;
  while (b > a && tokens[b - 1].kind === "ws") b -= 1;
  return tokens.slice(a, b);
}

// --- serialisation --------------------------------------------------------------------------------

function ser(token: Token): string {
  switch (token.kind) {
    case "ws": return " ";
    case "ident": return escapeIdent(token.value);
    case "function": return `${escapeIdent(token.value)}(`;
    case "atkw": return `@${escapeIdent(token.value)}`;
    case "hash": return `#${token.value.replace(/[^A-Za-z0-9_-]/gu, (ch) => `\\${ch.codePointAt(0)!.toString(16)} `)}`;
    case "string": return quote(token.value);
    case "url": return `url(${quote(token.value)})`;
    case "num": return token.value;
    case "delim": return token.value;
    case "punct": return token.value;
    default: return "";
  }
}

const serTokens = (tokens: Token[]) => tokens.map(ser).join("").trim();

/**
 * Core's own base themes are written as `:root.core-night` (specificity 0,2,0), so a theme's plain
 * `:root { --notible-*: … }` would lose to Midnight in dark mode. Every `:root` in a theme's
 * selectors is therefore written as `:root:root:root` (0,3,0): a theme always wins over the base
 * it is drawn on, whatever the order of the sheets, and authors keep writing `:root`.
 */
function boostRoot(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    out.push(tokens[i]);
    const colon = tokens[i];
    const name = tokens[i + 1];
    if (colon.kind === "punct" && colon.value === ":" && name?.kind === "ident" && name.value.toLowerCase() === "root") {
      out.push(name, { kind: "punct", value: ":" }, name, { kind: "punct", value: ":" }, name);
      i += 1;
    }
  }
  return out;
}

function serNodes(nodes: Node[]): string {
  return nodes.map((node) => {
    if (node.type === "decl") return `${escapeIdent(node.name)}:${serTokens(node.value)};`;
    const head = node.at ? `@${escapeIdent(node.at)} ${serTokens(node.prelude)}`.trim() : serTokens(boostRoot(node.prelude));
    return `${head}{${node.block ? serNodes(node.block) : ""}}`;
  }).join("\n");
}

export interface SanitizedTheme {
  /** The rebuilt stylesheet; each allowed image is `url("theme-asset:N")` until it is filled in. */
  css: string;
  /** Package-relative files the stylesheet asks for, by placeholder number. */
  assets: string[];
  /** What was removed, for the author (capped). */
  notes: string[];
}

/** Rebuild a theme stylesheet from its tokens. Throws only on an oversized input. */
export function sanitizeThemeCss(source: string): SanitizedTheme {
  if (new TextEncoder().encode(source).length > MAX_THEME_CSS_BYTES) throw new Error("that stylesheet is too large (over 512 KB)");
  const sanitizer = new Sanitizer();
  const { nodes } = sanitizer.parseBlock(tokenize(source), 0, 0, true);
  return { css: serNodes(nodes), assets: sanitizer.assets, notes: sanitizer.notes };
}

/** Put the data: URIs in place of the placeholders. Only exact, known placeholders are replaced. */
export function fillThemeAssets(css: string, dataUris: string[]): string {
  let out = css;
  dataUris.forEach((uri, index) => { out = out.split(`url("theme-asset:${index}")`).join(`url("${uri}")`); });
  return out;
}
