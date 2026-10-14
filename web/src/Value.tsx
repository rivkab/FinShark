import type { ReactNode } from "react";

/**
 * Mixed-direction convention (DESIGN §14 D3): the page is LTR English chrome; Hebrew
 * appears only in data. Data cells use dir="auto" so each renders in its own
 * direction, and amounts/dates/ids are wrapped in <bdi> so "₪42,318" and "12/31/2025"
 * are never reordered by surrounding Hebrew text.
 */
export function Cell({ children, numeric = false }: { children: ReactNode; numeric?: boolean }) {
  return (
    <td dir="auto" className={numeric ? "num" : undefined}>
      {children}
    </td>
  );
}

/** Inline data value (label text, name, document title). */
export function Text({ children }: { children: ReactNode }) {
  return <bdi dir="auto">{children}</bdi>;
}

/** An amount, date or identifier: isolated from the surrounding text direction. */
export function Value({ children }: { children: ReactNode }) {
  return <bdi className="value">{children}</bdi>;
}
