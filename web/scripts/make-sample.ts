// Regenerates web/public/sample.pdf (fake data only) from the shared test fixture.
// Run: node web/scripts/make-sample.ts
import { writeFileSync } from "node:fs";
import { sampleStatementPdf } from "../../server/src/testing/pdf-fixture.ts";

const out = new URL("../public/sample.pdf", import.meta.url);
writeFileSync(out, sampleStatementPdf());
console.log(`wrote ${out.pathname}`);
