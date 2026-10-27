/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Enforces the rules in ds/README.md: content code composes primitives and names no colors.

const SRC = fileURLToPath(new URL("..", import.meta.url));

const INTRINSIC = [
  "a", "b", "bdi", "br", "button", "code", "dd", "details", "div", "dl", "dt", "em", "fieldset", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "i", "input", "kbd", "label", "legend", "li", "main", "nav", "ol",
  "optgroup", "option", "p", "pre", "section", "select", "small", "span", "strong", "summary", "table", "tbody",
  "td", "textarea", "th", "thead", "tr", "ul",
];
const INTRINSIC_TAG = new RegExp(`<(${INTRINSIC.join("|")})(?=[\\s>/])`);
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

function files(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

const rel = (p: string) => relative(SRC, p).split(sep).join("/");
const inDir = (p: string, dir: string) => rel(p).startsWith(`${dir}/`);

describe("content code is declarative", () => {

  const content = files(SRC, ".tsx").filter((p) => !inDir(p, "ds") && !inDir(p, "pdf"));

  it("finds files to check", () => {
    expect(content.map(rel)).toEqual(expect.arrayContaining(["ui.tsx", "App.tsx", "AccountsPage.tsx", "DocumentView.tsx", "FactsPage.tsx"]));
  });

  for (const file of content) {
    it(`${rel(file)} has no className, style or intrinsic elements`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/\bclassName=/);
      expect(src).not.toMatch(/\bstyle=/);
      expect(src.match(INTRINSIC_TAG)?.[0]).toBeUndefined();
    });
  }
});

describe("only tokens.css names a color", () => {
  const css = files(SRC, ".css").filter((p) => rel(p) !== "ds/tokens.css");

  it("finds stylesheets to check", () => {
    expect(css.length).toBeGreaterThan(5);
  });

  for (const file of css) {
    it(`${rel(file)} has no color literal`, () => {
      expect(readFileSync(file, "utf8").match(COLOR_LITERAL)?.[0]).toBeUndefined();
    });
  }

  for (const file of files(SRC, ".tsx")) {
    it(`${rel(file)} has no color literal`, () => {
      expect(readFileSync(file, "utf8").match(COLOR_LITERAL)?.[0]).toBeUndefined();
    });
  }
});
