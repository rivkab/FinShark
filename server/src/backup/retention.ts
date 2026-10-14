// Grandfather-father-son retention. Pure: decides, never deletes. DESIGN §8.2.

export interface BackupRef {
  name: string;
  createdAt: Date;
}

export interface RetentionPolicy {
  /** Keep the newest backup of each of the last N days (UTC, including today). */
  daily: number;
  /** ... of each of the last N ISO weeks (Monday start, UTC, including this week). */
  weekly: number;
  /** ... of each of the last N calendar months (UTC, including this month). */
  monthly: number;
}

const DAY_MS = 86_400_000;

function dayIndex(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}
// 1970-01-01 was a Thursday, so shifting by 3 makes weeks start on Monday.
function weekIndex(d: Date): number {
  return Math.floor((dayIndex(d) + 3) / 7);
}
function monthIndex(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * Names of backups that may be deleted. A backup is kept if it is the newest in
 * its day/week/month bucket and that bucket is inside the policy window.
 * Backups dated in the future are always kept (clock skew is not a reason to delete).
 */
export function selectBackupsToDelete(backups: BackupRef[], policy: RetentionPolicy, now: Date): string[] {
  const keep = new Set<string>();
  const rules: [(d: Date) => number, number][] = [
    [dayIndex, policy.daily],
    [weekIndex, policy.weekly],
    [monthIndex, policy.monthly],
  ];
  for (const [bucketOf, count] of rules) {
    const current = bucketOf(now);
    const newest = new Map<number, BackupRef>();
    for (const b of backups) {
      const bucket = bucketOf(b.createdAt);
      const best = newest.get(bucket);
      if (!best || b.createdAt.getTime() > best.createdAt.getTime()) newest.set(bucket, b);
    }
    for (const [bucket, b] of newest) {
      const age = current - bucket;
      if (age >= 0 && age < count) keep.add(b.name);
    }
  }
  return backups
    .filter((b) => b.createdAt.getTime() <= now.getTime() && !keep.has(b.name))
    .map((b) => b.name)
    .sort();
}
