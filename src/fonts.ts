import { resolve } from "path";
import { mkdirSync, unlinkSync } from "fs";
import type { SlideData, BoldThresholdEntry, FontPrepResult } from "./types";
import { FONT_DOWNLOAD_TIMEOUT_MS, FONT_DOWNLOAD_CONCURRENCY } from "./constants";

const GITHUB_RAW = "https://github.com/google/fonts/raw/main";

interface MetadataFont {
  filename?: string;
  style?: string;
  weight?: number;
  [key: string]: unknown;
}

interface DownloadedFont {
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

async function downloadFontFamily(family: string, fontsDir: string, log: (msg: string) => void, warnings: string[]): Promise<DownloadedFont[]> {
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

/** Parse the name table from a buffer at the given offset, returning the family name (nameID 1) */
function parseFontNameTable(buffer: ArrayBuffer, nameOffset: number): string | null {
  const view = new DataView(buffer);
  const count = view.getUint16(nameOffset + 2);
  const stringOffset = nameOffset + view.getUint16(nameOffset + 4);

  // First pass: prefer platformID 3 (Windows) or 0 (Unicode) with nameID 1
  for (let i = 0; i < count; i++) {
    const recordOffset = nameOffset + 6 + i * 12;
    const platformID = view.getUint16(recordOffset);
    const nameID = view.getUint16(recordOffset + 6);
    if (nameID !== 1) continue;
    if (platformID !== 0 && platformID !== 3) continue;

    const length = view.getUint16(recordOffset + 8);
    const offset = view.getUint16(recordOffset + 10);
    const bytes = new Uint8Array(buffer, stringOffset + offset, length);

    // Decode as UTF-16BE (platform 0 and 3 use UTF-16BE)
    let name = "";
    for (let j = 0; j < bytes.length; j += 2) {
      name += String.fromCharCode((bytes[j] << 8) | bytes[j + 1]);
    }
    if (name) return name;
  }

  // Fallback: any platformID with nameID 1
  for (let i = 0; i < count; i++) {
    const recordOffset = nameOffset + 6 + i * 12;
    const nameID = view.getUint16(recordOffset + 6);
    if (nameID !== 1) continue;

    const length = view.getUint16(recordOffset + 8);
    const offset = view.getUint16(recordOffset + 10);
    const bytes = new Uint8Array(buffer, stringOffset + offset, length);
    const name = new TextDecoder("utf-8").decode(bytes);
    if (name) return name;
  }

  return null;
}

/** Read internal font family name from a TTF or WOFF file's name table (pure JS, no dependencies) */
async function readInternalFontName(fontPath: string): Promise<string | null> {
  try {
    const buffer = await Bun.file(fontPath).arrayBuffer();
    const view = new DataView(buffer);

    // Detect format from magic bytes
    const magic = String.fromCharCode(
      view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3),
    );

    if (magic === "wOFF") {
      // WOFF1 format: header is 44 bytes, then table directory
      const numTables = view.getUint16(12);
      // WOFF table directory entries are 20 bytes each (tag, offset, compLength, origLength, origChecksum)
      for (let i = 0; i < numTables; i++) {
        const entryOffset = 44 + i * 20;
        const tag = String.fromCharCode(
          view.getUint8(entryOffset), view.getUint8(entryOffset + 1),
          view.getUint8(entryOffset + 2), view.getUint8(entryOffset + 3),
        );
        if (tag === "name") {
          const tableOffset = view.getUint32(entryOffset + 4);
          const compLength = view.getUint32(entryOffset + 8);
          const origLength = view.getUint32(entryOffset + 12);

          let nameBuffer: ArrayBuffer;
          if (compLength === origLength) {
            // Uncompressed — read directly
            nameBuffer = buffer.slice(tableOffset, tableOffset + origLength);
          } else {
            // WOFF1 uses zlib compression — decompress via DecompressionStream
            const compressed = new Uint8Array(buffer, tableOffset, compLength);
            const ds = new DecompressionStream("deflate");
            const writer = ds.writable.getWriter();
            writer.write(compressed);
            writer.close();
            const reader = ds.readable.getReader();
            const chunks: Uint8Array[] = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
            const result = new Uint8Array(totalLen);
            let pos = 0;
            for (const chunk of chunks) {
              result.set(chunk, pos);
              pos += chunk.byteLength;
            }
            nameBuffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
          }
          return parseFontNameTable(nameBuffer, 0);
        }
      }
      return null;
    }

    // TTF/OTF format (magic: 0x00010000 or 'OTTO' or 'true')
    const numTables = view.getUint16(4);
    for (let i = 0; i < numTables; i++) {
      const tableOffset = 12 + i * 16;
      const tag = String.fromCharCode(
        view.getUint8(tableOffset), view.getUint8(tableOffset + 1),
        view.getUint8(tableOffset + 2), view.getUint8(tableOffset + 3),
      );
      if (tag === "name") {
        const nameOffset = view.getUint32(tableOffset + 8);
        return parseFontNameTable(buffer, nameOffset);
      }
    }

    return null;
  } catch {
    return null;
  }
}

const GOOGLE_FONTS_CSS_API = "https://fonts.googleapis.com/css2";
// Use an older IE11 User-Agent to get TTF format from Google Fonts CSS API
// (modern browsers get WOFF2 which our name table parser can't read)
const TTF_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Trident/7.0; rv:11.0) like Gecko";

