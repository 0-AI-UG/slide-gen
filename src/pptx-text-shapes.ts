/**
 * Text and table shape XML builders for PPTX slides.
 */

import type { ShadowInfo, TableElement, GradientInfo, CellBorder } from "./types";
import { parseCssColorAndAlpha } from "./color";
import { escapeXml, inToEmu, buildOuterShadowXml } from "./pptx-xml-helpers";
import { buildGradFillXml } from "./gradient";

// ---------------------------------------------------------------------------
// Text box shape
// ---------------------------------------------------------------------------

export interface TextRunOpts {
  text: string;
  fontSize: number; // points
  fontFace?: string;
  color: string; // hex
  bold?: boolean;
  italic?: boolean;
  charSpacing?: number; // points
  transparency?: number; // 0-100
  underline?: boolean;
  strikethrough?: boolean;
  hlinkRId?: string; // relationship ID for hyperlink
  textShadow?: ShadowInfo;
  gradientFill?: GradientInfo;
}

export interface TextBoxOpts {
  id: number;
  x: number; // inches
  y: number;
  w: number;
  h: number;
  runs: TextRunOpts[];
  align?: "l" | "ctr" | "r" | "just";
  wrap: boolean;
  rotate?: number; // degrees (0-360)
  lineSpacingMultiple?: number;
  shrinkToFit?: boolean;
  bulletType?: "char" | "autoNum" | "none";
  bulletChar?: string;
  bulletAutoNumType?: string;
  indentLevel?: number;
}

function buildRunPropsXml(run: TextRunOpts): string {
  const sz = Math.round(run.fontSize * 100); // 1/100th of a point
  const attrs: string[] = [`lang="en-US"`, `sz="${sz}"`, `dirty="0"`];

  if (run.bold) attrs.push(`b="1"`);
  if (run.italic) attrs.push(`i="1"`);
  if (run.underline) attrs.push(`u="sng"`);
  if (run.strikethrough) attrs.push(`strike="sngStrike"`);
  if (run.charSpacing !== undefined) {
    const spc = Math.round(run.charSpacing * 100); // 1/100th of a point
    attrs.push(`spc="${spc}"`);
  }

  let children = "";

  // Color fill — use gradient fill if available, else solid
  if (run.gradientFill && run.gradientFill.stops && run.gradientFill.stops.length >= 2) {
    children += buildGradFillXml(run.gradientFill);
  } else if (run.transparency !== undefined && run.transparency > 0) {
    const alpha = Math.round((1 - run.transparency / 100) * 100000);
    children += `<a:solidFill><a:srgbClr val="${run.color}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill>`;
  } else {
    children += `<a:solidFill><a:srgbClr val="${run.color}"/></a:solidFill>`;
  }

  // Font refs
  if (run.fontFace) {
    const face = escapeXml(run.fontFace);
    children += `<a:latin typeface="${face}" pitchFamily="34" charset="0"/>`;
    children += `<a:ea typeface="${face}" pitchFamily="34" charset="-122"/>`;
    children += `<a:cs typeface="${face}" pitchFamily="34" charset="-120"/>`;
  }

  // Hyperlink
  if (run.hlinkRId) {
    children += `<a:hlinkClick r:id="${run.hlinkRId}"/>`;
  }

  // Text shadow
  if (run.textShadow) {
    children += buildOuterShadowXml(run.textShadow);
  }

  return `<a:rPr ${attrs.join(" ")}>${children}</a:rPr>`;
}

