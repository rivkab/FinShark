import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import "./Text.css";

export type Tone = "default" | "muted" | "subtle" | "success" | "warning" | "danger";

export interface HeadingProps {
  level: 1 | 2 | 3 | 4;
  size?: "display" | "section" | "subsection" | "label" | undefined;
  children: ReactNode;
}

const DEFAULT_SIZE = { 1: "display", 2: "section", 3: "subsection", 4: "label" } as const;

export function Heading({ level, size = DEFAULT_SIZE[level], children }: HeadingProps) {
  const className = cx("ds-heading", `ds-heading--${size}`);
  switch (level) {
    case 1: return <h1 className={className}>{children}</h1>;
    case 2: return <h2 className={className}>{children}</h2>;
    case 3: return <h3 className={className}>{children}</h3>;
    case 4: return <h4 className={className}>{children}</h4>;
  }
}

export interface TextProps {
  as?: "span" | "p" | "div" | undefined;
  size?: "xs" | "sm" | "md" | "lg" | undefined;
  tone?: Tone | undefined;
  weight?: "regular" | "medium" | "semibold" | undefined;
  mono?: boolean | undefined;
  eyebrow?: boolean | undefined;
  children: ReactNode;
}

/** Props left out inherit from the surrounding text. */
export function Text({ as = "span", size, tone, weight, mono, eyebrow, children }: TextProps) {
  const className = cx(
    "ds-text",
    size && `ds-text--${size}`,
    tone && tone !== "default" && `ds-text--${tone}`,
    weight && `ds-text--${weight}`,
    mono && "ds-text--mono",
    eyebrow && "ds-text--eyebrow",
  );
  switch (as) {
    case "span": return <span className={className}>{children}</span>;
    case "p": return <p className={className}>{children}</p>;
    case "div": return <div className={className}>{children}</div>;
  }
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ds-kbd">{children}</kbd>;
}
