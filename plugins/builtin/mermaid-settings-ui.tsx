import { useEffect, useId, useRef, useState } from "react";
import { Select } from "../../src/core/ui/index.ts";
import { usePopover, PopoverLayer } from "../../src/core/ui/anchorPopover.ts";
import type { PluginContext } from "../../packages/plugin-api/src/index.ts";
import {
  MERMAID_COLOR_KEYS, MERMAID_ELK_KEY, MERMAID_HAND_DRAWN_KEY, MERMAID_THEME_KEY, MERMAID_THEMES,
  isHexColor, mermaidAppearance, mermaidSoftPanel, mermaidColorStorageKey, mermaidSvg, notibleColor,
  type MermaidColorKey, type MermaidTheme,
} from "./editor-extensions.ts";
import { PluginI18nProvider, useT, type Translate } from "./i18n.tsx";
import "./domain-plugin-ui.css";

// Small on purpose: two nodes, a decision, a group and a labelled edge show
// every colour the pickers below change.
// Top to bottom with a side-by-side group: stays readable in the narrow settings column.
const PREVIEW_SOURCE = [
  "flowchart TB",
  "  A[Idea] -->|draft| B{Ready?}",
  "  B -->|yes| G",
  "  B -.->|no| A",
  "  subgraph G [Group]",
  "    direction LR",
  "    C[Review] --> D[Done]",
  "  end",
].join("\n");

// Swatches come from the app's own tokens, so they match the current theme.
const SWATCH_TOKENS = ["background", "surface", "raised", "hover", "border", "muted", "text", "accent", "color-blue", "color-green", "color-amber", "color-red", "color-violet", "highlight-yellow", "highlight-green", "highlight-blue", "highlight-pink", "highlight-purple"];

function themeCopy(t: Translate): Record<MermaidTheme, { label: string; description: string }> {
  return {
    auto: { label: t("Notible"), description: t("Notible's own colours. Follows Daylight, Midnight and any theme pack.") },
    default: { label: t("Default"), description: t("Mermaid's classic look: lilac boxes, yellow notes. A light palette, shown on a soft panel in Midnight.") },
    neutral: { label: t("Neutral"), description: t("Black, white and greys. A light palette, shown on a soft panel in Midnight.") },
    forest: { label: t("Forest"), description: t("Shades of green. A light palette, shown on a soft panel in Midnight.") },
    base: { label: t("Base"), description: t("Mermaid's plain starting theme. Best with your own colours below.") },
  };
}

function colorCopy(t: Translate): Record<MermaidColorKey, { label: string; description: string }> {
  return {
    background: { label: t("Diagram background"), description: t("Behind the whole diagram. Auto leaves it clear, so the note shows through.") },
    nodeFill: { label: t("Node fill"), description: t("Inside boxes, decisions, states and sequence actors.") },
    nodeBorder: { label: t("Node border"), description: t("The outline of boxes, decisions and actors.") },
    nodeText: { label: t("Node text"), description: t("Labels inside boxes and actors.") },
    line: { label: t("Lines and arrows"), description: t("Connectors, arrowheads and sequence messages.") },
    groupFill: { label: t("Group fill"), description: t("Inside subgraphs and other groups.") },
    groupBorder: { label: t("Group border"), description: t("The outline of subgraphs and other groups.") },
  };
}

/** A literal format hint, the same in every language. */
const HEX_PLACEHOLDER = "#336699";

const isNight = () => document.documentElement.classList.contains("core-night");

