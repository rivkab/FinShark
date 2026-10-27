import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { niceTicks, scaleX, scaleY, timeTicks } from "./chartScale.ts";
import "./TimeSeriesChart.css";

export interface ChartPoint {
  key: string;
  /** YYYY-MM-DD */
  date: string;
  minor: bigint;
  /** Formatted amount, e.g. "₪48,210.55". */
  label: string;
  /** Extra tooltip lines (date, source...). */
  detail?: ReactNode | undefined;
  /** warning = conflict, drawn as a diamond. */
  tone?: "default" | "warning" | undefined;
  /** Clicking or pressing Enter navigates here. */
  href?: string | undefined;
}

export interface TimeSeriesChartProps {
  "aria-label": string;
  points: ChartPoint[];
  /** A line between the (single) points at these two dates. */
  segments: { from: string; to: string }[];
  /** A hatched "no statement" band between these dates. */
  gaps: { from: string; to: string }[];
  /** Y axis labels. */
  formatTick: (minor: bigint) => string;
  /** X domain; defaults to the first and last point. */
  start?: string | null | undefined;
  end?: string | null | undefined;
  /** Draw a vertical "closed" marker at the end. */
  endMarker?: boolean | undefined;
}

const HEIGHT = 260;
const FALLBACK_WIDTH = 640;
const MARGIN = { left: 76, right: 20, top: 14, bottom: 30 };
const GAP_LABEL_MIN_PX = 96;

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function go(href: string) {
  if (href.startsWith("#")) window.location.hash = href;
  else window.location.href = href;
}

export function TimeSeriesChart({ "aria-label": ariaLabel, points, segments, gaps, formatTick, start, end, endMarker }: TimeSeriesChartProps) {
  const [wrapRef, width] = useWidth();
  const patternId = `ds-chart-hatch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const pointEls = useRef(new Map<string, SVGGElement>());
  const [active, setActive] = useState<string | null>(null);
  if (points.length === 0) return null;

  const ordered = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
  const dates = [ordered[0]!.date, ordered.at(-1)!.date, ...(start ? [start] : []), ...(end ? [end] : [])];
  const d0 = dates.reduce((a, b) => (b < a ? b : a));
  const d1 = dates.reduce((a, b) => (b > a ? b : a));

  const plotW = Math.max(40, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const minor = ordered.map((p) => p.minor);
  const ticks = niceTicks(minor.reduce((a, b) => (b < a ? b : a)), minor.reduce((a, b) => (b > a ? b : a)));
  const lo = ticks[0]!;
  const hi = ticks.at(-1)!;
  const x = (date: string) => MARGIN.left + scaleX(date, d0, d1, plotW);
  const y = (v: bigint) => MARGIN.top + scaleY(v, lo, hi, plotH);
  const byDate = new Map<string, ChartPoint>();
  for (const p of ordered) if (!byDate.has(p.date)) byDate.set(p.date, p);

  const activePoint = ordered.find((p) => p.key === active) ?? null;

  const move = (index: number, delta: number) => {
    const next = ordered[index + delta];
    if (next) pointEls.current.get(next.key)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent, p: ChartPoint, index: number) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      move(index, 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      move(index, -1);
    } else if (e.key === "Enter" && p.href) {
      e.preventDefault();
      go(p.href);
    }
  };

  return (
    <div className="ds-chart" ref={wrapRef}>
      <svg className="ds-chart__svg" width={width} height={HEIGHT} role="group" aria-label={ariaLabel}>
        <defs>
          <pattern id={patternId} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line className="ds-chart__hatch" x1="0" y1="0" x2="0" y2="7" />
          </pattern>
        </defs>

        {gaps.map((g) => {
          const gx = x(g.from);
          const gw = x(g.to) - gx;
          return (
            <g key={`${g.from}:${g.to}`}>
              <rect x={gx} y={MARGIN.top} width={Math.max(0, gw)} height={plotH} fill={`url(#${patternId})`} />
              {gw >= GAP_LABEL_MIN_PX && (
                <text className="ds-chart__gap-label" x={gx + gw / 2} y={MARGIN.top + 14} textAnchor="middle">
                  no statement
                </text>
              )}
            </g>
          );
        })}

        {ticks.map((t) => (
          <g key={String(t)}>
            <line className={t === 0n ? "ds-chart__zero" : "ds-chart__grid"} x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(t)} y2={y(t)} />
            <text className="ds-chart__tick" x={MARGIN.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
              {formatTick(t)}
            </text>
          </g>
        ))}

        {timeTicks(d0, d1).map((t) => (
          <g key={t.date}>
            <line className="ds-chart__grid" x1={x(t.date)} x2={x(t.date)} y1={MARGIN.top + plotH} y2={MARGIN.top + plotH + 4} />
            <text className="ds-chart__tick" x={x(t.date)} y={MARGIN.top + plotH + 18} textAnchor="middle">
              {t.label}
            </text>
          </g>
        ))}

        {endMarker && (
          <g>
            <line className="ds-chart__end" x1={x(d1)} x2={x(d1)} y1={MARGIN.top} y2={MARGIN.top + plotH} />
            <text className="ds-chart__gap-label" x={x(d1) - 6} y={MARGIN.top + 12} textAnchor="end">
              closed
            </text>
          </g>
        )}

        {segments.map((s) => {
          const a = byDate.get(s.from);
          const b = byDate.get(s.to);
          if (!a || !b) return null;
          return <line key={`${s.from}:${s.to}`} className="ds-chart__line" x1={x(a.date)} y1={y(a.minor)} x2={x(b.date)} y2={y(b.minor)} />;
        })}

        {ordered.map((p, i) => {
          const cx = x(p.date);
          const cy = y(p.minor);
          const warn = p.tone === "warning";
          return (
            <g
              key={p.key}
              ref={(el) => {
                if (el) pointEls.current.set(p.key, el);
                else pointEls.current.delete(p.key);
              }}
              className={`ds-chart__point${warn ? " ds-chart__point--warning" : ""}${p.href ? " ds-chart__point--link" : ""}`}
              tabIndex={0}
              role={p.href ? "link" : "img"}
              aria-label={`${p.label}, ${p.date}${warn ? ", conflicting value" : ""}`}
              onMouseEnter={() => setActive(p.key)}
              onMouseLeave={() => setActive((a) => (a === p.key ? null : a))}
              onFocus={() => setActive(p.key)}
              onBlur={() => setActive((a) => (a === p.key ? null : a))}
              onClick={() => p.href && go(p.href)}
              onKeyDown={(e) => onKeyDown(e, p, i)}
            >
              <circle className="ds-chart__hit" cx={cx} cy={cy} r={12} />
              <circle className="ds-chart__ring" cx={cx} cy={cy} r={9} />
              {warn ? (
                <path className="ds-chart__dot" d={`M${cx} ${cy - 6}L${cx + 6} ${cy}L${cx} ${cy + 6}L${cx - 6} ${cy}Z`} />
              ) : (
                <circle className="ds-chart__dot" cx={cx} cy={cy} r={4} />
              )}
            </g>
          );
        })}
      </svg>

      {activePoint && (
        <div
          className={`ds-chart__tooltip${x(activePoint.date) > width / 2 ? " ds-chart__tooltip--left" : ""}`}
          style={{ left: x(activePoint.date), top: y(activePoint.minor) }}
          role="presentation"
        >
          <span className="ds-chart__tooltip-label">{activePoint.label}</span>
          {activePoint.detail && <span className="ds-chart__tooltip-detail">{activePoint.detail}</span>}
        </div>
      )}
    </div>
  );
}
