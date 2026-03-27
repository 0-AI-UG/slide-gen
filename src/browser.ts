import { chromium, type Browser, type Page } from "playwright";
import { resolve } from "path";
import { BrowserError } from "./errors";

export interface BrowserContext {
  browser: Browser;
  page: Page;
}

export async function launchBrowser(): Promise<BrowserContext> {
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    return { browser, page };
  } catch (err) {
    throw new BrowserError("Failed to launch browser. Is Playwright installed? Run: bunx playwright install chromium", { cause: err });
  }
}

export async function loadHtml(page: Page, htmlPath: string): Promise<void> {
  try {
    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
    await page.setViewportSize({ width: 1920, height: 1080 });
  } catch (err) {
    throw new BrowserError(`Failed to load HTML: ${htmlPath}`, { cause: err });
  }
}

export async function loadHtmlContent(page: Page, html: string): Promise<void> {
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.setViewportSize({ width: 1920, height: 1080 });
  } catch (err) {
    throw new BrowserError("Failed to load HTML content", { cause: err });
  }
}

export async function generatePdfBuffer(page: Page): Promise<Buffer> {
  try {
    return await page.pdf({
      width: "1920px",
      height: "1080px",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } catch (err) {
    throw new BrowserError("Failed to generate PDF", { cause: err });
  }
}

export async function generatePdf(page: Page, pdfPath: string): Promise<void> {
  try {
    await page.pdf({
      path: pdfPath,
      width: "1920px",
      height: "1080px",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } catch (err) {
    throw new BrowserError("Failed to generate PDF", { cause: err });
  }
}

export async function generateSlidePngBuffers(page: Page): Promise<Buffer[]> {
  try {
    const slides = await page.$$(".slide");
    const buffers: Buffer[] = [];
    for (let i = 0; i < slides.length; i++) {
      const buffer = await slides[i].screenshot({ type: "png" });
      buffers.push(buffer);
    }
    return buffers;
  } catch (err) {
    throw new BrowserError("Failed to generate slide PNGs", { cause: err });
  }
}

export async function generateSlidePngs(page: Page, outputDir: string): Promise<string[]> {
  try {
    const slides = await page.$$(".slide");
    const paths: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const pngPath = resolve(outputDir, `slide-${i + 1}.png`);
      await slides[i].screenshot({ path: pngPath });
      paths.push(pngPath);
    }
    return paths;
  } catch (err) {
    throw new BrowserError("Failed to generate slide PNGs", { cause: err });
  }
}

export async function closeBrowser(ctx: BrowserContext): Promise<void> {
  await ctx.browser.close();
}
