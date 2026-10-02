# deckforge

Themeable, template-driven HTML presentations with a static **viewer**, a local
**editor**, a **template editor** and an embedded **GitHub Copilot** assistant.

deckforge keeps the look of the `build-presentation` style (white 16:9 slides,
blue and amber accents, diagram-led layouts, staged reveals). Instead of
hand-editing raw HTML, you describe the deck in `deck.yaml` and deckforge
generates a static `deck.html`:

- **Viewer**: a static `deck.html` with keyboard and hash navigation, a static/reduced-motion
  mode, speaker notes, a presenter window, fullscreen and print output. It stays
  readable without JavaScript and makes **no network requests** in the `local` and `inline`
  runtime modes.
- **Editor** (`deckforge edit`): a slide rail, a live preview with inline text editing, a typed slot
  inspector, a theme switcher, autosave and undo/redo.
- **Images and free elements**: `image` slots and templates, drag-and-drop/paste uploads, and a per-slide
  overlay layer (images, text, callouts, arrows, shapes) you can move, resize and align on the slide.
- **Copilot**: a chat drawer scoped to *this slide* or the *whole deck*. Copilot can only call deck tools, and
  each turn is one undo step.
- **Template editor**: front-matter, HTML and CSS editing with a live preview, plus validation (unknown
  slots, overflow at 1280×720).

![The deckforge editor](docs/editor.png)

| Copilot drawer | Template editor | Viewer |
|---|---|---|
| ![Copilot](docs/copilot.png) | ![Template editor](docs/template-editor.png) | ![Viewer](docs/viewer.png) |

## Install

You need Node.js **20.19 or later**, or **22.12 or later**.

```bash
# from GitHub (the built runtime in dist/ is committed)
npm install -g github:lrivallain/deckforge
# or run it without installing
npx github:lrivallain/deckforge --help
```

The Copilot assistant uses the optional dependency `@github/copilot-sdk`, which
bundles the Copilot runtime (about 100 MB). It installs by default. For a slim install
that can only build and edit decks, use `npm install --omit=optional`. In that case the assistant
explains how to add the SDK.

## Quick start

```bash
deckforge new my-talk --title "Shipping with confidence"   # creates my-talk/deck.yaml + deck.html
deckforge edit my-talk                                      # opens the editor in your browser
deckforge build my-talk --runtime inline                    # one self-contained deck.html
```

To start from the full specimen deck, run `deckforge new my-talk --example`. It is the same deck as
[`examples/starter`](examples/starter), which reproduces the `build-presentation`
`starter.html` pixel for pixel.

## CLI

