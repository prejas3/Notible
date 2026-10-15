/**
 * CODE-LOOK (Hive #32): how code blocks look, per device (like zoom.ts). Written as CSS variables
 * on <html>; core-only.css reads them with today's look as the fallback, so a default value is
 * removed rather than written and nothing changes until the user picks something else.
 * Print ignores these on purpose: paper always wraps and sizes from the PDF text size.
 */
export const CODE_LOOK_KEY = "notible-code-look";

export interface CodeLook { size: number; lineHeight: number; wrap: "wrap" | "scroll"; tabSize: number }

export const CODE_LOOK_DEFAULT: CodeLook = { size: 13, lineHeight: 1.55, wrap: "wrap", tabSize: 8 };
export const CODE_SIZES = [11, 12, 13, 14, 15, 16, 18];
export const CODE_LINE_HEIGHTS = [1.3, 1.45, 1.55, 1.7, 1.9];
export const CODE_TAB_SIZES = [2, 4, 8];

export function readCodeLook(): CodeLook {
  let saved: Partial<CodeLook> = {};
  try { saved = JSON.parse(localStorage.getItem(CODE_LOOK_KEY) ?? "{}") ?? {}; } catch { /* default look */ }
  return {
    size: CODE_SIZES.includes(saved.size as number) ? saved.size as number : CODE_LOOK_DEFAULT.size,
    lineHeight: CODE_LINE_HEIGHTS.includes(saved.lineHeight as number) ? saved.lineHeight as number : CODE_LOOK_DEFAULT.lineHeight,
    wrap: saved.wrap === "scroll" ? "scroll" : "wrap",
    tabSize: CODE_TAB_SIZES.includes(saved.tabSize as number) ? saved.tabSize as number : CODE_LOOK_DEFAULT.tabSize,
  };
}

export function applyCodeLook(look: CodeLook): void {
  try { localStorage.setItem(CODE_LOOK_KEY, JSON.stringify(look)); } catch { /* still applied for this session */ }
  const style = document.documentElement.style;
  const set = (name: string, value: string | null) => (value === null ? style.removeProperty(name) : style.setProperty(name, value));
  set("--core-code-size", look.size === CODE_LOOK_DEFAULT.size ? null : `${look.size}px`);
  set("--core-code-line-height", look.lineHeight === CODE_LOOK_DEFAULT.lineHeight ? null : String(look.lineHeight));
  set("--core-code-wrap", look.wrap === "wrap" ? null : "pre");
  set("--core-code-tab-size", look.tabSize === CODE_LOOK_DEFAULT.tabSize ? null : String(look.tabSize));
}
