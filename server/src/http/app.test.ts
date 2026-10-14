import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { CONTENT_SECURITY_POLICY } from "./security.ts";

const PORT = 4321;
const TOKEN = "launch-token-for-tests";
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;

let counter = 0;
const apps: FastifyInstance[] = [];
function make(extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const app = buildApp({ port: PORT, token: TOKEN, now: () => 1_000, randomId: () => `id${++counter}`, ...extra });
  apps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function login(app: FastifyInstance) {
  const res = await app.inject({ method: "GET", url: `/auth?token=${TOKEN}`, headers: { host: HOST } });
  const setCookie = String(res.headers["set-cookie"]);
  const cookie = setCookie.split(";")[0]!;
  const sess = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST, cookie } });
  return { cookie, csrf: sess.json().csrfToken as string, res };
}

function expectSecurityHeaders(res: { headers: Record<string, unknown> }) {
  expect(res.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
  expect(res.headers["referrer-policy"]).toBe("no-referrer");
  expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
  expect(Object.keys(res.headers).filter((h) => h.startsWith("access-control-"))).toEqual([]);
}

describe("Host header check", () => {
  it("accepts 127.0.0.1:port and localhost:port", async () => {
    const app = make();
    for (const host of [HOST, `localhost:${PORT}`]) {
      const res = await app.inject({ method: "GET", url: "/auth?token=wrong", headers: { host } });
      expect(res.statusCode).toBe(401); // got past the Host check
    }
  });
  it.each(["evil.example", `evil.example:${PORT}`, "127.0.0.1", `127.0.0.1:${PORT + 1}`, `localhost`, `127.0.0.1:${PORT}.evil.example`, `[::1]:${PORT}`, `LOCALHOST:${PORT}`, ""])(
    "rejects Host %j",
    async (host) => {
      const app = make();
      const { cookie } = await login(app);
      const res = await app.inject({ method: "GET", url: "/api/health", headers: { host, cookie } });
      expect(res.statusCode).toBe(421);
      expectSecurityHeaders(res);
    },
  );
  it("rejects even the valid auth link when Host is wrong", async () => {
    const res = await make().inject({ method: "GET", url: `/auth?token=${TOKEN}`, headers: { host: "evil.example" } });
    expect(res.statusCode).toBe(421);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});

describe("launch token and session cookie", () => {
  it("correct token sets a hardened cookie and redirects to /", async () => {
    const { res } = await login(make());
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
    const c = String(res.headers["set-cookie"]);
    expect(c).toMatch(/^fs_session=id\d+;/);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Path=/");
    expect(c).not.toContain("Secure");
    expectSecurityHeaders(res);
  });
  it.each([["missing", "/auth"], ["empty", "/auth?token="], ["wrong", "/auth?token=nope"], ["prefix", `/auth?token=${TOKEN.slice(0, -1)}`], ["longer", `/auth?token=${TOKEN}x`], ["array", "/auth?token=a&token=b"]])(
    "%s token is rejected without a cookie",
    async (_n, url) => {
      const res = await make().inject({ method: "GET", url, headers: { host: HOST } });
      expect(res.statusCode).toBe(401);
      expect(res.headers["set-cookie"]).toBeUndefined();
      expectSecurityHeaders(res);
    },
  );
  it("every other route requires the cookie", async () => {
    const app = make();
    for (const url of ["/", "/api/health", "/api/session", "/anything"]) {
      const res = await app.inject({ method: "GET", url, headers: { host: HOST } });
      expect(res.statusCode).toBe(401);
      expectSecurityHeaders(res);
    }
  });
  it("shows the launcher hint page to browsers", async () => {
    const res = await make().inject({ method: "GET", url: "/", headers: { host: HOST, accept: "text/html" } });
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain("open the link from the launcher");
    const pub = await make().inject({ method: "GET", url: "/launch-required", headers: { host: HOST } });
    expect(pub.statusCode).toBe(200);
  });
  it("a forged or unknown cookie is rejected", async () => {
    const res = await make().inject({ method: "GET", url: "/api/health", headers: { host: HOST, cookie: "fs_session=forged" } });
    expect(res.statusCode).toBe(401);
  });
  it("authenticated requests work and carry security headers", async () => {
    const app = make();
    const { cookie } = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/health", headers: { host: HOST, cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expectSecurityHeaders(res);
  });
  it("404 carries security headers", async () => {
    const app = make();
    const { cookie } = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/nope", headers: { host: HOST, cookie } });
    expect(res.statusCode).toBe(404);
    expectSecurityHeaders(res);
  });
});

describe("Origin and CSRF on mutations", () => {
  const post = (app: FastifyInstance, headers: Record<string, string>, payload: unknown = { personId: "p1" }) =>
    app.inject({ method: "POST", url: "/api/session/person", headers: { host: HOST, ...headers }, payload: payload as object });

  it("accepts a same-origin request with the CSRF header", async () => {
    const app = make();
    const { cookie, csrf } = await login(app);
    const res = await post(app, { cookie, origin: ORIGIN, "x-finshark-csrf": csrf });
    expect(res.statusCode).toBe(200);
    expectSecurityHeaders(res);
    const sess = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST, cookie } });
    expect(sess.json().personId).toBe("p1");
  });
  it("accepts an absent Origin (non-browser client) with CSRF", async () => {
    const app = make();
    const { cookie, csrf } = await login(app);
    expect((await post(app, { cookie, "x-finshark-csrf": csrf })).statusCode).toBe(200);
  });
  it("accepts localhost origin when the Host is localhost", async () => {
    const app = make();
    const { cookie, csrf } = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/session/person",
      headers: { host: `localhost:${PORT}`, cookie, origin: `http://localhost:${PORT}`, "x-finshark-csrf": csrf },
      payload: { personId: "p2" },
    });
    expect(res.statusCode).toBe(200);
  });
  it("rejects a missing CSRF header", async () => {
    const app = make();
    const { cookie } = await login(app);
    const res = await post(app, { cookie, origin: ORIGIN });
    expect(res.statusCode).toBe(403);
    expectSecurityHeaders(res);
  });
  it("rejects a wrong CSRF header", async () => {
    const app = make();
    const { cookie } = await login(app);
    expect((await post(app, { cookie, "x-finshark-csrf": "wrong" })).statusCode).toBe(403);
  });
  it("rejects another session's CSRF token", async () => {
    const app = make();
    const a = await login(app);
    const b = await login(app);
    expect((await post(app, { cookie: a.cookie, "x-finshark-csrf": b.csrf })).statusCode).toBe(403);
  });
  it.each(["http://evil.example", "null", `http://localhost:${PORT}`, `https://${HOST}`, `http://127.0.0.1:${PORT + 1}`])(
    "rejects foreign Origin %s even with a valid CSRF token",
    async (origin) => {
      const app = make();
      const { cookie, csrf } = await login(app);
      const res = await post(app, { cookie, origin, "x-finshark-csrf": csrf });
      expect(res.statusCode).toBe(403);
      expectSecurityHeaders(res);
    },
  );
  it("rejects mutations without a session before looking at anything else", async () => {
    expect((await post(make(), { origin: ORIGIN, "x-finshark-csrf": "x" })).statusCode).toBe(401);
  });
  it.each(["PUT", "PATCH", "DELETE"] as const)("%s also needs CSRF", async (method) => {
    const app = make();
    app.addHook("onReady", async () => {});
    const { cookie } = await login(app);
    const res = await app.inject({ method, url: "/api/anything", headers: { host: HOST, cookie } });
    expect(res.statusCode).toBe(403);
  });
  it("validates the person id", async () => {
    const app = make({ isValidPerson: (id) => id === "ok" });
    const { cookie, csrf } = await login(app);
    const h = { cookie, "x-finshark-csrf": csrf };
    expect((await post(app, h, { personId: "bad" })).statusCode).toBe(400);
    expect((await post(app, h, { personId: 5 })).statusCode).toBe(400);
    expect((await post(app, h, { personId: "ok" })).statusCode).toBe(200);
  });
  it("a foreign Origin is refused on GET too", async () => {
    const app = make();
    const { cookie } = await login(app);
    const res = await app.inject({ method: "GET", url: "/api/health", headers: { host: HOST, cookie, origin: "http://evil.example" } });
    expect(res.statusCode).toBe(403);
  });
});

