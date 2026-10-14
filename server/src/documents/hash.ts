import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Streaming SHA-256 of a file; lowercase hex. Never loads the whole file into memory. */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
