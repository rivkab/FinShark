import type { ReactNode } from "react";

export type IconName =
  | "check"
  | "clock"
  | "cross"
  | "dash"
  | "arrowLeft"
  | "chevronDown"
  | "chevronRight"
  | "sortAsc"
  | "sortDesc"
  | "sortNone"
  | "upload";

const PATHS: Record<IconName, ReactNode> = {
  check: <path d="M3 8.5l3.2 3.2L13 4.5" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2 1.3" />
    </>
  ),
  cross: <path d="M4 4l8 8M12 4l-8 8" />,
  dash: <path d="M4 8h8" />,
  arrowLeft: <path d="M13 8H3M7 4L3 8l4 4" />,
  chevronDown: <path d="M4 6l4 4 4-4" />,
  chevronRight: <path d="M6 4l4 4-4 4" />,
  sortAsc: <path d="M8 12V4M5 7l3-3 3 3" />,
  sortDesc: <path d="M8 4v8M5 9l3 3 3-3" />,
  sortNone: <path d="M5 6.5l3-3 3 3M5 9.5l3 3 3-3" />,
  upload: <path d="M8 11V3M5 6l3-3 3 3M3 13h10" />,
};

/** Inline stroke icon: decorative (aria-hidden), takes its color from the text. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number | undefined }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ds-icon"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
