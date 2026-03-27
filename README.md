# slide-gen

Convert HTML slide decks to PPTX, PDF, and PNG. Design your slides with HTML + CSS, then export to native PowerPoint format with high-fidelity conversion.

## How it works

slide-gen renders your HTML in a headless Chromium browser (via Playwright), extracts every visible element from the DOM — shapes, text runs, images, gradients — and reconstructs them as native OOXML objects inside a `.pptx` file. The result is a real PowerPoint file with editable text, not a rasterized image.

## Requirements

- [Bun](https://bun.sh) >= 1.0
- Playwright Chromium (`bunx playwright install chromium`)
- **Optional:** LibreOffice + Ghostscript (only for `--render` PPTX verification)

## Install

```bash
bun add @0-ai/slide-gen
```

## CLI usage

```bash
bunx slide-gen slides.html -o ./output
```

This generates `presentation.pptx`, `presentation.pdf`, and `slide-*.png` files in the output directory.

### Options

```
-o, --output-dir <dir>   Output directory (default: ./output)
--no-pdf                 Skip PDF generation
--no-pptx                Skip PPTX generation
--no-png                 Skip PNG screenshots
--render                 Render PPTX back to PNG via LibreOffice (for verification)
--skip-fonts             Use previously cached fonts
--fonts-dir <dir>        Custom fonts cache directory
```

## API usage

### File-based pipeline

Reads HTML from disk, writes outputs to a directory:

```typescript
import { convertHtmlToSlides } from "@0-ai/slide-gen";

const result = await convertHtmlToSlides("slides.html", {
  outputDir: "./output",
  onProgress: console.log,
});

console.log(result.pptxPath);  // ./output/presentation.pptx
console.log(result.pdfPath);   // ./output/presentation.pdf
console.log(result.pngPaths);  // ["./output/slide-1.png", ...]
```

### Buffer-based pipeline

Accepts HTML as a string, returns everything as in-memory buffers — no output directory needed:

```typescript
import { convertHtmlBuffers } from "@0-ai/slide-gen";

const result = await convertHtmlBuffers({
  html: "<html>...</html>",
  noPdf: true,   // skip PDF
  noPng: true,   // skip PNGs
});

// result.pptxBuffer — Buffer containing the .pptx file
// result.pngBuffers — Buffer[] of slide screenshots
// result.slideData  — extracted slide structure
```

### Low-level API

Use individual pipeline stages directly:

```typescript
import {
  launchBrowser,
  loadHtmlContent,
  extractSlideData,
  prepareFontsFromSlideData,
  buildPptx,
  generatePdfBuffer,
  generateSlidePngBuffers,
  closeBrowser,
} from "@0-ai/slide-gen";
```

## HTML slide format

Each slide is a `<div class="slide">` element sized at 1920x1080px:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920, initial-scale=1" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');

    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    body { background: #000; }

    .slide {
      position: relative;
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      font-family: 'Inter', sans-serif;
      color: #fff;
      background: #0a0a0a;
    }
    .slide + .slide { page-break-before: always; }
  </style>
</head>
<body>
  <div class="slide">
    <h1 style="padding: 80px; font-size: 64px;">Hello, World</h1>
  </div>
  <div class="slide">
    <h1 style="padding: 80px; font-size: 64px;">Slide Two</h1>
  </div>
</body>
</html>
```

## Supported CSS

| Feature | Notes |
|---|---|
| Solid backgrounds | `background-color` on any element |
| Linear & radial gradients | `linear-gradient()`, `radial-gradient()` |
| Flexbox & Grid layouts | Positions captured via `getBoundingClientRect()` |
| Google Fonts | All weights (100-900) — auto-downloaded and embedded |
| Borders | Per-side colors and widths (>=1px) |
| `border-radius` | Uniform value (not per-corner) |
| Opacity | Accumulated from ancestor chain |
| CSS variables | Resolved by the browser before extraction |
| `transform: rotate()` | Only rotation — no scale/skew/translate |
| `::before` / `::after` | Position, size, background only (no text) |
| Font styling | size, weight, style, family, color, letter-spacing, line-height |
| Text formatting | text-transform, text-align |
| `<img>`, inline SVG | Rasterized and embedded as PNG |
| `background-image: url()` | Single image backgrounds |
| `writing-mode` | `vertical-rl`/`vertical-lr` |

### Data attributes

Control conversion behavior with these attributes:

| Attribute | Values | Purpose |
|---|---|---|
| `data-sg-wrap` | `"true"` / `"false"` | Explicit text wrapping control |
| `data-sg-group` | any string | Group text runs into a single PPTX text box |

### Not supported (silently ignored)

Shadows, filters, backdrop-filter, clip-path, text-decoration, transforms other than `rotate()`, conic gradients, multiple background layers, per-corner border-radius, positioned layout offsets.

## Fonts

Google Fonts are automatically downloaded, cached locally (in `.slide-gen-fonts/`), and embedded into the PPTX file. System fonts work but only get binary bold — no weight variants.

Use `--skip-fonts` on subsequent runs to reuse the cached fonts.

## License

MIT