/** True while the app is in Night; re-renders when the theme switches. */
function useNight(): boolean {
  const [night, setNight] = useState(isNight);
  useEffect(() => {
    const observer = new MutationObserver(() => setNight(isNight()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-notible-theme"] });
    return () => observer.disconnect();
  }, []);
  return night;
}

function MermaidSettings({ context }: { context: PluginContext }) {
  const t = useT();
  const night = useNight();
  const [version, setVersion] = useState(0);
  const appearance = mermaidAppearance(context);
  const set = (key: string, value: unknown) => { context.storage.set(key, value); setVersion((value) => value + 1); };
  const themes = themeCopy(t);
  const colors = colorCopy(t);
  return (
    <div className="core-plugin-settings-form">
      <section>
        <p className="core-plugin-settings-hint">{t("These defaults apply on this device. A diagram's own config front matter still wins.")}</p>
        <div className="core-setting-row">
          <div><label htmlFor="mermaid-theme">{t("Theme")}</label><small>{themes[appearance.theme].description}</small></div>
          <Select id="mermaid-theme" ariaLabel={t("Theme")} value={appearance.theme} onChange={(next) => set(MERMAID_THEME_KEY, next)} options={MERMAID_THEMES.map((value) => ({ value, label: themes[value].label }))} />
        </div>
        <div className="core-setting-row">
          <div><label htmlFor="mermaid-hand-drawn">{t("Hand-drawn look")}</label><small>{t("Give diagrams a sketch-like style.")}</small></div>
          <input id="mermaid-hand-drawn" type="checkbox" checked={appearance.handDrawn} onChange={(event) => set(MERMAID_HAND_DRAWN_KEY, event.target.checked)} />
        </div>
        <div className="core-setting-row">
          <div><label htmlFor="mermaid-elk">{t("ELK layout")}</label><small>{t("Use the ELK engine, which can arrange larger diagrams more neatly.")}</small></div>
          <input id="mermaid-elk" type="checkbox" checked={appearance.elk} onChange={(event) => set(MERMAID_ELK_KEY, event.target.checked)} />
        </div>
      </section>
      <section>
        <h3>{t("Colours")}</h3>
        <p className="core-plugin-settings-hint">{t("Each colour starts on Auto, taken from the theme above. Pick one to use it in every diagram.")}</p>
        {MERMAID_COLOR_KEYS.map((key) => (
          <div className="core-setting-row" key={key}>
            <div><label id={`mermaid-color-${key}`}>{colors[key].label}</label><small>{colors[key].description}</small></div>
            <ColorPicker labelId={`mermaid-color-${key}`} label={colors[key].label} value={appearance.colors[key] ?? null} onChange={(next) => set(mermaidColorStorageKey(key), next)} />
          </div>
        ))}
      </section>
      <section>
        <h3>{t("Live preview")}</h3>
        <MermaidPreview version={version} context={context} night={night} />
      </section>
    </div>
  );
}

/** The same `mermaidSvg()` path a note uses, redrawn on every change. */
function MermaidPreview({ context, night, version }: { context: PluginContext; night: boolean; version: number }) {
  const t = useT();
  const [state, setState] = useState<{ svg?: string; error?: string }>({});
  useEffect(() => {
    let current = true;
    mermaidSvg(PREVIEW_SOURCE, night, mermaidAppearance(context))
      .then((svg) => { if (current) setState({ svg }); })
      .catch((error: unknown) => { if (current) setState({ error: error instanceof Error ? error.message : String(error) }); });
    return () => { current = false; };
  }, [context, night, version]);
  const appearance = mermaidAppearance(context);
  const softPanel = mermaidSoftPanel(appearance, night, PREVIEW_SOURCE);
  if (state.error) return <p className="core-mermaid-diagram-error">{state.error}</p>;
  return state.svg
    // Trusted markup: a constant diagram, drawn with securityLevel "strict".
    ? <div className={`core-mermaid-diagram mermaid-settings-preview${softPanel ? " has-fixed-light-theme" : ""}`} aria-label={t("Live preview")} dangerouslySetInnerHTML={{ __html: state.svg }} />
    : <p className="core-plugin-settings-hint">{t("Loading…")}</p>;
}

/** Notible's colour control: swatches and a hex field in a themed popover. No
 * native colour input — that opens the OS dialog, which ignores the app theme. */
function ColorPicker({ label, labelId, value, onChange }: { label: string; labelId: string; value: string | null; onChange: (next: string | null) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const { anchorRef, panelRef, style, placement } = usePopover(open);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const autoRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  useEffect(() => { setDraft(value ?? ""); }, [value, open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, panelRef]);
  // Keyboard users land inside the popover; it is hidden until placed, so wait for that.
  const placed = open && style.visibility !== "hidden";
  useEffect(() => { if (placed) autoRef.current?.focus({ preventScroll: true }); }, [placed]);
  const close = () => { setOpen(false); buttonRef.current?.focus(); };
  const pick = (next: string | null) => { onChange(next); close(); };
  // Read on every render: the parent re-renders on a theme switch.
  const swatches = [...new Set(SWATCH_TOKENS.map((token) => notibleColor(token, notibleColor("surface") ?? undefined)).filter((color): color is string => Boolean(color)))];
  return (
    <span className="mermaid-color">
      <button
        ref={(node) => { buttonRef.current = node; anchorRef.current = node; }}
        type="button"
        className="nb-control-trigger"
        aria-labelledby={labelId}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((next) => !next)}
      >
        <span className={`mermaid-color-chip${value ? "" : " is-auto"}`} style={value ? { background: value } : undefined} aria-hidden />
        <span className="nb-value">{value ?? t("Auto")}</span>
        <span aria-hidden className="nb-caret" />
      </button>
      {open && (
        <PopoverLayer>
          <div
            ref={panelRef}
            id={panelId}
            className={`nb-popover nb-popover-${placement} mermaid-color-popover`}
            style={{ ...style, fontSize: buttonRef.current ? getComputedStyle(buttonRef.current).fontSize : undefined }}
            role="dialog"
            aria-label={label}
            onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
          >
            <button ref={autoRef} type="button" className={`mermaid-color-auto${value ? "" : " is-selected"}`} aria-pressed={!value} onClick={() => pick(null)}>
              <span className="mermaid-color-chip is-auto" aria-hidden />{t("Auto (from the theme)")}
            </button>
            <div className="mermaid-color-swatches">
              {swatches.map((color) => (
                <button key={color} type="button" className={`mermaid-color-swatch${color === value ? " is-selected" : ""}`} style={{ background: color }} title={color} aria-label={color} aria-pressed={color === value} onClick={() => pick(color)} />
              ))}
            </div>
            <label className="mermaid-color-hex">
              <span>{t("Hex")}</span>
              <input
                type="text"
                value={draft}
                placeholder={HEX_PLACEHOLDER}
                spellCheck={false}
                maxLength={7}
                aria-invalid={draft !== "" && !isHexColor(draft)}
                onChange={(event) => {
                  const next = event.target.value.trim();
                  setDraft(next);
                  if (isHexColor(next)) onChange(next.toLowerCase());
                }}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); close(); } }}
              />
            </label>
          </div>
        </PopoverLayer>
      )}
    </span>
  );
}

export default function MermaidSettingsSurface({ context }: { context: unknown }) {
  return <PluginI18nProvider context={context as PluginContext}><MermaidSettings context={context as PluginContext} /></PluginI18nProvider>;
}
