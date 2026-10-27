import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { Badge } from "./Badge.tsx";
import { Button } from "./Button.tsx";
import { DataText } from "./DataText.tsx";
import "./Shell.css";

export interface AppShellProps {
  header: ReactNode;
  footer?: ReactNode | undefined;
  children: ReactNode;
}

export function AppShell({ header, footer, children }: AppShellProps) {
  return (
    <div className="ds-app-shell">
      {header}
      <div className="ds-app-shell__content">{children}</div>
      {footer && <footer className="ds-app-shell__footer"><div className="ds-app-shell__footer-inner">{footer}</div></footer>}
    </div>
  );
}

export function AppHeader({ brand, nav, user }: { brand: ReactNode; nav: ReactNode; user: ReactNode }) {
  return (
    <header className="ds-app-header">
      <div className="ds-app-header__inner">
        {brand}
        {nav}
        {user}
      </div>
    </header>
  );
}

export function Brand() {
  return (
    <span className="ds-brand">
      <span className="ds-brand__name">FinShark</span>
      <span className="ds-brand__eyebrow">Household archive</span>
    </span>
  );
}

export interface NavItem {
  label: string;
  href: string;
  active: boolean;
  count?: number | undefined;
}

export function NavTabs({ items }: { items: NavItem[] }) {
  return (
    <nav className="ds-nav-tabs" aria-label="Main">
      {items.map((item) => (
        <a key={item.href} href={item.href} className={cx("ds-nav-tabs__tab", item.active && "ds-nav-tabs__tab--active")} aria-current={item.active ? "page" : undefined}>
          {item.label}
          {item.count !== undefined && item.count > 0 && <Badge tone="warning" count>{item.count}</Badge>}
        </a>
      ))}
    </nav>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase();
  return (
    <span className="ds-avatar" aria-hidden="true">
      {initials}
    </span>
  );
}

export function UserChip({ name, onSwitch }: { name: string; onSwitch: () => void }) {
  return (
    <span className="ds-user-chip">
      <Avatar name={name} />
      <DataText>{name}</DataText>
      <Button variant="secondary" size="sm" onClick={onSwitch}>Switch</Button>
    </span>
  );
}
