import { tCore } from "../app/core-i18n.ts";
import { useEffect, useId, useRef, useState } from "react";
import { usePopover, PopoverLayer } from "./anchorPopover.ts";
import { filterOptions, nextOptionIndex, truncateOptions } from "./logic.ts";
import type { SelectOption, SelectProps } from "./Select.tsx";
import "./core-ui.css";

export interface ComboboxProps extends Omit<SelectProps, "placeholder"> {
  placeholder?: string;
  /** Called when the user commits text that matches no option's label.
   *  Without it, free text is ignored. */
  onFreeText?: (text: string) => void;
}

/**
 * Searchable variant of `<Select>` — a filter input sits at the top of the
 * panel. Replaces the native `<input list>` + `<datalist>` used for ref
 * pickers (milestone / cycle / release).
 */
export function Combobox({
  value, onChange, options, placeholder, disabled, ariaLabel, id, className, onFreeText,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const capped = truncateOptions(options);
  const shown = filterOptions(capped, query);
  const current = capped.find((o: SelectOption) => o.value === value);
  const listId = useId();
  const { anchorRef, panelRef, style, placement } = usePopover(open);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, panelRef]);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
    btnRef.current?.focus();
  };

  const commitFreeText = () => {
    const exact = capped.find((o) => o.label.toLowerCase() === query.trim().toLowerCase());
    if (exact) return commit(exact.value);
    if (onFreeText && query.trim()) {
      onFreeText(query.trim());
      setOpen(false);
      setQuery("");
      btnRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      btnRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => nextOptionIndex(shown, i, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => nextOptionIndex(shown, i, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = shown[active];
      if (o && !o.disabled) commit(o.value);
      else commitFreeText();
    }
  };

  return (
    <span className={`nb-control nb-combobox${className ? ` ${className}` : ""}`}>
      <button
        ref={(n) => {
          btnRef.current = n;
          anchorRef.current = n;
        }}
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        className="nb-control-trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className={current ? "nb-value" : "nb-placeholder"}>
          {current ? current.label : (typeof value === "string" && value) || placeholder || "—"}
        </span>
        <span aria-hidden className="nb-caret" />
      </button>
      {open && (
        <PopoverLayer>
          <div
            ref={panelRef}
            className={`nb-popover nb-popover-${placement}`}
            style={{ ...style, fontSize: btnRef.current ? getComputedStyle(btnRef.current).fontSize : undefined }}
            id={listId}
          >
            <input
              ref={inputRef}
              className="nb-combo-filter"
              value={query}
              placeholder={placeholder}
              aria-label={ariaLabel}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
            <div role="listbox" aria-label={ariaLabel}>
              {shown.map((o, i) => (
                <div
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={o.value === value}
                  className={`nb-option${i === active ? " is-active" : ""}${o.disabled ? " is-disabled" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => !o.disabled && commit(o.value)}
                >
                  {o.label}
                </div>
              ))}
              {shown.length === 0 && <div className="nb-option is-disabled">{tCore("No matches")}</div>}
            </div>
          </div>
        </PopoverLayer>
      )}
    </span>
  );
}
