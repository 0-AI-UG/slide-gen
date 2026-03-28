import { describe, test, expect } from "bun:test";
import JSZip from "jszip";
import { buildPptx } from "../src/pptx-builder";
import type { SlideData, TextRun } from "../src/types";

function makeTextSlide(runs: Array<Partial<TextRun> & { text: string; fontFamily: string; fontWeight: string }>): SlideData[] {
  return [{
    width: 1920,
    height: 1080,
    backgroundColor: "rgb(255, 255, 255)",
    rects: [],
    tables: [],
    texts: runs.map((r, i) => ({
      runs: [{
        text: r.text,
        fontSize: r.fontSize ?? 32,
        fontFamily: r.fontFamily,
        fontWeight: r.fontWeight,
        fontStyle: r.fontStyle ?? "normal",
        color: r.color ?? "rgb(0, 0, 0)",
        letterSpacing: r.letterSpacing ?? 0,
        textTransform: r.textTransform ?? "none",
      }],
      x: 100,
      y: 100 + i * 60,
      width: 800,
      height: 50,
      textAlign: "left",
      rotation: 0,
      parentWidth: 1920,
      parentHeight: 1080,
      wrap: false,
      text: r.text,
      fontSize: r.fontSize ?? 32,
      fontFamily: r.fontFamily,
      fontWeight: r.fontWeight,
      fontStyle: r.fontStyle ?? "normal",
      color: r.color ?? "rgb(0, 0, 0)",
      letterSpacing: r.letterSpacing ?? 0,
      textTransform: r.textTransform ?? "none",
    })),
    images: [],
  }];
}

describe("font weight handling", () => {
  test("weight-specific font files suppress synthetic bold", async () => {
    const data = makeTextSlide([
      { text: "Light text", fontFamily: "Inter", fontWeight: "300" },
      { text: "Regular text", fontFamily: "Inter", fontWeight: "400" },
      { text: "SemiBold text", fontFamily: "Inter", fontWeight: "600" },
      { text: "Bold text", fontFamily: "Inter", fontWeight: "700" },
      { text: "ExtraBold text", fontFamily: "Inter", fontWeight: "800" },
    ]);

    const fontPrepResult = {
      boldThresholds: new Map([["Inter", 550]]),
      fontNameMap: new Map([["Inter", "Inter"]]),
      weightToFontName: new Map([
        ["Inter", new Map([
          [300, "Inter Light"],
          [400, "Inter"],
          [500, "Inter Medium"],
          [600, "Inter SemiBold"],
          [700, "Inter Bold"],
          [800, "Inter ExtraBold"],
        ])],
      ]),
      warnings: [],
    };

    const { buffer } = await buildPptx(data, { fontPrepResult });
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(0);
  });

  test("falls back to isBold when no weight map exists", async () => {
    const data = makeTextSlide([
      { text: "Regular text", fontFamily: "UnknownFont", fontWeight: "400" },
      { text: "Bold text", fontFamily: "UnknownFont", fontWeight: "700" },
    ]);

    const fontPrepResult = {
      boldThresholds: new Map<string, number>(),
      fontNameMap: new Map<string, string>(),
      weightToFontName: new Map<string, Map<number, string>>(),
      warnings: [],
    };

    const { buffer } = await buildPptx(data, { fontPrepResult });
    expect(buffer).toBeDefined();
  });

  test("no fontPrepResult at all still works", async () => {
    const data = makeTextSlide([
      { text: "Some text", fontFamily: "Inter", fontWeight: "700" },
    ]);

    const { buffer } = await buildPptx(data);
    expect(buffer).toBeDefined();
  });
});
