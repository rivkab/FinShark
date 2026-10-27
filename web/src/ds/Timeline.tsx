import type { ReactNode } from "react";
import "./Timeline.css";

export function Timeline({ children }: { children: ReactNode }) {
  return <ol className="ds-timeline">{children}</ol>;
}

export function TimelineItem({ time, children }: { time: ReactNode; children: ReactNode }) {
  return (
    <li className="ds-timeline__item">
      <span className="ds-timeline__time">{time}</span>
      <div>{children}</div>
    </li>
  );
}
