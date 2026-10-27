import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { Icon, type IconName } from "./icons.tsx";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "md" | "sm";

export interface ButtonProps {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  type?: "button" | "submit" | undefined;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
  icon?: IconName | undefined;
  "aria-label"?: string | undefined;
  children?: ReactNode | undefined;
}

const buttonClass = (variant: ButtonVariant, size: ButtonSize) => cx("ds-button", `ds-button--${variant}`, `ds-button--${size}`);

export function Button({ variant = "secondary", size = "md", type = "button", busy, disabled, onClick, icon, children, "aria-label": ariaLabel }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
      onClick={onClick ? () => onClick() : undefined}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export interface LinkButtonProps {
  href: string;
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  children: ReactNode;
}

export function LinkButton({ href, variant = "secondary", size = "md", children }: LinkButtonProps) {
  return (
    <a href={href} className={buttonClass(variant, size)}>
      {children}
    </a>
  );
}

export interface LinkProps {
  href: string;
  tone?: "default" | "muted" | "warning" | undefined;
  children: ReactNode;
}

export function Link({ href, tone = "default", children }: LinkProps) {
  return (
    <a href={href} className={cx("ds-link", tone !== "default" && `ds-link--${tone}`)}>
      {children}
    </a>
  );
}

/** "Edit" in a table cell: sits at the cell's end and shows when the row is hovered or focused. */
export function RowAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <span className="ds-row-action">
      <Button variant="link" size="sm" onClick={onClick}>{children}</Button>
    </span>
  );
}
