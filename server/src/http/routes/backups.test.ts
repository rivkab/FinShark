import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BackupSetupResponse, BackupStatusDto } from "@finshark/shared";
import { MemoryKeyStore } from "../../backup/keys.ts";
import { BackupService, CHANGE_DELAY_MS, type Timers } from "../../backup/service.ts";
import { makeRealVault, type RealTestVault } from "../../testing/test-vault.ts";
import { buildServer } from "../server.ts";

const PORT = 4556;
const TOKEN = "backup-route-token";
const HOST = `127.0.0.1:${PORT}`;

let v: RealTestVault;
let app: FastifyInstance;
let backups: BackupService;
let pending: { ms: number } | null;
let cookie: string;
let csrf: string;
let n = 0;

beforeEach(async () => {
  v = await makeRealVault();
  pending = null;
  const timers: Timers = { set: (_fn, ms) => (pending = { ms }), clear: () => (pending = null) };
  backups = new BackupService({
    db: v.vault.db,
    layout: v.vault.layout,
    vaultId: v.vault.info.vaultId,
    keyStore: new MemoryKeyStore(),
    now: v.now,
    appVersion: "0.0.0-test",
    timers,
    scryptWorkFactor: 8,
    log: () => {},
  });
  app = buildServer({ vault: v.vault, port: PORT, token: TOKEN, now: v.now, newId: () => `id${++n}`, randomId: () => `sess${++n}`, backups });
  const auth = await app.inject({ method: "GET", url: `/auth?token=${TOKEN}`, headers: { host: HOST } });
  cookie = String(auth.headers["set-cookie"]).split(";")[0]!;
  csrf = (await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST, cookie } })).json().csrfToken;
  const person = await call("POST", "/api/people", { displayName: "Dana" });
  await call("POST", "/api/session/person", { personId: String(person.json().id) });
});
afterEach(async () => {
  await backups.idle();
  await app.close();
  await v.cleanup();
});

function call(method: "GET" | "POST" | "PUT", url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: { host: HOST, cookie, "x-finshark-csrf": csrf, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

describe("backup routes", () => {
  it("set up, confirm, back up, verify", async () => {
    let s = (await call("GET", "/api/backups")).json() as BackupStatusDto;
    expect(s.warnings.map((w) => w.code)).toEqual(["not_set_up"]);

    expect((await call("POST", "/api/backups/setup", { passphrase: "short" })).statusCode).toBe(409);
    const setup = await call("POST", "/api/backups/setup", { passphrase: "a long enough passphrase" });
    expect(setup.statusCode).toBe(201);
    const { identity } = setup.json() as BackupSetupResponse;

    expect((await call("POST", "/api/backups/setup/confirm", { lastChars: "XXXXXX" })).json().error).toBe("wrong_characters");
    s = (await call("POST", "/api/backups/setup/confirm", { lastChars: identity.slice(-6) })).json() as BackupStatusDto;
    expect(s.setUp).toBe(true);
    await backups.idle(); // the first backup starts on confirm

    s = (await call("GET", "/api/backups")).json() as BackupStatusDto;
    expect(s.files).toHaveLength(1);
    expect(s.files[0]!.verifyOk).toBe(true);
    const verified = await call("POST", `/api/backups/${s.files[0]!.name}/verify`);
    expect(verified.json().verifyOk).toBe(true);
    expect((await call("POST", "/api/backups/FinShark-1999-01-01T00-00.ffbackup/verify")).statusCode).toBe(404);
    expect((await call("POST", "/api/backups/..%2Fvault.json/verify")).statusCode).toBe(404);
  });

  it("starts the 10-minute wait after a change to the vault, but not after a backup action", async () => {
    const { identity } = (await call("POST", "/api/backups/setup", { passphrase: "a long enough passphrase" })).json() as BackupSetupResponse;
    await call("POST", "/api/backups/setup/confirm", { lastChars: identity.slice(-6) });
    await backups.idle();
    expect(pending).toBeNull();
    expect((await call("POST", "/api/institutions", { name: "X", country: "US", kind: "financial" })).statusCode).toBe(201);
    expect(pending?.ms).toBe(CHANGE_DELAY_MS);
  });

  it("refuses a second folder that doesn't exist", async () => {
    const { identity } = (await call("POST", "/api/backups/setup", { passphrase: "a long enough passphrase" })).json() as BackupSetupResponse;
    await call("POST", "/api/backups/setup/confirm", { lastChars: identity.slice(-6) });
    const r = await call("PUT", "/api/backups/second-folder", { path: "/no/such/folder" });
    expect([r.statusCode, r.json().error]).toEqual([409, "bad_folder"]);
  });
});
