import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { existsSync } from "fs";
import { launchBrowser, loadHtml, closeBrowser } from "../src/browser";
import { extractSlideData } from "../src/dom-extract";

const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures");

const FIXTURES = [
  "slide.html",
  "typography.html",
  "gradients.html",
  "images.html",
  "mixed.html",
  "tables-and-grids.html",
  "data-attrs.html",
];

/** Strip volatile fields from slide data for stable snapshots */
function stripVolatile(slides: any[]): any[] {
  return slides.map(slide => ({
    ...slide,
    // Strip base64 image data (large & varies with rendering)
    images: (slide.images ?? []).map((img: any) => ({
      x: Math.round(img.x),
      y: Math.round(img.y),
      width: Math.round(img.width),
      height: Math.round(img.height),
    })),
    // Round coordinates to integers for stability
    rects: slide.rects.map((r: any) => ({
      ...r,
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    })),
    texts: slide.texts.map((t: any) => ({
      ...t,
      x: Math.round(t.x),
      y: Math.round(t.y),
      width: Math.round(t.width),
      height: Math.round(t.height),
      parentWidth: Math.round(t.parentWidth),
      parentHeight: Math.round(t.parentHeight),
      runs: t.runs?.map((r: any) => ({
        ...r,
        fontSize: Math.round(r.fontSize),
        letterSpacing: Math.round(r.letterSpacing * 100) / 100,
        lineHeight: Math.round((r.lineHeight ?? 1.2) * 100) / 100,
      })),
    })),
  }));
}

describe("extraction snapshots", () => {
  for (const fixture of FIXTURES) {
    test(`${fixture} extraction is stable`, async () => {
      const htmlPath = resolve(FIXTURES_DIR, fixture);
      if (!existsSync(htmlPath)) {
        console.log(`Skipping: ${fixture} not found`);
        return;
      }

      const ctx = await launchBrowser();
      try {
        await loadHtml(ctx.page, htmlPath);
        const { slides } = await extractSlideData(ctx.page);
        const stable = stripVolatile(slides);
        expect(stable).toMatchSnapshot();
      } finally {
        await closeBrowser(ctx);
      }
    }, 60_000);
  }
});
