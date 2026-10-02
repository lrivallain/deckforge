# Authoring deck.yaml with deckforge

`deck.yaml` is the source of truth. `deck.html` is generated: never edit it by hand.
The full format is in the deckforge [README](https://github.com/lrivallain/deckforge#deckyaml).
Images and overlays are in [docs/schema.md](https://github.com/lrivallain/deckforge/blob/master/docs/schema.md).

## 1. Tooling

```bash
deckforge --version                           # installed?
npx -y github:lrivallain/deckforge --version  # or run it without installing
```

Use whichever works and keep using it for every command below. You need Node.js 20.19+ or 22.12+.
To install the command globally, ask first, then use the tarball, because
`npm install -g github:…` installs an empty package with some npm 11 versions:

```bash
npm install -g https://github.com/lrivallain/deckforge/archive/refs/heads/master.tar.gz
# add --omit=optional for a slim install without the editor's Copilot assistant (~100 MB)
```

This skill is installed or updated with `deckforge skill install-copilot`.

## 2. Create the deck

```bash
deckforge new <dir> --title "<title>" [--theme build]   # deck.yaml with one title slide, then built
deckforge new <dir> --example                           # the full specimen (concept, implementation, lifecycle, zoom)
deckforge templates <dir> --json                        # the catalogue this deck can use
```

`templates --json` returns:
- `templates[]`: `name`, `label`, `description`, `category`, `scope` (`deck` < `user` < `builtin`; the first one found wins) and `slots`.
- `themes[]` and `icons[]`.

Each slot has a `type`, an optional `max` (characters for text, items for `list` and `cards`),
`maxLength` (per list item), `required`, `sample` and, for `cards`, `fields`. Use the `sample` values as the
shape of a valid value, not as content.

## 3. deck.yaml

```yaml
meta:
  title: Release safety                  # <title> and the default footer
  lang: fr                               # BCP 47; write slide copy in this language
  theme: build                           # build (default style) | atelier | a deck/user theme
  footer: Platform team / Q3             # rich text in every slide footer; no private paths
  runtime: local                         # optional: local | inline | cdn
  # also optional: subtitle, author, date, description
  brief:                                 # always fill it: it grounds the editor's Copilot
    topic: Release safety
    audience: Engineering managers
    goal: Agree on one release gate      # what the audience must understand or decide
    duration: 20 minutes
    language: French
    sources: [Q3 incident review (internal, 2026-09)]
    notes: Anything the assistant should know
slides:
  - id: shift                            # stable: a letter, then letters, digits, _ or -
    template: concept-map
    title: The shift                     # optional navigation title (defaults to the headline)
    hidden: false                        # true keeps a backup slide out of the presentation
    footer: Optional per-slide footer
    notes: |
      What to say, in 2 to 4 short sentences.

      Sources: name, URL, as-of date.
    data: { … }                          # the template's slots, nothing else
    overlays: [ … ]                      # optional free elements (section 6)
```

The editor manages `placeholders` (slots still showing sample text, never published) and
`stash` (content kept from a previous template). Leave them alone. The editor rewrites
`deck.yaml` and does not keep YAML comments.

## 4. Storyline → templates

| Step | Template | Notes |
|---|---|---|
| Opening | `title` | Two-part headline, a promise, presenter and event. An optional `visual` image replaces the motif |
| Chapter break | `section` | Number, short title, one line of context |
| Shift + concept map (recipe A) | `concept-map` | Audiences → a labelled boundary with two lanes → capabilities → takeaway |
| Same map, real components (B) | `implementation-map` | Copy the `concept-map` slot structure. Change the labels, not the counts |
| Lifecycle and owners (C/D) | `lifecycle` | 3 or 4 stages. `focus: true` on the stage the talk is about. An optional `feedback` path |
| Problem → response → outcome (E) | `zoom` | Stepper, problem card, bridge, up to 4 responses (one `highlight`), takeaway |
| Short argument | `bullets` | Up to 5 points. Prefer a diagram when the points are related |
| Comparison or recommendation | `two-column` | `highlightRight` marks the recommendation. Optional `leftMedia`/`rightMedia` |
| A real, sourced statement | `quote` | Never invent or paraphrase a quote |
| Picture that proves a point | `image` (framed, or `fullBleed`), `image-text` (`imageRight` alternates sides) | Approved images only |
| Resources and decision (G) | `resources` | 2–3 groups with real, descriptive links, and one next step |

Always confirm the names against `deckforge templates --json`. Deck-local and user templates
can add to this list or override entries in it.

## 5. Slot values

| Type | Value | Rules |
|---|---|---|
| `text` | string | Escaped. A newline becomes `<br>` |
| `richtext` | string | Allowed tags: `b strong i em u s small sub sup code kbd br span a abbr`. Allowed classes: `old muted primary accent blue amber ok mono nowrap` |
| `list` | `[string]` | `of: text` or `richtext`. `max` counts items, `maxLength` counts characters per item |
| `cards` | `[{…}]` | Each field has its own slot type and `max` |
| `icon` | name | One of the `icons` from `templates --json` (pen review book users shield cloud server database code gear chart target flag idea rocket flow agent network …) |
| `link` | `{label, href}` | `https://`, `mailto:`, `#…` or relative |
| `boolean` | true/false | |
| `image` | `{src, alt, fit, focus}` | `src: assets/<name>.<png\|jpg\|jpeg\|webp\|gif\|svg>` (no sub-folders; the name starts with a letter or digit) or `https://…`. `alt` is required in practice. `fit: cover\|contain`. `focus: "x% y%"` |

Headlines:
- Shift headline: `<span class="old">From X.</span><span class="blue">To Y.</span>`.
  `old` sets the previous state on its own muted line.
- Use `blue`/`primary` for the main emphasis and `amber`/`accent` for one distinction. Use them sparingly.
- A headline wraps at most twice.

Images:
- Copy approved files into `<dir>/assets/`, or let the user drop them in the editor.
  The editor checks the type from the file's magic bytes and refuses scripted SVG.
- Copy SVG files by hand only from a trusted source.
- `https://` images make every viewer download them: avoid them for offline decks.

## 6. Overlays

Free elements above the template. Use them for a short annotation the template cannot express,
such as an arrow to a detail, a callout on a value or an extra picture. Never use them to rebuild a layout.

```yaml
overlays:
  - id: callout-1        # unique on the slide
    kind: callout        # image | text | callout | arrow | shape
    x: 60                # left, % of 1280
    y: 70                # top, % of 720
    w: 25                # width, % of 1280
    h: 12.22             # height, % of 720
    z: 2
    rotate: -4           # optional, degrees
    order: 1             # optional reveal step
    data: { text: "<strong>Look here</strong>", tone: accent }
```

`data` uses theme tokens only, never raw colours:
- `text`: `text`, `style` body|heading|title|caption|label, `align`, `color` ink|muted|primary|accent
- `callout`: `text`, `tone` primary|accent|neutral, `align`
- `arrow`: `color`, `head` end|start|both|none, `weight` thin|regular|bold, `line` solid|dashed.
  The arrow points right; use `rotate` to aim it.
- `shape`: `shape` rounded|rect|ellipse|pill, `fill` primary|accent|neutral|paper|none, `stroke` primary|accent|line|dashed|none
- `image`: `src`, `alt`, `fit`, `focus`

8 px is 0.625 % horizontally and 1.11 % vertically. A 19.5 % × 6.5 % callout holds about 20 characters on one line.
`build` checks bounds and alt text. Only the layout check
([../scripts/layout-check.js](../scripts/layout-check.js)) shows whether an overlay covers template text.

## 7. Deck-local templates and themes

When no template fits a recurring need, add `<dir>/templates/<name>.html`, with a file name equal to `name`:

```html
---
name: metric-cards
label: Metric cards
description: Up to three metrics with a source line.
category: content            # structure | diagram | content | media
slots:
  eyebrow: { type: text, max: 40, sample: Results }
  title:   { type: richtext, max: 60, required: true, sample: 'What <span class="blue">changed</span>' }
  metrics:
    type: cards
    max: 3
    fields: { value: { type: text, max: 8 }, label: { type: text, max: 40 } }
    sample: [{ value: "42%", label: Fewer rollbacks }]
  source: { type: text, max: 90, sample: "Source: …" }
---
<header class="header reveal"><div><p class="eyebrow">{{eyebrow}}</p><h1 id="{{slide.titleId}}">{{title}}</h1></div></header>
<div class="metrics">{{#each metrics}}<article class="card metric reveal"><strong class="value">{{value}}</strong><p class="label">{{label}}</p></article>{{/each}}</div>
{{#if source}}<p class="outcome">{{source}}</p>{{/if}}
{{> foot}}
<style scoped>
.metrics { flex: 1; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: var(--df-space-grid); align-items: center; }
.metric { display: flex; flex-direction: column; justify-content: center; gap: .6cqw; min-height: 14cqw; }
.value { font: 800 5.5cqw / 1 var(--df-font-heading); color: var(--df-primary); letter-spacing: -.02em; }
.label { font-size: 1.7cqw; color: var(--df-muted); }
</style>
```

- Syntax: `{{slot}}`, `{{#each}}…{{else}}…{{/each}}` with `{{this}} {{@index}} {{@number}} {{@first}} {{@last}}`,
  `{{#if}}`/`{{#unless}}`, `{{slide.number}} {{slide.total}} {{slide.titleId}}`, `{{deck.title}}` and `{{> foot}}`.
- Use the base kit classes (`header eyebrow subtitle outcome foot pill card icon arrow reveal`) and `--df-*` tokens
  so the template follows every theme. `<style scoped>` scopes rules to the template.
- Charts: carry each human value **and** its precomputed size (for example `pct`) in slots. Draw the chart with HTML/CSS
  (`conic-gradient`, widths or heights in %), give it `role="img"` with an `aria-label` slot, and add an `sr-only` data table.
  Do not paste a static SVG chart.
- After adding a template, check it with `deckforge templates <dir> --json`: it appears with `scope: deck`,
  and `loadErrors` stays empty. Run the layout check with its sample data.

A theme is a `<dir>/themes/<name>.yaml` (the palette, fonts, radii, spacing and motion that compile to `--df-*`).
Copy the structure from the README's Themes section. Keep the built-in `build` theme unless the user asks for another look.

## 8. Build

```bash
deckforge build <dir> --json                 # validate + write deck.html (exit 2 on errors)
deckforge build <dir> --runtime inline       # one self-contained file to share (no network)
deckforge build <dir> --out <file> [--runtime local|inline|cdn]
```

`--json` reports `ok`, `outPath`, `runtime`, `slides`, `visibleSlides`, `issues[]`
(`level` error|warning|info, `slide`, `slot` or `overlay`, `message`), `loadErrors[]` and
`assets {used, missing, unused}`. Fatal problems return `{ "error": … }` with exit code 1.

| Issue | Fix |
|---|---|
| Unknown template or theme | Use a name from `templates --json`, or fix the deck-local file (`loadErrors`) |
| Slot not defined by the template | Rename it to a real slot, or drop it |
| `"x" is N characters (max M)` / too many items | Rewrite shorter, split the slide, or move detail to `notes` |
| Required slot missing or still sample text | Write real content |
| Image missing, unsupported source or empty alt | Copy the approved file into `assets/`, or write a specific alt text |
| Overlay beyond the slide | Move or resize it inside 0–100 % |

Runtimes: `local` (the default) copies `deckforge/deckforge.viewer.{js,css}` next to `deck.html`.
`inline` embeds everything, images included. `cdn` loads the runtime from jsDelivr and only works for tagged releases.
`local` and `inline` make no network requests.

## 9. Editor and viewer facts for the user

- `deckforge edit <dir>` opens a slide rail, inline text editing, a slot inspector, a theme switcher, the template editor,
  image upload, overlays with snapping, undo/redo and autosave. It also has a **Copilot drawer** scoped to
  *this slide* or the *whole deck*, grounded on `meta.brief`.
  The drawer can only use deck tools (no shell or web), and each turn is one undo step.
- `deckforge serve <dir>` gives a read-only view that rebuilds and live-reloads on change.
- Viewer keys: ←/→, PageUp/PageDown, Space, Home/End. `S` toggles static mode, `N` the notes,
  `P` the presenter window, `F` fullscreen. `#3` and `#slide-<id>` are deep links.
  Printing gives one 13.333 × 7.5 in page per slide.
- Fonts are not bundled. The `build` theme uses local Bricolage Grotesque, Instrument Sans and IBM Plex Mono,
  with named fallbacks. Say so when fidelity matters.
