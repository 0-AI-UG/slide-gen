# Slide-Gen Technical Guide

Technical rules about what CSS features survive the HTML-to-PPTX conversion.

---

## Slide Boilerplate

Every slide HTML file must follow this structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920, initial-scale=1" />

  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Fira+Code:wght@400;500&display=swap');

    *, *::before, *::after {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --bg:        #0A0A0A;
      --surface:   #141414;
      --surface-2: #1E1E1E;
      --surface-3: #262626;
      --text:      #F5F5F5;
      --text-dim:  #A3A3A3;
      --text-mute: #525252;
      --accent:    #3B82F6;
      --border:    #262626;
    }

    body {
      background: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .slide {
      position: relative;
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      font-family: 'Inter', sans-serif;
      color: var(--text);
      background: var(--bg);
    }

    .slide + .slide {
      page-break-before: always;
    }
  </style>
</head>
<body>

  <div class="slide">
    <!-- slide content here -->
  </div>

</body>
</html>
```

## Supported CSS Features

| Feature | Notes |
|---|---|
| **Solid backgrounds** | `background-color` on any element |
| **Linear gradients** | `linear-gradient()` with degree angles or keyword directions |
| **Radial gradients** | `radial-gradient()` — use 4+ stops to reduce banding |
| **Flexbox layouts** | Positions captured via `getBoundingClientRect()` |
| **CSS Grid layouts** | Same capture mechanism as flexbox |
| **Google Fonts** | All weights (100-900) when loaded via Google Fonts URL |
| **Borders** | Individual sides, colors, and widths (>=1px) |
| **`border-radius`** | Simplified to a single value (not per-corner) |
| **Opacity** | Fully supported, accumulated from ancestor chain |
| **CSS variables** | Resolved by the browser before extraction |
| **Rotation** | Via `transform: rotate()` — the only supported transform |
| **`::before` / `::after`** | Position, size, background color only (no text) |
| **`font-size`** | Clamped to 4-400pt |
| **`font-weight`** | Full numeric range |
| **`font-style`** | `italic` and `normal` |
| **`color`** | RGB, RGBA, hex, HSL, named colors |
| **`letter-spacing`** | Numeric values |
| **`text-transform`** | `uppercase`, `lowercase`, `capitalize` |
| **`line-height`** | Ratio-based values |
| **`text-align`** | `left`, `center`, `right` |
| **`<pre>` blocks** | Whitespace preserved for code snippets |
| **`<br>` tags** | Explicit line breaks |
| **`<img>` tags** | Rasterized and embedded as PNG |
| **Inline SVG** | Captured as image via screenshot |
| **`background-image: url()`** | Single image backgrounds |
| **`writing-mode`** | `vertical-rl`/`vertical-lr` converted to rotation |
| **`background-clip: text`** | Middle stop color is sampled |

## Data Attributes (Extraction Hints)

Use these attributes to control how the converter processes text elements:

| Attribute | Values | Purpose |
|---|---|---|
| `data-sg-wrap` | `"true"` / `"false"` | Explicit text wrapping control. Use `"true"` on paragraphs and multi-line text, `"false"` on headings and single-line labels. |
| `data-sg-group` | any string | Groups text runs into a single PPTX text box. All elements with the same group name within a slide are merged. |

If omitted, the converter falls back to heuristics (height-based wrapping detection, DOM block ancestor grouping).

## Unsupported CSS (Silently Ignored)

Do not rely on any of these for visual importance:

**Visual Effects:** `box-shadow`, `text-shadow`, `filter`, `backdrop-filter`,
`mix-blend-mode`, `clip-path`, `mask`, `outline`, `-webkit-text-stroke`

**Text:** `text-decoration` (underline/strikethrough), `text-indent`,
`word-spacing`, `font-variant`, `hyphens`

**Transforms:** `scale()`, `skew()`, `translate()`, `perspective`

**Gradients:** `conic-gradient()`, `repeating-*-gradient()`

**Layout:** `position: relative` offsets, `position: sticky/fixed`, CSS
`columns`, `float`

**Other:** Multiple `background-image` layers, per-corner `border-radius`,
`::before`/`::after` text content, CSS animations/transitions

## Common Pitfalls

**System fonts:** Always use Google Fonts. System fonts don't embed weight
variants — only binary bold.

**Box-shadow depth:** Use a border instead: `border: 1px solid var(--border)`.
Use a lighter `background-color` to suggest elevation.

**Large text rendering:** Text 72px+ renders ~10% smaller in PPTX. Size up.

**Multiple backgrounds:** Only the first `background-image` is processed. Nest
`<div>` elements instead.

**Gradient banding:** Use 4+ color stops for smooth gradients.

**Text wrapping:** Leave 10-15% extra horizontal space.

**Font weight in PPTX:** Weight 600 looks bolder in PPTX. Consider 500 instead.

**Small circles:** `border-radius: 50%` on elements smaller than 14px may
render as squares in PPTX.

---

## Technical Checklist

- [ ] Every slide is `<div class="slide">` at 1920x1080px
- [ ] `overflow: hidden` on every `.slide`
- [ ] Google Fonts only, loaded via `@import`
- [ ] No `box-shadow`, `text-shadow`, `filter`, `clip-path`
- [ ] No `text-decoration` for essential information
- [ ] No transforms other than `rotate()`
- [ ] No `conic-gradient` or `repeating-*-gradient`
- [ ] Only one `background-image` per element
- [ ] `border-radius` uses single uniform value
- [ ] Code blocks use `<pre>` with monospace Google Font
- [ ] Color contrast: body text readable against background
- [ ] `data-sg-wrap` on all text containers (`"true"` for paragraphs, `"false"` for single-line)
- [ ] `data-sg-group` on related inline text fragments that should form one text box
