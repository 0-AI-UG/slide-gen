import { describe, test, expect } from "bun:test";
import { parseGradient, detectGradient, detectGradients } from "../src/dom-extract/gradient-parse";

describe("parseGradient", () => {
  describe("linear gradients", () => {
    test("parses simple two-stop gradient with degree angle", () => {
      const result = parseGradient("linear", "90deg, #ff0000, #0000ff");
      expect(result).not.toBeNull();
      expect(result.type).toBe("linear");
      expect(result.angle).toBe(90);
      expect(result.stops).toHaveLength(2);
      expect(result.stops[0]).toEqual({ color: "#ff0000", position: 0 });
      expect(result.stops[1]).toEqual({ color: "#0000ff", position: 100 });
    });

    test("parses gradient with 'to right' direction", () => {
      const result = parseGradient("linear", "to right, #ff0000, #0000ff");
      expect(result).not.toBeNull();
      expect(result.angle).toBe(90);
    });

    test("parses gradient with 'to top left' direction", () => {
      const result = parseGradient("linear", "to top left, #ff0000, #0000ff");
      expect(result).not.toBeNull();
      expect(result.angle).toBe(315);
    });

    test("defaults angle to 180 when no direction given", () => {
      const result = parseGradient("linear", "#ff0000, #0000ff");
      expect(result).not.toBeNull();
      expect(result.angle).toBe(180);
    });

    test("parses explicit stop positions", () => {
      const result = parseGradient("linear", "180deg, #ff0000 25%, #0000ff 75%");
      expect(result).not.toBeNull();
      expect(result.stops[0].position).toBe(25);
      expect(result.stops[1].position).toBe(75);
    });

    test("parses rgba color stops", () => {
      const result = parseGradient("linear", "180deg, rgba(255, 0, 0, 0.5), rgba(0, 0, 255, 1)");
      expect(result).not.toBeNull();
      expect(result.stops).toHaveLength(2);
      expect(result.stops[0].color).toBe("rgba(255, 0, 0, 0.5)");
      expect(result.stops[1].color).toBe("rgba(0, 0, 255, 1)");
    });

    test("interpolates positions for middle stops", () => {
      const result = parseGradient("linear", "180deg, #ff0000, #00ff00, #0000ff");
      expect(result).not.toBeNull();
      expect(result.stops).toHaveLength(3);
      expect(result.stops[0].position).toBe(0);
      expect(result.stops[1].position).toBe(50);
      expect(result.stops[2].position).toBe(100);
    });
  });

  describe("radial gradients", () => {
    test("parses simple radial gradient", () => {
      const result = parseGradient("radial", "#ff0000, #0000ff");
      expect(result).not.toBeNull();
      expect(result.type).toBe("radial");
      expect(result.stops).toHaveLength(2);
      expect(result.angle).toBeUndefined();
    });

    test("parses radial position", () => {
      const result = parseGradient("radial", "circle at 30% 70%, #ff0000, #0000ff");
      expect(result).not.toBeNull();
      expect(result.radialPosition).toEqual({ x: 30, y: 70 });
    });
  });

  describe("edge cases", () => {
    test("returns null for single stop", () => {
      const result = parseGradient("linear", "180deg, #ff0000");
      expect(result).toBeNull();
    });

    test("returns null on empty input", () => {
      const result = parseGradient("linear", "");
      expect(result).toBeNull();
    });

    test("skips shape keywords in radial gradients", () => {
      const result = parseGradient("radial", "circle, #ff0000, #0000ff");
      expect(result).not.toBeNull();
      expect(result.stops).toHaveLength(2);
    });
  });

  describe("conic gradients", () => {
    test("parses simple conic gradient", () => {
      const result = parseGradient("conic", "#ff0000, #00ff00, #0000ff");
      expect(result).not.toBeNull();
      expect(result.type).toBe("conic");
      expect(result.stops).toHaveLength(3);
    });

    test("parses conic with from angle", () => {
      const result = parseGradient("conic", "from 45deg, #ff0000, #0000ff");
      expect(result).not.toBeNull();
      expect(result.conicAngle).toBe(45);
    });

    test("parses conic with position", () => {
      const result = parseGradient("conic", "from 0deg at 25% 75%, #ff0000, #0000ff");
      expect(result).not.toBeNull();
      expect(result.conicAngle).toBe(0);
      expect(result.radialPosition).toEqual({ x: 25, y: 75 });
    });
  });
});

describe("detectGradient", () => {
  test("detects linear-gradient", () => {
    const result = detectGradient("linear-gradient(90deg, #ff0000, #0000ff)");
    expect(result).not.toBeNull();
    expect(result.type).toBe("linear");
    expect(result.repeating).toBeUndefined();
  });

  test("detects repeating-linear-gradient", () => {
    const result = detectGradient("repeating-linear-gradient(90deg, #ff0000 0%, #0000ff 25%)");
    expect(result).not.toBeNull();
    expect(result.type).toBe("linear");
    expect(result.repeating).toBe(true);
  });

  test("detects repeating-radial-gradient", () => {
    const result = detectGradient("repeating-radial-gradient(#ff0000 0%, #0000ff 25%)");
    expect(result).not.toBeNull();
    expect(result.type).toBe("radial");
    expect(result.repeating).toBe(true);
  });

  test("detects conic-gradient", () => {
    const result = detectGradient("conic-gradient(from 45deg, #ff0000, #0000ff)");
    expect(result).not.toBeNull();
    expect(result.type).toBe("conic");
    expect(result.conicAngle).toBe(45);
  });

  test("returns null for none", () => {
    expect(detectGradient("none")).toBeNull();
  });

  test("returns null for url()", () => {
    expect(detectGradient("url(image.png)")).toBeNull();
  });

  test("returns first gradient from multi-layer background", () => {
    const result = detectGradient("linear-gradient(90deg, #ff0000, #0000ff), radial-gradient(#00ff00, #000000)");
    expect(result).not.toBeNull();
    expect(result.type).toBe("linear");
    expect(result.angle).toBe(90);
  });
});

describe("detectGradients", () => {
  test("returns empty array for none", () => {
    expect(detectGradients("none")).toEqual([]);
  });

  test("returns single gradient in array", () => {
    const results = detectGradients("linear-gradient(90deg, #ff0000, #0000ff)");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("linear");
  });

  test("returns multiple gradient layers", () => {
    const results = detectGradients("linear-gradient(90deg, #ff0000, #0000ff), radial-gradient(#00ff00, #000000)");
    expect(results).toHaveLength(2);
    expect(results[0].type).toBe("linear");
    expect(results[0].angle).toBe(90);
    expect(results[1].type).toBe("radial");
  });

  test("handles three gradient layers with rgba colors", () => {
    const results = detectGradients(
      "linear-gradient(45deg, rgba(255,0,0,0.5), rgba(0,0,255,0.5)), " +
      "radial-gradient(circle at 50% 50%, #00ff00, #000000), " +
      "linear-gradient(to bottom, #ffffff, #000000)"
    );
    expect(results).toHaveLength(3);
    expect(results[0].type).toBe("linear");
    expect(results[0].angle).toBe(45);
    expect(results[1].type).toBe("radial");
    expect(results[2].type).toBe("linear");
    expect(results[2].angle).toBe(180);
  });

  test("skips url() layers, returns only gradients", () => {
    const results = detectGradients("url(bg.png), linear-gradient(90deg, #ff0000, #0000ff)");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("linear");
  });
});
