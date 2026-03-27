import { applyOpacityToColor, parseBorderRadius } from "./css-helpers";

/** Extract position/size/colour of a ::before or ::after pseudo-element. */
export function extractPseudo(
  el: Element,
  pseudo: "::before" | "::after",
  slideRect: DOMRect,
  parentAccOpacity: number = 1,
): any | null {
  const computed = getComputedStyle(el, pseudo);
  const content = computed.content;
  if (!content || content === "none" || content === "normal") return null;

  const bg = computed.backgroundColor;
  if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") return null;

  const parentRect = el.getBoundingClientRect();
  const position = computed.position;

  let x: number, y: number, w: number, h: number;

  w = parseFloat(computed.width) || 0;
  h = parseFloat(computed.height) || 0;
  if (w < 1 || h < 1) return null;

  if (position === "absolute") {
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
  }

  const adjustedBg = applyOpacityToColor(bg, parentAccOpacity);
  const br = parseBorderRadius(computed);
  const result: any = { x, y, width: w, height: h, backgroundColor: adjustedBg };
  if (br > 0) result.borderRadius = br;
  return result;
}
