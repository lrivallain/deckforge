# deckforge deck → editable PowerPoint

## 0. Export first

```bash
deckforge export <dir> --json      # writes <dir>/deck.pptx (or --out <file>.pptx)
```

The exporter lays the approved deck out in headless Chromium (Playwright, an optional dependency: if the command
reports it missing, ask before running `npm install -g playwright && npx playwright install chromium`, or use the
editor's **PowerPoint** button). It writes native text boxes, rounded rectangles, lines and cropped pictures; icons,
gradients and arrowheads become SVG pictures; speaker notes and links are kept; hidden slides are skipped.

Read `warnings` (font substitutions, unsupported content), then validate the file with §5 below. It does **not**
produce animations or embed fonts. Use the manual method in §1–4 only for what the export cannot do or when the user
asks for a hand-built rebuild (for example, native grouped diagrams with connectors, or Appear/Fade builds).

## Manual rebuild

This method rebuilds an **approved** `deck.html` as native PowerPoint
text, shapes and connectors. It is a reconstruction method, not a universal exporter. A screenshot on
each slide is not an editable conversion.

Choose the available tooling: a `pptx` skill, the app's **PowerPoint canvas** (`open_canvas` with
canvasId `powerpoint`, `initialize: true`; discover its actions with `list_canvas_capabilities`),
python-pptx, PptxGenJS or an equivalent. Follow that tool's current documentation. If none is available,
report the missing prerequisite and stop. Do not install anything without approval.

[design-system.md](design-system.md) owns the visual style. Generic tool themes must not replace
the white slides and blue/amber accents.

## 1. Establish the approved input

- The approved `deck.yaml` revision, its built `deck.html`, the slide count and the output path.
- Take the content from `deck.yaml`, not from scraped HTML text:
  - slide order and `hidden` flags (skip hidden slides unless asked);
  - headlines and slot text (strip rich-text tags into runs: `blue`/`primary` → primary colour,
    `amber`/`accent` → accent, `old` → muted line);
  - links;
  - `notes`, which become the PowerPoint speaker notes.
- Use only the authorized assets in `<dir>/assets/`. Do not upload the deck or captures to online converters.
- List the exact fonts, the native objects you need and the animations to reproduce.

## 2. Measure the HTML

Serve the deck (`deckforge serve <dir> --no-open`) and measure it in the browser canvas
(`evaluate_javascript`) or with Playwright:

1. Read the entrance order **before** freezing animations. deckforge reveals `.reveal` elements in reading order,
   staggered by the theme's `motion.stagger` (or an explicit `--delay`), and overlays after them or at their
   `data-df-order` step.
2. Freeze the final state. Run [../scripts/layout-check.js](../scripts/layout-check.js) first: it lays every slide out at
   **1280 × 720** in static mode and must report `ok`. Without the script, add the `static` class on `<html>`.
3. Measure each element relative to its `section.slide`. Collect bounds, z-order, fill, stroke, radius, text runs,
   alignment, padding and link targets. Resolve `cqw` at this width (1cqw = 12.8 px).
4. Overlays are in `.df-overlay > [data-ov-id]`. Their unrotated box is `x y w h` (in %) in `deck.yaml`, with `rotate` in degrees.
5. Keep icons as small vectors (the deckforge icons are 24 × 24 outline SVGs); rebuild large geometry as shapes.
6. Save a reference screenshot per slide for comparison.

## 3. Rebuild native slides

Use a wide slide: **13.333333 × 7.5 in**.

| Quantity | Conversion from the 1280 px reference |
|---|---|
| Inches | CSS px / 96 |
| EMU | CSS px × 9525 |
| Font size in points | CSS px × 0.75 |
| 1cqw | 12.8 px = 0.1333 in = 9.6 pt |
| Left/right inset | 51.2 px = 0.5333 in |
| Top inset | 38.4 px = 0.4 in |
| 44 px headline | 33 pt |
| 24 px body | 18 pt |
| 16 px metadata | 12 pt |

Convert exactly once. A canvas may already report points or inches.

- Text becomes editable text boxes and runs with explicit margins and wrapping.
- Cards become rounded rectangles. Pills are rounded rectangles, not stretched ellipses.
- Connectors attach to the intended shapes and avoid labels.
- Keep tables and charts native and editable where the tool supports it.
- Keep the concept/implementation map pair at identical geometry.
- Group diagram parts logically, preserve the reading order, and put notes and sources in the notes field.
- Check theme defaults (shadows, line styles, text padding) that would alter correct coordinates.
- Verify the installed font family names and weights. Avoid synthetic bold on an already-bold face.

## 4. Animation and font fidelity

Prefer simple native Appear/Fade builds in the same order as the HTML reveals.
If the tool cannot author animations, deliver a static version and state the limitation. Never claim animation
parity from a static render. Embed fonts only when the licence, format and tooling allow it. Otherwise get
approval for a named substitute. Edit OOXML only when necessary, and validate the package after every change.

## 5. Validate and deliver

For every slide, not just the title:

1. Render the PPTX and compare it with the HTML reference screenshot.
2. Inspect clipping, overlap, wrapping, font substitution, connector endpoints, image quality, contrast and reading order.
3. Extract the text and compare the slide order, headlines, numbers, links and notes with `deck.yaml`.
4. Confirm editability by changing a representative text box and diagram shape.
5. Check animations in slideshow mode when they were requested.
6. Fix the defects and re-render the affected slides.

Deliver the `.pptx` and keep the approved HTML. State any font, animation or validation limitation. If nothing can
render the PPTX, report visual verification as **blocked**, not passed. This procedure does not authorize sending,
uploading or publishing either file.
