import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import type { Tone } from "./Text.tsx";
import "./DataText.css";

/**
 * Mixed-direction convention (DESIGN §14 D3, D14): the page is LTR and left-aligned;
 * Hebrew appears only in data. Each data string is isolated so it reads in its own
 * direction without moving or reordering its neighbours.
 */
export function DataText({ block = false, children }: { block?: boolean | undefined; children: ReactNode }) {
  return block ? (
    <div dir="auto" className="ds-data-text ds-data-text--block">{children}</div>
  ) : (
    <bdi dir="auto">{children}</bdi>
  );
}

/**
 * An amount, date or identifier: isolated from the surrounding text direction.
 * Without `size` it follows the surrounding text, slightly smaller (mono runs large).
 */
export function Value({ size, tone, children }: { size?: "sm" | "md" | "lg" | undefined; tone?: Tone | undefined; children: ReactNode }) {
  return <bdi className={cx("ds-value", size && `ds-value--${size}`, tone && tone !== "default" && `ds-value--${tone}`)}>{children}</bdi>;
}