/** Download a static weight file from the Google Fonts CSS API */
async function downloadStaticWeight(
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
      const fontData = await download(woff2Match[1]);
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

    const fontData = await download(urlMatch[1]);
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
function weightToVariantName(weight: number): string {
  if (weight <= 350) return "Light";
  if (weight <= 450) return "Regular";
  if (weight <= 550) return "Medium";
  if (weight <= 650) return "SemiBold";
  if (weight <= 750) return "Bold";
  if (weight <= 850) return "ExtraBold";
  return "Black";
}

async function prepareVariableFont(
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


function extractFamiliesFromSlideData(
  slideData: SlideData[],
): { families: string[]; familyWeights: Record<string, number[]> } {
  const familiesSet = new Set<string>();
  const familyWeights: Record<string, number[]> = {};

  for (const slide of slideData) {
    for (const text of slide.texts ?? []) {
      // Collect weights from individual runs (not just legacy top-level fields)
      const runs = text.runs && text.runs.length > 0 ? text.runs : [{
        fontFamily: text.fontFamily,
        fontWeight: text.fontWeight,
      }];
      for (const run of runs) {
        const family = (run.fontFamily ?? "").trim();
        if (!family) continue;
        familiesSet.add(family);
        const w = parseInt(String(run.fontWeight ?? 400), 10);
        (familyWeights[family] ??= []).push(w);
      }
    }
  }

  return { families: [...familiesSet].sort(), familyWeights };
}

/** Download and prepare fonts from slide data, returning bold thresholds and font name mappings */
export async function prepareFontsFromSlideData(
  slideData: SlideData[],
  fontsDir: string,
  log: (msg: string) => void = console.log,
): Promise<FontPrepResult> {
  const warnings: string[] = [];
  mkdirSync(fontsDir, { recursive: true });

  const { families, familyWeights } = extractFamiliesFromSlideData(slideData);

  const toDownload = [...families];

  const allOutputFiles: string[] = [];

  async function processFamily(family: string): Promise<string[]> {
    log(`Downloading: ${family}`);
    const downloaded = await downloadFontFamily(family, fontsDir, log, warnings);
    const weights = familyWeights[family] ?? [400];
    const outputFiles: string[] = [];

    const variableFonts = downloaded.filter((d) => d.isVariable);
    const staticFonts = downloaded.filter((d) => !d.isVariable);

    if (variableFonts.length > 0) {
      for (const vf of variableFonts) {
        const files = await prepareVariableFont(family, vf, weights, fontsDir, log, warnings);
        outputFiles.push(...files);
      }
      for (const vf of variableFonts) {
        try { unlinkSync(vf.path); } catch {}
      }
    } else {
      outputFiles.push(...staticFonts.map((s) => s.path));
    }

    return outputFiles;
  }

  for (let i = 0; i < toDownload.length; i += FONT_DOWNLOAD_CONCURRENCY) {
    const batch = toDownload.slice(i, i + FONT_DOWNLOAD_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (family) => {
        try {
          return await processFamily(family);
        } catch (err) {
          const msg = `Failed to prepare font '${family}': ${err}`;
          log(`  Warning: ${msg}`);
          warnings.push(msg);
          return [];
        }
      }),
    );
    for (const files of results) allOutputFiles.push(...files);
  }

  // Build thresholds and internal name map
  const thresholds: Record<string, BoldThresholdEntry> = {};
  // Build per-weight internal name map: familyKey → Map<cssWeight, internalFontName>
  const weightFontNames: Record<string, Map<number, string>> = {};

  for (const [family, weights] of Object.entries(familyWeights)) {
    const unique = [...new Set(weights)].sort((a, b) => a - b);
    const regularW = unique[0];
    const boldW = unique[unique.length - 1];
    const key = family.replace(/\s+/g, "");

    let internalName: string | null = null;
    for (const ext of [".ttf", ".woff2", ".woff"]) {
      const regularPath = resolve(fontsDir, `${key}-Regular${ext}`);
      if (await Bun.file(regularPath).exists()) {
        internalName = await readInternalFontName(regularPath);
        if (internalName) break;
      }
    }

    thresholds[key] = {
      regularWeight: regularW,
      boldWeight: boldW,
      boldThreshold: regularW < boldW ? Math.floor((regularW + boldW) / 2) : 600,
      ...(internalName ? { internalName } : {}),
    };

    // Read internal names for each weight variant
    const wMap = new Map<number, string>();
    const variantMap = new Map<string, number>();
    for (const w of unique) {
      const name = weightToVariantName(w);
      if (!variantMap.has(name)) variantMap.set(name, w);
    }
    if (!variantMap.has("Regular")) variantMap.set("Regular", 400);

    for (const [variantName, weight] of variantMap) {
      for (const ext of [".ttf", ".woff2", ".woff"]) {
        const varPath = resolve(fontsDir, `${key}-${variantName}${ext}`);
        if (await Bun.file(varPath).exists()) {
          const varInternal = await readInternalFontName(varPath);
          if (varInternal) {
            for (const w of unique) {
              if (weightToVariantName(w) === variantName) {
                wMap.set(w, varInternal);
              }
            }
            break;
          }
        }
      }
    }
    if (wMap.size > 0) weightFontNames[key] = wMap;
  }

  // Write manifest
  const manifestPath = resolve(fontsDir, "manifest.json");
  await Bun.write(manifestPath, JSON.stringify(thresholds, null, 2));

  log(`${allOutputFiles.length} font files prepared in ${fontsDir}`);

  // Build result maps
  const keyToFamily = new Map<string, string>();
  for (const slide of slideData) {
    for (const t of slide.texts) {
      const runs = t.runs && t.runs.length > 0 ? t.runs : [{ fontFamily: t.fontFamily }];
      for (const run of runs) {
        if (run.fontFamily) {
          keyToFamily.set(run.fontFamily.replace(/\s+/g, ""), run.fontFamily);
        }
      }
    }
  }

  const boldThresholds = new Map<string, number>();
  const fontNameMap = new Map<string, string>();
  const weightToFontName = new Map<string, Map<number, string>>();

  for (const [familyKey, entry] of Object.entries(thresholds)) {
    const typeface = keyToFamily.get(familyKey);
    if (!typeface) continue;
    boldThresholds.set(typeface, entry.boldThreshold);
    if (entry.internalName) {
      fontNameMap.set(typeface, entry.internalName);
    }
    if (weightFontNames[familyKey]) {
      weightToFontName.set(typeface, weightFontNames[familyKey]);
    }
    const variantCount = weightFontNames[familyKey]?.size ?? 0;
    log(`  ${typeface}: bold threshold = ${entry.boldThreshold}, ${variantCount} weight variants${entry.internalName ? ` [internal: ${entry.internalName}]` : ""}`);
  }

  return { boldThresholds, fontNameMap, weightToFontName, warnings };
}

/** Reconstruct FontPrepResult from a saved manifest.json (used with skipFonts) */
export function buildFontPrepResultFromManifest(
  manifest: Record<string, BoldThresholdEntry>,
  slideData: SlideData[],
): FontPrepResult {
  const keyToFamily = new Map<string, string>();
  for (const slide of slideData) {
    for (const t of slide.texts) {
      const runs = t.runs && t.runs.length > 0 ? t.runs : [{ fontFamily: t.fontFamily }];
      for (const run of runs) {
        if (run.fontFamily) {
          keyToFamily.set(run.fontFamily.replace(/\s+/g, ""), run.fontFamily);
        }
      }
    }
  }

  const boldThresholds = new Map<string, number>();
  const fontNameMap = new Map<string, string>();
  const weightToFontName = new Map<string, Map<number, string>>();

  for (const [familyKey, entry] of Object.entries(manifest)) {
    const typeface = keyToFamily.get(familyKey);
    if (!typeface) continue;
    boldThresholds.set(typeface, entry.boldThreshold);
    if (entry.internalName) {
      fontNameMap.set(typeface, entry.internalName);
    }
  }

  return { boldThresholds, fontNameMap, weightToFontName, warnings: [] };
}
