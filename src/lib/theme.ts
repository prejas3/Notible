/** Theme system: a single "paper" identity (Kierunek B). Non-colour preferences
 * (font, size, width, density, language) are still user-adjustable and persisted. */

export type Language = "pl" | "en";
export type FontFamily = "system" | "inter" | "serif" | "mono";
export type Density = "comfortable" | "compact";

export interface ThemeSettings {
  fontFamily: FontFamily;
  fontSize: number; // 13-18
  contentWidth: number; // px
  fullWidth: boolean;
  radius: number; // px, base radius
  density: Density;
  language: Language;
}

// The one paper palette — equal to the --archive-* tokens so the runtime legacy
// vars and the CSS token layer never disagree.
const PAPER = {
  bg: "#fffdfa",
  bgElevated: "#ffffff",
  bgHover: "#f4f1eb",
  bgActive: "#eae5db",
  bgWorkspace: "#fffdfa",
  text: "#25231f",
  textMuted: "#6e675d",
  textFaint: "#948a7a",
  border: "rgba(40, 35, 28, 0.12)",
  borderSubtle: "rgba(40, 35, 28, 0.07)",
  surfaceRaised: "#ffffff",
  surfaceSunken: "#eae5db",
};
const BURGUNDY = "#8d3b46";

const FONT_STACKS: Record<FontFamily, string> = {
  system: "-apple-system, 'Segoe UI', system-ui, sans-serif",
  inter: "'Inter', 'Segoe UI', system-ui, sans-serif",
  serif: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  mono: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
};

export const DEFAULT_THEME: ThemeSettings = {
  fontFamily: "system",
  fontSize: 15,
  contentWidth: 720,
  fullWidth: false,
  radius: 10,
  density: "comfortable",
  language: "pl",
};

const STORAGE_KEY = "notible.theme";

export function loadTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THEME };
    // Older stored themes carried bgPreset/accent fields — the spread drops them.
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_THEME, ...parsed };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export function saveTheme(t: ThemeSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  window.dispatchEvent(new CustomEvent("notible:preferences", { detail: t }));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const int = parseInt(n, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function hexAlpha(color: string, alpha: number): string {
  const [r, g, b] = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Apply the theme to document.documentElement as CSS custom properties. */
export function applyTheme(t: ThemeSettings) {
  document.documentElement.dataset.theme = "light";
  document.documentElement.dataset.visualTheme = "paper";
  document.documentElement.lang = t.language;
  document.documentElement.style.colorScheme = "light";
  const root = document.documentElement.style;

  root.setProperty("--bg", PAPER.bg);
  root.setProperty("--bg-elevated", PAPER.bgElevated);
  root.setProperty("--bg-hover", PAPER.bgHover);
  root.setProperty("--bg-active", PAPER.bgActive);
  root.setProperty("--bg-workspace", PAPER.bgWorkspace);
  root.setProperty("--text", PAPER.text);
  root.setProperty("--text-muted", PAPER.textMuted);
  root.setProperty("--text-faint", PAPER.textFaint);
  root.setProperty("--border", PAPER.border);
  root.setProperty("--border-subtle", PAPER.borderSubtle);
  root.setProperty("--surface-raised", PAPER.surfaceRaised);
  root.setProperty("--surface-sunken", PAPER.surfaceSunken);

  root.setProperty("--accent", BURGUNDY);
  root.setProperty("--accent-soft", hexAlpha(BURGUNDY, 0.15));

  // Chart / semantic series stay multi-hue for legibility — they colour data, not
  // chrome. Tuned for the light paper background.
  const colors = ["#3f70b5", "#3f8068", "#a66b24", "#b75158", "#805a9e", "#328394", "#b05f91", "#c56435"];
  ["blue", "green", "amber", "red", "violet"].forEach((name, index) => root.setProperty(`--color-${name}`, colors[index]));
  colors.forEach((color, index) => root.setProperty(`--chart-${index + 1}`, color));
  root.setProperty("--danger", colors[3]);
  root.setProperty("--danger-soft", hexAlpha(colors[3], 0.13));
  root.setProperty("--warning", colors[2]);
  root.setProperty("--success", colors[1]);

  root.setProperty("--font-family", FONT_STACKS[t.fontFamily]);
  root.setProperty("--font-size-base", `${t.fontSize}px`);
  root.setProperty("--content-width", t.fullWidth ? "100%" : `${t.contentWidth}px`);
  root.setProperty("--radius-sm", `${Math.round(t.radius * 0.6)}px`);
  root.setProperty("--radius-md", `${t.radius}px`);
  root.setProperty("--radius-lg", `${Math.round(t.radius * 1.4)}px`);
  root.setProperty("--density-gap", t.density === "compact" ? "2px" : "6px");
  root.setProperty("--density-pad", t.density === "compact" ? "4px 6px" : "7px 8px");

  // The archive layer is a consumer of the same semantic token contract. Keep
  // its legacy names as aliases so plugins/themes do not have to maintain a
  // second, conflicting palette while the CSS files are migrated incrementally.
  root.setProperty("--archive-paper", PAPER.bg);
  root.setProperty("--archive-paper-raised", PAPER.bgElevated);
  root.setProperty("--archive-paper-muted", PAPER.bgHover);
  root.setProperty("--archive-paper-sunken", PAPER.bgActive);
  root.setProperty("--archive-ink", PAPER.text);
  root.setProperty("--archive-ink-muted", PAPER.textMuted);
  root.setProperty("--archive-ink-faint", PAPER.textFaint);
  root.setProperty("--archive-rule", PAPER.border);
  root.setProperty("--archive-rule-strong", hexAlpha(PAPER.text, 0.34));
  root.setProperty("--archive-burgundy", BURGUNDY);
  root.setProperty("--archive-burgundy-hover", "#74313a");
  root.setProperty("--archive-burgundy-soft", hexAlpha(BURGUNDY, 0.12));
  root.setProperty("--archive-green", colors[1]);
  root.setProperty("--archive-green-soft", hexAlpha(colors[1], 0.14));
  root.setProperty("--archive-ochre", colors[2]);
  root.setProperty("--archive-ochre-soft", hexAlpha(colors[2], 0.14));
  root.setProperty("--archive-danger", colors[3]);
  root.setProperty("--archive-danger-soft", hexAlpha(colors[3], 0.13));
  root.setProperty("--archive-focus", BURGUNDY);
  root.setProperty("--archive-selection", hexAlpha(BURGUNDY, 0.2));
  root.setProperty("--archive-font-sans", FONT_STACKS[t.fontFamily]);
  root.setProperty("--archive-font-serif", "Georgia, 'Iowan Old Style', 'Times New Roman', serif");
  root.setProperty("--archive-font-mono", "'JetBrains Mono', 'Cascadia Code', Consolas, monospace");
}
