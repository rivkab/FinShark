import { useId, type ReactNode } from "react";
import { cx } from "./cx.ts";
import { Icon } from "./icons.tsx";
import "./Input.css";

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Typing direction: "auto" follows the first strong character (Hebrew or English). */
  dir?: "auto" | "ltr" | undefined;
  type?: "text" | "search" | undefined;
  placeholder?: string | undefined;
  size?: "md" | "sm" | undefined;
  maxLength?: number | undefined;
  autoFocus?: boolean | undefined;
  /** Called on Enter instead of submitting an enclosing form. For a mini-form nested inside another form. */
  onEnter?: (() => void) | undefined;
  "aria-label"?: string | undefined;
  id?: string | undefined;
}

export function TextInput({ value, onChange, dir = "auto", type = "text", placeholder, size = "md", maxLength, autoFocus, onEnter, "aria-label": ariaLabel, id }: TextInputProps) {
  return (
    <input
      id={id}
      className={cx("ds-control", size === "sm" && "ds-control--sm")}
      type={type}
      dir={dir}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onEnter ? (e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter();
        }
      } : undefined}
    />
  );
}

export function DateInput({ value, onChange, "aria-label": ariaLabel }: { value: string; onChange: (value: string) => void; "aria-label"?: string | undefined }) {
  return <input className="ds-control" type="date" value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />;
}

export function TextArea({ value, onChange, rows = 3, "aria-label": ariaLabel }: { value: string; onChange: (value: string) => void; rows?: number | undefined; "aria-label"?: string | undefined }) {
  return <textarea className="ds-control ds-control--area" dir="auto" rows={rows} value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />;
}

export interface SelectOption {
  value: string;
  label: string;
  dir?: "auto" | undefined;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[] | undefined;
  groups?: SelectGroup[] | undefined;
  /** Label of a first option with value "". */
  placeholder?: string | undefined;
  "aria-label"?: string | undefined;
  id?: string | undefined;
}

const renderOption = (o: SelectOption) => (
  <option key={o.value} value={o.value} dir={o.dir}>
    {o.label}
  </option>
);

export function Select({ value, onChange, options, groups, placeholder, "aria-label": ariaLabel, id }: SelectProps) {
  return (
    <span className="ds-select">
      <select id={id} className="ds-control" value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map(renderOption)}
        {groups?.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map(renderOption)}
          </optgroup>
        ))}
      </select>
      <span className="ds-select__chevron">
        <Icon name="chevronDown" />
      </span>
    </span>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode }) {
  const id = useId();
  return (
    <span className="ds-checkbox">
      <input id={id} className="ds-checkbox__input" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </span>
  );
}
