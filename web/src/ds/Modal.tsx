import type { ReactNode } from "react";
import "./Modal.css";

/** A dialog over a scrim; shown for as long as it is mounted. */
export function Modal({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ds-modal-scrim">
      <div className="ds-modal" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
