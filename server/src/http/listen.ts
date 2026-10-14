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

/** Listen on 127.0.0.1:<port> only. */
export async function listenLoopback(app: FastifyInstance, port: number): Promise<void> {
  await app.listen({ host: LOOPBACK, port });
}
