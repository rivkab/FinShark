// Pure scale helpers for TimeSeriesChart. Money is bigint minor units throughout; only the
// final, small pixel coordinate becomes a Number.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return -floorDiv(-a, b);
}

/** Smallest 1/2/5 x 10^k that is >= n (n >= 1). */
function niceStep(n: bigint): bigint {
  let pow = 1n;
  for (;;) {
    for (const m of [1n, 2n, 5n]) if (m * pow >= n) return m * pow;
    pow *= 10n;
  }
}

/**
 * Round tick values covering [min, max], always including zero (the y axis never hides
 * the baseline). Ascending; first <= min(min, 0), last >= max(max, 0).
 */
export function niceTicks(min: bigint, max: bigint, target = 5): bigint[] {
  const lo = min < 0n ? min : 0n;
  const hi = max > 0n ? max : 0n;
  if (lo === hi) return [0n, 100n];
  const intervals = BigInt(Math.max(1, target - 1));
  const step = niceStep(ceilDiv(hi - lo, intervals));
  const first = floorDiv(lo, step) * step;
  const last = ceilDiv(hi, step) * step;
  const ticks: bigint[] = [];
  for (let t = first; t <= last; t += step) ticks.push(t);
  return ticks;
}

/** Pixel offset from the top for value v on an axis running hi (top) to lo (bottom). */
export function scaleY(v: bigint, lo: bigint, hi: bigint, heightPx: number): number {
  if (hi === lo) return heightPx / 2;
  const scale = BigInt(Math.round(heightPx * 100));
  const hundredths = ((hi - v) * scale) / (hi - lo);
  return Number(hundredths) / 100;
}

/** Days since 1970-01-01 for "YYYY-MM-DD". */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function scaleX(date: string, startDate: string, endDate: string, widthPx: number): number {
  const a = dayNumber(startDate);
  const b = dayNumber(endDate);
  if (a === b) return widthPx / 2;
  return ((dayNumber(date) - a) / (b - a)) * widthPx;
}

function iso(y: number, m: number): string {
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Date ticks on the first of a month (spans under about two years) or of a year. */
export function timeTicks(start: string, end: string): { date: string; label: string }[] {
  const a = dayNumber(start);
  const b = dayNumber(end);
  const [sy, sm] = start.split("-").map(Number) as [number, number];
  const [ey, em] = end.split("-").map(Number) as [number, number];
  const out: { date: string; label: string }[] = [];
  if (b - a < 730) {
    const months = (ey - sy) * 12 + (em - sm) + 1;
    const step = [1, 2, 3, 6].find((s) => months / s <= 8) ?? 6;
    for (let i = 0; i <= months; i++) {
      const y = sy + Math.floor((sm - 1 + i) / 12);
      const m = (sm - 1 + i) % 12;
      const date = iso(y, m);
      if (date < start || date > end) continue;
      if (m % step !== 0 && step > 1) continue;
      out.push({ date, label: `${MONTHS[m]} ${y}` });
    }
  } else {
    const years = ey - sy + 1;
    const step = Math.max(1, Math.ceil(years / 8));
    for (let y = sy; y <= ey + 1; y++) {
      const date = iso(y, 0);
      if (date < start || date > end || y % step !== 0) continue;
      out.push({ date, label: String(y) });
    }
  }
  return out;
}
