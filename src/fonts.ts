/**
 * Font preparation pipeline — orchestrates downloading and naming for PPTX embedding.
 */

import { resolve } from "path";
import { mkdirSync, unlinkSync } from "fs";
import type { SlideData, BoldThresholdEntry, FontPrepResult } from "./types";
import { FONT_DOWNLOAD_CONCURRENCY } from "./constants";
import { downloadFontFamily, prepareVariableFont, weightToVariantName } from "./font-download";
import { readInternalFontName } from "./font-parse";

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
    const regularW = unique[0] ?? 400;
    const boldW = unique[unique.length - 1] ?? 400;
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
