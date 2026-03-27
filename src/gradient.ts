import type { GradientInfo } from "./types";
import { parseCssColorAndAlpha } from "./color";
import { ALPHA_OPAQUE_THRESHOLD, MAX_GRADIENT_STOPS } from "./constants";

/** Interpolate additional stops between existing ones to reduce banding */
function interpolateStops(stops: GradientInfo["stops"], intermediateCount: number): GradientInfo["stops"] {
  if (stops.length < 2) return stops;
  const result: GradientInfo["stops"] = [];

  for (let i = 0; i < stops.length - 1; i++) {
    result.push(stops[i]);
    const s1 = stops[i];
    const s2 = stops[i + 1];
    const c1 = parseCssColorAndAlpha(s1.color);
    const c2 = parseCssColorAndAlpha(s2.color);

    // Parse hex to RGB
    const r1 = parseInt(c1.hex.slice(0, 2), 16), g1 = parseInt(c1.hex.slice(2, 4), 16), b1 = parseInt(c1.hex.slice(4, 6), 16);
    const r2 = parseInt(c2.hex.slice(0, 2), 16), g2 = parseInt(c2.hex.slice(2, 4), 16), b2 = parseInt(c2.hex.slice(4, 6), 16);

    for (let j = 1; j <= intermediateCount; j++) {
      const t = j / (intermediateCount + 1);
      const r = Math.round(r1 + (r2 - r1) * t);
      const g = Math.round(g1 + (g2 - g1) * t);
      const b = Math.round(b1 + (b2 - b1) * t);
      const a = c1.alpha + (c2.alpha - c1.alpha) * t;
      const hex = [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
      const pos = s1.position + (s2.position - s1.position) * t;
      result.push({ color: `rgba(${r},${g},${b},${a})`, position: pos });
    }
  }
  result.push(stops[stops.length - 1]);
  return result;
}

/** Downsample stops to maxCount by taking evenly spaced indices */
function downsampleStops(stops: GradientInfo["stops"], maxCount: number): GradientInfo["stops"] {
  if (stops.length <= maxCount) return stops;
  const result: GradientInfo["stops"] = [];
  for (let i = 0; i < maxCount; i++) {
    const idx = Math.round(i * (stops.length - 1) / (maxCount - 1));
    result.push(stops[idx]);
  }
  return result;
}

/** Build OOXML <a:gradFill> XML from gradient info */
export function buildGradFillXml(gradient: GradientInfo, warnings?: string[]): string {
  // For radial gradients, interpolate extra stops to reduce banding
  let effectiveStops = gradient.type === "radial"
    ? interpolateStops(gradient.stops, 3)
    : gradient.stops;

  if (effectiveStops.length > MAX_GRADIENT_STOPS) {
    warnings?.push(`Gradient stop count ${effectiveStops.length} exceeded limit, capped to ${MAX_GRADIENT_STOPS}`);
    effectiveStops = downsampleStops(effectiveStops, MAX_GRADIENT_STOPS);
  }

  const gsEntries = effectiveStops.map((stop) => {
    const { hex, alpha } = parseCssColorAndAlpha(stop.color);
    const pos = Math.round(stop.position * 1000);
    let alphaTag = "";
    if (alpha < ALPHA_OPAQUE_THRESHOLD) {
      alphaTag = `<a:alpha val="${Math.round(alpha * 100000)}"/>`;
    }
    return `<a:gs pos="${pos}"><a:srgbClr val="${hex}">${alphaTag}</a:srgbClr></a:gs>`;
  }).join("");

  const gsLst = `<a:gsLst>${gsEntries}</a:gsLst>`;

  if (gradient.type === "radial") {
    const cx = gradient.radialPosition?.x ?? 50;
    const cy = gradient.radialPosition?.y ?? 50;
    const l = Math.round(cx * 1000);
    const t = Math.round(cy * 1000);
    const r = Math.round((100 - cx) * 1000);
    const b = Math.round((100 - cy) * 1000);
    // Use path="circle" for all radial gradients; asymmetric fillToRect bounds produce ellipses
    const pathType = "circle";
    return `<a:gradFill rotWithShape="0">${gsLst}<a:path path="${pathType}"><a:fillToRect l="${l}" t="${t}" r="${r}" b="${b}"/></a:path></a:gradFill>`;
  }

  // Linear gradient: CSS angle → OOXML angle
  const cssAngle = gradient.angle ?? 180;
  const ooxmlDeg = ((cssAngle - 90) % 360 + 360) % 360;
  const ooxmlAngle = Math.round(ooxmlDeg * 60000);

  return `<a:gradFill><a:gsLst>${gsEntries}</a:gsLst><a:lin ang="${ooxmlAngle}" scaled="1"/></a:gradFill>`;
}

