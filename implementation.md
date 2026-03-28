# slide-gen Implementation Plan

## What's Done

### Phase 1: Type System Foundation
All new types added to `src/types.ts` — every subsequent feature can build on these without further type changes.

- `ShadowInfo` — shared by box-shadow and text-shadow
- `CornerRadii` — per-corner border-radius (topLeft/topRight/bottomRight/bottomLeft)
- `TableElement`, `TableRow`, `TableCell` — native OOXML table support
- `MasterSlideConfig` — custom master/layout/theme XML overrides + logo image
- `ProgressEvent`, `ProgressCallback` — structured progress with phase/current/total
- `TextRun` extended with `textDecoration?`, `textShadow?`, `href?`
- `RectElement` extended with `boxShadow?`, `borderRadii?`
- `GradientInfo` extended with `"conic"` type, `repeating?`, `conicAngle?`
- `SlideData` extended with `tables[]`, `notes?`
- `ConvertOptions`/`ConvertBufferOptions` extended with `onProgressEvent?`, `masterSlide?`
- All new types exported from `src/index.ts`

### Phase 2a: Text Decoration (underline, strikethrough)
End-to-end implementation complete.

- **Extract** (`src/dom-extract/extract.ts`): reads `computed.textDecorationLine` for every text run
- **Build** (`src/pptx-shapes.ts`): `underline?` → `u="sng"`, `strikethrough?` → `strike="sngStrike"` on `<a:rPr>`
- **Wire** (`src/pptx-builder.ts`): parses `textDecoration` string, maps to OOXML attrs
- **Tests**: 3 tests (underline, strikethrough, both) in `pptx-builder.test.ts`
- **Fixture**: `fixtures/text-decoration.html`

### Phase 3: Hyperlink Extraction
End-to-end implementation complete.

- **Extract** (`src/dom-extract/extract.ts`): detects `<a>` ancestor via `el.closest('a')`, extracts `href`
- **Rels** (`src/pptx-rels.ts`): added `hyperlink` relationship type
- **Build** (`src/pptx-shapes.ts`): `hlinkRId?` on `TextRunOpts` → `<a:hlinkClick r:id="..."/>` inside `<a:rPr>`
- **Wire** (`src/pptx-builder.ts`): registers hyperlink rels with `TargetMode="External"`
- **Tests**: 1 test verifying slide XML contains `a:hlinkClick` and rels contain URL with External target mode
- **Fixture**: `fixtures/hyperlinks.html`

### Phase 4: Slide Notes
End-to-end implementation complete.

- **Extract** (`src/dom-extract/extract.ts`): reads `data-notes` attribute or `.notes`/`[data-slide-notes]` child element, hides notes element from visual extraction
- **XML** (`src/pptx-xml.ts`): `notesSlideXml()` generates `ppt/notesSlides/notesSlideN.xml`, `notesMasterXml()` generates notes master, `contentTypesXml()` updated to include notes content types
- **Rels** (`src/pptx-rels.ts`): added `notesSlide`, `notesMaster` relationship types
- **Build** (`src/pptx-builder.ts`): generates notes slides + master only when notes exist, with all required rels
- **Tests**: 2 tests (notes present, notes absent) in `pptx-builder.test.ts`
- **Fixture**: `fixtures/notes.html` (3 slides: data-notes attr, .notes element, no notes)

### Phase 2b: box-shadow / text-shadow
End-to-end implementation complete.

- **Extract** (`src/dom-extract/css-helpers.ts`): `parseShadow(str)` parses CSS box-shadow/text-shadow values, handles rgba/rgb colors, negative offsets, multi-shadow (takes first), zero-shadow filtering
- **Extract** (`src/dom-extract/extract.ts`): reads `computed.boxShadow` on rects, `computed.textShadow` on text runs
- **Build** (`src/pptx-shapes.ts`): `buildOuterShadowXml()` emits `<a:effectLst><a:outerShdw>` with blurRad/dist/dir in EMUs and color+alpha; box-shadow on `<p:spPr>`, text-shadow inside `<a:rPr>`
- **Wire** (`src/pptx-builder.ts`): passes `boxShadow` to `buildRectShapeXml`, `textShadow` to `TextRunOpts`
- **Tests**: 8 unit tests for `parseShadow` in `css-helpers.test.ts`, 3 PPTX output tests in `pptx-builder.test.ts`
- **Fixture**: `fixtures/shadows.html` (box-shadow card, text-shadow heading, glow effects)

### Phase 2c: Per-corner border-radius
End-to-end implementation complete.

