import { describe, test, expect } from "bun:test";
import { SYSTEM_FONTS } from "../src/constants";

describe("SYSTEM_FONTS", () => {
  test("contains common system fonts", () => {
    expect(SYSTEM_FONTS.has("arial")).toBe(true);
    expect(SYSTEM_FONTS.has("helvetica")).toBe(true);
    expect(SYSTEM_FONTS.has("sans-serif")).toBe(true);
  });

  test("contains macOS system fonts", () => {
    expect(SYSTEM_FONTS.has("sf pro")).toBe(true);
    expect(SYSTEM_FONTS.has("sf mono")).toBe(true);
  });

  test("does not contain Google Fonts", () => {
    expect(SYSTEM_FONTS.has("syne")).toBe(false);
    expect(SYSTEM_FONTS.has("instrument sans")).toBe(false);
    expect(SYSTEM_FONTS.has("jetbrains mono")).toBe(false);
  });
});