export function buildTextBoxXml(opts: TextBoxOpts): string {
  const xEmu = inToEmu(opts.x);
  const yEmu = inToEmu(opts.y);
  const wEmu = inToEmu(opts.w);
  const hEmu = inToEmu(opts.h);

  // Body properties
  const wrapAttr = opts.wrap ? "square" : "none";
  let bodyPrAttrs = `wrap="${wrapAttr}" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"`;
  if (opts.rotate) {
    const rotVal = Math.round(opts.rotate * 60000); // 1/60000th degree
    bodyPrAttrs += ` rot="${rotVal}"`;
  }

  const autoFit = opts.shrinkToFit ? "<a:normAutofit/>" : "";
  const bodyPr = `<a:bodyPr ${bodyPrAttrs}>${autoFit}</a:bodyPr>`;

  // Build paragraph properties
  const algn = opts.align ? ` algn="${opts.align}"` : "";
  let lnSpcXml = "";
  if (opts.lineSpacingMultiple && opts.lineSpacingMultiple > 0) {
    const val = Math.round(opts.lineSpacingMultiple * 100000);
    lnSpcXml = `<a:lnSpc><a:spcPct val="${val}"/></a:lnSpc>`;
  }

  let bulletXml = "<a:buNone/>";
  let marL = "0";
  let indent = "0";

  if (opts.bulletType === "char" && opts.bulletChar) {
    const level = opts.indentLevel ?? 0;
    const marLVal = 457200 + level * 457200; // 0.5 inch per level
    const indentVal = -228600; // hanging indent of 0.25 inch
    marL = String(marLVal);
    indent = String(indentVal);
    bulletXml = `<a:buChar char="${escapeXml(opts.bulletChar)}"/>`;
  } else if (opts.bulletType === "autoNum") {
    const level = opts.indentLevel ?? 0;
    const marLVal = 457200 + level * 457200;
    const indentVal = -228600;
    marL = String(marLVal);
    indent = String(indentVal);
    const numType = opts.bulletAutoNumType || "arabicPeriod";
    bulletXml = `<a:buAutoNum type="${numType}"/>`;
  }

  const pPrContent = `<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft>${lnSpcXml}${bulletXml}`;
  const pPr = `<a:pPr indent="${indent}" marL="${marL}"${algn}>${pPrContent}</a:pPr>`;

  // Split runs into paragraphs on newline boundaries
  const paragraphs: TextRunOpts[][] = [[]];
  for (const run of opts.runs) {
    const parts = run.text.split("\n");
    for (let pi = 0; pi < parts.length; pi++) {
      if (pi > 0) paragraphs.push([]);
      if (parts[pi]!.length > 0) {
        paragraphs[paragraphs.length - 1]!.push({ ...run, text: parts[pi]! });
      }
    }
  }

  // Build paragraph XML
  const lastRun = opts.runs[opts.runs.length - 1];
  const endParaSz = lastRun ? Math.round(lastRun.fontSize * 100) : 1800;

  const parasXml = paragraphs
    .map((paraRuns) => {
      const runsXml = paraRuns
        .map((run) => {
          const rPr = buildRunPropsXml(run);
          return `<a:r>${rPr}<a:t>${escapeXml(run.text)}</a:t></a:r>`;
        })
        .join("");
      return `<a:p>${pPr}${runsXml}<a:endParaRPr lang="en-US" sz="${endParaSz}" dirty="0"/></a:p>`;
    })
    .join("");

  return `<p:sp><p:nvSpPr><p:cNvPr id="${opts.id}" name="Text ${opts.id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${xEmu}" y="${yEmu}"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln/></p:spPr><p:txBody>${bodyPr}<a:lstStyle/>${parasXml}</p:txBody></p:sp>`;
}

// ---------------------------------------------------------------------------
// Table (graphicFrame)
// ---------------------------------------------------------------------------

export interface TableShapeOpts {
  id: number;
  table: TableElement;
  sx: number; // scale factor x (px → inches)
  sy: number; // scale factor y
  fontScale: number; // px → pt multiplier (0.75 * slideScale)
}

const PX_TO_EMU = 9525; // 914400 / 96dpi

function borderXml(tag: string, border: CellBorder | undefined): string {
  if (!border || border.style === "none") {
    return `<${tag}><a:noFill/></${tag}>`;
  }
  const wEmu = Math.round(border.width * PX_TO_EMU);
  const { hex, alpha } = parseCssColorAndAlpha(border.color);
  const alphaXml = alpha < 0.999 ? `<a:alpha val="${Math.round(alpha * 100000)}"/>` : "";
  const colorXml = alphaXml
    ? `<a:srgbClr val="${hex}">${alphaXml}</a:srgbClr>`
    : `<a:srgbClr val="${hex}"/>`;
  const dash = border.style === "dashed" ? ` <a:prstDash val="dash"/>` : border.style === "dotted" ? ` <a:prstDash val="dot"/>` : "";
  return `<${tag} w="${wEmu}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill>${colorXml}</a:solidFill>${dash}</${tag}>`;
}

