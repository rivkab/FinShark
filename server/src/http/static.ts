// Tiny static file server for the built web app (web/dist). Path-traversal safe:
// the resolved real path must stay inside the real root. SPA fallback to index.html
// for extension-less paths.

import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export interface StaticFile {
  body: Buffer;
  contentType: string;
}

/** Resolve a request path to a file under `root`, or null. Never throws on bad input. */
export async function readStaticFile(root: string, urlPath: string): Promise<StaticFile | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const realRoot = await realpath(root).catch(() => null);
  if (!realRoot) return null;

  const tryFile = async (rel: string): Promise<StaticFile | null> => {
    const candidate = path.resolve(realRoot, "." + path.posix.normalize("/" + rel));
    const real = await realpath(candidate).catch(() => null);
    if (!real || (real !== realRoot && !real.startsWith(realRoot + path.sep))) return null;
    const body = await readFile(real).catch(() => null);
    return body ? { body, contentType: contentTypeFor(real) } : null;
  };

  const direct = decoded.endsWith("/") ? null : await tryFile(decoded);
  if (direct) return direct;
  if (path.extname(decoded) === "") return tryFile("index.html");
  return null;
}
