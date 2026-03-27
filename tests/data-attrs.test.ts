import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { existsSync, rmSync } from "fs";
import { convertHtmlToSlides } from "../src/pipeline";

const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures");
const TEST_OUTPUT = resolve(import.meta.dir, "../.test-output-data-attrs");

describe("data-sg-wrap attribute", () => {
  test("respects explicit wrap=false on headings and wrap=true on paragraphs", async () => {
    const htmlPath = resolve(FIXTURES_DIR, "data-attrs.html");
    if (!existsSync(htmlPath)) {
      console.log("Skipping: fixture not found");
      return;
    }

    if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true });

    const result = await convertHtmlToSlides(htmlPath, {
      outputDir: TEST_OUTPUT,
      noPptx: true,
      noPdf: true,
      noPng: true,
      onProgress: () => {},
    });

    expect(result.warnings).toBeInstanceOf(Array);

    // Slide 1 has 3 text elements with explicit wrap attributes
    const slide1 = result.slideData[0];
    expect(slide1.texts.length).toBeGreaterThanOrEqual(3);

    // Find the heading (data-sg-wrap="false")
    const heading = slide1.texts.find(t => t.text.includes("Single Line Heading"));
    expect(heading).toBeDefined();
    expect(heading!.wrap).toBe(false);

    // Find the paragraph (data-sg-wrap="true")
    const paragraph = slide1.texts.find(t => t.text.includes("paragraph that should wrap"));
    expect(paragraph).toBeDefined();
    expect(paragraph!.wrap).toBe(true);

    // Find the metric (data-sg-wrap="false")
    const metric = slide1.texts.find(t => t.text.includes("$1,234,567"));
    expect(metric).toBeDefined();
    expect(metric!.wrap).toBe(false);

    if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true });
  }, 60_000);
});

describe("data-sg-group attribute", () => {
  test("groups text runs with same data-sg-group into single text element", async () => {
    const htmlPath = resolve(FIXTURES_DIR, "data-attrs.html");
    if (!existsSync(htmlPath)) {
      console.log("Skipping: fixture not found");
      return;
    }

    if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true });

    const result = await convertHtmlToSlides(htmlPath, {
      outputDir: TEST_OUTPUT,
      noPptx: true,
      noPdf: true,
      noPng: true,
      onProgress: () => {},
    });

    // Slide 2 has grouped metrics
    const slide2 = result.slideData[1];

    // The "metric-revenue" group should produce a single text element with 2 runs
    const revenueText = slide2.texts.find(t => t.text.includes("$2.4M"));
    expect(revenueText).toBeDefined();
    expect(revenueText!.text).toContain("revenue");
    expect(revenueText!.runs.length).toBeGreaterThanOrEqual(2);

    // The "metric-users" group should produce a single text element with 2 runs
    const usersText = slide2.texts.find(t => t.text.includes("12,345"));
    expect(usersText).toBeDefined();
    expect(usersText!.text).toContain("active users");
    expect(usersText!.runs.length).toBeGreaterThanOrEqual(2);

    // The ungrouped text should be a separate element
    const ungrouped = slide2.texts.find(t => t.text.includes("No group attribute"));
    expect(ungrouped).toBeDefined();

    if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true });
  }, 60_000);
});
