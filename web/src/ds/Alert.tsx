import type { ReactNode } from "react";
import "./Alert.css";

export interface AlertProps {
  tone: "danger" | "warning" | "success" | "info";
  children: ReactNode;
}

/** Renders nothing when there is no message, so `<Alert tone="danger">{error}</Alert>` is safe. */
export function Alert({ tone, children }: AlertProps) {
  if (children === null || children === undefined || children === false || children === "") return null;
  const role = tone === "danger" || tone === "warning" ? "alert" : undefined;
  return (
    <div className={`ds-alert ds-alert--${tone}`} role={role}>
      {children}
    </div>
  );
}
