import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./cx.ts";
import { Link } from "./Button.tsx";
import { Icon } from "./icons.tsx";
import { Heading, Text } from "./Text.tsx";
import "./Page.css";

export interface PageProps {
  /** May hold data (an account name): pass `<DataText>`. */
  eyebrow?: ReactNode | undefined;
  /** A document title is data: pass `<DataText>`. */
  title: ReactNode;
  back?: { href: string; label: string } | undefined;
  actions?: ReactNode | undefined;
  /** `narrow` for single-question screens (choosing who is using FinShark). */
  width?: "default" | "wide" | "narrow" | undefined;
  children?: ReactNode | undefined;
}

export function Page({ eyebrow, title, back, actions, width = "default", children }: PageProps) {
  return (
    <main className={cx("ds-page", width !== "default" && `ds-page--${width}`)}>
      <header className="ds-page__header">
        {back && (
          <div className="ds-page__back">
            <Link href={back.href} tone="muted">
              <Icon name="arrowLeft" /> {back.label}
            </Link>
          </div>
        )}
        <div className="ds-page__heading">
          <div className="ds-page__titles">
            {eyebrow && <Text as="div" eyebrow>{eyebrow}</Text>}
            <Heading level={1}>{title}</Heading>
          </div>
          {actions && <div className="ds-page__actions">{actions}</div>}
        </div>
      </header>
      <div className="ds-page__body">{children}</div>
    </main>
  );
}

export interface SectionProps {
  title: string;
  actions?: ReactNode | undefined;
  children: ReactNode;
}

export function Section({ title, actions, children }: SectionProps) {
  return (
    <section className="ds-section">
      <div className="ds-section__heading">
        <Heading level={2}>{title}</Heading>
        {actions}
      </div>
      {children}
    </section>
  );
}

export interface PanelProps {
  title?: string | undefined;
  actions?: ReactNode | undefined;
  /** Scrolls the panel into view whenever this changes (after the first render). */
  revealKey?: string | number | null | undefined;
  children: ReactNode;
}

export function Panel({ title, actions, revealKey, children }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Compare with the previous key rather than flagging the first run: StrictMode (the dev server) runs
  // effects twice on mount, which would scroll a panel below the fold into view on page load.
  const shown = useRef(revealKey);
  useEffect(() => {
    if (shown.current === revealKey) return;
    shown.current = revealKey;
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [revealKey]);
  return (
    <div className="ds-panel" ref={ref}>
      {(title || actions) && (
        <div className="ds-panel__heading">
          {title && <Heading level={3} size="label">{title}</Heading>}
          {actions}
        </div>
      )}
      <div className="ds-panel__body">{children}</div>
    </div>
  );
}

export interface DisclosureProps {
  summary: ReactNode;
  meta?: ReactNode | undefined;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}

export function Disclosure({ summary, meta, open, onToggle, children }: DisclosureProps) {
  return (
    <details className="ds-panel ds-disclosure" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary className="ds-disclosure__summary">
        <span className="ds-disclosure__chevron">
          <Icon name="chevronRight" />
        </span>
        <Text weight="semibold">{summary}</Text>
        {meta && <Text tone="muted" size="sm">{meta}</Text>}
      </summary>
      <div className="ds-disclosure__body">{children}</div>
    </details>
  );
}

/** Main content beside a sticky aside (the document and its facts). Stacks on narrow screens. */
export function SplitLayout({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="ds-split">
      <div className="ds-split__main">{main}</div>
      <div className="ds-split__aside">{aside}</div>
    </div>
  );
}
