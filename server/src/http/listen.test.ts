import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { listenLoopback, LOOPBACK, pickFreePort } from "./listen.ts";

describe("loopback-only binding", () => {
  it("listens on 127.0.0.1 and nothing else", async () => {
    const port = await pickFreePort();
    const app = buildApp({ port, token: "t", now: () => 0 });
    await listenLoopback(app, port);
    try {
      const addr = app.server.address();
      expect(addr).toMatchObject({ address: "127.0.0.1", family: "IPv4", port });
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(401); // reachable, but gated
      expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    } finally {
      await app.close();
    }
    expect(LOOPBACK).toBe("127.0.0.1");
  });

  it("no source file in server/src binds a wildcard address", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = [...readdirSync(here), "../main.ts"].filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = readFileSync(path.join(here, f), "utf8");
      expect(src, f).not.toMatch(/0\.0\.0\.0|host:\s*["']::|listen\(\s*\d+\s*\)/);
    }
  });
});
