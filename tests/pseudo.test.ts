import { describe, test, expect } from "bun:test";
import { extractPseudo, extractTextFromContent } from "../src/dom-extract/pseudo";

describe("extractPseudo", () => {
  test("is exported and callable", () => {
    expect(typeof extractPseudo).toBe("function");
  });
});

describe("extractTextFromContent", () => {
  test("extracts double-quoted string", () => {
    expect(extractTextFromContent('"Hello"')).toBe("Hello");
  });

  test("extracts single-quoted string", () => {
    expect(extractTextFromContent("'World'")).toBe("World");
  });

  test("concatenates multiple quoted strings", () => {
    expect(extractTextFromContent('"Hello" " " "World"')).toBe("Hello World");
  });

  test("returns null for none", () => {
    expect(extractTextFromContent("none")).toBeNull();
  });

  test("returns null for normal", () => {
    expect(extractTextFromContent("normal")).toBeNull();
  });

  test("returns null for empty quoted string", () => {
    expect(extractTextFromContent('""')).toBeNull();
  });

  test("handles unicode content like counters", () => {
    expect(extractTextFromContent('"\\2022"')).toBe("\\2022");
  });

  test("handles content with attr() - extracts only string parts", () => {
    expect(extractTextFromContent('"Note: " attr(data-label)')).toBe("Note:");
  });
});
