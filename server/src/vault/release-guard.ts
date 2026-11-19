// Real vaults are only opened by released code (DESIGN D22).
//
// Opening a vault migrates it, and an applied migration is never undone. If code from a
// development branch opened the real vault, the branch's unreleased migrations would be
// applied to it, and the vault could end up with a schema no released FinShark matches.
// So a vault that is not marked as a development vault (vault.json "dev": true) is only
// opened when the code is released: a git checkout whose HEAD is on `main` and whose
// working tree is clean, or a copy that is not a git checkout at all.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const RELEASE_BRANCH = "main";
export const ALLOW_UNRELEASED_ENV = "FINSHARK_ALLOW_UNRELEASED";

export type CodeState =
  | { kind: "released"; detail: string }
  | { kind: "unreleased"; reasons: string[] }
  | { kind: "unknown"; reason: string };

export interface GitResult {
  /** Exit status; 0 is success. */
  status: number;
  stdout: string;
}

export type RunGit = (args: readonly string[]) => GitResult;

/** Run git in `repoRoot` (local only: these commands never touch a remote). */
export function gitIn(repoRoot: string): RunGit {
  return (args) => {
    try {
      const stdout = execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return { status: 0, stdout };
    } catch (e) {
      const err = e as { status?: number | null; stdout?: string };
      return { status: typeof err.status === "number" ? err.status : -1, stdout: err.stdout ?? "" };
    }
  };
}

/** Whether the code in `repoRoot` is released. `git` is injected so this is testable. */
export function readCodeState(repoRoot: string, git: RunGit = gitIn(repoRoot)): CodeState {
  if (!existsSync(path.join(repoRoot, ".git"))) return { kind: "released", detail: "not a git checkout" };

  const head = git(["rev-parse", "--verify", "HEAD"]);
  if (head.status !== 0) return { kind: "unknown", reason: "git could not read the current commit" };
  const main = git(["rev-parse", "--verify", "--quiet", `refs/heads/${RELEASE_BRANCH}`]);
  if (main.status !== 0) return { kind: "unknown", reason: `there is no "${RELEASE_BRANCH}" branch` };

  const reasons: string[] = [];
  const onMain = git(["merge-base", "--is-ancestor", "HEAD", RELEASE_BRANCH]);
  if (onMain.status === 1) {
    const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const name = branch.status === 0 ? `branch "${branch.stdout.trim()}"` : "the current commit";
    reasons.push(`${name} has commits that are not on ${RELEASE_BRANCH}`);
  } else if (onMain.status !== 0) {
    return { kind: "unknown", reason: `git could not compare the current commit with ${RELEASE_BRANCH}` };
  }

  // Untracked files count too: a new migration is untracked until it is committed.
  // Ignored files (dev-vault/, node_modules/, web/dist/) do not.
  const status = git(["status", "--porcelain"]);
  if (status.status !== 0) return { kind: "unknown", reason: "git could not read the working tree" };
  if (status.stdout.trim() !== "") reasons.push("the working tree has uncommitted changes");

  if (reasons.length > 0) return { kind: "unreleased", reasons };
  return { kind: "released", detail: `on ${RELEASE_BRANCH} at ${head.stdout.trim().slice(0, 12)}` };
}

export interface VaultAccessInput {
  vaultRoot: string;
  /** True for a development vault (vault.json "dev": true). */
  isDevVault: boolean;
  /** Whether the vault exists yet. A new real vault is refused too: creating it migrates it. */
  exists: boolean;
  code: CodeState;
  /** FINSHARK_ALLOW_UNRELEASED=1 */
  override: boolean;
}

/** Null when the vault may be opened (or created); otherwise the message explaining why not. */
export function checkVaultAccess(i: VaultAccessInput): string | null {
  if (i.isDevVault || i.override || i.code.kind === "released") return null;
  const why = i.code.kind === "unreleased" ? i.code.reasons.join(", and ") : `its release state is unknown (${i.code.reason})`;
  const what = i.exists ? `${i.vaultRoot} is not a development vault` : `${i.vaultRoot} would be a new real vault`;
  return [
    `${what}, and this FinShark is unreleased code: ${why}.`,
    "Opening a vault applies this code's migrations to it, and that cannot be undone.",
    "",
    "  - To work on real data, run the release checkout (see CLAUDE.md, \"Development and release\").",
    "  - To develop, use a development vault: leave FINSHARK_VAULT unset, or run `npm run seed-dev`.",
    `  - If you are sure, set ${ALLOW_UNRELEASED_ENV}=1 (back the vault up first).`,
  ].join("\n");
}
