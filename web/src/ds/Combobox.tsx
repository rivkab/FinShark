import { useId, useState, type ReactNode } from "react";
import "./Combobox.css";

export interface ComboboxProps<T> {
  inputValue: string;
  onInputChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onPick: (item: T) => void;
  placeholder?: string | undefined;
  "aria-label": string;
  emptyText?: string | undefined;
}

export function Combobox<T>({
  inputValue,
  onInputChange,
  open,
  onOpenChange,
  items,
  getKey,
  renderItem,
  onPick,
  placeholder,
  "aria-label": ariaLabel,
  emptyText = "No match",
}: ComboboxProps<T>) {
  const [hi, setHi] = useState(0);
  const listId = useId();
  const active = Math.min(hi, Math.max(items.length - 1, 0));

  const pick = (item: T) => {
    onPick(item);
    onOpenChange(false);
  };

  return (
    <div className="ds-combobox">
      <input
        className="ds-control"
        type="text"
        dir="auto"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={inputValue}
        onFocus={() => {
          onOpenChange(true);
          setHi(0);
        }}
        onBlur={() => onOpenChange(false)}
        onChange={(e) => {
          onInputChange(e.target.value);
          onOpenChange(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi(Math.min(active + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi(Math.max(active - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            const item = items[active];
            if (item !== undefined) pick(item);
          } else if (e.key === "Escape") {
            onOpenChange(false);
          }
        }}
      />
      {open && (
        <ul id={listId} className="ds-combobox__list" role="listbox">
          {items.length === 0 && <li className="ds-combobox__empty">{emptyText}</li>}
          {items.map((item, i) => (
            <li
              key={getKey(item)}
              role="option"
              aria-selected={i === active}
              className={i === active ? "ds-combobox__item ds-combobox__item--active" : "ds-combobox__item"}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setHi(i)}
            >
              {renderItem(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
