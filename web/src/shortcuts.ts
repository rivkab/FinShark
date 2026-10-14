// Keyboard shortcuts for the review page. Must never fire while the user is typing.

export interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

export function isTypingTarget(t: KeyTarget | null | undefined): boolean {
  if (!t) return false;
  const tag = (t.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable === true;
}

export type ReviewAction = "verify" | "correct" | "reject" | "next" | "prev";

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: KeyTarget | null;
}

export function reviewShortcut(e: KeyLike): ReviewAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTypingTarget(e.target)) return null;
  switch (e.key) {
    case "v": case "V": return "verify";
    case "c": case "C": return "correct";
    case "r": case "R": return "reject";
    case "ArrowRight": case "j": case "J": return "next";
    case "ArrowLeft": case "k": case "K": return "prev";
    default: return null;
  }
}
