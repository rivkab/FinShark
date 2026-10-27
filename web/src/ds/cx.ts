/** Joins class names, skipping falsy parts. Internal to the design system. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type Gap = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
