import JSZip from "jszip";
import type { SlideData, FontPrepResult, MasterSlideConfig } from "./types";
import {
  SLIDE_W_IN, SLIDE_H_IN,
  FONT_SIZE_MIN_PT, FONT_SIZE_MAX_PT,
  BORDER_RADIUS_SCALE, DPI,
  ALPHA_VISIBLE_THRESHOLD, ALPHA_OPAQUE_THRESHOLD,
  MIN_RECT_DIM_PX, MIN_TEXT_DIM_PX, MIN_SHAPE_DIM_IN,
  BOLD_THRESHOLD_DEFAULT,
} from "./constants";
import { parseCssColor, parseCssAlpha, parseCssColorAndAlpha } from "./color";
import { RelationshipManager, REL_TYPES } from "./pptx-rels";
import {
  contentTypesXml, rootRelsXml, presentationXml,
  presPropsXml, viewPropsXml, tableStylesXml, themeXml,
  slideMasterXml, slideLayoutXml, slideXml,
  appXml, coreXml,
  notesSlideXml, notesMasterXml,
} from "./pptx-xml";
import {
  buildRectShapeXml, buildImageShapeXml, buildTextBoxXml, buildTableXml, buildBackgroundXml,
  inToEmu,
  type TextRunOpts,
} from "./pptx-shapes";

export interface PptxBuildOptions {
  fontPrepResult?: FontPrepResult;
  masterSlide?: MasterSlideConfig;
}

export interface PptxBuildResult {
  buffer: Buffer;
  warnings: string[];
}

