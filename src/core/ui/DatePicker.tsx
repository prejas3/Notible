import { useEffect, useMemo, useRef, useState } from "react";
import { usePopover, PopoverLayer } from "./anchorPopover.ts";
import { clampDate, formatDate, monthGrid, normaliseTime, parseDate, withTime } from "./logic.ts";
import "./core-ui.css";

export interface DatePickerProps {
  /** ISO `yyyy-mm-dd` (optionally `+THH:mm`), or `""` / `null`. */
  value: string | null;
  /** Emits ISO, or `""` when cleared. Never a `Date`. */
  onChange: (value: string) => void;
  range?: boolean;
  rangeValue?: [string, string] | null;
  onRangeChange?: (v: [string, string]) => void;
  time?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
  /** `"pl"` → `dd.mm.rrrr`; anything else → ISO. Defaults from the browser. */
  locale?: string;
  /** Overrides the default `yyyy-mm-dd` / `dd.mm.rrrr` placeholder — for a
   * cramped trigger (a compact chip) where the full date-format hint would
   * overflow or collide with a neighbouring control. */
  placeholder?: string;
}

const DOW: Record<string, string[]> = {
  pl: ["pon", "wto", "śro", "czw", "pią", "sob", "nie"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

// ponytail: a11y strings for the calendar sub-controls. This is a Core-level
// primitive below the plugin i18n layer, so it carries English here; wire it
// to a locale table if the picker ever needs localised screen-reader text.
const A11Y = { prev: "Previous month", next: "Next month", time: "Time", timeHint: "--:--" };

function defaultLocale(): string {
  // The app's chosen language is mirrored onto <html lang> by applyTheme.
  // navigator.language is the OS locale, which is a different thing — a
  // Polish Windows running the English UI was getting Polish month names.
  const lang = typeof document !== "undefined" ? document.documentElement.lang?.toLowerCase() : "";
  return lang?.startsWith("pl") ? "pl" : "en";
}

function monthLabel(year: number, month: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : "en-US", { month: "long", year: "numeric" })
      .format(new Date(Date.UTC(year, month - 1, 1)));
  } catch {
    return `${year}-${String(month).padStart(2, "0")}`;
  }
}

