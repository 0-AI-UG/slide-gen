/**
 * Font downloading from Google Fonts — fetches font files from GitHub and the CSS API.
 */

import { resolve } from "path";
import { FONT_DOWNLOAD_TIMEOUT_MS } from "./constants";

const GITHUB_RAW = "https://github.com/google/fonts/raw/main";
const GOOGLE_FONTS_CSS_API = "https://fonts.googleapis.com/css2";
// Use an older IE11 User-Agent to get TTF format from Google Fonts CSS API
// (modern browsers get WOFF2 which our name table parser can't read)
const TTF_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Trident/7.0; rv:11.0) like Gecko";

interface MetadataFont {
  filename?: string;
  style?: string;
  weight?: number;
  [key: string]: unknown;
}

export interface DownloadedFont {
  path: string;
  isVariable: boolean;
  style: string;
}

async function download(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(FONT_DOWNLOAD_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.arrayBuffer();
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.name === "TimeoutError" || e.name === "AbortError") return null;
      if (e.message?.includes("404")) return null;
    }
    throw e;
  }
}

function parseMetadataPb(text: string): MetadataFont[] {
  const fonts: MetadataFont[] = [];
  let current: Record<string, unknown> | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "fonts {") {
      current = {};
    } else if (line === "}" && current !== null) {
      fonts.push(current as MetadataFont);
      current = null;
    } else if (current !== null && line.includes(":")) {
      const colonIdx = line.indexOf(":");
      const key = line.slice(0, colonIdx).trim();
      let val: string | number = line.slice(colonIdx + 1).trim().replace(/^"|"$/g, "");
      if (key === "weight") val = parseInt(val, 10);
      current[key] = val;
    }
  }
  return fonts;
}

function familyToDir(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function downloadFontFamily(family: string, fontsDir: string, log: (msg: string) => void, warnings: string[]): Promise<DownloadedFont[]> {
  const dirName = familyToDir(family);

  for (const licenseDir of ["ofl", "apache", "ufl"]) {
    const metaUrl = `${GITHUB_RAW}/${licenseDir}/${dirName}/METADATA.pb`;
    const metaData = await download(metaUrl);
    if (!metaData) continue;

    const fonts = parseMetadataPb(new TextDecoder().decode(metaData));
    const results: DownloadedFont[] = [];

    for (const f of fonts) {
      const filename = (f.filename as string) || "";
      if (!filename) continue;

      const isVariable = filename.includes("[");

      if (!isVariable) {
        const weight = (f.weight as number) || 400;
        if (weight > 400 && weight < 600) continue;
      }

      const url = `${GITHUB_RAW}/${licenseDir}/${dirName}/${encodeURIComponent(filename)}`;
      const data = await download(url);
      if (!data) {
        const msg = `Failed to download font file '${filename}' for '${family}'`;
        log(`  Warning: ${msg}`);
        warnings.push(msg);
        continue;
      }

      const outFilename = isVariable ? filename.replace(/\[.*?\]/, "_var") : filename;
      const outPath = resolve(fontsDir, outFilename);
      await Bun.write(outPath, data);
      log(`  ${filename} (${data.byteLength.toLocaleString()} bytes)`);
      results.push({ path: outPath, isVariable, style: (f.style as string) || "normal" });
    }

    return results;
  }

  const msg = `'${family}' not found on Google Fonts — skipping`;
  log(`  Warning: ${msg}`);
  warnings.push(msg);
  return [];
}

/** Download a static weight file from the Google Fonts CSS API */
export async function downloadStaticWeight(
  family: string,
  weight: number,
  fontsDir: string,
  variantName: string,
  log: (msg: string) => void,
  warnings: string[],
): Promise<string | null> {
  const familyNoSpaces = family.replace(/\s+/g, "");
  const outPath = resolve(fontsDir, `${familyNoSpaces}-${variantName}.ttf`);

  // Check if already exists
  if (await Bun.file(outPath).exists()) return outPath;

  try {
    const url = `${GOOGLE_FONTS_CSS_API}?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
    const res = await fetch(url, {
      headers: { "User-Agent": TTF_USER_AGENT },
      signal: AbortSignal.timeout(FONT_DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) {
      const msg = `Google Fonts CSS API returned ${res.status} for '${family}' weight ${weight}`;
      log(`  Warning: ${msg}`);
      warnings.push(msg);
      return null;
    }

    const css = await res.text();
    // Extract the font URL from the CSS (matches url(...) in @font-face)
    const urlMatch = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/);
    if (!urlMatch) {
      // Try WOFF2 fallback
      const woff2Match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
      if (!woff2Match) {
        const msg = `No font URL found in CSS response for '${family}' weight ${weight}`;
        log(`  Warning: ${msg}`);
        warnings.push(msg);
        return null;
      }
      // Download whatever format is available
      const fontData = await download(woff2Match[1]!);
      if (!fontData) {
        const msg = `Failed to download font file for '${family}' weight ${weight}`;
        log(`  Warning: ${msg}`);
        warnings.push(msg);
        return null;
      }
      // Save with appropriate extension
      const woff2Path = resolve(fontsDir, `${familyNoSpaces}-${variantName}.woff2`);
      await Bun.write(woff2Path, fontData);
      log(`  → ${familyNoSpaces}-${variantName}.woff2 (${fontData.byteLength.toLocaleString()} bytes) [wght=${weight}]`);
      return woff2Path;
    }

    const fontData = await download(urlMatch[1]!);
    if (!fontData) {
      const msg = `Failed to download font file for '${family}' weight ${weight}`;
      log(`  Warning: ${msg}`);
      warnings.push(msg);
      return null;
    }

    await Bun.write(outPath, fontData);
    log(`  → ${familyNoSpaces}-${variantName}.ttf (${fontData.byteLength.toLocaleString()} bytes) [wght=${weight}]`);
    return outPath;
  } catch (err) {
    const msg = `Failed to download static weight for '${family}' weight ${weight}: ${err}`;
    log(`  Warning: ${msg}`);
    warnings.push(msg);
    return null;
  }
}

/** Map CSS weight to a human-readable variant name */
export function weightToVariantName(weight: number): string {
  if (weight <= 350) return "Light";
  if (weight <= 450) return "Regular";
  if (weight <= 550) return "Medium";
  if (weight <= 650) return "SemiBold";
  if (weight <= 750) return "Bold";
  if (weight <= 850) return "ExtraBold";
  return "Black";
}

export async function prepareVariableFont(
  family: string,
  downloaded: DownloadedFont,
  weights: number[],
  fontsDir: string,
  log: (msg: string) => void,
  warnings: string[],
): Promise<string[]> {
  const isItalic = downloaded.style === "italic";
  const outputFiles: string[] = [];

  // Deduplicate and bucket weights by variant name to avoid creating duplicate files
  const unique = [...new Set(weights)].sort((a, b) => a - b);
  const variantMap = new Map<string, number>(); // variantName → representative weight
  for (const w of unique) {
    const name = weightToVariantName(w);
    if (!variantMap.has(name)) {
      variantMap.set(name, w);
    }
  }

  // Ensure at least Regular exists
  if (!variantMap.has("Regular")) {
    variantMap.set("Regular", 400);
  }

  for (const [variantName, weight] of variantMap) {
    const styleSuffix = isItalic
      ? (variantName === "Regular" ? "Italic" : `${variantName}Italic`)
      : variantName;
    const path = await downloadStaticWeight(family, weight, fontsDir, styleSuffix, log, warnings);
    if (path) {
      outputFiles.push(path);
    }
  }

  return outputFiles;
}
