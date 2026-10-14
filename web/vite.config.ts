import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const serverPort = Number(process.env["FINSHARK_PORT"] ?? 8787);
const target = `http://127.0.0.1:${serverPort}`;

// pdf.js loads CMaps, standard fonts, ICC profiles and wasm helpers at runtime. They
// are bundled locally under /pdfjs/ (never a CDN). The wasm binaries themselves cannot
// run under the strict CSP (no 'wasm-unsafe-eval'); pdf.js falls back to its JS builds.
const PDFJS_DIRS = ["cmaps", "standard_fonts", "iccs", "wasm"];
function pdfjsAssets(): Plugin {
  const root = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  return {
    name: "finshark-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
        const full = path.join(root, rel);
        if (!PDFJS_DIRS.includes(rel.split("/")[1] ?? "") || !full.startsWith(root + path.sep)) return next();
        try {
          res.end(readFileSync(full));
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const d of PDFJS_DIRS) {
        for (const f of files(path.join(root, d))) {
          if (f.endsWith(".md")) continue;
          this.emitFile({ type: "asset", fileName: `pdfjs/${path.relative(root, f)}`, source: readFileSync(f) });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  server: {
    host: "127.0.0.1",
    proxy: {
      // The server only accepts Host/Origin of its own address, so rewrite both.
      "/api": proxyOptions(),
      "/auth": proxyOptions(),
    },
  },
  build: { target: "es2023" },
});

function proxyOptions() {
  return {
    target,
    changeOrigin: true,
    configure: (proxy: { on: (ev: "proxyReq", cb: (req: { getHeader(n: string): unknown; setHeader(n: string, v: string): void }) => void) => void }) => {
      proxy.on("proxyReq", (req) => {
        if (req.getHeader("origin") !== undefined) req.setHeader("origin", target);
      });
    },
  };
}
