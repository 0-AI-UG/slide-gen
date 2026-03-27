import type { Page } from "playwright";
import type { SlideData, ImageRef } from "../types";
import { getAccumulatedOpacity, applyOpacityToColor, getRotation, resolveRadius, parseBorderRadius } from "./css-helpers";
import { extractPseudo } from "./pseudo";
import { parseGradient } from "./gradient-parse";
import { findBlockAncestor, hasBrBetween } from "./text-helpers";

/** Inject helper functions as globals into the browser page context. */
async function injectHelpers(page: Page) {
  await page.addScriptTag({
    content: [
      getAccumulatedOpacity,
      applyOpacityToColor,
      getRotation,
      resolveRadius,
      parseBorderRadius,
      extractPseudo,
      parseGradient,
      findBlockAncestor,
      hasBrBetween,
    ].map(fn => fn.toString()).join("\n"),
  });
}

/** Extract structured slide data from the DOM via Playwright page.evaluate() */
export async function extractSlideData(page: Page): Promise<{ slides: SlideData[]; imageRefs: ImageRef[] }> {
  await injectHelpers(page);

  return await page.evaluate(() => {
    const slides = document.querySelectorAll(".slide");
    const result: any[] = [];
    const imageRefs: any[] = [];

    slides.forEach((slide, slideIdx) => {
      const slideRect = slide.getBoundingClientRect();
      const slideComputed = getComputedStyle(slide);
      let slideGradient: any = null;
      const slideBgImage = slideComputed.backgroundImage;
      if (slideBgImage && slideBgImage !== "none") {
        const linearMatch = slideBgImage.match(/linear-gradient\((.+)\)/);
        const radialMatch = slideBgImage.match(/radial-gradient\((.+)\)/);
        if (linearMatch) slideGradient = parseGradient("linear", linearMatch[1]);
        else if (radialMatch) slideGradient = parseGradient("radial", radialMatch[1]);
      }

      const data: any = {
        width: slideRect.width,
        height: slideRect.height,
        backgroundColor: slideComputed.backgroundColor,
        rects: [] as any[],
        texts: [] as any[],
        images: [] as any[],
      };
      if (slideGradient) data.gradient = slideGradient;

      // Track image elements to skip them during rect extraction
      let imgIdx = 0;
      const imageElements = new Set<Element>();

      const allElements = slide.querySelectorAll("*");

      // First pass: detect image elements
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

        // Detect <img> with non-empty src
        if (tagName === "IMG" && (el as HTMLImageElement).src) {
          isImage = true;
        }
        // Detect inline <svg>
        else if (tagName === "svg" || tagName === "SVG") {
          isImage = true;
        }
        // Detect background-image: url(...) but not gradients
        else {
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
          imageRefs.push({
            slideIndex: slideIdx,
            selector,
            x, y,
            width: w,
            height: h,
          });
        }
      });

      // Second pass: extract rects and borders (skip image elements)
      allElements.forEach((el) => {
        if (imageElements.has(el)) return;
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

        if (bgImage && bgImage !== "none") {
          const linearMatch = bgImage.match(/linear-gradient\((.+)\)/);
          const radialMatch = bgImage.match(/radial-gradient\((.+)\)/);

          if (linearMatch) {
            gradient = parseGradient("linear", linearMatch[1]);
          } else if (radialMatch) {
            gradient = parseGradient("radial", radialMatch[1]);
          }
        }

        const bgClip = computed.getPropertyValue("background-clip") || computed.getPropertyValue("-webkit-background-clip");
        const isTextClipped = bgClip === "text";

        if ((hasBg || gradient) && !isTextClipped) {
          const rectData: any = { x, y, width: w, height: h, backgroundColor: applyOpacityToColor(bg || "rgba(0,0,0,0)", accOpacity) };
          if (gradient) rectData.gradient = gradient;
          const br = parseBorderRadius(computed, w, h);
          if (br > 0) rectData.borderRadius = br;
          data.rects.push(rectData);
        }

        const sides = [
          { prop: "Top", rx: x, ry: y, rw: w, rh: 0 },
          { prop: "Bottom", rx: x, ry: y + h, rw: w, rh: 0 },
          { prop: "Left", rx: x, ry: y, rw: 0, rh: h },
          { prop: "Right", rx: x + w, ry: y, rw: 0, rh: h },
        ];
        for (const side of sides) {
          const bw = parseFloat((computed as any)[`border${side.prop}Width`]) || 0;
          const bc = (computed as any)[`border${side.prop}Color`];
          const bs = (computed as any)[`border${side.prop}Style`];
          if (bw >= 1 && bs !== "none" && bc && bc !== "rgba(0, 0, 0, 0)" && bc !== "transparent") {
            const isHoriz = side.prop === "Top" || side.prop === "Bottom";
            const lineRect = isHoriz
              ? { x: side.rx, y: side.ry - bw / 2, width: side.rw, height: bw, backgroundColor: applyOpacityToColor(bc, accOpacity) }
              : { x: side.rx - bw / 2, y: side.ry, width: bw, height: side.rh, backgroundColor: applyOpacityToColor(bc, accOpacity) };
            data.rects.push(lineRect);
          }
        }

        const before = extractPseudo(el, "::before", slideRect, accOpacity);
        if (before) data.rects.push(before);
        const after = extractPseudo(el, "::after", slideRect, accOpacity);
        if (after) data.rects.push(after);
      });

      // Text extraction
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
      }

      const rawRuns: RawTextRun[] = [];
      const preNodes = new Set<Node>();

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
          const fontFamily = computed.fontFamily.split(",")[0].trim().replace(/['"]/g, "");
          const letterSpacing = parseFloat(computed.letterSpacing) || 0;
          const rotation = getRotation(computed);
          const textAccOpacity = getAccumulatedOpacity(el, slide);
          const adjustedColor = applyOpacityToColor(computed.color, textAccOpacity);

          const lhVal = parseFloat(computed.lineHeight);
          const fsVal = parseFloat(computed.fontSize);
          const lineHeight = isNaN(lhVal) ? 1.2 : lhVal / fsVal;

          const sgGroup = el.closest('[data-sg-group]')?.getAttribute('data-sg-group') ?? null;

          rawRuns.push({
            text: rawText,
            textNode,
            el,
            blockAncestor: findBlockAncestor(pre, slide),
            groupKey: sgGroup,
            rangeRect: rangeRect.width >= 1 && rangeRect.height >= 1 ? rangeRect : preRect,
            fontSize: fsVal,
            fontFamily,
            fontWeight: computed.fontWeight,
            fontStyle: computed.fontStyle,
            color: adjustedColor,
            letterSpacing,
            textTransform: computed.textTransform,
            textAlign: computed.textAlign,
            rotation,
            lineHeight,
          });
        }
      });

      // Detect text-gradient elements (background-clip: text)
      const textGradientMap = new Map<Element, string>();
      allElements.forEach((el) => {
        const computed = getComputedStyle(el);
        const bgClip = computed.getPropertyValue("background-clip") || computed.getPropertyValue("-webkit-background-clip");
        if (bgClip === "text") {
          const bgImage = computed.backgroundImage;
          if (bgImage && bgImage !== "none") {
            const linearMatch = bgImage.match(/linear-gradient\((.+)\)/);
            const radialMatch = bgImage.match(/radial-gradient\((.+)\)/);
            const gradInner = linearMatch ? linearMatch[1] : radialMatch ? radialMatch[1] : null;
            if (gradInner) {
              const gradType = linearMatch ? "linear" : "radial";
              const grad = parseGradient(gradType as "linear" | "radial", gradInner);
              if (grad && grad.stops.length > 0) {
                const midIdx = Math.floor(grad.stops.length / 2);
                textGradientMap.set(el, grad.stops[midIdx].color);
              }
            }
          }
        }
      });

      const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const textNode = walker.currentNode;
        if (preNodes.has(textNode)) continue;

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
        const fontFamily = computed.fontFamily.split(",")[0].trim().replace(/['"]/g, "");
        const letterSpacing = parseFloat(computed.letterSpacing) || 0;
        let rotation = getRotation(computed);
        const writingMode = computed.writingMode || (computed as any).webkitWritingMode;
        if (Math.abs(rotation) < 0.5 && writingMode) {
          if (writingMode === "vertical-rl" || writingMode === "tb-rl") rotation = 90;
          else if (writingMode === "vertical-lr") rotation = -90;
        }
        const textAccOpacity = getAccumulatedOpacity(el, slide);
        let colorStr = computed.color;
        let cur: Element | null = el;
        while (cur && cur !== slide) {
          if (textGradientMap.has(cur)) {
            colorStr = textGradientMap.get(cur)!;
            break;
          }
          cur = cur.parentElement;
        }
        const adjustedColor = applyOpacityToColor(colorStr, textAccOpacity);

        const lhVal = parseFloat(computed.lineHeight);
        const fsVal = parseFloat(computed.fontSize);
        const lineHeight = isNaN(lhVal) ? 1.2 : lhVal / fsVal;

        const sgGroup = el.closest('[data-sg-group]')?.getAttribute('data-sg-group') ?? null;

        rawRuns.push({
          text,
          textNode,
          el,
          blockAncestor: findBlockAncestor(el, slide),
          groupKey: sgGroup,
          rangeRect,
          fontSize: fsVal,
          fontFamily,
          fontWeight: computed.fontWeight,
          fontStyle: computed.fontStyle,
          color: adjustedColor,
          letterSpacing,
          textTransform: computed.textTransform,
          textAlign: computed.textAlign,
          rotation,
          lineHeight,
        });
      }

      // Group runs by data-sg-group attribute or block ancestor
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

      // Merge into a single iterable of [blockEl, runs] pairs
      const allGroups: [Element, RawTextRun[]][] = [];
      for (const [, runs] of groupsByKey) {
        // Use the first run's block ancestor for positioning context
        allGroups.push([runs[0].blockAncestor, runs]);
      }
      for (const [blockEl, runs] of groupsByAncestor) {
        allGroups.push([blockEl, runs]);
      }

      for (const [blockEl, runs] of allGroups) {
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

        const blockRect = blockEl.getBoundingClientRect();
        const parentWidth = blockRect.width;
        const parentHeight = blockRect.height;

        const firstRun = runs[0];
        const rotation = firstRun.rotation;
        const isRotated = Math.abs(rotation) > 0.5;

        const textRuns: any[] = [];
        for (let ri = 0; ri < runs.length; ri++) {
          if (ri > 0 && hasBrBetween(runs[ri - 1].textNode, runs[ri].textNode, blockEl)) {
            textRuns.push({
              text: "\n",
              fontSize: runs[ri].fontSize,
              fontFamily: runs[ri].fontFamily,
              fontWeight: runs[ri].fontWeight,
              fontStyle: runs[ri].fontStyle,
              color: runs[ri].color,
              letterSpacing: runs[ri].letterSpacing,
              textTransform: "none",
              lineHeight: runs[ri].lineHeight,
            });
          }
          textRuns.push({
            text: runs[ri].text,
            fontSize: runs[ri].fontSize,
            fontFamily: runs[ri].fontFamily,
            fontWeight: runs[ri].fontWeight,
            fontStyle: runs[ri].fontStyle,
            color: runs[ri].color,
            letterSpacing: runs[ri].letterSpacing,
            textTransform: runs[ri].textTransform,
            lineHeight: runs[ri].lineHeight,
          });
        }

        const groupHeight = maxY - minY;
        const maxFontSize = Math.max(...runs.map(r => r.fontSize));
        const avgLineHeight = runs.reduce((sum, r) => sum + r.lineHeight, 0) / runs.length;
        const lineHeight = maxFontSize * 1.5;
        const hasLineBreaks = textRuns.some((r: any) => r.text === "\n");

        // Check for explicit data-sg-wrap attribute, fall back to heuristic
        const wrapAttr = blockEl.closest('[data-sg-wrap]')?.getAttribute('data-sg-wrap');
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

      result.push(data);
    });

    return { slides: result, imageRefs };
  });
}
