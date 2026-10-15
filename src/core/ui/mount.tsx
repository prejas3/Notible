import { createRoot } from "react-dom/client";
import { Select, type SelectOption } from "./Select.tsx";
import { DatePicker } from "./DatePicker.tsx";

/** Options for `context.ui.mountSelect` (Plugin API 1.11). */
export interface SelectMountOptions {
  value: string;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  onChange(value: string): void;
}

/** Options for `context.ui.mountDatePicker` (Plugin API 1.11). */
export interface DatePickerMountOptions {
  value: string;
  time?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
  ariaLabel?: string;
  onChange(value: string): void;
}

export interface MountedControl {
  dispose(): void;
}

/**
 * Render a themed `<Select>` into `el` and return a handle that removes it.
 * For third-party plugin surfaces, which mount into a raw `HTMLElement` and
 * have no React runtime of their own. `onChange` receives the option value
 * string only — never an event.
 */
export function mountSelect(el: HTMLElement, opts: SelectMountOptions): MountedControl {
  const root = createRoot(el);
  let value = opts.value;
  const render = () =>
    root.render(
      <Select
        value={value}
        options={opts.options}
        placeholder={opts.placeholder}
        disabled={opts.disabled}
        ariaLabel={opts.ariaLabel}
        onChange={(next) => {
          value = next;
          opts.onChange(next);
          render();
        }}
      />,
    );
  render();
  return { dispose: () => root.unmount() };
}

/** Render a themed `<DatePicker>` into `el`. See `mountSelect`. Emits ISO. */
export function mountDatePicker(el: HTMLElement, opts: DatePickerMountOptions): MountedControl {
  const root = createRoot(el);
  let value = opts.value;
  const render = () =>
    root.render(
      <DatePicker
        value={value}
        time={opts.time}
        min={opts.min}
        max={opts.max}
        disabled={opts.disabled}
        ariaLabel={opts.ariaLabel}
        onChange={(next) => {
          value = next;
          opts.onChange(next);
          render();
        }}
      />,
    );
  render();
  return { dispose: () => root.unmount() };
}
