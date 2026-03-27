export const SLIDE_W_IN = 13.333;
export const SLIDE_H_IN = 7.5;

export const SYSTEM_FONTS = new Set([
  "arial", "helvetica", "times new roman", "times", "courier new", "courier",
  "verdana", "georgia", "trebuchet ms", "impact", "comic sans ms",
  "tahoma", "lucida console", "lucida sans", "palatino", "garamond",
  "calibri", "cambria", "candara", "consolas", "constantia", "corbel",
  "segoe ui", "san francisco", "sf pro", "sf mono",
  "sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui",
]);

// Font size limits (points)
export const FONT_SIZE_MIN_PT = 4;
export const FONT_SIZE_MAX_PT = 400;

// Shape/rect constants
export const BORDER_RADIUS_SCALE = 1.0;
export const DPI = 96;
export const ALPHA_VISIBLE_THRESHOLD = 0.005;
export const ALPHA_OPAQUE_THRESHOLD = 0.99;
export const MIN_RECT_DIM_PX = 0.5;
export const MIN_TEXT_DIM_PX = 1;
export const MIN_SHAPE_DIM_IN = 0.001;

// Font constants
export const BOLD_THRESHOLD_DEFAULT = 600;
export const FONT_DOWNLOAD_TIMEOUT_MS = 30_000;
export const FONT_DOWNLOAD_CONCURRENCY = 4;

// Maximum gradient stops in OOXML (leave room for interpolation overhead)
export const MAX_GRADIENT_STOPS = 250;

