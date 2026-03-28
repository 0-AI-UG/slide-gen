import { applyOpacityToColor, parseBorderRadius } from "./css-helpers";

export interface PseudoResult {
  rect?: any;
  text?: any;
}

/** Extract position/size/colour and text content of a ::before or ::after pseudo-element. */
export function extractPseudo(
  el: Element,
  pseudo: "::before" | "::after",
  slideRect: DOMRect,
  parentAccOpacity: number = 1,
): PseudoResult | null {
  const computed = getComputedStyle(el, pseudo);
  const content = computed.content;
  if (!content || content === "none" || content === "normal") return null;

  const parentRect = el.getBoundingClientRect();
  const position = computed.position;

  // Parse dimensions
  let w = parseFloat(computed.width) || 0;
  let h = parseFloat(computed.height) || 0;

  // Extract quoted text content (e.g., content: "Hello" or content: 'Hello')
  // Also handles attr() and counter() but we only extract string literals
  const textContent = extractTextFromContent(content);

  const bg = computed.backgroundColor;
  const hasBg = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";

  // If no background and no text, nothing to extract
  if (!hasBg && !textContent) return null;

  // For text-only pseudo-elements (no explicit dimensions), use parent position
  // The pseudo-element may be inline and have 0 explicit width/height
  const hasExplicitSize = w >= 1 && h >= 1;

  let x: number, y: number;

  if (position === "absolute" && hasExplicitSize) {
    const top = parseFloat(computed.top);
    const left = parseFloat(computed.left);
    const right = parseFloat(computed.right);
    const bottom = parseFloat(computed.bottom);

    if (!isNaN(left)) {
      x = parentRect.left - slideRect.left + left;
    } else if (!isNaN(right)) {
      x = parentRect.right - slideRect.left - right - w;
    } else {
      x = parentRect.left - slideRect.left;
    }

    if (!isNaN(top)) {
      y = parentRect.top - slideRect.top + top;
    } else if (!isNaN(bottom)) {
      y = parentRect.bottom - slideRect.top - bottom - h;
    } else {
      y = parentRect.top - slideRect.top;
    }
  } else {
    x = parentRect.left - slideRect.left;
    y = parentRect.top - slideRect.top;
    if (!hasExplicitSize) {
      w = parentRect.width;
      h = parentRect.height;
    }
  }

  const result: PseudoResult = {};

  // Build rect if there's a visible background and explicit size
  if (hasBg && hasExplicitSize) {
    const adjustedBg = applyOpacityToColor(bg, parentAccOpacity);
    const br = parseBorderRadius(computed);
    const rectData: any = { x, y, width: w, height: h, backgroundColor: adjustedBg };
    if (br > 0) rectData.borderRadius = br;
    result.rect = rectData;
  }

  // Build text element if there's text content
  if (textContent) {
    const fontFamily = computed.fontFamily.split(",")[0].trim().replace(/['"]/g, "");
    const fsVal = parseFloat(computed.fontSize) || 16;
    const adjustedColor = applyOpacityToColor(computed.color, parentAccOpacity);
    const lhVal = parseFloat(computed.lineHeight);
    const lineHeight = isNaN(lhVal) ? 1.2 : lhVal / fsVal;
    const letterSpacing = parseFloat(computed.letterSpacing) || 0;

    const run: any = {
      text: textContent,
      fontSize: fsVal,
      fontFamily,
      fontWeight: computed.fontWeight,
      fontStyle: computed.fontStyle,
      color: adjustedColor,
      letterSpacing,
      textTransform: computed.textTransform,
      lineHeight,
    };

    const dec = computed.textDecorationLine;
    if (dec && dec !== "none") run.textDecoration = dec;

    result.text = {
      runs: [run],
      x,
      y,
      width: w,
      height: h,
      textAlign: computed.textAlign || "left",
      rotation: 0,
      parentWidth: parentRect.width,
      parentHeight: parentRect.height,
      wrap: true,
      lineHeight,
      text: textContent,
      fontSize: fsVal,
      fontFamily,
      fontWeight: computed.fontWeight,
      fontStyle: computed.fontStyle,
      color: adjustedColor,
      letterSpacing,
      textTransform: computed.textTransform,
    };
  }

  return result.rect || result.text ? result : null;
}

/** Extract text from CSS content property value. Handles quoted strings. */
export function extractTextFromContent(content: string): string | null {
  // CSS content can be: "string", 'string', counter(...), attr(...), url(...), etc.
  // We only extract simple quoted strings and concatenated quoted strings
  const parts: string[] = [];
  const regex = /["']([^"']*?)["']/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) parts.push(match[1]);
  }

  const text = parts.join("").trim();
  return text || null;
}