| Command | What it does |
|---|---|
| `deckforge new <dir> [--title T] [--theme build] [--example] [--force]` | Create a deck folder with `deck.yaml` and build it |
| `deckforge build <deck.yaml\|dir> [--runtime local\|cdn\|inline] [--out file] [--json]` | Render `deck.yaml` to `deck.html`. Prints validation issues; exits with code 2 on errors. `--json` prints a machine-readable report (`ok`, `outPath`, `issues`, `loadErrors`, `assets`) |
| `deckforge templates [deck.yaml\|dir] [--json]` | List the templates a deck can use, with their slots, plus themes and icons. Deck-local and user templates are included |
| `deckforge edit <deck.yaml\|dir> [--port 0] [--token T] [--runtime …] [--no-open]` | Start the local editor |
| `deckforge serve <deck.yaml\|dir> [--port 0] [--no-open]` | Serve the deck read-only. Rebuilds and live-reloads on change |
| `deckforge skill install-copilot [--dest dir] [--force] [--replace-build-presentation]` | Install the [GitHub Copilot skill](#github-copilot-skill) |

`edit` and `serve` bind to `127.0.0.1` only. `edit` prints a URL with a per-run
token, for example `http://127.0.0.1:53712/?token=…`. That URL is the only way into the editor,
so do not share it.

## `deck.yaml`

`deck.yaml` is the source of truth. `deck.html` is generated, so do not edit it by hand.

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

Images are files in the deck's `assets/` folder (added by the editor) or `https://` URLs. Overlays
are free elements drawn above the template. See [docs/schema.md](docs/schema.md) for every field.

Two optional per-slide fields are managed by the editor:

- `placeholders`: slots that still contain the template's sample text, for example after adding a slide
  or switching templates. The editor shows them as dimmed "Sample" placeholders. They are **never
  published** in `deck.html`, and a required slot left as a placeholder is reported as an issue.
  Editing a slot makes it real content.
- `stash`: content of slots the current template does not use. When you switch templates, nothing is
  lost: switching back to a template with those slots restores them. A navigation `title` that only
  repeated the old template's name is dropped, so the title follows the headline.

The editor rewrites `deck.yaml` on every change, so YAML comments are not preserved.
External edits, for example from your text editor, are picked up live and can be undone.

## Themes

A theme is a YAML file that compiles to CSS custom properties (`--df-*`).
deckforge looks up themes in this order:

1. `<deck folder>/themes/<name>.yaml`
2. `~/.config/deckforge/themes/<name>.yaml` (or `$XDG_CONFIG_HOME/deckforge`, or `$DECKFORGE_CONFIG_DIR`)
3. the built-in themes:
   - **`build`** has the exact `build-presentation` tokens.
   - **`atelier`** is a warm ivory theme with teal and rose accents and serif headings.

```yaml
name: my-theme
label: My theme
palette:            # required: bg paper line ink muted node primary primary-soft primary-line accent accent-soft accent-line
  bg: "#EDF1F7"     # optional: frame (boundary fill), dashed (dashed borders), ok, chrome (viewer surround),
                    #   accent-text / primary-text (darker shades for small text, 4.5:1 contrast)
  paper: "#FFFFFF"
  # …
fonts:
  heading:
    family: Bricolage Grotesque
    fallback: '"Trebuchet MS", "Segoe UI", sans-serif'
    faces:
      - { weight: 800, local: [Bricolage Grotesque ExtraBold Regular] }
      - { weight: 600, url: fonts/heading-600.woff2 }   # relative to deck.html, or https://
  body: { family: Instrument Sans, fallback: '"Segoe UI", Arial, sans-serif' }
  mono: { family: IBM Plex Mono, fallback: Consolas, monospace }
radii:   { slide: 12px, card: 10px, panel: 12px, frame: 14px, small: 8px, pill: 99px }
spacing: { padding: 3cqw 4cqw 2cqw, gap: 1.3cqw, grid: 1.1cqw }
motion:  { duration: .55s, easing: ease, distance: 8px, stagger: .15s }
shadow:  { slide: 0 24px 60px rgb(22 32 47 / 10%) }
```

Values are validated, and anything that could break out of CSS is rejected. Fonts are not
bundled. The built-in themes use locally installed fonts with named fallbacks, so they make no network requests.

## Templates

A template is one `.html` file with YAML front-matter, an HTML body and scoped CSS.
The lookup order is the same as for themes: `templates/` in the deck folder, then
`~/.config/deckforge/templates/`, then the built-ins.

```html
---
name: team-grid                 # must match the file name
label: Team grid
description: Up to three cards under a headline.
category: content               # structure | diagram | content | media (template picker groups)
order: 10                       # optional sort order in the picker
class: map-slide                # optional extra classes on the <section>
slots:
  eyebrow: { type: text, max: 40, sample: "Section / topic" }
  title:   { type: richtext, max: 60, required: true, sample: 'A clear <span class="blue">headline</span>' }
  cards:
    type: cards
    max: 3                      # characters for text, items for list/cards (soft limit)
    fields:
      icon:  { type: icon }
      title: { type: text, max: 24 }
      focus: { type: boolean }
    sample:
      - { icon: users, title: First }
---
<header class="header reveal">
  <div><p class="eyebrow">{{eyebrow}}</p><h1 id="{{slide.titleId}}">{{title}}</h1></div>
</header>
<div class="grid">
  {{#each cards}}<article class="card{{#if focus}} focus{{/if}} reveal">{{icon}}<h2>{{title}}</h2></article>{{/each}}
</div>
{{> foot}}

<style scoped>
.grid { flex: 1; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: var(--df-space-grid); }
:scope .header { flex: 0 0 9cqw; }   /* :scope = this template's slide */
</style>
```

**Slot types**

| Type | Value | Notes |
|---|---|---|
| `text` | string | HTML-escaped. Newlines become `<br>` |
| `richtext` | string | Sanitized inline HTML: `b strong i em u s small sub sup code kbd br span a abbr`. Allowed classes: `old muted primary accent blue amber ok mono nowrap`. Links only allow `http(s)`, `mailto`, `#` and relative URLs |
| `list` | string[] | Use `of: text \| richtext`. `maxLength` limits each item |
| `cards` | object[] | `fields` declares the slot type of each item field |
| `icon` | icon name | One of the built-in outline icons, such as `pen review book user users shield lock cloud server database code gear chart target flag idea rocket link search clock calendar mail chat globe layers box bolt check alert arrow star heart home file folder eye sparkles puzzle flow agent network money building` |
| `link` | `{label, href}` | Rendered as a safe external link |
| `boolean` | true/false | Use it in `{{#if}}` blocks |
| `image` | `{src, alt, fit, focus}` | `src` is `assets/<file>` or `https://…`; `alt` is required (warned when empty); `fit: cover\|contain`; `focus: "x% y%"` (kept visible when cropping). Rendered as `<img loading="lazy" decoding="async">`; empty renders nothing, so wrap optional ones in `{{#if}}`. The base kit's `.media` class gives a framed box the image fills |

**Syntax**

- `{{slot}}` outputs a value. Text is escaped and rich text is sanitized. Inside an attribute, the value becomes plain text.
- `{{#each slot}}…{{else}}…{{/each}}` loops over a list. Inside the loop, use `{{this}}`, `{{field}}`, `{{@index}}`, `{{@number}}` (01, 02…), `{{@first}}` and `{{@last}}`.
- `{{#if slot}}…{{else}}…{{/if}}` and `{{#unless slot}}…{{/unless}}` render conditionally.
- `{{slide.number}} {{slide.total}} {{slide.titleId}} {{slide.footer}}` and `{{deck.title}} {{deck.author}} {{deck.date}}` output deck metadata.
- `{{> foot}}` renders the standard footer. `{{! comment }}` is a comment.
- `<style scoped>` scopes every selector to `.df-t-<name>`.
- Add `class="reveal"` for staged entrances. The viewer staggers delays in reading order unless you set `style="--delay:.3s"`.

The viewer CSS provides a base kit with the classes `header eyebrow subtitle outcome foot pill card
icon arrow`, `h1 .old`, `.blue/.primary` and `.amber/.accent`. Built-in templates:
`title` (optional `visual` picture instead of the motif), `section`, `concept-map`, `implementation-map`, `lifecycle`, `zoom`
(problem → response), `bullets`, `two-column` (optional `leftMedia`/`rightMedia`), `quote`, `resources`,
`image` (framed with a caption, or full-bleed with a text panel) and `image-text` (picture + headline +
points; `imageRight` switches the side). Empty optional images keep the original layouts pixel for pixel.

## Runtime modes and CDN

`deck.html` loads the viewer runtime (`deckforge.viewer.js` and `.css`) in one of three ways:

| Mode | How | Network |
|---|---|---|
| `local` (default) | Copies `deckforge/deckforge.viewer.{js,css}` next to `deck.html` | none |
| `inline` | Embeds everything in a single self-contained file | none |
| `cdn` | `https://cdn.jsdelivr.net/gh/lrivallain/deckforge@v<version>/dist/deckforge.viewer.{js,css}` | jsDelivr |

Theme and template CSS are always inlined, so `cdn` decks fetch only the two runtime files.

Images follow the mode: `local` copies the used `assets/` files next to `deck.html` when you build
with `--out` elsewhere, `inline` embeds them as `data:` URIs, and `cdn` keeps the relative paths.
`deckforge build` lists assets that no slide uses (it never deletes them) and warns about missing
files, empty alt texts and `https://` images (each viewer fetches them).
The CDN URLs only resolve for tagged releases (`v<version>`).

## Viewer

| Key | Action |
|---|---|
| → / PageDown / Space | Next slide |
| ← / PageUp | Previous slide |
| Home / End | First / last slide |
| `S` | Toggle static mode (no animations) |
| `N` | Toggle the speaker notes panel |
| `P` | Open the presenter window (notes, next slide, timer) |
| `F` | Toggle fullscreen |

The viewer also supports these:

- **Hash links:** `#3` and `#slide-<id>` open a specific slide.
- **Reduced motion:** with `prefers-reduced-motion`, slides show their final state immediately.
- **Print / PDF:** printing outputs one 13.333×7.5 in page per slide, without the controls. Images are
  lazy in the markup, but the runtime loads the neighbouring slides' images on navigation and every
  image after the page has loaded and before printing.
- **Overlays** reveal after the template elements, or at their `order` step.

## Editor

- **Slide rail.** Click to select a slide, or drag to reorder. Alt+↑/↓ moves a slide, Delete removes it and ⌘/Ctrl+D duplicates it.
  Each item has buttons to duplicate, hide/show and delete the slide.
- **Preview.** Click any text to edit it in place. Enter commits, Shift+Enter adds a line break and Esc reverts.
- **Inspector.** Template picker with live thumbnails, typed slot form (counters show the `max`
  limits), speaker notes, navigation title, footer override and visibility. Template changes are
  named in the undo history and in a toast, for example "Slide 1: Concept map → Title · Undo". Copilot's template
  changes are announced the same way.
- **Top bar.** Undo/redo (⌘/Ctrl+Z, ⇧⌘Z), theme switcher, **Templates** (template editor),
  **Deck** (metadata, brief, runtime), **Present** (opens the generated viewer) and **Copilot** (⌘/Ctrl+K).
- **Images.** Drop or paste an image on the slide, click an empty image frame, or use the inspector's
  image control (choose a file, reuse one from the deck, or type an `https://` address). PNG, JPEG,
  WebP, GIF and SVG up to 10 MB. The control shows a thumbnail: click it to set the focal point. It also
  has a fill/fit switch and an alt text field with a counter that warns while it is empty.
  Dropping on an image frame replaces that picture; dropping elsewhere fills an empty required image
  slot, or adds an image overlay.
- **Insert** (above the slide) adds an image, text, callout, arrow or shape overlay. Click an overlay to
  select it (Shift+click adds to the selection). Then:
  - drag it, resize it with the 8 handles (Shift keeps the proportions) or rotate it with the round
    handle (Shift: 15° steps);
  - it snaps to an 8 px grid and to the edges and centres of the template's elements, the slide
    margins and other overlays, with guides (hold Alt to move freely);
  - arrow keys nudge 1 px, Shift+arrow 10 px; ⌘/Ctrl+D duplicates, Delete removes, ⌘/Ctrl+] and [
    bring forward and send backward;
  - the inspector edits position, size, rotation, reveal step and the kind's theme tokens, and aligns or
    distributes several overlays.
  Every gesture is one undo step. Overlays leaving the slide or covering the template's text are flagged.
  Template slots keep their layout: there are no per-element offsets, so paired slides stay aligned.
- **Reorder items.** Hover a card or list item on the slide and drag its grip, or drag the handle of a
  row in the inspector. Each drop is one undo step.
- Every change autosaves `deck.yaml` and rebuilds `deck.html`.

### Copilot assistant

The assistant runs server-side through the [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
and uses your existing sign-in from `gh auth login` or the Copilot CLI `/login`. If you are not
signed in, the drawer shows how to sign in.

- **Scope.** *This slide* limits every change to the selected slide. *Whole deck* allows
  adding, removing, reordering and theming slides.
- **Tools.** Copilot can only use `get_deck`, `list_templates`, `list_themes`, `update_slide`,
  `add_slide`, `remove_slide`, `move_slide`, `set_hidden`, `set_template`, `set_theme`,
  `update_meta`, `list_assets`, `set_image`, `add_overlay`, `update_overlay` and `remove_overlay`. It has no
  shell, file or web tools. Every other permission request is refused.
- **Images.** Copilot can only place images that are already in `assets/` (no downloads and no
  `https://` sources). It writes alt texts and says when one is only a suggestion to check.
- **Grounding.** The system prompt contains the design rules of the style (one takeaway per slide,
  short headlines, no invented facts…), the template catalogue and `meta.brief`.
- **Undo.** Changes apply directly, and slides Copilot changed are highlighted in the rail. A turn is a single
  undo step ("Undo these changes").
- **Model.** Set `DECKFORGE_MODEL=<model>` to pick a model. By default, deckforge uses the Copilot default model.

### Security model

- The server binds `127.0.0.1` with a random port and a per-run token. The token is exchanged for an
  `HttpOnly; SameSite=Strict` cookie named after the port (`df_token_<port>`), so several editors can run
  side by side.
- The server checks the Host header against DNS rebinding and the Origin header on writes. It requires JSON request bodies and sends
  a strict Content-Security-Policy for the editor.
- Writes happen only in the deck folder (`deck.yaml`, `deck.html`, `deckforge/`, `templates/`, `assets/`) and in
  `~/.config/deckforge/templates`. Dot-files and paths outside the deck folder are never served.
- Uploads (`POST /api/assets`) need the token, pass the Origin check and are limited to 10 MB. The file
  type comes from its magic bytes, never from its name or Content-Type. SVG files with scripts, event
  handlers, `javascript:` URLs, `foreignObject` or entity declarations are refused. Files are stored as
  `assets/<sha256-12>.<ext>`. Assets are served with `X-Content-Type-Options: nosniff`, and SVG with a
  `sandbox` Content-Security-Policy. User images are always `<img>` elements, never inline SVG. The server
  never fetches remote URLs.
- Slot text is HTML-escaped and rich text is sanitized with an allow-list. Theme values are validated.
- deckforge sends no telemetry.

## GitHub Copilot skill

deckforge ships a skill that teaches GitHub Copilot (the CLI and the GitHub Copilot app) to build decks
with deckforge. The skill lives in [`skills/deckforge`](skills/deckforge). Copilot plans a storyline from a brief
and writes `deck.yaml` against the live catalogue (`deckforge templates --json`). It then iterates on
`deckforge build --json` until the deck is clean and measures every slide at 1280×720 in the app's browser canvas
(overflow, clipped text, overlays covering text). Finally it hands the deck over to `deckforge edit`.
On request, it rebuilds the approved deck as editable PowerPoint.

```bash
deckforge skill install-copilot          # copies the skill to ~/.copilot/skills/deckforge
```

- The destination is `$COPILOT_HOME/skills` when `COPILOT_HOME` is set. `--dest <dir>` installs it elsewhere,
  for example a repository's `.github/skills`.
- Re-running the command updates the copy it installed. It refuses to overwrite a folder it did not create
  unless you add `--force`.
- The skill replaces the older `build-presentation` skill. The command warns when that skill is installed,
  and `--replace-build-presentation` removes it.
- Start a new Copilot session to load the skill.

The skill's contents are described in [skills/deckforge/README.md](skills/deckforge/README.md).

## Development

```bash
npm ci                  # behind a private mirror, keep the lockfile URLs as generated
npm run build           # esbuild → dist/deckforge.{viewer,editor}.{js,css}
npm test                # vitest unit tests (core, server, agent with a mocked SDK, CLI)
npm run test:e2e        # Playwright (Chromium + WebKit): viewer a11y/print/no-JS, editor flows, agent (mocked SDK)
npm run lint
npm run dev             # rebuild on change + `deckforge edit` on a scratch copy of the example (port 4370)
```

Editor previews are written into same-origin `about:blank` iframes with `document.write`. They do not use
`srcdoc` or `blob:` URLs, which some WebKit hosts (for example Tauri WKWebView) never load. An e2e test
disables `srcdoc` to guard this.

`dist/` and `examples/starter/deck.html` are committed, because the CDN serves them from Git tags.
CI checks that they are up to date. The e2e tests mock the Copilot SDK with
`test/fixtures/mock-sdk.js` (`DECKFORGE_AGENT_MOCK`).

## Limitations

- PowerPoint export is out of scope. Use your existing HTML→PPTX workflow on `deck.html`.
- The editor does not preserve YAML comments in `deck.yaml`.
- The "overlay covers template text" check needs a laid-out page, so the editor reports it but
  `deckforge build` does not. The build checks bounds, alt texts and missing files.
- Images are not resized or compressed. Unused files in `assets/` are reported, never deleted.
- Fonts are not bundled. The `build` theme falls back to system fonts when its fonts are not installed.

## License

[MIT](LICENSE)
