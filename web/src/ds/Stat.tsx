import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { Inline } from "./Stack.tsx";
import "./Stat.css";

export function StatGroup({ children }: { children: ReactNode }) {
  return <Inline gap={8} align="start">{children}</Inline>;
}

export interface StatProps {
  label: string;
  value: ReactNode;
  note?: ReactNode | undefined;
  tone?: "default" | "warning" | undefined;
  /** Makes the whole stat a link. */
  href?: string | undefined;
}

export function Stat({ label, value, note, tone = "default", href }: StatProps) {
  const className = cx("ds-stat", tone === "warning" && "ds-stat--warning", href && "ds-stat--link");
  const body = (
    <>
      <span className="ds-stat__label">{label}</span>
      <span className="ds-stat__value">{value}</span>
      {note && <span className="ds-stat__note">{note}</span>}
    </>
  );
  return href ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}
