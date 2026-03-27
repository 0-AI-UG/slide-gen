export { convertHtmlToSlides, convertHtmlBuffers } from "./pipeline";
export { extractSlideData } from "./dom-extract";
export { buildPptx } from "./pptx-builder";
export { prepareFontsFromSlideData, buildFontPrepResultFromManifest } from "./fonts";
export { generatePdf, generatePdfBuffer, generateSlidePngs, generateSlidePngBuffers } from "./browser";
export { renderPptx } from "./render";
export type {
  SlideData,
  TextElement,
  TextRun,
  RectElement,
  GradientInfo,
  GradientStop,
  ImageElement,
  ImageRef,
  FontPrepResult,
  ConvertOptions,
  ConvertResult,
  ConvertBufferOptions,
  ConvertBufferResult,
} from "./types";
export { SlideGenError, BrowserError, FontError, PptxBuildError, RenderError } from "./errors";
