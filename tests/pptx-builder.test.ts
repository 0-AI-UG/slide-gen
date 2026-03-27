import { describe, test, expect } from "bun:test";
import JSZip from "jszip";
import { buildPptx } from "../src/pptx-builder";
import type { SlideData } from "../src/types";

function makeSlideData(overrides: Partial<SlideData> = {}): SlideData[] {
  return [{
    width: 1920,
    height: 1080,
    backgroundColor: "rgb(12, 12, 20)",
    rects: [],
    texts: [],
    images: [],
    ...overrides,
  }];
}

async function getSlideXml(data: SlideData[], options?: Parameters<typeof buildPptx>[1]): Promise<string> {
  const { buffer } = await buildPptx(data, options);
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("ppt/slides/slide1.xml")!.async("string");
}

describe("buildPptx", () => {
  test("creates a valid PPTX ZIP with required parts", async () => {
    const { buffer } = await buildPptx(makeSlideData());
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("[Content_Types].xml")).toBeDefined();
    expect(zip.file("_rels/.rels")).toBeDefined();
    expect(zip.file("ppt/presentation.xml")).toBeDefined();
    expect(zip.file("ppt/slides/slide1.xml")).toBeDefined();
    expect(zip.file("ppt/theme/theme1.xml")).toBeDefined();
    expect(zip.file("ppt/slideMasters/slideMaster1.xml")).toBeDefined();
    expect(zip.file("ppt/slideLayouts/slideLayout1.xml")).toBeDefined();
  });

  test("creates correct number of slides", async () => {
    const data = [
      ...makeSlideData(),
      ...makeSlideData({ backgroundColor: "rgb(255, 255, 255)" }),
    ];
    const { buffer } = await buildPptx(data);
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("ppt/slides/slide1.xml")).toBeDefined();
    expect(zip.file("ppt/slides/slide2.xml")).toBeDefined();
    expect(zip.file("ppt/slides/slide3.xml")).toBeNull();
  });

  test("handles gradient backgrounds directly in XML", async () => {
    const data = makeSlideData({
      gradient: {
        type: "linear",
        angle: 180,
        stops: [
          { color: "#FF0000", position: 0 },
          { color: "#0000FF", position: 100 },
        ],
      },
    });
    const xml = await getSlideXml(data);
    expect(xml).toContain("<a:gradFill>");
    expect(xml).toContain('<a:srgbClr val="FF0000"');
    expect(xml).toContain('<a:srgbClr val="0000FF"');
  });

  test("processes text elements with bold threshold", async () => {
    const data = makeSlideData({
      texts: [{
        runs: [{
          text: "Hello",
          fontSize: 48,
          fontFamily: "Syne",
          fontWeight: "700",
          fontStyle: "normal",
          color: "rgb(255, 255, 255)",
          letterSpacing: 0,
          textTransform: "none",
        }],
        x: 100,
        y: 100,
        width: 400,
        height: 60,
        textAlign: "left",
        rotation: 0,
        parentWidth: 1920,
        parentHeight: 1080,
        wrap: false,
        text: "Hello",
        fontSize: 48,
        fontFamily: "Syne",
        fontWeight: "700",
        fontStyle: "normal",
        color: "rgb(255, 255, 255)",
        letterSpacing: 0,
        textTransform: "none",
      }],
    });

    const fontPrepResult = {
      boldThresholds: new Map([["Syne", 500]]),
      fontNameMap: new Map(),
      weightToFontName: new Map(),
      warnings: [],
    };
    const xml = await getSlideXml(data, { fontPrepResult });
    expect(xml).toContain('b="1"');
    expect(xml).toContain("Hello");
  });

  test("handles rect elements with solid fill", async () => {
    const xml = await getSlideXml(makeSlideData({
      rects: [{
        x: 100, y: 100, width: 400, height: 200,
        backgroundColor: "rgba(255, 0, 0, 1)",
      }],
    }));
    expect(xml).toContain('<a:srgbClr val="FF0000"');
    expect(xml).toContain('prst="rect"');
  });

  test("handles rect elements with gradient fill", async () => {
    const xml = await getSlideXml(makeSlideData({
      rects: [{
        x: 100, y: 100, width: 400, height: 200,
        backgroundColor: "rgb(255, 0, 0)",
        gradient: {
          type: "linear",
          angle: 90,
          stops: [
            { color: "#FF0000", position: 0 },
            { color: "#0000FF", position: 100 },
          ],
        },
      }],
    }));
    expect(xml).toContain("<a:gradFill>");
    expect(xml).toContain("<a:lin");
  });

  test("handles rect elements with border radius", async () => {
    const xml = await getSlideXml(makeSlideData({
      rects: [{
        x: 50, y: 50, width: 300, height: 150,
        backgroundColor: "rgb(0, 128, 255)",
        borderRadius: 20,
      }],
    }));
    expect(xml).toContain('prst="roundRect"');
    expect(xml).toMatch(/<a:gd name="adj" fmla="val \d+"/);
  });

  test("rect without borderRadius produces rect geometry", async () => {
    const xml = await getSlideXml(makeSlideData({
      rects: [{
        x: 50, y: 50, width: 300, height: 150,
        backgroundColor: "rgb(0, 128, 255)",
      }],
    }));
    expect(xml).toContain('prst="rect"');
    expect(xml).not.toContain('prst="roundRect"');
  });

  test("handles image elements", async () => {
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const { buffer } = await buildPptx(makeSlideData({
      images: [{
        x: 100, y: 100, width: 200, height: 200,
        base64: pngBase64,
      }],
    }));
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("ppt/media/image1.png")).toBeDefined();
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("<p:pic>");
    expect(slideXml).toContain("r:embed=");
  });

  test("handles empty slide data (no texts, rects, or images)", async () => {
    const { buffer } = await buildPptx(makeSlideData());
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("ppt/slides/slide1.xml")).toBeDefined();
  });

  test("handles NBSP substitution for whitespace preservation", async () => {
    const xml = await getSlideXml(makeSlideData({
      texts: [{
        runs: [{
          text: " leading space",
          fontSize: 16,
          fontFamily: "JetBrains Mono",
          fontWeight: "400",
          fontStyle: "normal",
          color: "rgb(200, 200, 200)",
          letterSpacing: 0,
          textTransform: "none",
        }],
        x: 50,
        y: 50,
        width: 300,
        height: 24,
        textAlign: "left",
        rotation: 0,
        parentWidth: 1920,
        parentHeight: 1080,
        wrap: true,
        text: " leading space",
        fontSize: 16,
        fontFamily: "JetBrains Mono",
        fontWeight: "400",
        fontStyle: "normal",
        color: "rgb(200, 200, 200)",
        letterSpacing: 0,
        textTransform: "none",
      }],
    }));
    // NBSP should be present (U+00A0) instead of leading space
    expect(xml).toContain("\u00A0leading space");
  });
});
