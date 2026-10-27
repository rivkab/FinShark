import type { ReactNode } from "react";
import { cx, type Gap } from "./cx.ts";
import "./Stack.css";

export interface StackProps {
  gap?: Gap | undefined;
  align?: "start" | "center" | "end" | "stretch" | undefined;
  children: ReactNode;
}

export function Stack({ gap = 3, align, children }: StackProps) {
  return <div className={cx("ds-stack", `ds-stack--gap-${gap}`, align && `ds-stack--${align}`)}>{children}</div>;
}

export interface InlineProps {
  gap?: Gap | undefined;
  align?: "start" | "center" | "end" | "baseline" | undefined;
  justify?: "start" | "between" | "end" | undefined;
  wrap?: boolean | undefined;
  children: ReactNode;
}

export function Inline({ gap = 2, align, justify, wrap = true, children }: InlineProps) {
  return (
    <div className={cx("ds-inline", `ds-inline--gap-${gap}`, align && `ds-inline--align-${align}`, justify && `ds-inline--justify-${justify}`, !wrap && "ds-inline--nowrap")}>
      {children}
    </div>
  );
}
