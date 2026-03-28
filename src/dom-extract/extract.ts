import type { Page } from "playwright";
import type { SlideData, ImageRef } from "../types";
import { getAccumulatedOpacity, applyOpacityToColor, getRotation, getTransformInfo, resolveRadius, parseBorderRadius, parseBorderRadii, parseShadow } from "./css-helpers";
import { extractPseudo, extractTextFromContent } from "./pseudo";
import { parseGradient, detectGradient, detectGradients, splitBackgroundLayers, parseSingleGradientLayer } from "./gradient-parse";
import { findBlockAncestor, hasBrBetween } from "./text-helpers";

/** Inject helper functions as globals into the browser page context. */
async function injectHelpers(page: Page) {
  await page.addScriptTag({
    content: [
      getAccumulatedOpacity,
      applyOpacityToColor,
      getRotation,
      getTransformInfo,
      resolveRadius,
      parseBorderRadius,
      parseBorderRadii,
      parseShadow,
      extractTextFromContent,
      extractPseudo,
      parseGradient,
      detectGradient,
      detectGradients,
      splitBackgroundLayers,
      parseSingleGradientLayer,
      findBlockAncestor,
      hasBrBetween,
    ].map(fn => fn.toString()).join("\n"),
  });
}

/** Extract structured slide data from the DOM via Playwright page.evaluate() */
export async function extractSlideData(page: Page): Promise<{ slides: SlideData[]; imageRefs: ImageRef[] }> {
  await injectHelpers(page);

  return await page.evaluate(() => {
    // ----------------------------------------------------------------
    // RawTextRun interface (shared by text extraction phases)
    // ----------------------------------------------------------------
    interface RawTextRun {
      text: string;
      textNode: Node;
      el: Element;
      blockAncestor: Element;
      groupKey: string | null;
      rangeRect: DOMRect;
      fontSize: number;
      fontFamily: string;
      fontWeight: string;
      fontStyle: string;
      color: string;
      letterSpacing: number;
      textTransform: string;
      textAlign: string;
      rotation: number;
      lineHeight: number;
      textDecoration: string;
      href: string | null;
      textShadow: { offsetX: number; offsetY: number; blurRadius: number; color: string } | null;
      gradientFill: any | null;
    }

    // ----------------------------------------------------------------
    // Phase: Image detection
    // ----------------------------------------------------------------
    function extractImages(
      allElements: NodeListOf<Element>,
      slideRect: DOMRect,
      slideIdx: number,
      imageRefs: any[],
    ): Set<Element> {
      let imgIdx = 0;
      const imageElements = new Set<Element>();

      allElements.forEach((el) => {
        const tagName = el.tagName;
        const computed = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const x = rect.left - slideRect.left;
        const y = rect.top - slideRect.top;
        const w = rect.width;
        const h = rect.height;
        if (w < 1 || h < 1) return;

        let isImage = false;

        if (tagName === "IMG" && (el as HTMLImageElement).src) {
          isImage = true;
        } else if (tagName === "svg" || tagName === "SVG") {
          isImage = true;
        } else {
          const bgImage = computed.backgroundImage;
          if (bgImage && bgImage !== "none" && bgImage.includes("url(") && !bgImage.includes("gradient")) {
            isImage = true;
          }
        }

        if (isImage) {
          const selector = `[data-slidegen-img="img-${slideIdx}-${imgIdx}"]`;
          el.setAttribute("data-slidegen-img", `img-${slideIdx}-${imgIdx}`);
          imgIdx++;
          imageElements.add(el);
          imageRefs.push({ slideIndex: slideIdx, selector, x, y, width: w, height: h });
        }
      });

      return imageElements;
    }

    // ----------------------------------------------------------------
    // Phase: Rect and border extraction
    // ----------------------------------------------------------------
    function extractRects(
      allElements: NodeListOf<Element>,
      slide: Element,
      slideRect: DOMRect,
      imageElements: Set<Element>,
      data: any,
    ) {
      allElements.forEach((el) => {
        if (imageElements.has(el)) return;
        const tag = el.tagName;
        if (tag === "TABLE" || tag === "THEAD" || tag === "TBODY" || tag === "TFOOT" || tag === "TR" || tag === "TD" || tag === "TH") return;
        const computed = getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        const x = rect.left - slideRect.left;
        const y = rect.top - slideRect.top;
        const w = rect.width;
        const h = rect.height;

        if (w < 1 || h < 1) return;

        const accOpacity = getAccumulatedOpacity(el, slide);

        const bg = computed.backgroundColor;
        const hasBg = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";

        const bgImage = computed.backgroundImage;
        let gradient: any = null;
        let gradients: any[] = [];

        if (bgImage && bgImage !== "none") {
          gradients = detectGradients(bgImage);
          gradient = gradients.length > 0 ? gradients[0] : null;
        }

        const bgClip = computed.getPropertyValue("background-clip") || computed.getPropertyValue("-webkit-background-clip");
        const isTextClipped = bgClip === "text";

        if ((hasBg || gradient) && !isTextClipped) {
          const rectData: any = { x, y, width: w, height: h, backgroundColor: applyOpacityToColor(bg || "rgba(0,0,0,0)", accOpacity) };
          if (gradient) rectData.gradient = gradient;
          if (gradients.length > 1) rectData.gradients = gradients;
          const br = parseBorderRadius(computed, w, h);
          if (br > 0) rectData.borderRadius = br;
          const radii = parseBorderRadii(computed, w, h);
          if (radii) {
            const allEqual = radii.topLeft === radii.topRight && radii.topRight === radii.bottomRight && radii.bottomRight === radii.bottomLeft;
            if (!allEqual) rectData.borderRadii = radii;
          }
          const shadow = parseShadow(computed.boxShadow);
          if (shadow) rectData.boxShadow = shadow;
          data.rects.push(rectData);
        }

        // Check for uniform borders — emit as a single outlined rect instead of 4 line-rects
        const borderProps = ["Top", "Right", "Bottom", "Left"].map(prop => ({
          width: parseFloat((computed as any)[`border${prop}Width`]) || 0,
          color: (computed as any)[`border${prop}Color`] as string,
          style: (computed as any)[`border${prop}Style`] as string,
        }));
        const visibleBorders = borderProps.filter(b => b.width >= 1 && b.style !== "none" && b.color && b.color !== "rgba(0, 0, 0, 0)" && b.color !== "transparent");

        if (visibleBorders.length === 4) {
          // All 4 sides have visible borders — check if uniform
          const allSameColor = visibleBorders.every(b => b.color === visibleBorders[0]!.color);
          const allSameWidth = visibleBorders.every(b => Math.abs(b.width - visibleBorders[0]!.width) < 0.5);
          if (allSameColor && allSameWidth) {
            // Emit as a single rect with border properties (whether or not it has a background)
            if (!hasBg && !gradient) {
              const rectData: any = {
                x, y, width: w, height: h,
                backgroundColor: "rgba(0,0,0,0)",
                borderColor: applyOpacityToColor(visibleBorders[0]!.color, accOpacity),
                borderWidth: visibleBorders[0]!.width,
              };
              const br = parseBorderRadius(computed, w, h);
              if (br > 0) rectData.borderRadius = br;
              const radii = parseBorderRadii(computed, w, h);
              if (radii) {
                const allEqual = radii.topLeft === radii.topRight && radii.topRight === radii.bottomRight && radii.bottomRight === radii.bottomLeft;
                if (!allEqual) rectData.borderRadii = radii;
              }
              data.rects.push(rectData);
            } else {
              // Background rect already emitted above — add border info to it
              const lastRect = data.rects[data.rects.length - 1];
              if (lastRect && lastRect.x === x && lastRect.y === y) {
                lastRect.borderColor = applyOpacityToColor(visibleBorders[0]!.color, accOpacity);
                lastRect.borderWidth = visibleBorders[0]!.width;
              }
            }
          } else {
            // Non-uniform borders — emit as individual line-rects
            const sides = [
              { prop: 0, rx: x, ry: y, rw: w, rh: 0, isHoriz: true },
              { prop: 2, rx: x, ry: y + h, rw: w, rh: 0, isHoriz: true },
              { prop: 3, rx: x, ry: y, rw: 0, rh: h, isHoriz: false },
              { prop: 1, rx: x + w, ry: y, rw: 0, rh: h, isHoriz: false },
            ];
            for (const side of sides) {
              const bp = borderProps[side.prop]!;
              if (bp.width >= 1 && bp.style !== "none" && bp.color && bp.color !== "rgba(0, 0, 0, 0)" && bp.color !== "transparent") {
                const lineRect = side.isHoriz
                  ? { x: side.rx, y: side.ry - bp.width / 2, width: side.rw, height: bp.width, backgroundColor: applyOpacityToColor(bp.color, accOpacity) }
                  : { x: side.rx - bp.width / 2, y: side.ry, width: bp.width, height: side.rh, backgroundColor: applyOpacityToColor(bp.color, accOpacity) };
                data.rects.push(lineRect);
              }
            }
          }
        } else if (visibleBorders.length > 0) {
          // Some but not all sides — emit individual line-rects
          const sides = [
            { prop: 0, rx: x, ry: y, rw: w, rh: 0, isHoriz: true },
            { prop: 1, rx: x + w, ry: y, rw: 0, rh: h, isHoriz: false },
            { prop: 2, rx: x, ry: y + h, rw: w, rh: 0, isHoriz: true },
            { prop: 3, rx: x, ry: y, rw: 0, rh: h, isHoriz: false },
          ];
          for (const side of sides) {
            const bp = borderProps[side.prop]!;
            if (bp.width >= 1 && bp.style !== "none" && bp.color && bp.color !== "rgba(0, 0, 0, 0)" && bp.color !== "transparent") {
              const lineRect = side.isHoriz
                ? { x: side.rx, y: side.ry - bp.width / 2, width: side.rw, height: bp.width, backgroundColor: applyOpacityToColor(bp.color, accOpacity) }
                : { x: side.rx - bp.width / 2, y: side.ry, width: bp.width, height: side.rh, backgroundColor: applyOpacityToColor(bp.color, accOpacity) };
              data.rects.push(lineRect);
            }
          }
        }

        const before = extractPseudo(el, "::before", slideRect, accOpacity);
        if (before) {
          if (before.rect) data.rects.push(before.rect);
          if (before.text) data.texts.push(before.text);
        }
        const after = extractPseudo(el, "::after", slideRect, accOpacity);
        if (after) {
          if (after.rect) data.rects.push(after.rect);
          if (after.text) data.texts.push(after.text);
        }
      });
    }

    // ----------------------------------------------------------------
    // Phase: List extraction
    // ----------------------------------------------------------------
    function extractLists(
      slide: Element,
      slideRect: DOMRect,
      data: any,
    ): Set<Node> {
      const listNodes = new Set<Node>();

      slide.querySelectorAll("ul, ol").forEach((listEl) => {
        const listRect = listEl.getBoundingClientRect();
        if (listRect.width < 1 || listRect.height < 1) return;

        const isOrdered = listEl.tagName === "OL";

        const items = listEl.querySelectorAll(":scope > li");
        items.forEach((li, liIdx) => {
          const liRect = li.getBoundingClientRect();
          if (liRect.width < 1 || liRect.height < 1) return;

          const liComputed = getComputedStyle(li);
          const accOpacity = getAccumulatedOpacity(li, slide);

          let depth = 0;
          let parent = li.parentElement;
          while (parent && parent !== slide) {
            if (parent.tagName === "UL" || parent.tagName === "OL") depth++;
            parent = parent.parentElement;
          }
          depth = Math.max(0, depth - 1);

          const listStyleType = liComputed.listStyleType || "disc";
          let bulletType: "char" | "autoNum" = isOrdered ? "autoNum" : "char";
          let bulletChar = "\u2022";
          let bulletAutoNumType: string | undefined;

          if (isOrdered) {
            const autoNumMap: Record<string, string> = {
              "decimal": "arabicPeriod",
              "lower-alpha": "alphaLcPeriod",
              "upper-alpha": "alphaUcPeriod",
              "lower-roman": "romanLcPeriod",
              "upper-roman": "romanUcPeriod",
            };
            bulletAutoNumType = autoNumMap[listStyleType] || "arabicPeriod";
          } else {
            const charMap: Record<string, string> = {
              "disc": "\u2022",
              "circle": "\u25CB",
              "square": "\u25A0",
              "none": "",
            };
            bulletChar = charMap[listStyleType] ?? "\u2022";
            if (listStyleType === "none") bulletType = "char";
          }

          const liRuns: any[] = [];
          const textWalker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
          let firstTextComputed: CSSStyleDeclaration | null = null;
          while (textWalker.nextNode()) {
            const textNode = textWalker.currentNode;
            let inNested = false;
            let p = textNode.parentElement;
            while (p && p !== li) {
              if (p.tagName === "UL" || p.tagName === "OL") { inNested = true; break; }
              p = p.parentElement;
            }
            if (inNested) continue;

            listNodes.add(textNode);
            const rawText = textNode.textContent || "";
            const text = rawText.replace(/\s+/g, " ");
            if (!text.trim()) continue;

            const el = textNode.parentElement;
            if (!el) continue;

            const computed = getComputedStyle(el);
            if (!firstTextComputed) firstTextComputed = computed;

            const fontFamily = computed.fontFamily.split(",")[0]!.trim().replace(/['"]/g, "");
            const fsVal = parseFloat(computed.fontSize);
            const textAccOpacity = getAccumulatedOpacity(el, slide);
            const adjustedColor = applyOpacityToColor(computed.color, textAccOpacity);
            const lhVal = parseFloat(computed.lineHeight);
            const lineHeight = isNaN(lhVal) ? 1.2 : lhVal / fsVal;

            const run: any = {
              text,
              fontSize: fsVal,
              fontFamily,
              fontWeight: computed.fontWeight,
              fontStyle: computed.fontStyle,
              color: adjustedColor,
              letterSpacing: parseFloat(computed.letterSpacing) || 0,
              textTransform: computed.textTransform,
              lineHeight,
            };
            const dec = computed.textDecorationLine;
            if (dec && dec !== "none") run.textDecoration = dec;
            liRuns.push(run);
          }

          if (liRuns.length === 0) return;

          const firstRun = liRuns[0]!;
          const fc = firstTextComputed || liComputed;
          const x = liRect.left - slideRect.left;
          const y = liRect.top - slideRect.top;

          const textEl: any = {
            runs: liRuns,
            x,
            y,
            width: liRect.width,
            height: liRect.height,
            textAlign: fc.textAlign || "left",
            rotation: 0,
            parentWidth: listRect.width,
            parentHeight: listRect.height,
            wrap: true,
            lineHeight: firstRun.lineHeight,
            bulletType,
            indentLevel: depth,
            text: liRuns.map((r: any) => r.text).join(""),
            fontSize: firstRun.fontSize,
            fontFamily: firstRun.fontFamily,
            fontWeight: firstRun.fontWeight,
            fontStyle: firstRun.fontStyle,
            color: firstRun.color,
            letterSpacing: firstRun.letterSpacing,
            textTransform: firstRun.textTransform,
          };
          if (bulletType === "char" && bulletChar) textEl.bulletChar = bulletChar;
          if (bulletType === "autoNum" && bulletAutoNumType) textEl.bulletAutoNumType = bulletAutoNumType;

          data.texts.push(textEl);
        });
      });

      return listNodes;
    }

    // ----------------------------------------------------------------
    // Phase: Table extraction
    // ----------------------------------------------------------------
    function extractTables(
      slide: Element,
      slideRect: DOMRect,
      data: any,
    ): Set<Node> {
      const tableNodes = new Set<Node>();

      slide.querySelectorAll("table").forEach((tableEl) => {
        const tableRect = tableEl.getBoundingClientRect();
        if (tableRect.width < 1 || tableRect.height < 1) return;

        const rows: any[] = [];
        const columnWidths: number[] = [];
        let columnWidthsSet = false;

        // Pre-extract <col> element backgrounds for column-level styling
        const colBackgrounds: string[] = [];
        tableEl.querySelectorAll("colgroup > col, col").forEach((colEl) => {
          const colComputed = getComputedStyle(colEl);
          const colBg = colComputed.backgroundColor;
          const hasColBg = colBg && colBg !== "rgba(0, 0, 0, 0)" && colBg !== "transparent";
          colBackgrounds.push(hasColBg ? colBg : "");
        });

        tableEl.querySelectorAll("tr").forEach((trEl) => {
          const trRect = trEl.getBoundingClientRect();
          const cells: any[] = [];

          trEl.querySelectorAll("td, th").forEach((cellEl, cellIdx) => {
            const cellRect = cellEl.getBoundingClientRect();
            const cellComputed = getComputedStyle(cellEl);
            const cellAccOpacity = getAccumulatedOpacity(cellEl, slide);

            if (!columnWidthsSet) {
              columnWidths.push(cellRect.width);
            }

            const cellRuns: any[] = [];
            const cellWalker = document.createTreeWalker(cellEl, NodeFilter.SHOW_TEXT);
            while (cellWalker.nextNode()) {
              const textNode = cellWalker.currentNode;
              tableNodes.add(textNode);
              const rawText = textNode.textContent || "";
              const text = rawText.replace(/\s+/g, " ");
              if (!text.trim()) continue;

              const el = textNode.parentElement;
              if (!el) continue;

              const computed = getComputedStyle(el);
              const fontFamily = computed.fontFamily.split(",")[0]!.trim().replace(/['"]/g, "");
              const fsVal = parseFloat(computed.fontSize);
              const textAccOpacity = getAccumulatedOpacity(el, slide);
              const adjustedColor = applyOpacityToColor(computed.color, textAccOpacity);

              cellRuns.push({
                text,
                fontSize: fsVal,
                fontFamily,
                fontWeight: computed.fontWeight,
                fontStyle: computed.fontStyle,
                color: adjustedColor,
              });
            }

            const cellBg = cellComputed.backgroundColor;
            const hasCellBg = cellBg && cellBg !== "rgba(0, 0, 0, 0)" && cellBg !== "transparent";

            // Fall back to <col> background if cell has none
            let effectiveBg = hasCellBg ? cellBg : "";
            if (!hasCellBg && cellIdx < colBackgrounds.length && colBackgrounds[cellIdx]!) {
              effectiveBg = colBackgrounds[cellIdx]!;
            }
            // Also check <tr> background
            if (!effectiveBg) {
              const trComputed = getComputedStyle(trEl);
              const trBg = trComputed.backgroundColor;
              if (trBg && trBg !== "rgba(0, 0, 0, 0)" && trBg !== "transparent") {
                effectiveBg = trBg;
              }
            }

            // Extract cell borders
            function parseBorder(side: string) {
              const w = parseFloat(cellComputed.getPropertyValue(`border-${side}-width`));
              const s = cellComputed.getPropertyValue(`border-${side}-style`);
              const c = cellComputed.getPropertyValue(`border-${side}-color`);
              if (w > 0 && s && s !== "none") {
                return { width: w, style: s, color: applyOpacityToColor(c, cellAccOpacity) };
              }
              return undefined;
            }
            const borderTop = parseBorder("top");
            const borderRight = parseBorder("right");
            const borderBottom = parseBorder("bottom");
            const borderLeft = parseBorder("left");

            const cell: any = {
              width: cellRect.width,
              text: cellRuns.map((r: any) => r.text).join("").trim(),
            };
            if (cellRuns.length > 0) cell.textRuns = cellRuns;
            if (effectiveBg) cell.backgroundColor = applyOpacityToColor(effectiveBg, cellAccOpacity);
            const colspan = parseInt(cellEl.getAttribute("colspan") || "1");
            const rowspan = parseInt(cellEl.getAttribute("rowspan") || "1");
            if (colspan > 1) cell.colSpan = colspan;
            if (rowspan > 1) cell.rowSpan = rowspan;
            if (borderTop) cell.borderTop = borderTop;
            if (borderRight) cell.borderRight = borderRight;
            if (borderBottom) cell.borderBottom = borderBottom;
            if (borderLeft) cell.borderLeft = borderLeft;

            // Extract cell padding
            const pTop = parseFloat(cellComputed.paddingTop);
            const pRight = parseFloat(cellComputed.paddingRight);
            const pBottom = parseFloat(cellComputed.paddingBottom);
            const pLeft = parseFloat(cellComputed.paddingLeft);
            if (pTop) cell.paddingTop = pTop;
            if (pRight) cell.paddingRight = pRight;
            if (pBottom) cell.paddingBottom = pBottom;
            if (pLeft) cell.paddingLeft = pLeft;

            const textAlign = cellComputed.textAlign;
            if (textAlign && textAlign !== "left" && textAlign !== "start") {
              cell.textAlign = textAlign;
            }

            cells.push(cell);
          });

          if (!columnWidthsSet && columnWidths.length > 0) columnWidthsSet = true;

          rows.push({ height: trRect.height, cells });
        });

        data.tables.push({
          x: tableRect.left - slideRect.left,
          y: tableRect.top - slideRect.top,
          width: tableRect.width,
          height: tableRect.height,
          rows,
          columnWidths,
        });
      });

      return tableNodes;
    }

    // ----------------------------------------------------------------
    // Phase: Text run extraction (pre + regular text nodes)
    // ----------------------------------------------------------------
    function extractTextRuns(
      slide: Element,
      slideRect: DOMRect,
      allElements: NodeListOf<Element>,
      preNodes: Set<Node>,
      listNodes: Set<Node>,
      tableNodes: Set<Node>,
      textGradientMap: Map<Element, string>,
      textGradientInfoMap: Map<Element, any>,
    ): RawTextRun[] {
      const rawRuns: RawTextRun[] = [];

      // Collect <pre> text nodes for special whitespace handling
      slide.querySelectorAll("pre").forEach((pre) => {
        const preRect = pre.getBoundingClientRect();
        if (preRect.width < 1 || preRect.height < 1) return;

        const preWalker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
        while (preWalker.nextNode()) {
          const textNode = preWalker.currentNode;
          preNodes.add(textNode);
          const rawText = textNode.textContent || "";
          if (!rawText) continue;

          const el = textNode.parentElement;
          if (!el) continue;

          const range = document.createRange();
          range.selectNodeContents(textNode);
          const rangeRect = range.getBoundingClientRect();

          const computed = getComputedStyle(el);
          const fontFamily = computed.fontFamily.split(",")[0]!.trim().replace(/['"]/g, "");
          const letterSpacing = parseFloat(computed.letterSpacing) || 0;
          const txInfo = getTransformInfo(computed);
          const rotation = txInfo.rotation;
          const textAccOpacity = getAccumulatedOpacity(el, slide);
          const adjustedColor = applyOpacityToColor(computed.color, textAccOpacity);

          const lhVal = parseFloat(computed.lineHeight);
          const fsVal = parseFloat(computed.fontSize);
          const lineHeight = isNaN(lhVal) ? 1.2 : lhVal / fsVal;
          const scaleAvg = (Math.abs(txInfo.scaleX) + Math.abs(txInfo.scaleY)) / 2;
          const effectiveFontSize = scaleAvg !== 1 ? fsVal * scaleAvg : fsVal;

          const sgGroup = el.closest('[data-sg-group]')?.getAttribute('data-sg-group') ?? null;
          const anchorEl = el.closest('a');
          const href = anchorEl?.getAttribute('href') ?? null;

          rawRuns.push({
            text: rawText,
            textNode,
            el,
            blockAncestor: findBlockAncestor(pre, slide),
            groupKey: sgGroup,
            rangeRect: rangeRect.width >= 1 && rangeRect.height >= 1 ? rangeRect : preRect,
            fontSize: effectiveFontSize,
            fontFamily,
            fontWeight: computed.fontWeight,
            fontStyle: computed.fontStyle,
            color: adjustedColor,
            letterSpacing,
            textTransform: computed.textTransform,
            textAlign: computed.textAlign,
            rotation,
            lineHeight,
            textDecoration: computed.textDecorationLine || "none",
            href,
            textShadow: parseShadow(computed.textShadow),
            gradientFill: null,
          });
        }
      });

      // Regular text nodes
      const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const textNode = walker.currentNode;
        if (preNodes.has(textNode)) continue;
        if (listNodes.has(textNode)) continue;
        if (tableNodes.has(textNode)) continue;

        const rawText = textNode.textContent || "";
        const text = rawText.replace(/\s+/g, " ");
        if (!text.trim()) continue;

        const el = textNode.parentElement;
        if (!el) continue;

        const range = document.createRange();
        range.selectNodeContents(textNode);
        const rangeRect = range.getBoundingClientRect();
        if (rangeRect.width < 1 || rangeRect.height < 1) continue;

        const computed = getComputedStyle(el);
        const fontFamily = computed.fontFamily.split(",")[0]!.trim().replace(/['"]/g, "");
        const letterSpacing = parseFloat(computed.letterSpacing) || 0;
        const txInfo = getTransformInfo(computed);
        let rotation = txInfo.rotation;
        const writingMode = computed.writingMode || (computed as any).webkitWritingMode;
        if (Math.abs(rotation) < 0.5 && writingMode) {
          if (writingMode === "vertical-rl" || writingMode === "tb-rl") rotation = 90;
          else if (writingMode === "vertical-lr") rotation = -90;
        }
        const textAccOpacity = getAccumulatedOpacity(el, slide);
        let colorStr = computed.color;
        let gradFill: any | null = null;
        let cur: Element | null = el;
        while (cur && cur !== slide) {
          if (textGradientMap.has(cur)) {
            colorStr = textGradientMap.get(cur)!;
            gradFill = textGradientInfoMap.get(cur) ?? null;
            break;
          }
          cur = cur.parentElement;
        }
        const adjustedColor = applyOpacityToColor(colorStr, textAccOpacity);

        const lhVal = parseFloat(computed.lineHeight);
        const fsVal = parseFloat(computed.fontSize);
        const lineHeight = isNaN(lhVal) ? 1.2 : lhVal / fsVal;
        const scaleAvg = (Math.abs(txInfo.scaleX) + Math.abs(txInfo.scaleY)) / 2;
        const effectiveFontSize = scaleAvg !== 1 ? fsVal * scaleAvg : fsVal;

        const sgGroup = el.closest('[data-sg-group]')?.getAttribute('data-sg-group') ?? null;
        const anchorEl = el.closest('a');
        const href = anchorEl?.getAttribute('href') ?? null;

        rawRuns.push({
          text,
          textNode,
          el,
          blockAncestor: findBlockAncestor(el, slide),
          groupKey: sgGroup,
          rangeRect,
          fontSize: effectiveFontSize,
          fontFamily,
          fontWeight: computed.fontWeight,
          fontStyle: computed.fontStyle,
          color: adjustedColor,
          letterSpacing,
          textTransform: computed.textTransform,
          textAlign: computed.textAlign,
          rotation,
          lineHeight,
          textDecoration: computed.textDecorationLine || "none",
          href,
          textShadow: parseShadow(computed.textShadow),
          gradientFill: gradFill,
        });
      }

      return rawRuns;
    }

    // ----------------------------------------------------------------
    // Phase: Group and merge text runs into text elements
    // ----------------------------------------------------------------
    function groupAndMergeRuns(
      rawRuns: RawTextRun[],
      slideRect: DOMRect,
      blockEl: Element,
      data: any,
    ) {
      const groupsByKey = new Map<string, RawTextRun[]>();
      const groupsByAncestor = new Map<Element, RawTextRun[]>();
      for (const run of rawRuns) {
        if (run.groupKey) {
          const key = "sg:" + run.groupKey;
          const list = groupsByKey.get(key) || [];
          list.push(run);
          groupsByKey.set(key, list);
        } else {
          const list = groupsByAncestor.get(run.blockAncestor) || [];
          list.push(run);
          groupsByAncestor.set(run.blockAncestor, list);
        }
      }

      const allGroups: [Element, RawTextRun[]][] = [];
      for (const [, runs] of groupsByKey) {
        allGroups.push([runs[0]!.blockAncestor, runs]);
      }
      for (const [blkEl, runs] of groupsByAncestor) {
        allGroups.push([blkEl, runs]);
      }

      for (const [groupBlockEl, runs] of allGroups) {
        if (runs.length === 0) continue;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const r of runs) {
          const rx = r.rangeRect.left - slideRect.left;
          const ry = r.rangeRect.top - slideRect.top;
          minX = Math.min(minX, rx);
          minY = Math.min(minY, ry);
          maxX = Math.max(maxX, rx + r.rangeRect.width);
          maxY = Math.max(maxY, ry + r.rangeRect.height);
        }

        const blockRect = groupBlockEl.getBoundingClientRect();
        const parentWidth = blockRect.width;
        const parentHeight = blockRect.height;

        const firstRun = runs[0]!;
        const rotation = firstRun.rotation;
        const isRotated = Math.abs(rotation) > 0.5;

        const textRuns: any[] = [];
        for (let ri = 0; ri < runs.length; ri++) {
          const curRun = runs[ri]!;
          if (ri > 0 && hasBrBetween(runs[ri - 1]!.textNode, curRun.textNode, groupBlockEl)) {
            textRuns.push({
              text: "\n",
              fontSize: curRun.fontSize,
              fontFamily: curRun.fontFamily,
              fontWeight: curRun.fontWeight,
              fontStyle: curRun.fontStyle,
              color: curRun.color,
              letterSpacing: curRun.letterSpacing,
              textTransform: "none",
              lineHeight: curRun.lineHeight,
            });
          }
          const run: any = {
            text: curRun.text,
            fontSize: curRun.fontSize,
            fontFamily: curRun.fontFamily,
            fontWeight: curRun.fontWeight,
            fontStyle: curRun.fontStyle,
            color: curRun.color,
            letterSpacing: curRun.letterSpacing,
            textTransform: curRun.textTransform,
            lineHeight: curRun.lineHeight,
          };
          const dec = curRun.textDecoration;
          if (dec && dec !== "none") run.textDecoration = dec;
          if (curRun.href) run.href = curRun.href;
          if (curRun.textShadow) run.textShadow = curRun.textShadow;
          if (curRun.gradientFill) run.gradientFill = curRun.gradientFill;
          textRuns.push(run);
        }

        const groupHeight = maxY - minY;
        const maxFontSize = Math.max(...runs.map(r => r.fontSize));
        const avgLineHeight = runs.reduce((sum, r) => sum + r.lineHeight, 0) / runs.length;
        const lineHeight = maxFontSize * 1.5;
        const hasLineBreaks = textRuns.some((r: any) => r.text === "\n");

        const wrapAttr = groupBlockEl.closest('[data-sg-wrap]')?.getAttribute('data-sg-wrap');
        let shouldWrap: boolean;
        if (wrapAttr === "true") {
          shouldWrap = !isRotated;
        } else if (wrapAttr === "false") {
          shouldWrap = false;
        } else {
          shouldWrap = !isRotated && (groupHeight > lineHeight * 1.3 || hasLineBreaks);
        }

        data.texts.push({
          runs: textRuns,
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          textAlign: firstRun.textAlign,
          rotation,
          parentWidth,
          parentHeight,
          wrap: shouldWrap,
          lineHeight: avgLineHeight,
          text: runs.map(r => r.text).join(""),
          fontSize: firstRun.fontSize,
          fontFamily: firstRun.fontFamily,
          fontWeight: firstRun.fontWeight,
          fontStyle: firstRun.fontStyle,
          color: firstRun.color,
          letterSpacing: firstRun.letterSpacing,
          textTransform: firstRun.textTransform,
        });
      }
    }

    // ================================================================
    // Main extraction loop
    // ================================================================
    const slides = document.querySelectorAll(".slide");
    const result: any[] = [];
    const imageRefs: any[] = [];

    slides.forEach((slide, slideIdx) => {
      const slideRect = slide.getBoundingClientRect();
      const slideComputed = getComputedStyle(slide);
      let slideGradient: any = null;
      const slideBgImage = slideComputed.backgroundImage;
      if (slideBgImage && slideBgImage !== "none") {
        slideGradient = detectGradient(slideBgImage);
      }

      const data: any = {
        width: slideRect.width,
        height: slideRect.height,
        backgroundColor: slideComputed.backgroundColor,
        rects: [] as any[],
        texts: [] as any[],
        images: [] as any[],
        tables: [] as any[],
      };
      if (slideGradient) data.gradient = slideGradient;

      // Extract speaker notes
      const notesAttr = slide.getAttribute('data-notes');
      if (notesAttr) {
        data.notes = notesAttr;
      } else {
        const notesEl = slide.querySelector('.notes, [data-slide-notes]');
        if (notesEl) {
          data.notes = notesEl.textContent?.trim() || undefined;
          (notesEl as HTMLElement).style.display = 'none';
        }
      }

      const allElements = slide.querySelectorAll("*");

      // Phase 1: Images
      const imageElements = extractImages(allElements, slideRect, slideIdx, imageRefs);

      // Phase 2: Rects and borders
      extractRects(allElements, slide, slideRect, imageElements, data);

      // Phase 3: Lists
      const listNodes = extractLists(slide, slideRect, data);

      // Phase 4: Tables
      const tableNodes = extractTables(slide, slideRect, data);

      // Phase 5: Text gradient detection
      // Store both a solid fallback color AND the full gradient info for text gradient fills
      const textGradientMap = new Map<Element, string>();
      const textGradientInfoMap = new Map<Element, any>();
      allElements.forEach((el) => {
        const computed = getComputedStyle(el);
        const bgClip = computed.getPropertyValue("background-clip") || computed.getPropertyValue("-webkit-background-clip");
        if (bgClip === "text") {
          const bgImage = computed.backgroundImage;
          if (bgImage && bgImage !== "none") {
            const grad = detectGradient(bgImage);
            if (grad && grad.stops.length > 0) {
              const midIdx = Math.floor(grad.stops.length / 2);
              textGradientMap.set(el, grad.stops[midIdx].color);
              textGradientInfoMap.set(el, grad);
            }
          }
        }
      });

      // Phase 6: Text runs
      const preNodes = new Set<Node>();
      const rawRuns = extractTextRuns(slide, slideRect, allElements, preNodes, listNodes, tableNodes, textGradientMap, textGradientInfoMap);

      // Phase 7: Group and merge text runs
      groupAndMergeRuns(rawRuns, slideRect, slide, data);

      result.push(data);
    });

    return { slides: result, imageRefs };
  });
}
