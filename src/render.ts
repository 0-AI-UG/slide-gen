import { resolve } from "path";
import { $ } from "bun";
import { RenderError } from "./errors";

/** Render a PPTX file to PDF and then to PNGs using LibreOffice + Ghostscript */
export async function renderPptx(
  pptxPath: string,
  outputDir: string,
  fontsDir: string,
  log: (msg: string) => void = console.log,
): Promise<string[]> {
  // Install fonts as system fonts for LibreOffice
  const isMac = process.platform === "darwin";
  const systemFontsDir = isMac
    ? resolve(process.env.HOME || "~", "Library/Fonts")
    : resolve(process.env.HOME || "~", ".local/share/fonts");

  await $`mkdir -p ${systemFontsDir}`.quiet();
  const fontFiles = await Array.fromAsync(new Bun.Glob("*.ttf").scan(fontsDir));
  for (const f of fontFiles) {
    await $`cp ${resolve(fontsDir, f)} ${systemFontsDir}/`.quiet();
  }
  if (!isMac) await $`fc-cache -f`.quiet();
  log(`${fontFiles.length} fonts installed to ${systemFontsDir}`);

  const renderDir = resolve(outputDir, "pptx-render");
  await $`mkdir -p ${renderDir}`;

  // Check for soffice
  try {
    await $`which soffice`.quiet();
  } catch {
    throw new RenderError(
      "LibreOffice not found. Install it:\n" +
      "  macOS: brew install --cask libreoffice\n" +
      "  Linux: sudo apt install libreoffice",
    );
  }

  // Check for gs
  try {
    await $`which gs`.quiet();
  } catch {
    throw new RenderError(
      "Ghostscript not found. Install it:\n" +
      "  macOS: brew install ghostscript\n" +
      "  Linux: sudo apt install ghostscript",
    );
  }

  log("Converting PPTX → PDF via LibreOffice...");
  try {
    await $`soffice --headless --convert-to pdf --outdir ${renderDir} ${pptxPath}`.quiet();
  } catch (err) {
    throw new RenderError("LibreOffice PPTX→PDF conversion failed", { cause: err });
  }

  log("Rasterizing PDF → PNGs via Ghostscript...");
  const pdfFile = resolve(renderDir, "presentation.pdf");
  try {
    await $`gs -dNOPAUSE -dBATCH -sDEVICE=png16m -r150 -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile=${renderDir}/slide-%d.png ${pdfFile}`.quiet();
  } catch (err) {
    throw new RenderError("Ghostscript PDF→PNG rasterization failed", { cause: err });
  }

  // Collect output PNGs
  const pngFiles = await Array.fromAsync(new Bun.Glob("slide-*.png").scan(renderDir));
  const paths = pngFiles.map(f => resolve(renderDir, f)).sort();
  log(`PPTX rendered to ${paths.length} PNGs`);
  return paths;
}