- **Extract** (`src/dom-extract/css-helpers.ts`): `parseBorderRadii()` returns per-corner `{ topLeft, topRight, bottomRight, bottomLeft }` in px
- **Extract** (`src/dom-extract/extract.ts`): stores `borderRadii` on rects only when corners differ (equal corners use existing `borderRadius` path)
- **Build** (`src/pptx-shapes.ts`): `buildCustomRoundedRectGeom()` generates `<a:custGeom>` with moveTo/lnTo/arcTo per corner; falls back to `roundRect` preset when all 4 corners equal
- **Wire** (`src/pptx-builder.ts`): converts per-corner px values to inches with `BORDER_RADIUS_SCALE`
- **Tests**: 3 unit tests for `parseBorderRadii`, 2 PPTX output tests (custom geom vs prstGeom)

### Phase 2d: CSS transforms (scale, translate, skew)
End-to-end implementation complete.

- **Extract** (`src/dom-extract/css-helpers.ts`): `getTransformInfo()` decomposes `matrix(a,b,c,d,tx,ty)` into rotation, scaleX, scaleY, translateX, translateY, skewX
- **Extract** (`src/dom-extract/extract.ts`): uses `getTransformInfo()` for text runs; applies scale average to font sizes (getBoundingClientRect already includes transform for positions/dimensions); skew is decomposed but has no OOXML equivalent
- **Tests**: 5 unit tests for `getTransformInfo` (identity, translation, scale, rotation, combined)

### Phase 5: List Support (`<ul>` / `<ol>`)
End-to-end implementation complete.

- **Types** (`src/types.ts`): added `bulletType?`, `bulletChar?`, `bulletAutoNumType?`, `indentLevel?` to `TextElement`
- **Extract** (`src/dom-extract/extract.ts`): dedicated pass for `<ul>`/`<ol>` — walks `<li>` children, tracks nesting depth, maps `list-style-type` to bullet chars (disc/circle/square) or auto-num types (decimal/roman/alpha), marks text nodes to skip in regular text walker
- **Build** (`src/pptx-shapes.ts`): extended `buildTextBoxXml()` — emits `<a:buChar>` or `<a:buAutoNum>` instead of `<a:buNone/>`, sets `marL` (0.5in/level) and hanging `indent` (-0.25in)
- **Wire** (`src/pptx-builder.ts`): passes bullet properties through to `buildTextBoxXml`
- **Tests**: 3 tests (unordered bullet, ordered auto-num, nested indent) in `pptx-builder.test.ts`
- **Fixture**: `fixtures/lists.html` (unordered, ordered, nested lists)

---

### Phase 2g: ::before/::after text content
End-to-end implementation complete.

- **Extract** (`src/dom-extract/pseudo.ts`): `extractTextFromContent()` parses CSS `content` property, extracts quoted strings (single/double), concatenates multiple strings; `extractPseudo()` now returns `{ rect?, text? }` — builds a `TextElement`-compatible object from pseudo computed style when text content is present
- **Extract** (`src/dom-extract/extract.ts`): updated pseudo callers to handle new return shape — pushes `rect` to `data.rects` and `text` to `data.texts`; injects `extractTextFromContent` into browser context
- **Tests**: 8 unit tests for `extractTextFromContent` (quoted strings, concatenation, none/normal/empty, attr() partial) in `pseudo.test.ts`

---

## What's Left

### Phase 2e: conic-gradient() and repeating gradients
End-to-end implementation complete.

- **Extract** (`src/dom-extract/gradient-parse.ts`): `detectGradient()` detects all gradient types including `repeating-*` and `conic-gradient` from CSS `backgroundImage`; `parseGradient()` extended for conic type — parses `from <angle>`, `at <x>% <y>%`
- **Extract** (`src/dom-extract/extract.ts`): all 3 gradient detection sites replaced with `detectGradient()` call
- **Build** (`src/gradient.ts`): `tileRepeatingStops()` tiles repeating gradient stops to fill 0-100%; conic gradients fall back to radial approximation (no OOXML equivalent) with warning
- **Tests**: 3 conic parse tests, 6 `detectGradient` tests (linear, repeating-linear, repeating-radial, conic, none, url) in `gradient-parse.test.ts`

### Phase 2f: Multiple background-image layers
End-to-end implementation complete.

- **Extract** (`src/dom-extract/gradient-parse.ts`): `splitBackgroundLayers()` splits CSS `backgroundImage` on top-level commas; `detectGradients()` returns all gradient layers as an array; `detectGradient()` refactored to use same infrastructure (returns first match)
- **Types** (`src/types.ts`): added `gradients?: GradientInfo[]` to `RectElement` (alongside existing singular `gradient`)
- **Extract** (`src/dom-extract/extract.ts`): uses `detectGradients()` for rect extraction; populates `gradients` array when multiple gradient layers found
- **Build** (`src/pptx-builder.ts`): when `rect.gradients` has >1 entry, emits stacked shapes (one per gradient layer, reversed for correct paint order); bottom shape gets background color + box-shadow, upper shapes get gradient fill only
- **Tests**: 5 `detectGradients` tests (empty, single, multi, triple with rgba, url filtering) in `gradient-parse.test.ts`; 2 PPTX output tests (stacked shapes for multi-gradient, single shape for single gradient) in `pptx-builder.test.ts`

