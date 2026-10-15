import { createSlugger } from "./slug.ts";

/** Visible text of a heading's inner HTML (caret hosts, marks and entities stripped). */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/gu, "").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/​/gu, "");
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/gu;

function linkify(part: string): string {
  return part.replace(LINK, (whole, text: string, target: string) => {
    if (target.startsWith("help:")) {
      const [id, slug = ""] = target.slice(5).split("#");
      return `<a class="core-help-link" data-help="${id}" data-help-slug="${slug}" href="#">${text}</a>`;
    }
    if (target === "settings:plugins") return `<a class="core-help-link" data-settings="plugins" href="#">${text}</a>`;
    if (/^https?:\/\//u.test(target)) return `<a class="core-help-link" data-external="${target}" href="${target}">${text}</a>`;
    return whole;
  });
}

const escapeHtml = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");

/** Placeholder for an inline code span: no character the note renderer
 * treats as a mark (`*`, `_`, `~`, `=`, `[`, `!`), so it passes through as text. */
const codeToken = (index: number) => `HELPCODE${index}HELPCODE`;

/** A code span that is a key or chord (`Ctrl+N`, `F1`, `[[`) renders as keycaps, like Settings → Hotkeys. */
const KEY = /^(?:(?:Ctrl|Alt|Shift|Mod|Cmd)\+)*(?:F\d{1,2}|Tab|Esc|Enter|Space|Backspace|Delete|Home|End|click|←|→|↑|↓|[A-Z0-9,./]|\[\[)$/u;
const MODIFIED = /^(?:Ctrl|Alt|Shift|Mod|Cmd)\+/u;
export function inlineCode(code: string): string {
  const isKey = KEY.test(code) && (MODIFIED.test(code) || code.length > 1 || code === "/");
  if (!isKey) return `<code>${escapeHtml(code)}</code>`;
  // Same markup as HotkeyCaps in CorePluginSurfaces.tsx.
  const keys = code.split(/\+(?=.)/u).map((key, index) => `<span>${index ? '<span aria-hidden="true">+</span>' : ""}<kbd>${escapeHtml(key)}</kbd></span>`);
  return `<span class="core-hotkey-caps">${keys.join("")}</span>`;
}

/**
 * Render a Help page body. The note renderer has no inline `code`, so
 * `**bold**` inside backticks would come out bold and `[[x]]` a link. Inline
 * code is lifted out before rendering and put back as <code> afterwards;
 * fenced blocks are left to the renderer. `renderMarkdown` is injected
 * (renderCoreMarkdown in the app) so this module stays importable from Node.
 */
export function renderHelpPage(body: string, renderMarkdown: (value: string) => string): string {
  const spans: string[] = [];
  let inFence = false;
  const lifted = body.split("\n").map((line) => {
    if (line.trim().startsWith("```")) { inFence = !inFence; return line; }
    if (inFence) return line;
    return line.replace(/`([^`]+)`/gu, (_whole, code: string) => { spans.push(code); return codeToken(spans.length - 1); });
  }).join("\n");
  const html = postProcessHelpHtml(renderMarkdown(lifted));
  return html.replace(/HELPCODE(\d+)HELPCODE/gu, (_whole, index: string) => inlineCode(spans[Number(index)] ?? ""));
}

/**
 * Help-only additions on top of renderCoreMarkdown: heading ids (same slugger
 * as search and help-check), links, and .webm clips as <video>. Never touches
 * <pre>, so examples stay literal. Input is already HTML-escaped, so link
 * targets and texts can't break out of the attributes they land in; the
 * [a-z0-9-] rule for ids/slugs is enforced by help-check.
 */
export function postProcessHelpHtml(html: string): string {
  const slug = createSlugger();
  return html.split(/(<pre[\s\S]*?<\/pre>)/u).map((part) => {
    if (part.startsWith("<pre")) return part;
    return linkify(part)
      .replace(/<h([1-3])>([\s\S]*?)<\/h\1>/gu, (_whole, level: string, inner: string) => `<h${level} id="${slug(textOf(inner))}">${inner}</h${level}>`)
      .replace(/<img class="core-md-image" alt="([^"]*)" src="(help\/[^"]+\.webm)">/gu, '<video class="core-help-video" src="$2" muted loop autoplay playsinline aria-label="$1"></video>');
  }).join("");
}
