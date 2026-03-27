import { describe, test, expect } from "bun:test";
import { findBlockAncestor, hasBrBetween } from "../src/dom-extract/text-helpers";
import type { RawTextRun } from "../src/dom-extract/text-helpers";

describe("text-helpers", () => {
  test("RawTextRun interface is importable", () => {
    // Type-level check — if this compiles, the interface is exported correctly
    const run: Partial<RawTextRun> = { text: "hello", fontSize: 16 };
    expect(run.text).toBe("hello");
  });

  test("findBlockAncestor is exported and callable", () => {
    expect(typeof findBlockAncestor).toBe("function");
  });

  test("hasBrBetween is exported and callable", () => {
    expect(typeof hasBrBetween).toBe("function");
  });
});
