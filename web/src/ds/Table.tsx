import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { Icon } from "./icons.tsx";
import "./Table.css";

export function Table({ children, "aria-label": ariaLabel }: { children: ReactNode; "aria-label"?: string | undefined }) {
  return (
    <div className="ds-table-wrap">
      <table className="ds-table" aria-label={ariaLabel}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

/** `muted` greys the whole row (rejected and replaced facts). */
export function Tr({ tone = "default", children }: { tone?: "default" | "muted" | undefined; children: ReactNode }) {
  return <tr className={tone === "muted" ? "ds-tr--muted" : undefined}>{children}</tr>;
}

export interface ThProps {
  align?: "start" | "end" | undefined;
  sort?: "asc" | "desc" | "none" | undefined;
  /** Makes the header a sort button. */
  onSort?: (() => void) | undefined;
  children?: ReactNode | undefined;
}

const ARIA_SORT = { asc: "ascending", desc: "descending", none: "none" } as const;
const SORT_ICON = { asc: "sortAsc", desc: "sortDesc", none: "sortNone" } as const;

export function Th({ align = "start", sort = "none", onSort, children }: ThProps) {
  return (
    <th scope="col" className={cx("ds-th", align === "end" && "ds-th--end")} aria-sort={onSort ? ARIA_SORT[sort] : undefined}>
      {onSort ? (
        <button type="button" className="ds-th__sort" onClick={() => onSort()}>
          {children}
          <Icon name={SORT_ICON[sort]} size={12} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function Td({ align = "start", colSpan, children }: { align?: "start" | "end" | undefined; colSpan?: number | undefined; children?: ReactNode | undefined }) {
  return (
    <td className={align === "end" ? "ds-td ds-td--end" : "ds-td"} colSpan={colSpan}>
      {children}
    </td>
  );
}