export function buildTableXml(opts: TableShapeOpts): string {
  const { id, table, sx, sy, fontScale } = opts;
  const xEmu = inToEmu(table.x * sx);
  const yEmu = inToEmu(table.y * sy);
  const wEmu = inToEmu(table.width * sx);
  const hEmu = inToEmu(table.height * sy);

  // Column grid
  const gridColsXml = table.columnWidths
    .map(cw => `<a:gridCol w="${inToEmu(cw * sx)}"/>`)
    .join("");

  // Rows
  const rowsXml = table.rows
    .map(row => {
      const hRow = inToEmu(row.height * sy);
      const cellsXml = row.cells
        .map(cell => {
          // Cell text alignment
          let algnAttr = "";
          if (cell.textAlign === "right" || cell.textAlign === "end") algnAttr = ` algn="r"`;
          else if (cell.textAlign === "center") algnAttr = ` algn="ctr"`;
          else if (cell.textAlign === "justify") algnAttr = ` algn="just"`;

          // Cell text
          let textXml: string;
          if (cell.textRuns && cell.textRuns.length > 0) {
            const runsXml = cell.textRuns
              .map(run => {
                const sz = Math.round(run.fontSize * fontScale * 100);
                const { hex, alpha } = parseCssColorAndAlpha(run.color);
                const alphaAttr = alpha < 0.999 ? `<a:alpha val="${Math.round(alpha * 100000)}"/>` : "";
                const colorXml = alphaAttr
                  ? `<a:solidFill><a:srgbClr val="${hex}">${alphaAttr}</a:srgbClr></a:solidFill>`
                  : `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
                const face = escapeXml(run.fontFamily);
                const bold = run.fontWeight === "bold" || parseInt(run.fontWeight) >= 700 ? ` b="1"` : "";
                const italic = run.fontStyle === "italic" ? ` i="1"` : "";
                return `<a:r><a:rPr lang="en-US" sz="${sz}" dirty="0"${bold}${italic}>${colorXml}<a:latin typeface="${face}"/><a:ea typeface="${face}"/><a:cs typeface="${face}"/></a:rPr><a:t>${escapeXml(run.text)}</a:t></a:r>`;
              })
              .join("");
            textXml = `<a:p><a:pPr${algnAttr}/>${runsXml}<a:endParaRPr lang="en-US" dirty="0"/></a:p>`;
          } else {
            textXml = `<a:p><a:pPr${algnAttr}/><a:r><a:rPr lang="en-US" sz="1400" dirty="0"/><a:t>${escapeXml(cell.text)}</a:t></a:r><a:endParaRPr lang="en-US" dirty="0"/></a:p>`;
          }

          // Cell borders (OOXML order: lnL, lnR, lnT, lnB before solidFill)
          let bordersXml = "";
          bordersXml += borderXml("a:lnL", cell.borderLeft);
          bordersXml += borderXml("a:lnR", cell.borderRight);
          bordersXml += borderXml("a:lnT", cell.borderTop);
          bordersXml += borderXml("a:lnB", cell.borderBottom);

          // Cell background (with alpha support)
          let fillXml = "";
          if (cell.backgroundColor) {
            const { hex, alpha } = parseCssColorAndAlpha(cell.backgroundColor);
            if (alpha < 0.999) {
              const alphaVal = Math.round(alpha * 100000);
              fillXml = `<a:solidFill><a:srgbClr val="${hex}"><a:alpha val="${alphaVal}"/></a:srgbClr></a:solidFill>`;
            } else {
              fillXml = `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
            }
          }

          // Spanning attrs
          let spanAttrs = "";
          if (cell.colSpan && cell.colSpan > 1) spanAttrs += ` gridSpan="${cell.colSpan}"`;
          if (cell.rowSpan && cell.rowSpan > 1) spanAttrs += ` rowSpan="${cell.rowSpan}"`;

          // Cell padding (px → inches → EMU, same scale as row/column dimensions)
          const marT = inToEmu((cell.paddingTop ?? 0) * sy);
          const marR = inToEmu((cell.paddingRight ?? 0) * sx);
          const marB = inToEmu((cell.paddingBottom ?? 0) * sy);
          const marL = inToEmu((cell.paddingLeft ?? 0) * sx);

          return `<a:tc${spanAttrs}><a:txBody><a:bodyPr/><a:lstStyle/>${textXml}</a:txBody><a:tcPr marL="${marL}" marR="${marR}" marT="${marT}" marB="${marB}">${bordersXml}${fillXml}</a:tcPr></a:tc>`;
        })
        .join("");

      return `<a:tr h="${hRow}">${cellsXml}</a:tr>`;
    })
    .join("");

  const tableUri = "http://schemas.openxmlformats.org/drawingml/2006/table";

  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${xEmu}" y="${yEmu}"/><a:ext cx="${wEmu}" cy="${hEmu}"/></p:xfrm><a:graphic><a:graphicData uri="${tableUri}"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:noFill/></a:tblPr><a:tblGrid>${gridColsXml}</a:tblGrid>${rowsXml}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}
