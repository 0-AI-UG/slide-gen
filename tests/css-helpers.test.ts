import { describe, test, expect } from "bun:test";
import { getAccumulatedOpacity, applyOpacityToColor, getRotation, getTransformInfo, parseShadow, parseBorderRadii } from "../src/dom-extract/css-helpers";

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

describe("getTransformInfo", () => {
  test("returns identity for no transform", () => {
    const computed = { transform: "none" } as CSSStyleDeclaration;
    const info = getTransformInfo(computed);
    expect(info.rotation).toBe(0);
    expect(info.scaleX).toBe(1);
    expect(info.scaleY).toBe(1);
    expect(info.translateX).toBe(0);
    expect(info.translateY).toBe(0);
    expect(info.skewX).toBe(0);
  });

  test("extracts translation", () => {
    const computed = { transform: "matrix(1, 0, 0, 1, 50, 100)" } as CSSStyleDeclaration;
    const info = getTransformInfo(computed);
    expect(info.translateX).toBe(50);
    expect(info.translateY).toBe(100);
    expect(info.scaleX).toBe(1);
    expect(info.scaleY).toBe(1);
    expect(info.rotation).toBe(0);
  });

  test("extracts scale", () => {
    const computed = { transform: "matrix(2, 0, 0, 1.5, 0, 0)" } as CSSStyleDeclaration;
    const info = getTransformInfo(computed);
    expect(info.scaleX).toBe(2);
    expect(info.scaleY).toBe(1.5);
    expect(info.rotation).toBe(0);
  });

  test("extracts rotation", () => {
    // 90 degrees: matrix(0, 1, -1, 0, 0, 0)
    const computed = { transform: "matrix(0, 1, -1, 0, 0, 0)" } as CSSStyleDeclaration;
    const info = getTransformInfo(computed);
    expect(info.rotation).toBe(90);
    expect(Math.abs(info.scaleX - 1)).toBeLessThan(0.01);
    expect(Math.abs(info.scaleY - 1)).toBeLessThan(0.01);
  });

  test("extracts combined translate + scale", () => {
    const computed = { transform: "matrix(2, 0, 0, 3, 10, 20)" } as CSSStyleDeclaration;
    const info = getTransformInfo(computed);
    expect(info.scaleX).toBe(2);
    expect(info.scaleY).toBe(3);
    expect(info.translateX).toBe(10);
    expect(info.translateY).toBe(20);
  });
});

describe("getAccumulatedOpacity", () => {
  test("function is exported and callable", () => {
    expect(typeof getAccumulatedOpacity).toBe("function");
  });
});

describe("parseBorderRadii", () => {
  test("returns null when all corners are 0", () => {
    const computed = {
      borderTopLeftRadius: "0px",
      borderTopRightRadius: "0px",
      borderBottomRightRadius: "0px",
      borderBottomLeftRadius: "0px",
    } as CSSStyleDeclaration;
    expect(parseBorderRadii(computed)).toBeNull();
  });

  test("returns per-corner values", () => {
    const computed = {
      borderTopLeftRadius: "10px",
      borderTopRightRadius: "20px",
      borderBottomRightRadius: "5px",
      borderBottomLeftRadius: "0px",
    } as CSSStyleDeclaration;
    expect(parseBorderRadii(computed)).toEqual({
      topLeft: 10,
      topRight: 20,
      bottomRight: 5,
      bottomLeft: 0,
    });
  });

  test("returns equal corners when all same", () => {
    const computed = {
      borderTopLeftRadius: "15px",
      borderTopRightRadius: "15px",
      borderBottomRightRadius: "15px",
      borderBottomLeftRadius: "15px",
    } as CSSStyleDeclaration;
    expect(parseBorderRadii(computed)).toEqual({
      topLeft: 15,
      topRight: 15,
      bottomRight: 15,
      bottomLeft: 15,
    });
  });
});

describe("parseShadow", () => {
  test("returns null for 'none'", () => {
    expect(parseShadow("none")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseShadow("")).toBeNull();
  });

  test("parses rgba box-shadow with spread", () => {
    const result = parseShadow("rgba(0, 0, 0, 0.5) 2px 4px 8px 0px");
    expect(result).toEqual({
      offsetX: 2,
      offsetY: 4,
      blurRadius: 8,
      spreadRadius: 0,
      color: "rgba(0, 0, 0, 0.5)",
    });
  });

  test("parses text-shadow (no spread)", () => {
    const result = parseShadow("rgba(0, 0, 0, 0.5) 2px 4px 8px");
    expect(result).toEqual({
      offsetX: 2,
      offsetY: 4,
      blurRadius: 8,
      color: "rgba(0, 0, 0, 0.5)",
    });
  });

  test("parses rgb shadow without alpha", () => {
    const result = parseShadow("rgb(0, 0, 0) 3px 3px 6px");
    expect(result).toEqual({
      offsetX: 3,
      offsetY: 3,
      blurRadius: 6,
      color: "rgb(0, 0, 0)",
    });
  });

  test("parses shadow with color after offsets", () => {
    const result = parseShadow("2px 4px 8px rgba(0, 0, 0, 0.3)");
    expect(result).toEqual({
      offsetX: 2,
      offsetY: 4,
      blurRadius: 8,
      color: "rgba(0, 0, 0, 0.3)",
    });
  });

  test("parses negative offsets", () => {
    const result = parseShadow("rgba(255, 0, 0, 1) -2px -4px 8px");
    expect(result).toEqual({
      offsetX: -2,
      offsetY: -4,
      blurRadius: 8,
      color: "rgba(255, 0, 0, 1)",
    });
  });

  test("returns null for zero offset and zero blur", () => {
    expect(parseShadow("rgba(0, 0, 0, 0.5) 0px 0px 0px")).toBeNull();
  });

  test("only parses the first shadow from a multi-shadow value", () => {
    const result = parseShadow("rgba(0, 0, 0, 0.5) 2px 4px 8px, rgba(255, 0, 0, 1) 10px 10px 20px");
    expect(result).toEqual({
      offsetX: 2,
      offsetY: 4,
      blurRadius: 8,
      color: "rgba(0, 0, 0, 0.5)",
    });
  });

  test("handles missing blur (only offset)", () => {
    const result = parseShadow("rgba(0, 0, 0, 1) 5px 5px");
    expect(result).toEqual({
      offsetX: 5,
      offsetY: 5,
      blurRadius: 0,
      color: "rgba(0, 0, 0, 1)",
    });
  });
});
