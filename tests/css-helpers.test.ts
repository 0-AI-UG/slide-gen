import { describe, test, expect } from "bun:test";
import { getAccumulatedOpacity, applyOpacityToColor, getRotation } from "../src/dom-extract/css-helpers";

describe("applyOpacityToColor", () => {
  test("returns unchanged color when opacity is 1", () => {
    expect(applyOpacityToColor("rgb(255, 0, 0)", 1)).toBe("rgb(255, 0, 0)");
  });

  test("returns unchanged color when opacity is ~1", () => {
    expect(applyOpacityToColor("rgb(100, 200, 50)", 0.9999)).toBe("rgb(100, 200, 50)");
  });

  test("applies opacity to rgb color", () => {
    expect(applyOpacityToColor("rgb(255, 0, 0)", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });

  test("applies opacity to rgba color", () => {
    expect(applyOpacityToColor("rgba(255, 0, 0, 0.8)", 0.5)).toBe("rgba(255, 0, 0, 0.4)");
  });

  test("multiplies existing alpha with opacity", () => {
    expect(applyOpacityToColor("rgba(10, 20, 30, 0.5)", 0.5)).toBe("rgba(10, 20, 30, 0.25)");
  });

  test("returns non-matching strings unchanged", () => {
    expect(applyOpacityToColor("transparent", 0.5)).toBe("transparent");
    expect(applyOpacityToColor("#ff0000", 0.5)).toBe("#ff0000");
  });
});

describe("getRotation", () => {
  test("returns 0 for no transform", () => {
    const computed = { transform: "none" } as CSSStyleDeclaration;
    expect(getRotation(computed)).toBe(0);
  });

  test("returns 0 for empty transform", () => {
    const computed = { transform: "" } as CSSStyleDeclaration;
    expect(getRotation(computed)).toBe(0);
  });

  test("extracts 0 degrees from identity matrix", () => {
    const computed = { transform: "matrix(1, 0, 0, 1, 0, 0)" } as CSSStyleDeclaration;
    expect(getRotation(computed)).toBe(0);
  });

  test("extracts 90 degrees", () => {
    // cos(90)=0, sin(90)=1 → matrix(0, 1, -1, 0, 0, 0)
    const computed = { transform: "matrix(0, 1, -1, 0, 0, 0)" } as CSSStyleDeclaration;
    expect(getRotation(computed)).toBe(90);
  });

  test("extracts 45 degrees", () => {
    const cos45 = Math.cos(Math.PI / 4);
    const sin45 = Math.sin(Math.PI / 4);
    const computed = { transform: `matrix(${cos45}, ${sin45}, ${-sin45}, ${cos45}, 0, 0)` } as CSSStyleDeclaration;
    expect(getRotation(computed)).toBe(45);
  });

  test("returns 0 for non-matching transform", () => {
    const computed = { transform: "rotate(45deg)" } as CSSStyleDeclaration;
    expect(getRotation(computed)).toBe(0);
  });
});

describe("getAccumulatedOpacity", () => {
  test("function is exported and callable", () => {
    expect(typeof getAccumulatedOpacity).toBe("function");
  });
});
