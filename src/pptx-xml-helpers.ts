/**
 * Shared XML primitive helpers for PPTX shape builders.
 */

import type { ShadowInfo } from "./types";
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

export function solidFillXml(color: string, transparency?: number): string {
  if (transparency !== undefined && transparency > 0) {
    const alpha = Math.round((1 - transparency / 100) * 100000);
    return `<a:solidFill><a:srgbClr val="${color}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill>`;
  }
  return `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
}

// ---------------------------------------------------------------------------
// Shadow XML helper
// ---------------------------------------------------------------------------

export function buildOuterShadowXml(shadow: ShadowInfo): string {
  const { hex, alpha } = parseCssColorAndAlpha(shadow.color);

  // Convert px to EMU (assume 96 DPI: 1px = 914400/96 = 9525 EMU)
  const PX_TO_EMU = 9525;
  const blurRad = Math.round(shadow.blurRadius * PX_TO_EMU);

  // Distance = sqrt(offsetX² + offsetY²)
  const dist = Math.round(Math.sqrt(shadow.offsetX ** 2 + shadow.offsetY ** 2) * PX_TO_EMU);

  // Direction = atan2(offsetY, offsetX) in 60000ths of a degree
  const angleRad = Math.atan2(shadow.offsetY, shadow.offsetX);
  const angleDeg = angleRad * (180 / Math.PI);
  const dir = Math.round(((angleDeg % 360 + 360) % 360) * 60000);

  let colorXml: string;
  if (alpha < 0.999) {
    const alphaVal = Math.round(alpha * 100000);
    colorXml = `<a:srgbClr val="${hex}"><a:alpha val="${alphaVal}"/></a:srgbClr>`;
  } else {
    colorXml = `<a:srgbClr val="${hex}"/>`;
  }

  return `<a:effectLst><a:outerShdw blurRad="${blurRad}" dist="${dist}" dir="${dir}" rotWithShape="0">${colorXml}</a:outerShdw></a:effectLst>`;
}
