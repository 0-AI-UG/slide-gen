/**
 * Shape XML builders for PPTX slides — geometry, background, rect, and image shapes.
 * Text and table shapes are in ./pptx-text-shapes.ts.
 */

import type { GradientInfo, CornerRadii } from "./types";
import { buildGradFillXml } from "./gradient";
import { inToEmu, solidFillXml, buildOuterShadowXml } from "./pptx-xml-helpers";
import type { ShadowInfo } from "./types";

// Re-export shared primitives and text/table builders so existing consumers don't break
export { EMU_PER_INCH, inToEmu, escapeXml } from "./pptx-xml-helpers";
export { buildTextBoxXml, buildTableXml, type TextRunOpts, type TextBoxOpts, type TableShapeOpts } from "./pptx-text-shapes";

// ---------------------------------------------------------------------------
// Custom rounded rectangle geometry (per-corner radii)
// ---------------------------------------------------------------------------

function buildCustomRoundedRectGeom(wEmu: number, hEmu: number, radii: CornerRadii): string {
  const tl = inToEmu(radii.topLeft);
  const tr = inToEmu(radii.topRight);
  const br = inToEmu(radii.bottomRight);
  const bl = inToEmu(radii.bottomLeft);

  const ANG_90 = 5400000;  // 90° in 60000ths
  const ANG_180 = 10800000;
  const ANG_270 = 16200000;

  let path = `<a:moveTo><a:pt x="${tl}" y="0"/></a:moveTo>`;
  path += `<a:lnTo><a:pt x="${wEmu - tr}" y="0"/></a:lnTo>`;
  if (tr > 0) path += `<a:arcTo wR="${tr}" hR="${tr}" stAng="${ANG_270}" swAng="${ANG_90}"/>`;
  path += `<a:lnTo><a:pt x="${wEmu}" y="${hEmu - br}"/></a:lnTo>`;
  if (br > 0) path += `<a:arcTo wR="${br}" hR="${br}" stAng="0" swAng="${ANG_90}"/>`;
  path += `<a:lnTo><a:pt x="${bl}" y="${hEmu}"/></a:lnTo>`;
  if (bl > 0) path += `<a:arcTo wR="${bl}" hR="${bl}" stAng="${ANG_90}" swAng="${ANG_90}"/>`;
  path += `<a:lnTo><a:pt x="0" y="${tl}"/></a:lnTo>`;
  if (tl > 0) path += `<a:arcTo wR="${tl}" hR="${tl}" stAng="${ANG_180}" swAng="${ANG_90}"/>`;
  path += `<a:close/>`;

  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="0" b="0"/><a:pathLst><a:path w="${wEmu}" h="${hEmu}">${path}</a:path></a:pathLst></a:custGeom>`;
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
  borderRadii?: CornerRadii; // inches, per-corner
  boxShadow?: ShadowInfo;
  borderColor?: string; // hex without #
  borderWidth?: number; // inches
  noFill?: boolean; // true = transparent fill
  warnings?: string[];
}

export function buildRectShapeXml(opts: RectShapeOpts): string {
  const xEmu = inToEmu(opts.x);
  const yEmu = inToEmu(opts.y);
  const wEmu = inToEmu(opts.w);
  const hEmu = inToEmu(opts.h);

  let geomXml: string;
  if (opts.borderRadii) {
    geomXml = buildCustomRoundedRectGeom(wEmu, hEmu, opts.borderRadii);
  } else {
    const isRounded = (opts.borderRadius ?? 0) > 0;
    const prst = isRounded ? "roundRect" : "rect";
    let avLst = "";
    if (isRounded) {
      const radiusEmu = inToEmu(opts.borderRadius!);
      const adj = Math.min(50000, Math.round((radiusEmu / Math.min(wEmu, hEmu)) * 100000));
      avLst = `<a:gd name="adj" fmla="val ${adj}"/>`;
    }
    geomXml = `<a:prstGeom prst="${prst}"><a:avLst>${avLst}</a:avLst></a:prstGeom>`;
  }

  let fillXml: string;
  if (opts.noFill) {
    fillXml = "<a:noFill/>";
  } else if (opts.gradient && opts.gradient.stops.length >= 2) {
    fillXml = buildGradFillXml(opts.gradient, opts.warnings);
  } else {
    fillXml = solidFillXml(opts.fillColor, opts.fillTransparency);
  }

  // Line/border
  let lnXml: string;
  if (opts.borderColor && opts.borderWidth) {
    const lnW = inToEmu(opts.borderWidth);
    lnXml = `<a:ln w="${lnW}"><a:solidFill><a:srgbClr val="${opts.borderColor}"/></a:solidFill></a:ln>`;
  } else {
    lnXml = "<a:ln/>";
  }

  const effectXml = opts.boxShadow ? buildOuterShadowXml(opts.boxShadow) : "";

  return `<p:sp><p:nvSpPr><p:cNvPr id="${opts.id}" name="Shape ${opts.id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${xEmu}" y="${yEmu}"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm>${geomXml}${fillXml}${lnXml}${effectXml}</p:spPr></p:sp>`;
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
