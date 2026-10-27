import type { ReactNode } from "react";
import type { Gap } from "./cx.ts";
import { Inline, Stack } from "./Stack.tsx";
import "./Form.css";

export function Form({ onSubmit, gap = 4, children }: { onSubmit: () => void; gap?: Gap | undefined; children: ReactNode }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Stack gap={gap}>{children}</Stack>
    </form>
  );
}

export interface FieldProps {
  label: string;
  hint?: ReactNode | undefined;
  error?: ReactNode | undefined;
  grow?: boolean | undefined;
  /** Exactly one control. */
  children: ReactNode;
}

export function Field({ label, hint, error, grow, children }: FieldProps) {
  return (
    <label className={grow ? "ds-field ds-field--grow" : "ds-field"}>
      <span className="ds-field__label">{label}</span>
      {children}
      {hint && <span className="ds-field__hint">{hint}</span>}
      {error && <span className="ds-field__error">{error}</span>}
    </label>
  );
}

/** A set of related checkboxes under one label. */
export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="ds-field-group">
      <legend className="ds-field__label">{label}</legend>
      <Inline gap={4}>{children}</Inline>
    </fieldset>
  );
}

/** Fields side by side, bottoms aligned; wraps on narrow screens. */
/** Fields side by side, labels aligned. `align="end"` lines a trailing button or link up with the controls. */
export function FieldRow({ align = "start", children }: { align?: "start" | "end" | undefined; children: ReactNode }) {
  return <Inline gap={3} align={align}>{children}</Inline>;
}