export async function buildPptx(slideData: SlideData[], options: PptxBuildOptions = {}): Promise<PptxBuildResult> {
  const warnings: string[] = [];
  const boldThresholds = options.fontPrepResult?.boldThresholds ?? new Map();
  const fontNameMap = options.fontPrepResult?.fontNameMap ?? new Map();
  const weightToFontName = options.fontPrepResult?.weightToFontName ?? new Map();

  const htmlW = slideData[0]!.width;
  const htmlH = slideData[0]!.height;
  const sx = SLIDE_W_IN / htmlW;
  const sy = SLIDE_H_IN / htmlH;

  const slideSizeCx = inToEmu(SLIDE_W_IN);
  const slideSizeCy = inToEmu(SLIDE_H_IN);

  const zip = new JSZip();

  const masterSlide = options.masterSlide;

  // ── Static boilerplate ──────────────────────────────────────────────
  zip.file("_rels/.rels", rootRelsXml());
  zip.file("docProps/app.xml", appXml(slideData.length));
  zip.file("docProps/core.xml", coreXml());
  zip.file("ppt/theme/theme1.xml", masterSlide?.themeXml ?? themeXml());
  zip.file("ppt/presProps.xml", presPropsXml());
  zip.file("ppt/viewProps.xml", viewPropsXml());
  zip.file("ppt/tableStyles.xml", tableStylesXml());
  zip.file("ppt/slideMasters/slideMaster1.xml", masterSlide?.masterXml ?? slideMasterXml());
  zip.file("ppt/slideLayouts/slideLayout1.xml", masterSlide?.layoutXml ?? slideLayoutXml());

  // Slide master rels (layout + theme)
  const masterRels = new RelationshipManager();
  masterRels.add(REL_TYPES.slideLayout, "../slideLayouts/slideLayout1.xml");
  masterRels.add(REL_TYPES.theme, "../theme/theme1.xml");
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", masterRels.toXml());

  // Slide layout rels (master)
  const layoutRels = new RelationshipManager();
  layoutRels.add(REL_TYPES.slideMaster, "../slideMasters/slideMaster1.xml");
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", layoutRels.toXml());

  // ── Presentation-level rels ─────────────────────────────────────────
  const presRels = new RelationshipManager();
  const masterRId = presRels.add(REL_TYPES.slideMaster, "slideMasters/slideMaster1.xml");

  let imageCounter = 0;
  const slideRIds: string[] = [];
  let notesSlideCount = 0;
  let hasNotesMaster = false;

  // Pre-register logo image media if provided
  let logoMediaIndex: number | undefined;
  if (masterSlide?.logoImage) {
    imageCounter++;
    logoMediaIndex = imageCounter;
    const mediaPath = `ppt/media/image${logoMediaIndex}.png`;
    zip.file(mediaPath, Buffer.from(masterSlide.logoImage.base64, "base64"));
  }

  // ── Build each slide ────────────────────────────────────────────────
  for (let slideIdx = 0; slideIdx < slideData.length; slideIdx++) {
    const sd = slideData[slideIdx]!;
    const slideRels = new RelationshipManager();
    slideRels.add(REL_TYPES.slideLayout, "../slideLayouts/slideLayout1.xml");

    let shapeId = 2; // id=1 is reserved for the spTree group root
    let shapesXml = "";

    // ── Background ──
    const bgColor = parseCssColor(sd.backgroundColor);
    const bgXml = buildBackgroundXml(
      bgColor || undefined,
      sd.gradient && sd.gradient.stops.length >= 2 ? sd.gradient : undefined,
      warnings,
    );

    // ── Rectangles ──
    for (const rect of sd.rects) {
      const hasGradient = rect.gradient && rect.gradient.stops.length >= 2;
      const hasBorder = rect.borderColor && rect.borderWidth;
      const fillColor = parseCssColor(rect.backgroundColor);
      const fillAlpha = parseCssAlpha(rect.backgroundColor);
      if (!hasGradient && !hasBorder && (!fillColor || fillAlpha <= ALPHA_VISIBLE_THRESHOLD)) {
        warnings.push(`Slide ${slideIdx + 1}: dropped invisible rect at (${rect.x}, ${rect.y})`);
        continue;
      }

      // Drop repeating gradients where non-opaque-black stops are nearly invisible —
      // these create fine CSS stripe textures that OOXML can't reproduce faithfully
      if (hasGradient && rect.gradient!.repeating) {
        const maxVisibleAlpha = Math.max(...rect.gradient!.stops.map(s => {
          const { hex, alpha } = parseCssColorAndAlpha(s.color);
          // Ignore fully opaque black (blends into dark backgrounds) and fully transparent
          if (hex === "000000" && alpha > 0.99) return 0;
          if (alpha < 0.01) return 0;
          return alpha;
        }));
        if (maxVisibleAlpha < 0.1) {
          warnings.push(`Slide ${slideIdx + 1}: dropped subtle repeating gradient at (${rect.x}, ${rect.y}) — can't reproduce fine CSS stripes in OOXML`);
          continue;
        }
      }

      const x = rect.x;
      const y = rect.y;
      const w = rect.width;
      const h = rect.height;
      if (w < MIN_RECT_DIM_PX || h < MIN_RECT_DIM_PX) {
        warnings.push(`Slide ${slideIdx + 1}: dropped rect smaller than ${MIN_RECT_DIM_PX}px at (${x}, ${y})`);
        continue;
      }

      let shapeColor: string;
      let fillTransparency: number;
      const isTransparentFill = fillAlpha <= ALPHA_VISIBLE_THRESHOLD;

      if (hasGradient) {
        shapeColor = "000000"; // unused when gradient is set
        fillTransparency = 0;
      } else if (isTransparentFill) {
        shapeColor = "000000";
        fillTransparency = 0;
      } else {
        shapeColor = fillColor!;
        fillTransparency = Math.round((1 - fillAlpha) * 100);
      }

      // Parse border properties
      let borderColorHex: string | undefined;
      let borderWidthIn: number | undefined;
      if (hasBorder) {
        borderColorHex = parseCssColor(rect.borderColor!) ?? undefined;
        borderWidthIn = rect.borderWidth! * sx;
      }

      const commonRectOpts = {
        x: x * sx,
        y: y * sy,
        w: Math.max(w * sx, MIN_SHAPE_DIM_IN),
        h: Math.max(h * sy, MIN_SHAPE_DIM_IN),
        borderRadius: (rect.borderRadius ?? 0) > 0 ? rect.borderRadius! * sx * BORDER_RADIUS_SCALE : undefined,
        borderRadii: rect.borderRadii ? {
          topLeft: rect.borderRadii.topLeft * sx * BORDER_RADIUS_SCALE,
          topRight: rect.borderRadii.topRight * sx * BORDER_RADIUS_SCALE,
          bottomRight: rect.borderRadii.bottomRight * sx * BORDER_RADIUS_SCALE,
          bottomLeft: rect.borderRadii.bottomLeft * sx * BORDER_RADIUS_SCALE,
        } : undefined,
        borderColor: borderColorHex,
        borderWidth: borderWidthIn,
        noFill: isTransparentFill && !hasGradient,
        warnings,
      };

      if (rect.gradients && rect.gradients.length > 1) {
        // Multiple gradient layers: emit stacked shapes (bottom layer first)
        // First shape gets the background color + shadow + first gradient (bottom-most)
        // CSS layers are painted top-to-bottom, so gradients[0] is on top
        // OOXML shapes stack later-on-top, so we reverse the order
        const reversed = [...rect.gradients].reverse();
        for (let gi = 0; gi < reversed.length; gi++) {
          const grad = reversed[gi]!;
          shapesXml += buildRectShapeXml({
            id: shapeId++,
            ...commonRectOpts,
            fillColor: gi === 0 ? shapeColor : "000000",
            fillTransparency: gi === 0 ? fillTransparency : 0,
            gradient: grad.stops.length >= 2 ? grad : undefined,
            boxShadow: gi === 0 ? rect.boxShadow : undefined,
          });
        }
      } else {
        shapesXml += buildRectShapeXml({
          id: shapeId++,
          ...commonRectOpts,
          fillColor: shapeColor,
          fillTransparency,
          gradient: hasGradient ? rect.gradient : undefined,
          boxShadow: rect.boxShadow,
        });
      }
    }

    // ── Images ──
    for (const img of sd.images ?? []) {
      imageCounter++;
      const mediaPath = `ppt/media/image${imageCounter}.png`;
      zip.file(mediaPath, Buffer.from(img.base64, "base64"));
      const rId = slideRels.add(REL_TYPES.image, `../media/image${imageCounter}.png`);

      shapesXml += buildImageShapeXml({
        id: shapeId++,
        x: img.x * sx,
        y: img.y * sy,
        w: img.width * sx,
        h: img.height * sy,
        rId,
      });
    }

    // ── Text elements ──
    const scale = SLIDE_W_IN / (htmlW / DPI);

    for (const t of sd.texts) {
      const runs = t.runs && t.runs.length > 0 ? t.runs : [{
        text: t.text,
        fontSize: t.fontSize,
        fontFamily: t.fontFamily,
        fontWeight: t.fontWeight,
        fontStyle: t.fontStyle,
        color: t.color,
        letterSpacing: t.letterSpacing,
        textTransform: t.textTransform,
      }];

      const combinedText = runs.map(r => r.text).join("").trim();
      if (!combinedText) continue;

      const x = t.x;
      const y = t.y;
      const w = t.width;
      const h = t.height;
      if (w < MIN_TEXT_DIM_PX || h < MIN_TEXT_DIM_PX) {
        warnings.push(`Slide ${slideIdx + 1}: dropped text element smaller than ${MIN_TEXT_DIM_PX}px ("${combinedText.slice(0, 30)}")`);
        continue;
      }

      const pptxRuns: TextRunOpts[] = [];
      for (const run of runs) {
        const fontSizePt = run.fontSize * 0.75 * scale;
        const clampedFontSize = Math.max(FONT_SIZE_MIN_PT, Math.min(FONT_SIZE_MAX_PT, fontSizePt));

        let displayText = run.text;
        if (run.textTransform === "uppercase") displayText = run.text.toUpperCase();
        else if (run.textTransform === "lowercase") displayText = run.text.toLowerCase();
        else if (run.textTransform === "capitalize") {
          displayText = run.text.replace(/\b\w/g, (c: string) => c.toUpperCase());
        }

        // Replace leading/trailing spaces with NBSP to prevent stripping
        displayText = displayText
          .replace(/^ /g, "\u00A0")
          .replace(/ $/g, "\u00A0")
          .replace(/\n /g, "\n\u00A0");
        displayText = displayText.replace(/\u00A0( +)/g, (_, spaces) =>
          "\u00A0" + spaces.replace(/ /g, "\u00A0"));
        if (/^[ \t]+$/.test(displayText)) {
          displayText = displayText.replace(/ /g, "\u00A0");
        }

        const color = parseCssColor(run.color);
        const cssWeight = run.fontWeight === "bold" ? 700
          : run.fontWeight === "bolder" ? 800
          : parseInt(run.fontWeight) || 400;

        // Look up the closest weight variant for this family
        const familyWeightMap = weightToFontName.get(run.fontFamily);
        let fontFace: string | undefined;
        let isBold = false;

        if (familyWeightMap && familyWeightMap.size > 0) {
          let closestWeight = 400;
          let closestDist = Infinity;
          for (const availWeight of familyWeightMap.keys()) {
            const dist = Math.abs(availWeight - cssWeight);
            if (dist < closestDist || (dist === closestDist && availWeight > closestWeight)) {
              closestDist = dist;
              closestWeight = availWeight;
            }
          }
          if (Math.abs(cssWeight - closestWeight) <= Math.abs(cssWeight - 400)) {
            fontFace = familyWeightMap.get(closestWeight)!;
            isBold = false;
          } else {
            fontFace = fontNameMap.get(run.fontFamily) || run.fontFamily || undefined;
            const familyBoldThreshold = boldThresholds.get(run.fontFamily) ?? BOLD_THRESHOLD_DEFAULT;
            isBold = cssWeight >= familyBoldThreshold;
          }
        } else {
          fontFace = fontNameMap.get(run.fontFamily) || run.fontFamily || undefined;
          const familyBoldThreshold = boldThresholds.get(run.fontFamily) ?? BOLD_THRESHOLD_DEFAULT;
          isBold = cssWeight >= familyBoldThreshold;
        }

        const charSpacing =
          Math.abs(run.letterSpacing) > 0.1
            ? run.letterSpacing * 0.75 * (sx + sy) / 2
            : undefined;

        const textAlpha = parseCssAlpha(run.color);
        const textTransparency = textAlpha < ALPHA_OPAQUE_THRESHOLD ? Math.round((1 - textAlpha) * 100) : undefined;

        // Parse text-decoration
        const dec = run.textDecoration || "";
        const hasUnderline = dec.includes("underline") || undefined;
        const hasStrike = dec.includes("line-through") || undefined;

        // Handle hyperlinks
        let hlinkRId: string | undefined;
        if (run.href) {
          hlinkRId = slideRels.add(REL_TYPES.hyperlink, run.href, "External");
        }

        pptxRuns.push({
          text: displayText,
          fontSize: clampedFontSize,
          fontFace,
          color: color || "000000",
          bold: isBold || undefined,
          italic: run.fontStyle === "italic" || undefined,
          charSpacing,
          transparency: textTransparency,
          underline: hasUnderline,
          strikethrough: hasStrike,
          hlinkRId,
          textShadow: run.textShadow,
          gradientFill: run.gradientFill,
        });
      }

      // Post-process: merge indentation into content runs
      for (let ri = pptxRuns.length - 2; ri >= 0; ri--) {
        const cur = pptxRuns[ri]!;
        const next = pptxRuns[ri + 1];
        if (!next) continue;
        if (/^[\u00A0 \t]+$/.test(cur.text)) {
          next.text = cur.text + next.text;
          pptxRuns.splice(ri, 1);
          continue;
        }
        const trailingMatch = cur.text.match(/^([\s\S]*\n)([\u00A0 \t]+)$/);
        if (trailingMatch) {
          cur.text = trailingMatch[1]!;
          next.text = trailingMatch[2]! + next.text;
        }
      }

      let align: "l" | "ctr" | "r" | "just" | undefined;
      if (t.textAlign === "right") align = "r";
      else if (t.textAlign === "center") align = "ctr";
      else if (t.textAlign === "justify") align = "just";

      const maxFontSizePt = Math.max(...runs.map(r => r.fontSize * 0.75 * scale));

      const shouldWrap = t.wrap;
      let wIn: number, hIn: number;

      // For aligned text, reconstruct the parent container's x position
      // since the extracted x is the text content bounding box, not the container
      let containerX = x;
      if (t.parentWidth > w + 1) {
        if (t.textAlign === "center") {
          containerX = x - (t.parentWidth - w) / 2;
        } else if (t.textAlign === "right") {
          containerX = x - (t.parentWidth - w);
        }
      }

      if (shouldWrap) {
        wIn = Math.min(t.parentWidth, htmlW - Math.max(0, containerX)) * sx * 1.05;
        hIn = Math.max(t.parentHeight * sy, h * sy);
      } else {
        wIn = w * 1.25 * sx;
        const minH = (maxFontSizePt / 72) * 1.4;
        hIn = Math.max(h * sy, minH);
      }

      let finalX = (align === "ctr" || align === "r" ? containerX : x) * sx;
      let finalY = y * sy;
      let finalW = wIn;
      let finalH = hIn;
      let rotate: number | undefined;

      if (Math.abs(t.rotation) > 0.5) {
        rotate = ((t.rotation % 360) + 360) % 360;
        const normRot = ((t.rotation % 360) + 360) % 360;
        const isNear90 = (normRot > 60 && normRot < 120) || (normRot > 240 && normRot < 300);
        if (isNear90) {
          finalW = h * sx;
          finalH = w * sy;
        } else {
          const rad = Math.abs(t.rotation) * (Math.PI / 180);
          finalW = Math.abs(w * Math.cos(rad) + h * Math.sin(rad)) * sx;
          finalH = Math.abs(w * Math.sin(rad) + h * Math.cos(rad)) * sy;
        }
        const cx = x + w / 2;
        const cy = y + h / 2;
        finalX = cx * sx - finalW / 2;
        finalY = cy * sy - finalH / 2;
      }

      const lineHeightMult = t.lineHeight ?? runs[0]?.lineHeight;
      const lineSpacingMultiple = lineHeightMult && lineHeightMult > 0 ? lineHeightMult : undefined;

      shapesXml += buildTextBoxXml({
        id: shapeId++,
        x: finalX,
        y: finalY,
        w: finalW,
        h: finalH,
        runs: pptxRuns,
        align,
        wrap: rotate ? false : shouldWrap,
        rotate,
        lineSpacingMultiple,
        shrinkToFit: true,
        bulletType: t.bulletType,
        bulletChar: t.bulletChar,
        bulletAutoNumType: t.bulletAutoNumType,
        indentLevel: t.indentLevel,
      });
    }

    // ── Tables ──
    for (const table of sd.tables ?? []) {
      shapesXml += buildTableXml({
        id: shapeId++,
        table,
        sx,
        sy,
        fontScale: 0.75 * scale,
      });
    }

    // ── Logo image ──
    if (logoMediaIndex !== undefined && masterSlide?.logoImage) {
      const logo = masterSlide.logoImage;
      const logoRId = slideRels.add(REL_TYPES.image, `../media/image${logoMediaIndex}.png`);
      shapesXml += buildImageShapeXml({
        id: shapeId++,
        x: logo.x * sx,
        y: logo.y * sy,
        w: logo.width * sx,
        h: logo.height * sy,
        rId: logoRId,
      });
    }

    // ── Notes slide ──
    if (sd.notes) {
      notesSlideCount++;
      const notesNum = notesSlideCount;

      // Ensure notes master exists
      if (!hasNotesMaster) {
        hasNotesMaster = true;
        zip.file("ppt/notesMasters/notesMaster1.xml", notesMasterXml());
        const notesMasterRels = new RelationshipManager();
        notesMasterRels.add(REL_TYPES.theme, "../theme/theme1.xml");
        zip.file("ppt/notesMasters/_rels/notesMaster1.xml.rels", notesMasterRels.toXml());
      }

      // Create notes slide
      slideRels.add(REL_TYPES.notesSlide, `../notesSlides/notesSlide${notesNum}.xml`);
      zip.file(`ppt/notesSlides/notesSlide${notesNum}.xml`, notesSlideXml(sd.notes));

      // Notes slide rels: link back to slide and to notes master
      const notesRels = new RelationshipManager();
      notesRels.add(REL_TYPES.slide, `../slides/slide${slideIdx + 1}.xml`);
      notesRels.add(REL_TYPES.notesMaster, "../notesMasters/notesMaster1.xml");
      zip.file(`ppt/notesSlides/_rels/notesSlide${notesNum}.xml.rels`, notesRels.toXml());
    }

    // ── Write slide XML ──
    const slideNum = slideIdx + 1;
    zip.file(`ppt/slides/slide${slideNum}.xml`, slideXml(bgXml, shapesXml, slideIdx));
    zip.file(`ppt/slides/_rels/slide${slideNum}.xml.rels`, slideRels.toXml());

    // Track in presentation rels
    const slideRId = presRels.add(REL_TYPES.slide, `slides/slide${slideNum}.xml`);
    slideRIds.push(slideRId);
  }

  // ── Finalize presentation rels ──────────────────────────────────────
  const presPropsRId = presRels.add(REL_TYPES.presProps, "presProps.xml");
  const viewPropsRId = presRels.add(REL_TYPES.viewProps, "viewProps.xml");
  const themeRId = presRels.add(REL_TYPES.theme, "theme/theme1.xml");
  const tableStylesRId = presRels.add(REL_TYPES.tableStyles, "tableStyles.xml");

  // Add notes master to presentation rels if any notes exist
  if (hasNotesMaster) {
    presRels.add(REL_TYPES.notesMaster, "notesMasters/notesMaster1.xml");
  }

  zip.file("ppt/_rels/presentation.xml.rels", presRels.toXml());
  zip.file("ppt/presentation.xml", presentationXml(
    slideData.length,
    { slideRIds, masterRId, presPropsRId, viewPropsRId, themeRId, tableStylesRId },
    slideSizeCx,
    slideSizeCy,
  ));
  zip.file("[Content_Types].xml", contentTypesXml(slideData.length, notesSlideCount));

  // ── Generate ZIP buffer ─────────────────────────────────────────────
  const buffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
  return { buffer, warnings };
}
