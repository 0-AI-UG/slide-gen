/** Walk up from `el` to `slideEl`, multiplying each element's opacity. */
export function getAccumulatedOpacity(el: Element, slideEl: Element): number {
  let opacity = 1;
  let current: Element | null = el;
  while (current && current !== slideEl) {
    const op = parseFloat(getComputedStyle(current).opacity);
    if (!isNaN(op)) opacity *= op;
    current = current.parentElement;
  }
  return opacity;
}

/** Multiply an rgba/rgb colour string by an additional opacity factor. */
export function applyOpacityToColor(colorStr: string, opacity: number): string {
  if (opacity >= 0.999) return colorStr;
  const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return colorStr;
  const r = m[1], g = m[2], b = m[3];
  const existingAlpha = m[4] != null ? parseFloat(m[4]) : 1;
  const finalAlpha = existingAlpha * opacity;
  return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
}

/** Resolve a single border-radius value, handling percentages. */
export function resolveRadius(value: string, width: number, height: number): number {
  // Value can be "10px", "50%", or "200px 150px" / "50% 50%"
  const parts = value.split(/\s+/);
  const h = parts[0] || "0";
  const v = parts[1] || h;

  function parse(s: string, dim: number): number {
    if (s.includes("%")) {
      return (parseFloat(s) / 100) * dim;
    }
    return parseFloat(s) || 0;
  }

  const hPx = parse(h, width);
  const vPx = parse(v, height);
  // Use the minimum of horizontal/vertical so the corner fits
  return Math.min(hPx, vPx);
}

/** Parse effective border-radius from computed style (max of all corners, in px). */
export function parseBorderRadius(computed: CSSStyleDeclaration, width?: number, height?: number): number {
  const w = width ?? 0;
  const h = height ?? 0;
  const needsResolve = w > 0 && h > 0;

  if (needsResolve) {
    const tl = resolveRadius(computed.borderTopLeftRadius, w, h);
    const tr = resolveRadius(computed.borderTopRightRadius, w, h);
    const br = resolveRadius(computed.borderBottomRightRadius, w, h);
    const bl = resolveRadius(computed.borderBottomLeftRadius, w, h);
    return Math.max(tl, tr, br, bl);
  }

  const tl = parseFloat(computed.borderTopLeftRadius) || 0;
  const tr = parseFloat(computed.borderTopRightRadius) || 0;
  const br = parseFloat(computed.borderBottomRightRadius) || 0;
  const bl = parseFloat(computed.borderBottomLeftRadius) || 0;
  return Math.max(tl, tr, br, bl);
}

/** Extract rotation angle (degrees) from a CSS transform matrix. */
export function getRotation(computed: CSSStyleDeclaration): number {
  const transform = computed.transform;
  if (!transform || transform === "none") return 0;
  const m = transform.match(/matrix\(([^)]+)\)/);
  if (m) {
    const vals = m[1].split(",").map((v) => parseFloat(v.trim()));
    const angle = Math.atan2(vals[1], vals[0]) * (180 / Math.PI);
    return Math.round(angle * 100) / 100;
  }
  return 0;
}
