import type { ReactNode } from "react";
import "./core-ui.css";

export interface FieldRowProps {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}

/** The flat "Properties panel" row: label above, control, optional hint. */
export function FieldRow({ label, hint, htmlFor, children }: FieldRowProps) {
  return (
    <label className="nb-field-row" htmlFor={htmlFor}>
      <span className="nb-field-label">{label}</span>
      {children}
      {hint && <span className="nb-field-hint">{hint}</span>}
    </label>
  );
}
