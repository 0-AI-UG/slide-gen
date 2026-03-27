/** Parse a CSS color string to 6-char hex (uppercase), or null if transparent/invalid */
export function parseCssColor(colorStr: string): string | null {
  if (!colorStr) return null;

  // rgb(r, g, b) or rgba(r, g, b, a)
  const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    // Check alpha
    const alphaMatch = colorStr.match(/,\s*([\d.]+)\s*\)/);
    if (alphaMatch && parseFloat(alphaMatch[1]) < 0.01) return null;

    const r = parseInt(m[1]).toString(16).padStart(2, "0");
    const g = parseInt(m[2]).toString(16).padStart(2, "0");
    const b = parseInt(m[3]).toString(16).padStart(2, "0");
    return `${r}${g}${b}`.toUpperCase();
  }

  // #rrggbb
  const hex = colorStr.match(/#([0-9a-fA-F]{6})/);
  if (hex) return hex[1].toUpperCase();

  return null;
}

/** Extract alpha from a CSS rgba() color string (returns 1 for non-rgba) */
export function parseCssAlpha(colorStr: string): number {
  if (!colorStr) return 1;
  const alphaMatch = colorStr.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\s*\)/);
  if (alphaMatch) return parseFloat(alphaMatch[1]);
  return 1;
}

/** Convert a CSS color string to hex (6 chars) and alpha (0-1) */
export function parseCssColorAndAlpha(colorStr: string): { hex: string; alpha: number } {
  const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) {
    const r = parseInt(m[1]).toString(16).padStart(2, "0");
    const g = parseInt(m[2]).toString(16).padStart(2, "0");
    const b = parseInt(m[3]).toString(16).padStart(2, "0");
    const alpha = m[4] != null ? parseFloat(m[4]) : 1;
    return { hex: `${r}${g}${b}`.toUpperCase(), alpha };
  }
  const hex = colorStr.match(/#([0-9a-fA-F]{6})/);
  if (hex) return { hex: hex[1].toUpperCase(), alpha: 1 };
  // Try 3-char hex
  const hex3 = colorStr.match(/#([0-9a-fA-F]{3})$/);
  if (hex3) {
    const expanded = hex3[1].split("").map(c => c + c).join("");
    return { hex: expanded.toUpperCase(), alpha: 1 };
  }
  return { hex: "000000", alpha: 1 };
}
