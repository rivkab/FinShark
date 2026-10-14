import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { choosePort, isLoopbackPortFree, listenLoopback, pickFreePort } from "./listen.ts";

describe("choosePort", () => {
  const free = async () => true;
  const fallback = async () => 51234;

  it("uses a valid FINSHARK_PORT", async () => {
    expect(await choosePort({ envPort: "5000", preferred: 4780, isFree: free })).toEqual({ port: 5000 });
  });
  it("rejects invalid FINSHARK_PORT", async () => {
    for (const bad of ["abc", "0", "70000", "12.5", "-1"]) {
      await expect(choosePort({ envPort: bad, preferred: 4780, isFree: free })).rejects.toThrow(/Invalid FINSHARK_PORT/);
    }
  });
  it("errors if FINSHARK_PORT is taken, without falling back", async () => {
    await expect(choosePort({ envPort: "5000", preferred: 4780, isFree: async () => false, fallback })).rejects.toThrow(/already in use/);
  });
  it("uses the preferred port when free", async () => {
    expect(await choosePort({ envPort: undefined, preferred: 4780, isFree: free })).toEqual({ port: 4780 });
  });
  it("falls back with a note when the preferred port is taken", async () => {
    const r = await choosePort({ envPort: undefined, preferred: 4780, isFree: async (p) => p !== 4780, fallback });
    expect(r.port).toBe(51234);
    expect(r.note).toContain("Port 4780 is in use");
    expect(r.note).toContain("51234");
  });
  it("isLoopbackPortFree sees a listening port as taken", async () => {
    const port = await pickFreePort();
    expect(await isLoopbackPortFree(port)).toBe(true);
    const app = buildApp({ port, token: "t", now: () => 0 });
    await listenLoopback(app, port);
    try {
      expect(await isLoopbackPortFree(port)).toBe(false);
    } finally {
      await app.close();
    }
  });
});
