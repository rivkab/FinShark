import { describe, expect, it } from "vitest";
import { isTypingTarget, reviewShortcut } from "./shortcuts.ts";

describe("isTypingTarget", () => {
  it("is true for form controls and editable content", () => {
    for (const tagName of ["INPUT", "textarea", "Select"]) expect(isTypingTarget({ tagName })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("is false for buttons, the body and nothing", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "BODY" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("reviewShortcut", () => {
  const body = { tagName: "BODY" };
  it("maps keys to actions", () => {
    const k = (key: string) => reviewShortcut({ key, target: body });
    expect(k("v")).toBe("verify");
    expect(k("V")).toBe("verify");
    expect(k("c")).toBe("correct");
    expect(k("r")).toBe("reject");
    expect(k("ArrowRight")).toBe("next");
    expect(k("j")).toBe("next");
    // Review only moves forward: there is no "previous" shortcut.
    expect(k("ArrowLeft")).toBeNull();
    expect(k("k")).toBeNull();
    expect(k("x")).toBeNull();
  });
  it("never fires while typing", () => {
    expect(reviewShortcut({ key: "v", target: { tagName: "INPUT" } })).toBeNull();
    expect(reviewShortcut({ key: "r", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(reviewShortcut({ key: "ArrowLeft", target: { tagName: "SELECT" } })).toBeNull();
  });
  it("ignores browser shortcuts", () => {
    expect(reviewShortcut({ key: "r", metaKey: true, target: body })).toBeNull();
    expect(reviewShortcut({ key: "c", ctrlKey: true, target: body })).toBeNull();
    expect(reviewShortcut({ key: "v", altKey: true, target: body })).toBeNull();
  });
});
