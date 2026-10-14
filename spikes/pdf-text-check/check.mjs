#!/usr/bin/env node
// Spike: do numbers in our real PDFs (especially Hebrew ones) come out of the
// text layer correctly? Runs entirely locally; makes no network requests.
//
//   node check.mjs statement.pdf                    list every line containing a number
//   node check.mjs statement.pdf --find 83,421.17   look for specific amounts you see in Preview
//   node check.mjs *.pdf --summary --find 42,318    counts and find results only, no document text
//
// Options:
//   --find <amount>   repeatable; amount as you see it on screen (commas, ₪, $ are ignored)
//   --page <n>        only examine page n
//   --summary         print no document text, only counts and find results (safe to paste)

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));

// --- arguments ---------------------------------------------------------------

const files = [];
const finds = [];
let onlyPage = null;
let summary = false;

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--find") finds.push(argv[++i]);
  else if (a === "--page") onlyPage = Number(argv[++i]);
  else if (a === "--summary") summary = true;
  else if (a === "-h" || a === "--help") usage(0);
  else if (a.startsWith("--")) usage(1, `Unknown option ${a}`);
  else files.push(a);
}
if (files.length === 0) usage(1, "No PDF given.");
if (finds.some((f) => f === undefined || digitsOf(f) === "")) usage(1, "--find needs an amount.");

function usage(code, msg) {
  if (msg) console.error(msg + "\n");
  console.error("Usage: node check.mjs <file.pdf>... [--find <amount>]... [--page <n>] [--summary]");
  process.exit(code);
}

// --- helpers -----------------------------------------------------------------

const HAS_DIGIT = /\d/;
const HAS_HEBREW = /[֐-׿]/;
// Characters that may legitimately sit inside an amount as printed.
const NUMERIC_ONLY = /^[\s\d.,\-−()₪$%'/ ‎‏‪-‮]*$/;

function digitsOf(s) {
  return s.replace(/\D/g, "");
}

function reverse(s) {
  return [...s].reverse().join("");
}

// A text item's box in PDF points (origin bottom-left, unrotated page space).
function boxOf(item) {
  const [, , , , x, y] = item.transform;
  const h = item.height || Math.hypot(item.transform[2], item.transform[3]);
  return { x0: x, y0: y, x1: x + item.width, y1: y + h };
}

// Group items into visual lines by baseline, each sorted left-to-right.
function toLines(items) {
  const lines = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const box = boxOf(item);
    const tol = Math.max(2, (box.y1 - box.y0) * 0.4);
    let line = lines.find((l) => Math.abs(l.y - box.y0) <= tol);
    if (!line) lines.push((line = { y: box.y0, items: [] }));
    line.items.push({ item, box });
  }
  for (const l of lines) l.items.sort((a, b) => a.box.x0 - b.box.x0);
  return lines.sort((a, b) => b.y - a.y);
}

// Adjacent items on a line that are both purely numeric and nearly touching are
// one printed number split across text items: a box drawn around the number
// would have to merge them.
function splitNumbers(line) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length > 1) out.push(run);
    run = [];
  };
  for (const entry of line.items) {
    const numeric = HAS_DIGIT.test(entry.item.str) && NUMERIC_ONLY.test(entry.item.str);
    const prev = run[run.length - 1];
    const gap = prev ? entry.box.x0 - prev.box.x1 : 0;
    const fontSize = entry.box.y1 - entry.box.y0;
    if (numeric && (!prev || gap < Math.max(1.5, fontSize * 0.25))) run.push(entry);
    else {
      flush();
      if (numeric) run.push(entry);
    }
  }
  flush();
  return out;
}

function fmtBox(b) {
  const r = (n) => n.toFixed(0).padStart(4);
  return `x ${r(b.x0)}–${r(b.x1)}  y ${r(b.y0)}`;
}

// --- per document ------------------------------------------------------------