describe("CORS", () => {
  it.each([{ origin: "http://evil.example", "access-control-request-method": "POST" }, {}])(
    "preflight %j is refused with 403 and no CORS headers",
    async (extra) => {
      const app = make();
      const { cookie } = await login(app);
      for (const headers of [{ host: HOST, ...extra }, { host: HOST, cookie, ...extra }]) {
        const res = await app.inject({ method: "OPTIONS", url: "/api/session/person", headers });
        expect(res.statusCode).toBe(403);
        expectSecurityHeaders(res);
      }
    },
  );
  it("never adds CORS headers to normal responses", async () => {
    const app = make();
    const { cookie, res } = await login(app);
    expectSecurityHeaders(res);
    const ok = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST, cookie, origin: ORIGIN } });
    expect(ok.statusCode).toBe(200);
    expectSecurityHeaders(ok);
  });
});

describe("static files (production mode)", () => {
  function setup() {
    const root = mkdtempSync(path.join(tmpdir(), "finshark-static-"));
    mkdirSync(path.join(root, "assets"));
    writeFileSync(path.join(root, "index.html"), "<!doctype html><title>x</title>");
    writeFileSync(path.join(root, "assets", "app.js"), "console.log(1)");
    writeFileSync(path.join(root, "..", path.basename(root) + "-secret.txt"), "secret");
    return { root, secretName: path.basename(root) + "-secret.txt" };
  }
  it("serves files with content types and SPA fallback, behind auth", async () => {
    const { root } = setup();
    const app = make({ staticDir: root });
    expect((await app.inject({ method: "GET", url: "/", headers: { host: HOST } })).statusCode).toBe(401);
    const { cookie } = await login(app);
    const h = { host: HOST, cookie };
    const idx = await app.inject({ method: "GET", url: "/", headers: h });
    expect(idx.statusCode).toBe(200);
    expect(idx.headers["content-type"]).toContain("text/html");
    const js = await app.inject({ method: "GET", url: "/assets/app.js", headers: h });
    expect(js.headers["content-type"]).toContain("text/javascript");
    expectSecurityHeaders(js);
    expect((await app.inject({ method: "GET", url: "/documents/12", headers: h })).body).toContain("<title>x</title>");
    expect((await app.inject({ method: "GET", url: "/missing.js", headers: h })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/unknown", headers: h })).statusCode).toBe(404);
  });
  it("blocks path traversal", async () => {
    const { root, secretName } = setup();
    const app = make({ staticDir: root });
    const { cookie } = await login(app);
    for (const url of [`/../${secretName}`, `/%2e%2e/${secretName}`, `/..%2f${secretName}`, `/assets/../../${secretName}`, "/%00", "/%zz"]) {
      const res = await app.inject({ method: "GET", url, headers: { host: HOST, cookie } });
      expect(res.body).not.toContain("secret");
    }
  });
});
