export interface TextRun {
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
  letterSpacing: number;
  textTransform: string;
  lineHeight?: number;
}

export interface TextElement {
  runs: TextRun[];
  x: number;
  y: number;
  width: number;
  height: number;
  textAlign: string;
  rotation: number;
  parentWidth: number;
  parentHeight: number;
  wrap: boolean;
  lineHeight?: number;
  // Legacy single-run fields (kept for backward compat with slide-data.json consumers)
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
  letterSpacing: number;
  textTransform: string;
}

export interface GradientStop {
  color: string;
  position: number; // 0-100
}

export interface GradientInfo {
  type: "linear" | "radial";
  angle?: number; // CSS degrees (0=to top, 90=to right)
  stops: GradientStop[];
  radialPosition?: { x: number; y: number }; // percentage 0-100
  radialShape?: "circle" | "ellipse";
}

export interface RectElement {
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor: string;
  gradient?: GradientInfo;
  borderRadius?: number;
}

export interface ImageElement {
  x: number;
  y: number;
  width: number;
  height: number;
  base64: string; // PNG data, no prefix
}

export interface ImageRef {
  slideIndex: number;
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SlideData {
  width: number;
  height: number;
  backgroundColor: string;
  gradient?: GradientInfo;
  rects: RectElement[];
  texts: TextElement[];
  images: ImageElement[];
}

export interface BoldThresholdEntry {
  regularWeight: number;
  boldWeight: number;
  boldThreshold: number;
  internalName?: string;
}

export interface FontInfo {
  boldThreshold: number;
  internalName?: string;
}

export interface FontPrepResult {
  boldThresholds: Map<string, number>;
  fontNameMap: Map<string, string>;
  /** Maps (cssFamily, cssWeight) → internal font name for multi-weight variants */
  weightToFontName: Map<string, Map<number, string>>;
  warnings: string[];
}

export interface ConvertOptions {
  outputDir: string;
  /** Skip PDF generation (default: false) */
  noPdf?: boolean;
  /** Skip PPTX generation (default: false) */
  noPptx?: boolean;
  /** Skip PNG screenshots (default: false) */
  noPng?: boolean;
  /** Render PPTX back to PNG for verification (default: false) */
  render?: boolean;
  /** Use cached fonts (default: false) */
  skipFonts?: boolean;
  /** Custom fonts directory */
  fontsDir?: string;
  /** Progress callback (replaces console.log in library mode) */
  onProgress?: (message: string) => void;
}

export interface ConvertResult {
  pdfPath?: string;
  pptxPath?: string;
  pngPaths: string[];
  slideData: SlideData[];
  renderPngPaths?: string[];
  warnings: string[];
}

/** Options for the buffer-based pipeline (no temp files needed for output). */
export interface ConvertBufferOptions {
  /** Raw HTML content string */
  html: string;
  /** Skip PDF generation (default: false) */
  noPdf?: boolean;
  /** Skip PPTX generation (default: false) */
  noPptx?: boolean;
  /** Skip PNG screenshots (default: false) */
  noPng?: boolean;
  /** Use cached fonts (default: false) */
  skipFonts?: boolean;
  /** Font cache directory on disk (needed by fontTools) */
  fontsDir?: string;
  /** Progress callback */
  onProgress?: (message: string) => void;
}

/** Result from the buffer-based pipeline — all outputs are in-memory. */
export interface ConvertBufferResult {
  pdfBuffer?: Buffer;
  pptxBuffer?: Buffer;
  pngBuffers: Buffer[];
  slideData: SlideData[];
  warnings: string[];
}
