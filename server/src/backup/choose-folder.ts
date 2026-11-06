import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

// The standard macOS "Choose a folder" window, through the built-in osascript (DESIGN D20).
// A browser page can't learn a folder's full path, so the server asks macOS instead. This is
// safe only because the server runs on the person's own Mac and listens on 127.0.0.1 only.

/** Opens the window; resolves the chosen folder's path, or null if it was cancelled. */
export type ChooseFolder = (opts: { prompt: string; startIn: string | null }) => Promise<string | null>;

/** AppleScript's "User canceled." */
const CANCELLED = /-128/;

// The prompt and start folder are passed as arguments (argv), never pasted into the script.
const SCRIPT = [
  "on run argv",
  "  activate",
  "  set promptText to item 1 of argv",
  "  if (count of argv) > 1 then",
  "    return POSIX path of (choose folder with prompt promptText default location (POSIX file (item 2 of argv)))",
  "  end if",
  "  return POSIX path of (choose folder with prompt promptText)",
  "end run",
];

export const chooseFolderWithOsascript: ChooseFolder = ({ prompt, startIn }) =>
  new Promise((resolve, reject) => {
    const args = [...SCRIPT.flatMap((line) => ["-e", line]), prompt, ...(startIn ? [startIn] : [])];
    // Closes on its own after 10 minutes, so a forgotten window doesn't hold the request open.
    execFile("/usr/bin/osascript", args, { timeout: 10 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) {
        if (CANCELLED.test(stderr) || err.killed) resolve(null);
        else reject(new Error(`Could not open the folder chooser: ${stderr.trim() || err.message}`));
        return;
      }
      const chosen = stdout.trim();
      resolve(chosen === "" ? null : path.resolve(chosen));
    });
  });

/** iCloud Drive's folder. The chooser starts there when no second folder is set yet (if it exists). */
export function iCloudDrive(): string {
  return path.join(os.homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs");
}
