// Minimal PDF writer for tests: fake documents with text at known positions, so
// tests never need real financial PDFs. ASCII text only (Helvetica, WinAnsi).

export interface FixtureText {
  text: string;
  /** PDF points from the left edge. */
  x: number;
  /** PDF points from the bottom edge (baseline). */
  y: number;
  /** Font size in points; default 11. */
  size?: number;
}

export interface FixturePage {
  /** Default US Letter 612 x 792. */
  width?: number;
  height?: number;
  texts: FixtureText[];
}

function escapePdfString(s: string): string {
  if (/[^\x20-\x7e]/.test(s)) throw new Error(`Fixture text must be printable ASCII: ${JSON.stringify(s)}`);
  return s.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Build a PDF. Output is byte-for-byte deterministic for the same input. */
export function makePdf(pages: FixturePage[]): Uint8Array {
  if (pages.length === 0) throw new Error("makePdf needs at least one page");
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1; // 1-based object number

  const catalog = add(""); // filled in below
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  const pageRefs: number[] = [];
  for (const page of pages) {
    const w = page.width ?? 612;
    const h = page.height ?? 792;
    const ops = page.texts
      .map((t) => `BT /F1 ${t.size ?? 11} Tf ${t.x} ${t.y} Td (${escapePdfString(t.text)}) Tj ET`)
      .join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(ops, "latin1")} >>\nstream\n${ops}\nendstream`);
    pageRefs.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${w} ${h}] ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** A one-page fake year-end statement used across tests. */
export function sampleStatementPdf(opts: { endingBalance?: string; interest?: string; last4?: string } = {}): Uint8Array {
  return makePdf([
    {
      texts: [
        { text: "Example Brokerage - Annual Statement", x: 72, y: 720, size: 16 },
        { text: `Account ending ${opts.last4 ?? "4821"}`, x: 72, y: 690 },
        { text: "Statement period: 01/01/2025 - 12/31/2025", x: 72, y: 672 },
        { text: "Ending balance", x: 72, y: 600 },
        { text: opts.endingBalance ?? "$83,421.17", x: 400, y: 600 },
        { text: "Interest paid", x: 72, y: 580 },
        { text: opts.interest ?? "$1,204.33", x: 400, y: 580 },
      ],
    },
  ]);
}
