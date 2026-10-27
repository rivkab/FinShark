import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import "./List.css";

export function List({ divided, children }: { divided?: boolean | undefined; children: ReactNode }) {
  return <ul className={cx("ds-list", divided && "ds-list--divided")}>{children}</ul>;
}

export interface ListItemProps {
  current?: boolean | undefined;
  /** Makes the whole item a button. */
  onClick?: (() => void) | undefined;
  title?: string | undefined;
  /** Shown after the item, outside its button (links such as "History"). */
  aside?: ReactNode | undefined;
  children: ReactNode;
}

export function ListItem({ current, onClick, title, aside, children }: ListItemProps) {
  return (
    <li className={cx("ds-list__item", current && "ds-list__item--current")} title={title}>
      {onClick ? (
        <button type="button" className="ds-list__button" onClick={() => onClick()}>
          {children}
        </button>
      ) : (
        <div className="ds-list__content">{children}</div>
      )}
      {aside && <div className="ds-list__aside">{aside}</div>}
    </li>
  );
}
