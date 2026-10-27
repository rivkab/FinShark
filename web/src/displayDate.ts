// Short, locale-independent date text for headings and marks. Pure and unit-tested.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function parts(iso: string): { y: string; m: string; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const m = MONTHS[Number(match[2]) - 1];
  return m ? { y: match[1]!, m, d: Number(match[3]) } : null;
}

/** "2026-09-30" -> "30 Sep 2026"; anything that is not an ISO date comes back unchanged. */
export function formatDay(iso: string): string {
  const p = parts(iso);
  return p ? `${p.d} ${p.m} ${p.y}` : iso;
}

/** "2026-09-30" -> "30 Sep"; anything that is not an ISO date comes back unchanged. */
export function formatDayShort(iso: string): string {
  const p = parts(iso);
  return p ? `${p.d} ${p.m}` : iso;
}