// Local calendar day, not UTC — near midnight in a positive-offset zone
// (e.g. Warsaw 00:30+02) the UTC date is still "yesterday".
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function DatePicker({
  value, onChange, range, rangeValue, onRangeChange, time,
  min, max, disabled, ariaLabel, id, className, locale = defaultLocale(), placeholder,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const model = value ?? "";
  const datePart = model.slice(0, 10);
  const timePart = model.length > 10 ? model.slice(11, 16) : "";
  const { anchorRef, panelRef, style, placement } = usePopover(open);
  // usePopover floors the panel at the trigger's width via an inline
  // minWidth, and an inline style beats the panel's CSS `min-width: 15rem`.
  // A narrow trigger (Planning's form is tighter than Properties' grid) then
  // squeezed the 7-column month grid. Keep the calendar's own floor.
  const panelStyle = { ...style, minWidth: Math.max(Number(style.minWidth) || 0, 240) };
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState(() => formatDate(model, locale));
  const [view, setView] = useState(() => {
    const base = datePart || todayIso();
    return { year: +base.slice(0, 4), month: +base.slice(5, 7) };
  });
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);

  useEffect(() => {
    setText(formatDate(model, locale));
    // A value set from outside (or a typed one, committed) shows its own month.
    if (datePart) setView({ year: +datePart.slice(0, 4), month: +datePart.slice(5, 7) });
  }, [model, locale, datePart]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (inputRef.current?.parentElement?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, panelRef]);

  const cells = useMemo(() => monthGrid(view.year, view.month), [view]);

  const commitText = () => {
    const parsed = parseDate(text.trim(), locale);
    if (parsed === null) {
      setText(formatDate(model, locale)); // revert
      return;
    }
    if (parsed === "") {
      onChange("");
      return;
    }
    onChange(withTime(clampDate(parsed, min, max), time ? timePart : ""));
  };

  const pickDay = (iso: string) => {
    if (range) {
      if (!rangeAnchor) {
        setRangeAnchor(iso);
        return;
      }
      const [a, b] = rangeAnchor <= iso ? [rangeAnchor, iso] : [iso, rangeAnchor];
      onRangeChange?.([a, b]);
      setRangeAnchor(null);
      setOpen(false);
      return;
    }
    onChange(withTime(clampDate(iso, min, max), time ? timePart : ""));
    if (!time) setOpen(false);
  };

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const m = v.month - 1 + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 + 1 };
    });
  };

  const inRange = (iso: string): boolean => {
    if (!range) return false;
    const lo = rangeValue?.[0] ?? rangeAnchor;
    const hi = rangeValue?.[1] ?? rangeAnchor;
    return !!lo && !!hi && iso >= (lo < hi ? lo : hi) && iso <= (lo < hi ? hi : lo);
  };

  return (
    <span className={`nb-control nb-datepicker${className ? ` ${className}` : ""}`}>
      <input
        ref={(n) => {
          inputRef.current = n;
          anchorRef.current = n;
        }}
        id={id}
        className="nb-control-trigger"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={placeholder ?? (locale === "pl" ? "dd.mm.rrrr" : "yyyy-mm-dd")}
        onChange={(e) => {
          setText(e.target.value);
          // The month follows a complete date as it is typed (R4 T10).
          const typed = parseDate(e.target.value.trim(), locale);
          if (typed) setView({ year: +typed.slice(0, 4), month: +typed.slice(5, 7) });
        }}
        onBlur={commitText}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText();
            setOpen(false);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && !disabled && (
        <PopoverLayer>
          <div ref={panelRef} className={`nb-popover nb-popover-${placement} nb-datepicker-panel`} style={panelStyle}>
            <div className="nb-dp-head">
              <button type="button" className="nb-dp-nav" aria-label={A11Y.prev} onClick={() => shiftMonth(-1)}>‹</button>
              <span>{monthLabel(view.year, view.month, locale)}</span>
              <button type="button" className="nb-dp-nav" aria-label={A11Y.next} onClick={() => shiftMonth(1)}>›</button>
            </div>
            <div className="nb-dp-body">
            <div className="nb-dp-grid">
              {(DOW[locale] ?? DOW.en).map((d) => (
                <span key={d} className="nb-dp-dow">{d}</span>
              ))}
              {cells.map((iso, i) =>
                iso === null ? (
                  <span key={`pad-${i}`} />
                ) : (
                  <button
                    key={iso}
                    type="button"
                    className={
                      "nb-dp-day" +
                      (iso === datePart ? " is-selected" : "") +
                      (iso === todayIso() ? " is-today" : "") +
                      (inRange(iso) ? " in-range" : "")
                    }
                    disabled={(min && iso < min) || (max && iso > max) || undefined}
                    onClick={() => pickDay(iso)}
                  >
                    {+iso.slice(8, 10)}
                  </button>
                ),
              )}
            </div>
            {time && (
              <input
                className="nb-dp-time"
                type="text"
                inputMode="numeric"
                placeholder={A11Y.timeHint}
                defaultValue={timePart}
                aria-label={A11Y.time}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === "") { if (datePart) onChange(withTime(datePart, "")); return; }
                  const hhmm = normaliseTime(raw);
                  if (hhmm === null) { e.target.value = timePart; return; } // keep the saved value
                  e.target.value = hhmm;
                  if (datePart) onChange(withTime(datePart, hhmm));
                }}
              />
            )}
            </div>
            <div className="nb-dp-foot">
              <button type="button" onClick={() => { onChange(""); setText(""); setOpen(false); }}>
                {locale === "pl" ? "Wyczyść" : "Clear"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const t = clampDate(todayIso(), min, max);
                  onChange(withTime(t, time ? timePart : ""));
                  setView({ year: +t.slice(0, 4), month: +t.slice(5, 7) });
                  if (!time) setOpen(false);
                }}
              >
                {locale === "pl" ? "Dzisiaj" : "Today"}
              </button>
            </div>
          </div>
        </PopoverLayer>
      )}
    </span>
  );
}
