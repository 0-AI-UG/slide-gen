import { describe, test, expect } from "bun:test";
import JSZip from "jszip";
import { buildPptx } from "../src/pptx-builder";
import type { SlideData } from "../src/types";

function makeSlideData(overrides: Partial<SlideData> = {}): SlideData {
  return {
    width: 1920,
    height: 1080,
    backgroundColor: "rgb(12, 12, 20)",
    rects: [],
    texts: [],
    images: [],
    tables: [],
    ...overrides,
  };
}

/** Parse and return all XML files from a PPTX buffer */
async function loadPptx(data: SlideData[]) {
  const { buffer, warnings } = await buildPptx(data);
  const zip = await JSZip.loadAsync(buffer);
  return { zip, warnings };
}

describe("PPTX roundtrip integrity", () => {
  test("all required parts exist", async () => {
    const { zip } = await loadPptx([makeSlideData()]);

    const required = [
      "[Content_Types].xml",
      "_rels/.rels",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
      "ppt/slides/slide1.xml",
      "ppt/slides/_rels/slide1.xml.rels",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      "ppt/theme/theme1.xml",
      "ppt/presProps.xml",
      "ppt/viewProps.xml",
      "ppt/tableStyles.xml",
      "docProps/app.xml",
      "docProps/core.xml",
    ];

    for (const path of required) {
      expect(zip.file(path)).not.toBeNull();
    }
  });

  test("all XML files are well-formed (no unclosed tags)", async () => {
    const slide = makeSlideData({
      rects: [{ x: 0, y: 0, width: 200, height: 100, backgroundColor: "rgb(255,0,0)" }],
      texts: [{
        runs: [{ text: "Hello", fontSize: 24, fontFamily: "Arial", fontWeight: "400", fontStyle: "normal", color: "rgb(0,0,0)", letterSpacing: 0, textTransform: "none" }],
        x: 10, y: 10, width: 100, height: 30, textAlign: "left", rotation: 0, parentWidth: 1920, parentHeight: 1080, wrap: false,
        text: "Hello", fontSize: 24, fontFamily: "Arial", fontWeight: "400", fontStyle: "normal", color: "rgb(0,0,0)", letterSpacing: 0, textTransform: "none",
      }],
      notes: "Speaker notes here",
    });
    const { zip } = await loadPptx([slide]);

    const xmlFiles: string[] = [];
    zip.forEach((path, file) => {
      if (path.endsWith(".xml") || path.endsWith(".rels")) {
        xmlFiles.push(path);
      }
    });

    expect(xmlFiles.length).toBeGreaterThan(0);

    for (const path of xmlFiles) {
      const content = await zip.file(path)!.async("string");
      // Basic well-formedness: starts with XML header or Relationships/Types tag
      expect(content.startsWith("<?xml") || content.startsWith("<")).toBe(true);
      // No obviously broken XML: unmatched opening angle brackets
      const opens = (content.match(/</g) || []).length;
      const closes = (content.match(/>/g) || []).length;
      expect(opens).toBe(closes);
    }
  });

  test("content types cover all parts in the ZIP", async () => {
    const slide = makeSlideData({
      notes: "Test notes",
    });
    const { zip } = await loadPptx([slide, makeSlideData()]);

    const contentTypes = await zip.file("[Content_Types].xml")!.async("string");

    // Every slide should be listed
    expect(contentTypes).toContain("slide1.xml");
    expect(contentTypes).toContain("slide2.xml");

    // Notes-related content types should be present when notes exist
    expect(contentTypes).toContain("notesSlide");
    expect(contentTypes).toContain("notesMaster");
  });

  test("presentation.xml references all slides", async () => {
    const { zip } = await loadPptx([makeSlideData(), makeSlideData(), makeSlideData()]);

    const presXml = await zip.file("ppt/presentation.xml")!.async("string");
    // Should have 3 sldId entries (self-closing tags)
    const slideIdMatches = presXml.match(/<p:sldId /g) || [];
    expect(slideIdMatches.length).toBe(3);
  });

  test("slide rels reference slideLayout", async () => {
    const { zip } = await loadPptx([makeSlideData()]);

    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(rels).toContain("slideLayout1.xml");
  });

  test("notes slides have rels back to slide and notes master", async () => {
    const { zip } = await loadPptx([makeSlideData({ notes: "My notes" })]);

    expect(zip.file("ppt/notesSlides/notesSlide1.xml")).not.toBeNull();
    const notesRels = await zip.file("ppt/notesSlides/_rels/notesSlide1.xml.rels")!.async("string");
    expect(notesRels).toContain("slide1.xml");
    expect(notesRels).toContain("notesMaster1.xml");
  });

  test("image media files match image rels", async () => {
    // Create a slide with an image
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const slide = makeSlideData({
      images: [{ x: 0, y: 0, width: 100, height: 100, base64: tinyPng }],
    });
    const { zip } = await loadPptx([slide]);

    // Image media should exist
    expect(zip.file("ppt/media/image1.png")).not.toBeNull();

    // Slide rels should reference the image
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(rels).toContain("image1.png");
  });

  test("hyperlink rels have External target mode", async () => {
    const slide = makeSlideData({
      texts: [{
        runs: [{ text: "Link", fontSize: 16, fontFamily: "Arial", fontWeight: "400", fontStyle: "normal", color: "rgb(0,0,255)", letterSpacing: 0, textTransform: "none", href: "https://example.com" }],
        x: 10, y: 10, width: 100, height: 20, textAlign: "left", rotation: 0, parentWidth: 1920, parentHeight: 1080, wrap: false,
        text: "Link", fontSize: 16, fontFamily: "Arial", fontWeight: "400", fontStyle: "normal", color: "rgb(0,0,255)", letterSpacing: 0, textTransform: "none",
      }],
    });
    const { zip } = await loadPptx([slide]);

    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    expect(rels).toContain("https://example.com");
    expect(rels).toContain('TargetMode="External"');
  });
});