### Phase 6: Table Support (`<table>`)
End-to-end implementation complete.

- **Types** (`src/types.ts`): added `columnWidths: number[]` to `TableElement`
- **Extract** (`src/dom-extract/extract.ts`): dedicated pass for `<table>` — iterates `<tr>` > `<td>`/`<th>`, extracts per-cell text runs, background color, colspan, rowspan, dimensions; tracks column widths from first row; skips table elements in rect/text extraction passes
- **Build** (`src/pptx-shapes.ts`): `buildTableXml()` generates `<p:graphicFrame>` with `<a:tbl>`, `<a:tblGrid>`, `<a:tr>`, `<a:tc>`; supports cell background colors, text runs with font properties, colspan/rowspan via `gridSpan`/`rowSpan` attrs
- **Wire** (`src/pptx-builder.ts`): loops over `sd.tables` after text boxes, calls `buildTableXml` with scale factors
- **Tests**: 3 tests (simple table structure, cell backgroundColor, colspan gridSpan) in `pptx-builder.test.ts`
- **Fixture**: `fixtures/tables.html` (simple data table, table with colspan and styled cells)

### Phase 7: Master Slide / Layout Customization
End-to-end implementation complete.

- **Build** (`src/pptx-builder.ts`): `MasterSlideConfig` added to `PptxBuildOptions`; custom `masterXml`, `layoutXml`, `themeXml` override defaults when provided; `logoImage` base64 PNG added as media once and referenced on every slide via `buildImageShapeXml`
- **Pipeline** (`src/pipeline.ts`): `masterSlide` option threaded from both `convertHtmlBuffers` and `convertHtmlToSlides` through to `buildPptx()`
- **Tests**: 2 tests in `pptx-builder.test.ts` — custom master/layout/theme XML overrides verified in ZIP, logo image media + rels + pic elements verified on all slides

### Phase 8: Progress Callbacks
End-to-end implementation complete.

- **Pipeline** (`src/pipeline.ts`): emits structured `ProgressEvent` at each phase boundary (browser, pdf, extract, png, fonts, pptx, render) via `onProgressEvent` callback; includes `current/total` for image capture and slide extraction
- **Backward compat**: existing `onProgress` string callback continues to work alongside new `onProgressEvent` — both fire independently
- **Pipeline** (`src/pipeline.ts`): `onProgressEvent` threaded from `convertHtmlToSlides` → `convertHtmlBuffers`

### Phase 9: Testing
Roundtrip tests complete. Rendering fidelity tests deferred (requires LibreOffice).

- **`tests/pptx-roundtrip.test.ts`**: 8 tests verifying PPTX ZIP integrity — required parts exist, XML well-formedness (balanced angle brackets), content types coverage, presentation slide references, slide/notes/image rels consistency, hyperlink external target mode
- Rendering fidelity tests (`pixelmatch` comparison) deferred — requires LibreOffice + Ghostscript setup

---

## Implementation Order

Recommended sequence (respects dependencies):

1. ~~Phase 1: Types~~ ✅
2. ~~Phase 2a: text-decoration~~ ✅
3. ~~Phase 3: Hyperlinks~~ ✅
4. ~~Phase 4: Slide Notes~~ ✅
5. ~~Phase 2b: box-shadow / text-shadow~~ ✅
6. ~~Phase 2c: Per-corner border-radius~~ ✅
7. ~~Phase 2d: CSS transforms~~ ✅
8. ~~Phase 5: List support~~ ✅
9. ~~Phase 2g: ::before/::after text~~ ✅
10. ~~Phase 6: Table support~~ ✅
11. ~~Phase 2e: Conic + repeating gradients~~ ✅
12. ~~Phase 2f: Multiple bg layers~~ ✅
13. ~~Phase 7: Master slide customization~~ ✅
14. ~~Phase 8: Progress callbacks~~ ✅
15. ~~Phase 9: Testing infrastructure~~ ✅

## Key Risks

| Feature | Risk | Mitigation |
|---|---|---|
| Per-corner border-radius | `<a:custGeom>` is verbose and tricky | Fall back to `roundRect` when corners equal |
| Conic gradients | No OOXML equivalent | Rasterize as image fallback |
| CSS skew | No OOXML equivalent | Warn and approximate |
| Complex tables | colspan/rowspan hard | Start simple, add spanning iteratively |
| Notes master | Large XML boilerplate | Extracted minimal working template |
