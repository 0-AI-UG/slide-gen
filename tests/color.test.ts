import { describe, test, expect } from "bun:test";
import { parseCssColor, parseCssAlpha, parseCssColorAndAlpha } from "../src/color";

describe("parseCssColor", () => {
  test("parses rgb()", () => {
    expect(parseCssColor("rgb(255, 0, 128)")).toBe("FF0080");
  });

  test("parses rgba() with visible alpha", () => {
    expect(parseCssColor("rgba(255, 0, 128, 0.5)")).toBe("FF0080");
  });

  test("returns null for fully transparent rgba", () => {
    expect(parseCssColor("rgba(0, 0, 0, 0)")).toBeNull();
  });

  test("returns null for very low alpha", () => {
    expect(parseCssColor("rgba(255, 255, 255, 0.005)")).toBeNull();
  });

  test("parses hex color", () => {
    expect(parseCssColor("#7B61FF")).toBe("7B61FF");
  });

  test("parses lowercase hex", () => {
    expect(parseCssColor("#0c0c14")).toBe("0C0C14");
  });

  test("returns null for empty string", () => {
    expect(parseCssColor("")).toBeNull();
  });

  test("returns null for invalid color", () => {
    expect(parseCssColor("transparent")).toBeNull();
  });
});

describe("parseCssAlpha", () => {
  test("returns 1 for rgb()", () => {
    expect(parseCssAlpha("rgb(255, 0, 0)")).toBe(1);
  });

  test("returns alpha for rgba()", () => {
    expect(parseCssAlpha("rgba(255, 0, 0, 0.5)")).toBe(0.5);
  });

  test("returns 1 for empty string", () => {
    expect(parseCssAlpha("")).toBe(1);
  });

  test("returns 1 for hex color", () => {
    expect(parseCssAlpha("#FF0000")).toBe(1);
  });
});

describe("parseCssColorAndAlpha", () => {
  test("parses rgb()", () => {
    expect(parseCssColorAndAlpha("rgb(255, 0, 128)")).toEqual({ hex: "FF0080", alpha: 1 });
  });

  test("parses rgba()", () => {
    expect(parseCssColorAndAlpha("rgba(255, 0, 128, 0.3)")).toEqual({ hex: "FF0080", alpha: 0.3 });
  });

  test("parses 6-char hex", () => {
    expect(parseCssColorAndAlpha("#7B61FF")).toEqual({ hex: "7B61FF", alpha: 1 });
  });

  test("parses 3-char hex", () => {
    expect(parseCssColorAndAlpha("#F00")).toEqual({ hex: "FF0000", alpha: 1 });
  });

  test("returns black for unrecognized", () => {
    expect(parseCssColorAndAlpha("potato")).toEqual({ hex: "000000", alpha: 1 });
  });
});
