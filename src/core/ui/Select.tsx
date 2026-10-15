import { useEffect, useId, useRef, useState } from "react";
import { usePopover, PopoverLayer } from "./anchorPopover.ts";
import { nextOptionIndex, truncateOptions } from "./logic.ts";
import "./core-ui.css";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown on the trigger when `value` is `""`. Rendered as text. */
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  /** Merged onto the outer `<span>` — lets a call site keep its width rules. */
  className?: string;
}

/**
 * Themed drop-in for a native `<select>`. Button + portalled listbox,
 * keyboard-navigable, anchored to the button. Emits the chosen option value
 * only — never an event. `label`/`placeholder` are text nodes; there is no
 * markup form.
 */
export function Select({
  value, onChange, options, placeholder = "—", disabled, ariaLabel, id, className,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const capped = truncateOptions(options);
  const current = capped.find((o) => o.value === value);
  const listId = useId();
  const { anchorRef, panelRef, style, placement } = usePopover(open);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [active, setActive] = useState(() => {
    const i = capped.findIndex((o) => o.value === value);
    return i >= 0 ? i : 0;
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, panelRef]);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => nextOptionIndex(capped, i, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => nextOptionIndex(capped, i, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(nextOptionIndex(capped, capped.length - 1, 1));
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(nextOptionIndex(capped, 0, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const o = capped[active];
      if (o && !o.disabled) commit(o.value);
    } else if (e.key.length === 1) {
      const hit = capped.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <span className={`nb-control nb-select${className ? ` ${className}` : ""}`}>
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
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={disabled}
        className="nb-control-trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span className={current ? "nb-value" : "nb-placeholder"}>
          {current ? current.label : placeholder}
        </span>
        <span aria-hidden className="nb-caret" />
      </button>
      {open && (
        <PopoverLayer>
          <div
            ref={panelRef}
            className={`nb-popover nb-popover-${placement}`}
            // The layer is portalled to <body>, so it inherited 16px while the
            // control is 13px: the list looked like another app (CS38).
            style={{ ...style, fontSize: btnRef.current ? getComputedStyle(btnRef.current).fontSize : undefined }}
            role="listbox"
            id={listId}
            aria-label={ariaLabel}
            onMouseDown={(e) => e.preventDefault()}
          >
            {capped.map((o, i) => (
              <div
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                className={`nb-option${i === active ? " is-active" : ""}${o.disabled ? " is-disabled" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => !o.disabled && commit(o.value)}
              >
                {o.label}
              </div>
            ))}
          </div>
        </PopoverLayer>
      )}
    </span>
  );
}
