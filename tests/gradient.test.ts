import { describe, test, expect } from "bun:test";
import { buildGradFillXml } from "../src/gradient";
import type { GradientInfo } from "../src/types";

describe("buildGradFillXml", () => {
  test("generates linear gradient XML", () => {
    const grad: GradientInfo = {
      type: "linear",
      angle: 180,
      stops: [
        { color: "#FF0000", position: 0 },
        { color: "#0000FF", position: 100 },
      ],
    };
    const xml = buildGradFillXml(grad);
    expect(xml).toContain("<a:gradFill>");
    expect(xml).toContain('<a:srgbClr val="FF0000">');
    expect(xml).toContain('<a:srgbClr val="0000FF">');
    expect(xml).toContain("<a:lin");
    expect(xml).toContain("scaled=\"1\"");
  });

  test("generates radial gradient XML", () => {
    const grad: GradientInfo = {
      type: "radial",
      stops: [
        { color: "rgb(255, 0, 0)", position: 0 },
        { color: "rgb(0, 0, 255)", position: 100 },
      ],
      radialPosition: { x: 50, y: 50 },
    };
    const xml = buildGradFillXml(grad);
    expect(xml).toContain('<a:path path="circle">');
    expect(xml).toContain("a:fillToRect");
    expect(xml).toContain('rotWithShape="0"');

    // With explicit circle shape, path should also be "circle"
    const circleGrad: GradientInfo = { ...grad, radialShape: "circle" };
    const circleXml = buildGradFillXml(circleGrad);
    expect(circleXml).toContain('<a:path path="circle">');
  });

  test("includes alpha tag for semi-transparent stops", () => {
    const grad: GradientInfo = {
      type: "linear",
      angle: 90,
      stops: [
        { color: "rgba(255, 0, 0, 0.5)", position: 0 },
        { color: "#0000FF", position: 100 },
      ],
    };
    const xml = buildGradFillXml(grad);
    expect(xml).toContain("<a:alpha");
  });

  test("caps gradient stops at MAX_GRADIENT_STOPS and pushes warning", () => {
    // Create a radial gradient with many stops — 3 interpolated per pair
    // 100 stops → 100 + 99*3 = 397 effective stops after interpolation
    const stops = Array.from({ length: 100 }, (_, i) => ({
      color: `rgb(${i * 2}, ${i}, ${255 - i * 2})`,
      position: (i / 99) * 100,
    }));
    const grad: GradientInfo = {
      type: "radial",
      stops,
      radialPosition: { x: 50, y: 50 },
    };
    const warnings: string[] = [];
    const xml = buildGradFillXml(grad, warnings);

    // Count <a:gs entries
    const gsCount = (xml.match(/<a:gs /g) || []).length;
    expect(gsCount).toBeLessThanOrEqual(250);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("exceeded limit");
  });

  test("converts CSS angle to OOXML angle correctly", () => {
    // CSS 90deg (to right) should produce OOXML 0deg
    const grad: GradientInfo = {
      type: "linear",
      angle: 90,
      stops: [
        { color: "#FF0000", position: 0 },
        { color: "#0000FF", position: 100 },
      ],
    };
    const xml = buildGradFillXml(grad);
    expect(xml).toContain('ang="0"');
  });
});
