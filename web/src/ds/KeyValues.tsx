import { Fragment, type ReactNode } from "react";
import "./KeyValues.css";

export type KeyValueItem = { label: string; value: ReactNode } | false | null;

export function KeyValues({ items }: { items: KeyValueItem[] }) {
  return (
    <dl className="ds-key-values">
      {items.map((item) =>
        item ? (
          <Fragment key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </Fragment>
        ) : null,
      )}
    </dl>
  );
}
