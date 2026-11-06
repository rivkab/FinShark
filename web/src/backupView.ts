import type { BackupFileDto } from "@finshark/shared";

/** "4.2 MB": sizes are for reading, not arithmetic. */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** "5 Nov 2026, 14:03" in local time, from an ISO timestamp. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

export type BackupCheck = { tone: "success" | "danger" | "warning" | "muted"; label: string };

/** How far a backup has been checked. Unverified without the key is expected, not an alarm (D20). */
export function backupCheck(f: Pick<BackupFileDto, "verifyOk">, keyOnThisMac: boolean): BackupCheck {
  if (f.verifyOk === true) return { tone: "success", label: "Verified" };
  if (f.verifyOk === false) return { tone: "danger", label: "Failed verification" };
  return keyOnThisMac ? { tone: "warning", label: "Not yet verified" } : { tone: "muted", label: "Not verified on this Mac" };
}
