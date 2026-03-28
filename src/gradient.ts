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

/** Normalize non-monotonic stop positions (CSS clamping: each pos >= previous) */
function normalizeStopPositions(stops: GradientInfo["stops"]): GradientInfo["stops"] {
  let maxPos = -Infinity;
  return stops.map(s => {
    const pos = Math.max(s.position, maxPos);
    maxPos = pos;
    return { ...s, position: pos };
  });
}

/** Tile repeating gradient stops to fill 0-100% */
function tileRepeatingStops(stops: GradientInfo["stops"]): GradientInfo["stops"] {
  if (stops.length < 2) return stops;
  // CSS clamps each stop position to be >= the previous one
  stops = normalizeStopPositions(stops);
  const range = stops[stops.length - 1].position - stops[0].position;
  if (range <= 0 || range >= 100) return stops;

  const result: GradientInfo["stops"] = [];
  let offset = stops[0].position >= 0 ? 0 : stops[0].position;
  while (offset < 100) {
    for (const stop of stops) {
      const pos = offset + (stop.position - stops[0].position);
      if (pos > 100) break;
      result.push({ color: stop.color, position: Math.min(pos, 100) });
    }
    offset += range;
  }
  return result.length >= 2 ? result : stops;
}

/** Build OOXML <a:gradFill> XML from gradient info */
export function buildGradFillXml(gradient: GradientInfo, warnings?: string[]): string {
  // Conic gradients have no OOXML equivalent — fall back to radial approximation
  if (gradient.type === "conic") {
    warnings?.push("Conic gradient approximated as radial (no OOXML equivalent)");
    // Treat as radial with the same stops
    const fallback: GradientInfo = { ...gradient, type: "radial" };
    return buildGradFillXml(fallback, warnings);
  }

  // For repeating gradients, tile stops to fill 0-100%
  let baseStops = gradient.repeating
    ? tileRepeatingStops(gradient.stops)
    : gradient.stops;

  // For radial gradients, interpolate extra stops to reduce banding
  let effectiveStops = gradient.type === "radial"
    ? interpolateStops(baseStops, 3)
    : baseStops;

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
    const extent = gradient.radialExtent ?? "farthest-corner";

    // OOXML path gradients fill from center to fillToRect edges.
    // CSS farthest-corner (default) extends gradient to the farthest corner of the element,
    // which creates a much larger circle than the element bounds.
    // The key difference: CSS distributes stops across the full radius to farthest corner,
    // while OOXML distributes them across the fillToRect.
    //
    // Strategy: scale the fillToRect to better approximate CSS behavior.
    // For farthest-corner, CSS extends ~1.41x (sqrt(2)) beyond the closest side,
    // but OOXML fills exactly to the fillToRect bounds.
    //
    // We also compress stops for transparent-fading gradients to reduce the visible orb size.

    let fillScale = 1.0;  // Scale factor for fillToRect bounds
    let stopScale = 1.0;  // Scale factor for stop positions

    if (extent === "closest-side") {
      fillScale = 0.3;
    } else if (extent === "closest-corner") {
      fillScale = 0.45;
    } else if (extent === "farthest-side") {
      fillScale = 0.7;
    } else {
      // farthest-corner (default)
      // Check if gradient fades to transparent — these are typically decorative orbs
      // that look much too large in OOXML without compression
      const lastStop = effectiveStops[effectiveStops.length - 1];
      const lastAlpha = parseCssColorAndAlpha(lastStop.color).alpha;
      const firstStop = effectiveStops[0];
      const firstAlpha = parseCssColorAndAlpha(firstStop.color).alpha;

      if (lastAlpha < 0.1 && firstAlpha > lastAlpha) {
        // Gradient fades from visible to transparent — compress the fill region
        // The more transparent the gradient is overall, the more we compress
        fillScale = 0.5;
        // Also compress stops: push the visible portion towards center
        stopScale = 0.7;
      }
    }

    // Apply stop compression if needed
    if (stopScale !== 1.0) {
      effectiveStops = effectiveStops.map(s => ({
        ...s,
        position: Math.min(100, s.position * stopScale),
      }));
      // Rebuild gsEntries with compressed stops
      const compressedEntries = effectiveStops.map((stop) => {
        const { hex, alpha } = parseCssColorAndAlpha(stop.color);
        const pos = Math.round(stop.position * 1000);
        let alphaTag = "";
        if (alpha < ALPHA_OPAQUE_THRESHOLD) {
          alphaTag = `<a:alpha val="${Math.round(alpha * 100000)}"/>`;
        }
        return `<a:gs pos="${pos}"><a:srgbClr val="${hex}">${alphaTag}</a:srgbClr></a:gs>`;
      }).join("");
      const compressedGsLst = `<a:gsLst>${compressedEntries}</a:gsLst>`;

      const l = Math.round(cx * 1000 * fillScale);
      const t = Math.round(cy * 1000 * fillScale);
      const r = Math.round((100 - cx) * 1000 * fillScale);
      const b = Math.round((100 - cy) * 1000 * fillScale);
      return `<a:gradFill rotWithShape="0">${compressedGsLst}<a:path path="circle"><a:fillToRect l="${l}" t="${t}" r="${r}" b="${b}"/></a:path></a:gradFill>`;
    }

    const l = Math.round(cx * 1000 * fillScale);
    const t = Math.round(cy * 1000 * fillScale);
    const r = Math.round((100 - cx) * 1000 * fillScale);
    const b = Math.round((100 - cy) * 1000 * fillScale);
    return `<a:gradFill rotWithShape="0">${gsLst}<a:path path="circle"><a:fillToRect l="${l}" t="${t}" r="${r}" b="${b}"/></a:path></a:gradFill>`;
  }

  // Linear gradient: CSS angle → OOXML angle
  const cssAngle = gradient.angle ?? 180;
  const ooxmlDeg = ((cssAngle - 90) % 360 + 360) % 360;
  const ooxmlAngle = Math.round(ooxmlDeg * 60000);

  return `<a:gradFill><a:gsLst>${gsEntries}</a:gsLst><a:lin ang="${ooxmlAngle}" scaled="1"/></a:gradFill>`;
}