async function checkFile(file) {
  const data = new Uint8Array(await readFile(file));
  const doc = await getDocument({
    data,
    cMapUrl: path.join(pdfjsDir, "cmaps") + path.sep,
    cMapPacked: true,
    standardFontDataUrl: path.join(pdfjsDir, "standard_fonts") + path.sep,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  const stats = {
    pages: doc.numPages,
    pagesWithoutText: [],
    numericItems: 0,
    hebrewLines: 0,
    splitNumbers: 0,
    rtlNumericItems: 0,
  };
  const findResults = new Map(finds.map((f) => [f, []]));

  if (!summary) console.log(`\n=== ${path.basename(file)} — ${doc.numPages} page(s) ===`);

  for (let p = 1; p <= doc.numPages; p++) {
    if (onlyPage && p !== onlyPage) continue;
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const textItems = items.filter((i) => typeof i.str === "string");
    if (!textItems.some((i) => i.str.trim())) {
      stats.pagesWithoutText.push(p);
      if (!summary) console.log(`\n--- page ${p}: NO TEXT LAYER (scanned image?) ---`);
      continue;
    }

    const lines = toLines(textItems);
    if (!summary) console.log(`\n--- page ${p} ---`);

    for (const line of lines) {
      const numericEntries = line.items.filter((e) => HAS_DIGIT.test(e.item.str));
      const hebrew = line.items.some((e) => HAS_HEBREW.test(e.item.str));
      if (hebrew) stats.hebrewLines++;
      stats.numericItems += numericEntries.length;
      stats.rtlNumericItems += numericEntries.filter((e) => e.item.dir === "rtl").length;
      const splits = splitNumbers(line);
      stats.splitNumbers += splits.length;

      for (const f of finds) matchFind(f, p, line, findResults.get(f));

      if (summary || numericEntries.length === 0) continue;
      const text = line.items.map((e) => e.item.str).join(" ").replace(/\s+/g, " ").trim();
      console.log(`${fmtBox(line.items[0].box)}  ${hebrew ? "[he] " : ""}${text}`);
      for (const e of numericEntries) {
        const dir = e.item.dir === "rtl" ? "  (rtl)" : "";
        console.log(`        item with digits: "${e.item.str}"  ${fmtBox(e.box)}${dir}`);
      }
      for (const run of splits) {
        const pieces = run.map((e) => `"${e.item.str}"`).join(" + ");
        console.log(`        ⚠ split number: ${pieces}`);
      }
    }
  }

  await doc.destroy();
  return { stats, findResults };
}

// Numbers as printed inside a piece of text: digit groups joined by , . space.
const NUMBER_TOKEN = /\d(?:[\d,.  ]*\d)?/g;

function numberTokens(s) {
  return (s.match(NUMBER_TOKEN) || []).map(digitsOf);
}

// Classify how an amount the user can see on screen appears in the text layer.
function matchFind(wanted, page, line, results) {
  const want = digitsOf(wanted);
  const items = line.items.map((e) => e.item.str);

  if (items.some((s) => numberTokens(s).includes(want))) {
    results.push({ page, how: "OK (one text item)" });
    return;
  }
  // Pieces of the amount in consecutive items: joined without a gap, they form it.
  for (let i = 0; i < items.length - 1; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (numberTokens(items.slice(i, j + 1).join("")).includes(want)) {
        results.push({ page, how: `SPLIT across ${j - i + 1} text items` });
        return;
      }
    }
  }
  const lineTokens = numberTokens(items.join("")).concat(numberTokens(items.join(" ")));
  if (want !== reverse(want) && lineTokens.includes(reverse(want))) {
    results.push({ page, how: "REVERSED (digits in the wrong order)" });
  } else if (items.some((s) => numberTokens(s).some((t) => t.length >= 3 && want.includes(t)))) {
    // Only part of it on this line; reported only if nothing better turns up.
    results.push({ page, how: "PARTIAL (only part of the number found on one line)", weak: true });
  }
}

// --- main --------------------------------------------------------------------

let anyProblem = false;
for (const file of files) {
  let result;
  try {
    result = await checkFile(file);
  } catch (err) {
    console.log(`\n${path.basename(file)}: could not read PDF (${err.message})`);
    anyProblem = true;
    continue;
  }
  const { stats, findResults } = result;

  console.log(`\nSummary — ${path.basename(file)}`);
  console.log(`  pages:                     ${stats.pages}`);
  console.log(`  pages with no text layer:  ${stats.pagesWithoutText.length ? stats.pagesWithoutText.join(", ") : "none"}`);
  console.log(`  lines containing Hebrew:   ${stats.hebrewLines}`);
  console.log(`  text items with digits:    ${stats.numericItems}  (marked right-to-left: ${stats.rtlNumericItems})`);
  console.log(`  numbers split across items: ${stats.splitNumbers}`);

  for (const [wanted, hits] of findResults) {
    const strong = hits.filter((h) => !h.weak);
    const shown = strong.length ? strong : hits;
    if (shown.length === 0) {
      console.log(`  find ${wanted}: NOT FOUND`);
      anyProblem = true;
    } else {
      for (const h of shown) console.log(`  find ${wanted}: page ${h.page} — ${h.how}`);
      if (!shown.some((h) => h.how.startsWith("OK"))) anyProblem = true;
    }
  }
}

process.exitCode = anyProblem ? 1 : 0;
