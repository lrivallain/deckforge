# deck.yaml

`deck.yaml` is the source of truth. `deck.html` is generated from it, so don't edit `deck.html` by hand.

## Full example

```yaml
meta:
  title: Shipping with confidence
  lang: en                    # BCP 47, used for <html lang>
  theme: build                # a theme name (see Themes)
  footer: Platform team / Q3  # rich text shown in every slide footer
  runtime: local              # optional: local | cdn | inline
  brief:                      # grounds the Copilot assistant
    topic: Release safety
    audience: Engineering managers
    goal: Agree on one release gate
    duration: 20 minutes
    sources: [Q3 incident review]
slides:
  - id: shift                 # stable id: letters, digits, dashes
    template: concept-map     # a template name (see Templates)
    title: Concept map        # optional navigation title
    hidden: false             # hidden slides are kept but not presented
    footer: optional per-slide footer override (rich text)
    notes: |
      Speaker notes. Blank lines separate paragraphs.
    sources:                  # optional: in the notes and on the generated Sources slide
      - Q3 incident review (internal)
      - { label: Price list, href: "https://example.com/prices" }
    data:                     # slot values defined by the template
      eyebrow: 01 / Explain the shift
      title: <span class="old">From X.</span><span class="blue">To Y.</span>
      audiences:
        - { icon: pen, title: Creators, text: Prepare the work }
  - id: photo
    template: image-text
    data:
      image: { src: assets/3f2a9c1b04de.jpg, alt: Review board with three printed drafts, fit: cover, focus: 50% 30% }
      title: What reviewers see
    overlays:                 # optional free layer, % of the 1280×720 slide
      - { id: arrow-1, kind: arrow, x: 30, y: 20, w: 15, h: 6.67, z: 1, rotate: 25, data: { color: accent } }
```

## `meta`

| Field | Type | Notes |
|---|---|---|
| `title` | string | Deck title, used for `<title>`. The default is `Untitled deck` |
| `lang` | BCP 47 tag | Used for `<html lang>`. The default is `en` |
| `theme` | theme name | See [Themes](../guide/themes). The default is `build` |
| `footer` | rich text | Shown in every slide footer |
| `runtime` | `local` \| `cdn` \| `inline` | Default `--runtime` for `deckforge build` |
| `description` | string | `<meta name="description">` of the page |
| `subtitle`, `author`, `date` | string | Available to templates, for example <code v-pre>{{deck.author}}</code> |
| `brief` | mapping | `topic`, `audience`, `goal`, `duration`, `sources`: context for Copilot |
| `sourcesSlide` | `false` \| string | `false` leaves out the generated Sources slide; a string is its title. The default title is `Sources` |

## Slides

| Field | Type | Notes |
|---|---|---|
| `id` | string | Required, stable, unique. Letters, digits and dashes |
| `template` | template name | See [Templates](../guide/templates) |
| `title` | string | Optional navigation title |
| `hidden` | boolean | Kept in the deck, not presented |
| `footer` | rich text | Footer override for this slide |
| `notes` | string | Speaker notes. Blank lines separate paragraphs |
| `sources` | string or list | Where the slide's facts come from: strings or `{label, href}`. See [Sources](#sources) |
| `data` | mapping | Slot values, as defined by the template |
| `overlays` | list | Free elements above the template (see below) |

Two optional per-slide fields are managed by the editor:

- `placeholders`: slots that still contain the template's sample text, for example after adding a slide
  or switching templates. The editor shows them as dimmed "Sample" placeholders. They are **never
  published** in `deck.html`, and a required slot left as a placeholder is reported as an issue.
  Editing a slot makes it real content.
- `stash`: content of slots the current template does not use. When you switch templates, nothing is
  lost: switching back to a template with those slots restores them. A navigation `title` that only
  repeated the old template's name is dropped, so the title follows the headline.

## Sources

Each `sources:` entry is listed at the end of the slide's speaker notes. When at least one visible slide has sources,
`deckforge build` adds a **Sources** appendix slide at the end of `deck.html`: every source, with the number and
title of the slide it supports. Entries that are `http(s)` URLs, or have an `href`, become links. The appendix uses
the `sources` template, which a deck can override; `meta.sourcesSlide` renames it or turns it off.
The appendix is generated at build time: the editor doesn't show it as a slide.

## Number values

