import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { $ } from "bun";
import type { ConvertOptions, ConvertResult, ConvertBufferOptions, ConvertBufferResult, SlideData, FontPrepResult } from "./types";
import { SlideGenError } from "./errors";
import { launchBrowser, loadHtml, loadHtmlContent, generatePdf, generatePdfBuffer, generateSlidePngs, generateSlidePngBuffers, closeBrowser } from "./browser";
import { extractSlideData } from "./dom-extract";
import { prepareFontsFromSlideData, buildFontPrepResultFromManifest } from "./fonts";
import { buildPptx } from "./pptx-builder";
import { renderPptx } from "./render";

/**
 * Buffer-based pipeline: accepts HTML string, returns all outputs as in-memory buffers.
 * No temp directories are created for output — only fontsDir is used on disk (persistent cache).
 */
export async function convertHtmlBuffers(
  options: ConvertBufferOptions,
): Promise<ConvertBufferResult> {
  const log = options.onProgress ?? console.log;
  const fontsDir = options.fontsDir ?? resolve(process.cwd(), ".slide-gen-fonts");

  const warnings: string[] = [];
  const result: ConvertBufferResult = {
    pngBuffers: [],
    slideData: [],
    warnings,
  };

  // 1. Launch browser and load HTML from string
  log("Launching browser...");
  const ctx = await launchBrowser();

  try {
    await loadHtmlContent(ctx.page, options.html);

    // 2. Generate PDF buffer
    if (!options.noPdf) {
      log("Generating PDF...");
      result.pdfBuffer = await generatePdfBuffer(ctx.page);
      log("PDF generated");
    }

    // 3. Extract slide data from DOM
    log("Extracting slide data from DOM...");
    const { slides: slideData, imageRefs } = await extractSlideData(ctx.page);
    if (slideData.length === 0) {
      throw new SlideGenError('No slides found. Ensure slides have class="slide".');
    }
    result.slideData = slideData;
    log(`Extracted ${slideData.length} slides`);

    // 4. Capture images via screenshot
    if (imageRefs.length > 0) {
      log(`Capturing ${imageRefs.length} images...`);
      const slideEls = await ctx.page.$$(".slide");
      for (const ref of imageRefs) {
        const imgEl = await slideEls[ref.slideIndex]?.$(ref.selector);
        if (!imgEl) continue;
        const buffer = await imgEl.screenshot({ type: "png", omitBackground: true });
        slideData[ref.slideIndex].images.push({
          x: ref.x,
          y: ref.y,
          width: ref.width,
          height: ref.height,
          base64: buffer.toString("base64"),
        });
      }
      log(`Captured ${imageRefs.length} images`);
    }

    // 5. Generate PNG buffers
    if (!options.noPng) {
      log("Generating slide PNGs...");
      result.pngBuffers = await generateSlidePngBuffers(ctx.page);
      log(`${result.pngBuffers.length} slide PNGs generated`);
    }
  } finally {
    await closeBrowser(ctx);
  }

  // 6. Build PPTX buffer
  if (!options.noPptx) {
    let fontPrepResult: FontPrepResult | undefined;

    if (options.skipFonts) {
      const manifestPath = resolve(fontsDir, "manifest.json");
      if (existsSync(manifestPath)) {
        log("Using cached fonts...");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        fontPrepResult = buildFontPrepResultFromManifest(manifest, result.slideData);
      } else {
        log("No cached fonts found, downloading...");
        fontPrepResult = await prepareFontsFromSlideData(result.slideData, fontsDir, log);
      }
    } else {
      log("Preparing fonts...");
      fontPrepResult = await prepareFontsFromSlideData(result.slideData, fontsDir, log);
    }
    warnings.push(...(fontPrepResult.warnings ?? []));
    log("Fonts prepared");

    log("Building PPTX...");
    const pptxResult = await buildPptx(result.slideData, { fontPrepResult });
    result.pptxBuffer = pptxResult.buffer;
    warnings.push(...pptxResult.warnings);
    log("PPTX generated");
  }

  log("Done!");
  return result;
}

/**
 * File-path based pipeline: reads HTML from disk, writes all outputs to outputDir.
 * Delegates to convertHtmlBuffers internally.
 */
export async function convertHtmlToSlides(
  htmlPath: string,
  options: ConvertOptions,
): Promise<ConvertResult> {
  const log = options.onProgress ?? console.log;
  const outputDir = resolve(options.outputDir);
  const fontsDir = options.fontsDir ?? resolve(outputDir, "fonts");

  if (!existsSync(htmlPath)) {
    throw new SlideGenError(`Input HTML file not found: ${htmlPath}`);
  }

  const ext = htmlPath.toLowerCase().split(".").pop();
  if (ext !== "html" && ext !== "htm" && ext !== "slides") {
    throw new SlideGenError(`Input file must be .html, .htm, or .slides, got: .${ext}`);
  }

  await $`mkdir -p ${outputDir}`.quiet();

  const html = readFileSync(htmlPath, "utf-8");

  const bufferResult = await convertHtmlBuffers({
    html,
    noPdf: options.noPdf,
    noPptx: options.noPptx,
    noPng: options.noPng,
    skipFonts: options.skipFonts,
    fontsDir,
    onProgress: log,
  });

  const result: ConvertResult = {
    pngPaths: [],
    slideData: bufferResult.slideData,
    warnings: bufferResult.warnings,
  };

  // Write PDF to disk
  if (bufferResult.pdfBuffer) {
    const pdfPath = resolve(outputDir, "presentation.pdf");
    await Bun.write(pdfPath, bufferResult.pdfBuffer);
    result.pdfPath = pdfPath;
  }

  // Save slide data for debugging
  const slideDataPath = resolve(outputDir, "slide-data.json");
  await Bun.write(slideDataPath, JSON.stringify(bufferResult.slideData, null, 2));

  // Write PNGs to disk
  for (let i = 0; i < bufferResult.pngBuffers.length; i++) {
    const pngPath = resolve(outputDir, `slide-${i + 1}.png`);
    await Bun.write(pngPath, bufferResult.pngBuffers[i]);
    result.pngPaths.push(pngPath);
  }

  // Write PPTX to disk
  if (bufferResult.pptxBuffer) {
    const pptxPath = resolve(outputDir, "presentation.pptx");
    await Bun.write(pptxPath, bufferResult.pptxBuffer);
    result.pptxPath = pptxPath;

    // Optional: Render PPTX back to PNGs (requires LibreOffice + Ghostscript)
    if (options.render) {
      log("Rendering PPTX to PNGs...");
      result.renderPngPaths = await renderPptx(pptxPath, outputDir, fontsDir, log);
      log("PPTX rendering complete");
    }
  }

  return result;
}
