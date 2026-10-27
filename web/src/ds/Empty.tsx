import type { ReactNode } from "react";
import "./Empty.css";

export function Empty({ children }: { children: ReactNode }) {
  return <p className="ds-empty">{children}</p>;
}

export function Loading({ label = "Loading..." }: { label?: string | undefined }) {
  return <p className="ds-empty" role="status">{label}</p>;
}