`number` slots, such as the values of the [chart templates](../guide/templates#charts-and-data), take a plain YAML
number: `1200`, `9.5`, `-3`. Don't add units, thousands separators or `%`; the template formats the number for
`meta.lang` and computes bar lengths, segments and totals from it.

## Image values

`image` slots (and image overlays) hold one mapping:

| Field | Type | Default | Notes |
|---|---|---|---|
| `src` | string | required | `assets/<name>.<png\|jpg\|jpeg\|webp\|gif\|svg>` (a file in the deck's `assets/` folder, no sub-folders, no `..`) or an `https://` URL. Other schemes (`http:`, `data:`, `javascript:`, `//host`) are not rendered. |
| `alt` | string | `""` | Alternative text. Empty alt texts are reported as warnings. |
| `fit` | `cover` \| `contain` | `cover` | `cover` fills the frame and crops; `contain` shows the whole picture. |
| `focus` | `"x% y%"` | `"50% 50%"` | `object-position`: the point kept visible when cropping. Values are clamped to 0–100 %. |

A bare string (`image: assets/1a2b3c4d5e6f.png`) is accepted as `{src}`.

Rendering: `<img class="df-img" src alt loading="lazy" decoding="async" style="object-fit: …; object-position: …">`.
User images are never inlined as SVG markup.

Validation (`deckforge build`, the inspector):

- warning: no alt text;
- warning: `https://` source (each viewer downloads it);
- error: unsupported source;
- warning: the file is missing from `assets/`;
- info: a file in `assets/` is not used by any slide.

### Files in `assets/`

The editor uploads images with `POST /api/assets` (raw `image/*` body, or JSON `{"data": "<base64 or data: URL>"}`,
10 MB maximum). The type is detected from the file's magic bytes:

| Type | Signature |
|---|---|
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| JPEG | `FF D8 FF` |
| GIF | `GIF87a` / `GIF89a` |
| WebP | `RIFF····WEBP` |
| SVG | UTF-8 text starting (after an optional XML declaration, comments or doctype) with `<svg`, ending with `</svg>`, and without `<script>`, `on*=` handlers, `javascript:`, `<foreignObject>`, `<!ENTITY>` or embedded documents |

Files are stored as `assets/<first 12 hex chars of the SHA-256>.<ext>`, so uploading the same file twice
reuses it. `GET /api/assets` lists them.

## Overlays

`overlays` is an optional list on each slide. Overlays are drawn in `<div class="df-overlay">`, an absolutely
positioned layer above the template, inside the slide's `<section>`.

```yaml
overlays:
  - id: callout-1          # unique on the slide; generated when missing
    kind: callout          # image | text | callout | arrow | shape
    x: 60                  # left edge, % of the slide width (1280 px)
    y: 70                  # top edge, % of the slide height (720 px)
    w: 25                  # width, % of 1280
    h: 12.22               # height, % of 720
    z: 2                   # stacking order among overlays (higher is in front)
    rotate: -4             # optional, degrees
    order: 1               # optional reveal step (0 = with the first template element)
    data: { text: "<strong>Look here</strong>", tone: accent }
```

- Geometry is stored with two decimals. 8 px is 0.625 % horizontally and 1.11 % vertically.
- Without `order`, overlays reveal after the template's elements, in z order. With `order: n` they
  appear with the template's n-th reveal step.
- Overlays use theme tokens only: no raw colors, fonts or sizes.

### Kinds and their `data`

| Kind | Fields (default first) | Rendering |
|---|---|---|
| `image` | `src`, `alt`, `fit`, `focus` (see above) | `<img>` filling the box |
| `text` | `text` (rich text), `style: body \| heading \| title \| caption \| label`, `align: left \| center \| right`, `color: ink \| muted \| primary \| accent` | theme heading, body or mono fonts |
| `callout` | `text` (rich text), `tone: primary \| accent \| neutral`, `align` | soft box in the tone's colors |
| `arrow` | `color: primary \| accent \| ink \| muted`, `head: end \| start \| both \| none`, `weight: regular \| thin \| bold`, `line: solid \| dashed` | horizontal arrow across the box; use `rotate` to aim it. Decorative (`aria-hidden`) |
| `shape` | `shape: rounded \| rect \| ellipse \| pill`, `fill: primary \| accent \| neutral \| paper \| none`, `stroke: primary \| accent \| line \| dashed \| none` | frame or highlight. Decorative (`aria-hidden`) |

Unknown fields and values outside these lists are dropped when the deck is loaded.

### Validation

- warning: an overlay extends beyond the slide;
- warning: an image overlay has no image or no alt text; a text or callout overlay is empty;
- warning (editor only, measured on the laid-out slide): an overlay covers the template's text.

### Operations

The editor and Copilot change overlays through the same operations, each one undo step:

| Operation | Arguments |
|---|---|
| `add_overlay` | `{id, overlay}` or `{id, overlays: [...]}`; `z` defaults to the top |
| `update_overlay` | `{id, overlayId, props}` or `{id, updates: [{overlayId, props}]}`; `props` may set `x y w h z rotate order` (`null` clears `order`) and merges `data` |
| `remove_overlay` | `{id, overlayId}` or `{id, overlayIds}` |
| `move_item` | `{id, path, from, to}`: reorder an item of a list or cards slot (`path` may be nested, e.g. `columns.0.points`) |
| `set_image` | `{id, path, alt, fit?, focus?, slot?}`: put `assets/…` into an image slot (default: the first one) |

Copilot's tools have the same names; `add_overlay` and `update_overlay` take the overlay fields at the top
level (`{id, kind, x, y, w, h, data}`, `{id, overlayId, x, …}`). In a slide-scoped request, only that
slide's overlays can change, and images must already be in `assets/`.
