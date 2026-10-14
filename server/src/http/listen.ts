import net from "node:net";
import type { FastifyInstance } from "fastify";

/** The only address the server ever binds. There is deliberately no host parameter. */
export const LOOPBACK = "127.0.0.1";

/** Ask the OS for a free loopback port (tiny race window before the real bind). */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, LOOPBACK, () => {
      const addr = srv.address();
      srv.close(() => (addr && typeof addr === "object" ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

/** True if nothing is listening on 127.0.0.1:<port> (tiny race window before the real bind). */
export function isLoopbackPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, LOOPBACK, () => srv.close(() => resolve(true)));
  });
}

export const DEFAULT_PORT = 4780;

export interface ChoosePortOptions {
  envPort: string | undefined;
  preferred: number;
  isFree: (port: number) => Promise<boolean>;
  /** Used when the preferred port is taken. Defaults to an OS-assigned free loopback port. */
  fallback?: () => Promise<number>;
}

/**
 * FINSHARK_PORT wins and must be usable (the user asked for it explicitly). Otherwise the preferred
 * port, falling back to a random free one with a note to print.
 */
export async function choosePort(opts: ChoosePortOptions): Promise<{ port: number; note?: string }> {
  const { envPort, preferred, isFree } = opts;
  if (envPort !== undefined && envPort !== "") {
    const port = Number(envPort);
    if (!/^\d+$/.test(envPort.trim()) || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid FINSHARK_PORT "${envPort}": expected a port number between 1 and 65535.`);
    }
    if (!(await isFree(port))) throw new Error(`FINSHARK_PORT ${port} is already in use. Pick another port or stop the program using it.`);
    return { port };
  }
  if (await isFree(preferred)) return { port: preferred };
  const port = await (opts.fallback ?? pickFreePort)();
  return { port, note: `Port ${preferred} is in use (is FinShark already running?) — using ${port} instead.` };
}

/** Listen on 127.0.0.1:<port> only. */
export async function listenLoopback(app: FastifyInstance, port: number): Promise<void> {
  await app.listen({ host: LOOPBACK, port });
}
