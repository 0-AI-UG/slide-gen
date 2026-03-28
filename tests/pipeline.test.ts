import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { existsSync, rmSync } from "fs";
import { convertHtmlToSlides } from "../src/pipeline";
import { SlideGenError } from "../src/errors";

const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures");
const TEST_OUTPUT = resolve(import.meta.dir, "../.test-output");

describe("pipeline error handling", () => {
  test("throws SlideGenError for nonexistent HTML file", async () => {
    const fakePath = resolve(FIXTURES_DIR, "nonexistent.html");
    await expect(
      convertHtmlToSlides(fakePath, { outputDir: TEST_OUTPUT, onProgress: () => {} }),
    ).rejects.toThrow(SlideGenError);
  });

  test("throws SlideGenError for non-HTML file extension", async () => {
    // Use a file that exists but has wrong extension
    const tsFile = resolve(import.meta.dir, "../src/pipeline.ts");
    await expect(
      convertHtmlToSlides(tsFile, { outputDir: TEST_OUTPUT, onProgress: () => {} }),
    ).rejects.toThrow(SlideGenError);
  });
});

describe("pipeline integration", () => {
  test.skipIf(!!process.env.CI)("converts slide.html to PDF and PNG (no PPTX to skip font download)", async () => {
    const htmlPath = resolve(FIXTURES_DIR, "slide.html");
    if (!existsSync(htmlPath)) {
      console.log("Skipping: fixture not found");
      return;
    }

    // Clean up test output
    if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true });

    const result = await convertHtmlToSlides(htmlPath, {
      outputDir: TEST_OUTPUT,
      noPptx: true,
      onProgress: () => {}, // Silence output
    });

    expect(result.pdfPath).toBeDefined();
    expect(existsSync(result.pdfPath!)).toBe(true);
    expect(result.pngPaths.length).toBeGreaterThan(0);
    expect(result.slideData.length).toBeGreaterThan(0);

    // Verify slide data structure
    const slide = result.slideData[0]!;
    expect(slide.width).toBe(1920);
    expect(slide.height).toBe(1080);
    expect(slide.backgroundColor).toBeDefined();

    // Clean up
    if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true });
  }, 60_000);
});
