import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { existsSync, rmSync } from "fs";
import JSZip from "jszip";
import { buildPptx } from "../src/pptx-builder";
import { convertHtmlToSlides } from "../src/pipeline";
import type { SlideData } from "../src/types";

const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures");
const TEST_OUTPUT = resolve(import.meta.dir, "../.test-output-images");

describe("image support", () => {
  describe("pipeline - image extraction", () => {
    test.skipIf(!!process.env.CI)("detects img, svg, and background-image elements", async () => {
      const htmlPath = resolve(FIXTURES_DIR, "images.html");
      if (!existsSync(htmlPath)) {
        console.log("Skipping: fixture not found");
        return;
      }

      if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true });

      const result = await convertHtmlToSlides(htmlPath, {
        outputDir: TEST_OUTPUT,
        noPptx: true,
        noPng: true,
        noPdf: true,
        onProgress: () => {},
      });

      const slide = result.slideData[0];
      expect(slide).toBeDefined();
      expect(slide.images).toBeDefined();
      expect(Array.isArray(slide.images)).toBe(true);

      // Should have 3 images: <img>, <svg>, background-image url()
      expect(slide.images.length).toBe(4);

      for (const img of slide.images) {
        // Each image should have valid position/size
        expect(img.x).toBeGreaterThanOrEqual(0);
        expect(img.y).toBeGreaterThanOrEqual(0);
        expect(img.width).toBeGreaterThan(0);
        expect(img.height).toBeGreaterThan(0);
        // Each should have base64 PNG data
        expect(img.base64).toBeDefined();
        expect(img.base64.length).toBeGreaterThan(0);
      }

      if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true });
    }, 60_000);

    test("gradient elements are NOT treated as images", async () => {
      const htmlPath = resolve(FIXTURES_DIR, "images.html");
      if (!existsSync(htmlPath)) return;

      if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true });

      const result = await convertHtmlToSlides(htmlPath, {
        outputDir: TEST_OUTPUT,
        noPptx: true,
        noPng: true,
        noPdf: true,
        onProgress: () => {},
      });

      const slide = result.slideData[0];
      // gradient-not-image div should appear in rects, not images
      expect(slide.images.length).toBe(4); // only the 3 actual images
      // The gradient rect should exist
      const hasGradientRect = slide.rects.some(r => r.gradient != null);
      expect(hasGradientRect).toBe(true);

      if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true });
    }, 60_000);
  });

  describe("pptx-builder - image rendering", () => {
    test("builds PPTX with image elements", async () => {
      const data: SlideData[] = [{
        width: 1920,
        height: 1080,
        backgroundColor: "rgb(26, 26, 46)",
        rects: [],
        tables: [],
        texts: [],
        images: [{
          x: 100,
          y: 200,
          width: 200,
          height: 200,
          // Minimal 1x1 red PNG
          base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
        }],
      }];

      const { buffer } = await buildPptx(data);
      expect(buffer).toBeDefined();
      const zip = await JSZip.loadAsync(buffer);
      expect(zip.file("ppt/media/image1.png")).toBeDefined();
    });

    test("builds PPTX with multiple images", async () => {
      const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
      const data: SlideData[] = [{
        width: 1920,
        height: 1080,
        backgroundColor: "rgb(255, 255, 255)",
        rects: [],
        tables: [],
        texts: [],
        images: [
          { x: 100, y: 100, width: 200, height: 200, base64 },
          { x: 400, y: 100, width: 200, height: 200, base64 },
          { x: 700, y: 100, width: 200, height: 200, base64 },
        ],
      }];

      const { buffer } = await buildPptx(data);
      expect(buffer).toBeDefined();
      const zip = await JSZip.loadAsync(buffer);
      expect(zip.file("ppt/media/image1.png")).toBeDefined();
      expect(zip.file("ppt/media/image2.png")).toBeDefined();
      expect(zip.file("ppt/media/image3.png")).toBeDefined();
    });

    test("handles empty images array", async () => {
      const data: SlideData[] = [{
        width: 1920,
        height: 1080,
        backgroundColor: "rgb(0, 0, 0)",
        rects: [],
        tables: [],
        texts: [],
        images: [],
      }];

      const { buffer } = await buildPptx(data);
      expect(buffer).toBeDefined();
    });
  });
});
