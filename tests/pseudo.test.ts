import { describe, test, expect } from "bun:test";
import { extractPseudo } from "../src/dom-extract/pseudo";

describe("extractPseudo", () => {
  test("is exported and callable", () => {
    expect(typeof extractPseudo).toBe("function");
  });
});
