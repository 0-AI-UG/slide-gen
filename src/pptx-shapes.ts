/**
 * Shape XML builders for PPTX slides.
 * Each function returns an XML string for a shape element inside <p:spTree>.
 */

import type { GradientInfo } from "./types";
import { buildGradFillXml } from "./gradient";
import { ALPHA_OPAQUE_THRESHOLD } from "./constants";
import { parseCssColorAndAlpha } from "./color";

// ---------------------------------------------------------------------------
// Unit conversions
// ---------------------------------------------------------------------------

export const EMU_PER_INCH = 914400;

export function inToEmu(inches: number): number {
  return Math.round(inches * EMU_PER_INCH);
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function solidFillXml(color: string, transparency?: number): string {
  if (transparency !== undefined && transparency > 0) {
    const alpha = Math.round((1 - transparency / 100) * 100000);
    return `<a:solidFill><a:srgbClr val="${color}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill>`;
  }
  return `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

export function buildBackgroundXml(color?: string, gradient?: GradientInfo, warnings?: string[]): string {
  if (gradient && gradient.stops.length >= 2) {
    return `<p:bg><p:bgPr>${buildGradFillXml(gradient, warnings)}</p:bgPr></p:bg>`;
  }
  if (color) {
    return `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></p:bgPr></p:bg>`;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Rectangle shape
// ---------------------------------------------------------------------------

export interface RectShapeOpts {
  id: number;
  x: number; // inches
  y: number;
  w: number;
  h: number;
  fillColor: string; // hex without #
  fillTransparency: number; // 0-100
  gradient?: GradientInfo;
  borderRadius?: number; // inches
  warnings?: string[];
}

export function buildRectShapeXml(opts: RectShapeOpts): string {
  const xEmu = inToEmu(opts.x);
  const yEmu = inToEmu(opts.y);
  const wEmu = inToEmu(opts.w);
  const hEmu = inToEmu(opts.h);

  const isRounded = (opts.borderRadius ?? 0) > 0;
  const prst = isRounded ? "roundRect" : "rect";

  let avLst = "";
  if (isRounded) {
    const radiusEmu = inToEmu(opts.borderRadius!);
    const adj = Math.min(50000, Math.round((radiusEmu / Math.min(wEmu, hEmu)) * 100000));
    avLst = `<a:gd name="adj" fmla="val ${adj}"/>`;
  }

  let fillXml: string;
  if (opts.gradient && opts.gradient.stops.length >= 2) {
    fillXml = buildGradFillXml(opts.gradient, opts.warnings);
  } else {
    fillXml = solidFillXml(opts.fillColor, opts.fillTransparency);
  }

  return `<p:sp><p:nvSpPr><p:cNvPr id="${opts.id}" name="Shape ${opts.id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${xEmu}" y="${yEmu}"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst>${avLst}</a:avLst></a:prstGeom>${fillXml}<a:ln/></p:spPr></p:sp>`;
}

// ---------------------------------------------------------------------------
// Image shape
// ---------------------------------------------------------------------------

export interface ImageShapeOpts {
  id: number;
  x: number; // inches
  y: number;
  w: number;
  h: number;
  rId: string;
}

export function buildImageShapeXml(opts: ImageShapeOpts): string {
  const xEmu = inToEmu(opts.x);
  const yEmu = inToEmu(opts.y);
  const wEmu = inToEmu(opts.w);
  const hEmu = inToEmu(opts.h);

  return `<p:pic><p:nvPicPr><p:cNvPr id="${opts.id}" name="Image ${opts.id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${opts.rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${xEmu}" y="${yEmu}"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

// ---------------------------------------------------------------------------
// Text box shape
// ---------------------------------------------------------------------------

export interface TextRunOpts {
  text: string;
  fontSize: number; // points
  fontFace?: string;
  color: string; // hex
  bold?: boolean;
  italic?: boolean;
  charSpacing?: number; // points
  transparency?: number; // 0-100
}

export interface TextBoxOpts {
  id: number;
  x: number; // inches
  y: number;
  w: number;
  h: number;
  runs: TextRunOpts[];
  align?: "l" | "ctr" | "r" | "just";
  wrap: boolean;
  rotate?: number; // degrees (0-360)
  lineSpacingMultiple?: number;
  shrinkToFit?: boolean;
}

function buildRunPropsXml(run: TextRunOpts): string {
  const sz = Math.round(run.fontSize * 100); // 1/100th of a point
  const attrs: string[] = [`lang="en-US"`, `sz="${sz}"`, `dirty="0"`];

  if (run.bold) attrs.push(`b="1"`);
  if (run.italic) attrs.push(`i="1"`);
  if (run.charSpacing !== undefined) {
    const spc = Math.round(run.charSpacing * 100); // 1/100th of a point
    attrs.push(`spc="${spc}"`);
  }

  let children = "";

  // Color fill
  if (run.transparency !== undefined && run.transparency > 0) {
    const alpha = Math.round((1 - run.transparency / 100) * 100000);
    children += `<a:solidFill><a:srgbClr val="${run.color}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill>`;
  } else {
    children += `<a:solidFill><a:srgbClr val="${run.color}"/></a:solidFill>`;
  }

  // Font refs
  if (run.fontFace) {
    const face = escapeXml(run.fontFace);
    children += `<a:latin typeface="${face}" pitchFamily="34" charset="0"/>`;
    children += `<a:ea typeface="${face}" pitchFamily="34" charset="-122"/>`;
    children += `<a:cs typeface="${face}" pitchFamily="34" charset="-120"/>`;
  }

  return `<a:rPr ${attrs.join(" ")}>${children}</a:rPr>`;
}

export function buildTextBoxXml(opts: TextBoxOpts): string {
  const xEmu = inToEmu(opts.x);
  const yEmu = inToEmu(opts.y);
  const wEmu = inToEmu(opts.w);
  const hEmu = inToEmu(opts.h);

  // Body properties
  const wrapAttr = opts.wrap ? "square" : "none";
  let bodyPrAttrs = `wrap="${wrapAttr}" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"`;
  if (opts.rotate) {
    const rotVal = Math.round(opts.rotate * 60000); // 1/60000th degree
    bodyPrAttrs += ` rot="${rotVal}"`;
  }

  const autoFit = opts.shrinkToFit ? "<a:normAutofit/>" : "";
  const bodyPr = `<a:bodyPr ${bodyPrAttrs}>${autoFit}</a:bodyPr>`;

  // Build paragraph properties
  const algn = opts.align ? ` algn="${opts.align}"` : "";
  let lnSpcXml = "";
  if (opts.lineSpacingMultiple && opts.lineSpacingMultiple > 0) {
    const val = Math.round(opts.lineSpacingMultiple * 100000);
    lnSpcXml = `<a:lnSpc><a:spcPct val="${val}"/></a:lnSpc>`;
  }
  const pPrContent = `<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft>${lnSpcXml}<a:buNone/>`;
  const pPr = `<a:pPr indent="0" marL="0"${algn}>${pPrContent}</a:pPr>`;

  // Split runs into paragraphs on newline boundaries
  const paragraphs: TextRunOpts[][] = [[]];
  for (const run of opts.runs) {
    const parts = run.text.split("\n");
    for (let pi = 0; pi < parts.length; pi++) {
      if (pi > 0) paragraphs.push([]);
      if (parts[pi].length > 0) {
        paragraphs[paragraphs.length - 1].push({ ...run, text: parts[pi] });
      }
    }
  }

  // Build paragraph XML
  const lastRun = opts.runs[opts.runs.length - 1];
  const endParaSz = lastRun ? Math.round(lastRun.fontSize * 100) : 1800;

  const parasXml = paragraphs
    .map((paraRuns) => {
      const runsXml = paraRuns
        .map((run) => {
          const rPr = buildRunPropsXml(run);
          return `<a:r>${rPr}<a:t>${escapeXml(run.text)}</a:t></a:r>`;
        })
        .join("");
      return `<a:p>${pPr}${runsXml}<a:endParaRPr lang="en-US" sz="${endParaSz}" dirty="0"/></a:p>`;
    })
    .join("");

  return `<p:sp><p:nvSpPr><p:cNvPr id="${opts.id}" name="Text ${opts.id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${xEmu}" y="${yEmu}"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln/></p:spPr><p:txBody>${bodyPr}<a:lstStyle/>${parasXml}</p:txBody></p:sp>`;
}
