import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { Icon } from "./icons.tsx";
import "./Badge.css";

export interface BadgeProps {
  tone: "neutral" | "success" | "warning" | "danger" | "muted";
  count?: boolean | undefined;
  children: ReactNode;
}

export function Badge({ tone, count, children }: BadgeProps) {
  return <span className={cx("ds-badge", `ds-badge--${tone}`, count && "ds-badge--count")}>{children}</span>;
}

export interface StatusMarkProps {
  tone: "success" | "warning" | "danger" | "muted";
  icon: "check" | "clock" | "cross" | "dash";
  children: ReactNode;
}

/** The small status line under an amount: "✓ verified · 30 Sep". */
export function StatusMark({ tone, icon, children }: StatusMarkProps) {
  return (
    <span className={cx("ds-status-mark", `ds-status-mark--${tone}`)}>
      <Icon name={icon} size={12} />
      <span>{children}</span>
    </span>
  );
}
