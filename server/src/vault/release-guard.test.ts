import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkVaultAccess, readCodeState, type GitResult, type RunGit } from "./release-guard.ts";

/** A fake git answering by the first argument(s). */
function fakeGit(answers: Record<string, GitResult>): RunGit {
  return (args) => {
    const key = args[0] === "rev-parse" ? `rev-parse ${args.at(-1)}` : args[0]!;
    const a = answers[key];
    if (!a) throw new Error(`unexpected git ${args.join(" ")}`);
    return a;
  };
}

const ok = (stdout = ""): GitResult => ({ status: 0, stdout });
const RELEASED = {
  "rev-parse HEAD": ok("0123456789abcdef0123\n"),
  "rev-parse refs/heads/main": ok("0123456789abcdef0123\n"),
  "merge-base": ok(),
  status: ok(""),
  "symbolic-ref": ok("feature\n"),
};

describe("readCodeState", () => {
  let repo: string;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "finshark-guard-"));
    fs.writeFileSync(path.join(repo, ".git"), "gitdir: elsewhere\n"); // as in a worktree
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("treats a copy that is not a git checkout as released", () => {
    fs.rmSync(path.join(repo, ".git"));
    expect(readCodeState(repo, fakeGit({})).kind).toBe("released");
  });

  it("is released on main with a clean tree", () => {
    expect(readCodeState(repo, fakeGit(RELEASED))).toEqual({ kind: "released", detail: "on main at 0123456789ab" });
  });

  it("is unreleased with commits not on main", () => {
    const s = readCodeState(repo, fakeGit({ ...RELEASED, "merge-base": { status: 1, stdout: "" } }));
    expect(s).toEqual({ kind: "unreleased", reasons: ['branch "feature" has commits that are not on main'] });
  });

  it("is unreleased with uncommitted or untracked changes", () => {
    const s = readCodeState(repo, fakeGit({ ...RELEASED, status: ok("?? server/src/db/migrations/010_new.sql\n") }));
    expect(s).toEqual({ kind: "unreleased", reasons: ["the working tree has uncommitted changes"] });
  });

  it("is unknown without a main branch or when git fails", () => {
    expect(readCodeState(repo, fakeGit({ ...RELEASED, "rev-parse refs/heads/main": { status: 1, stdout: "" } })).kind).toBe("unknown");
    expect(readCodeState(repo, fakeGit({ ...RELEASED, "rev-parse HEAD": { status: -1, stdout: "" } })).kind).toBe("unknown");
    expect(readCodeState(repo, fakeGit({ ...RELEASED, "merge-base": { status: 128, stdout: "" } })).kind).toBe("unknown");
  });
});

describe("checkVaultAccess", () => {
  const unreleased = { kind: "unreleased" as const, reasons: ["the working tree has uncommitted changes"] };
  const base = { vaultRoot: "/v", isDevVault: false, exists: true, code: unreleased, override: false };

  it("refuses a real vault from unreleased code, saying why and what to do", () => {
    const msg = checkVaultAccess(base);
    expect(msg).toContain("/v is not a development vault");
    expect(msg).toContain("uncommitted changes");
    expect(msg).toContain("FINSHARK_ALLOW_UNRELEASED=1");
  });

  it("refuses to create a new real vault from unreleased code", () => {
    expect(checkVaultAccess({ ...base, exists: false })).toContain("would be a new real vault");
  });

  it("refuses when the release state is unknown", () => {
    expect(checkVaultAccess({ ...base, code: { kind: "unknown", reason: "no main" } })).toContain("unknown (no main)");
  });

  it("allows a development vault, released code, or the override", () => {
    expect(checkVaultAccess({ ...base, isDevVault: true })).toBeNull();
    expect(checkVaultAccess({ ...base, code: { kind: "released", detail: "x" } })).toBeNull();
    expect(checkVaultAccess({ ...base, override: true })).toBeNull();
  });
});
