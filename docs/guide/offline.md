# Share offline

For confidential content, share **one HTML file** that makes no network request: it opens from an email attachment,
a USB key or an archive, on a machine without network access, and keeps rendering for years.

```bash
deckforge build my-talk --runtime inline --check-offline --out ~/Desktop/review.html
deckforge build my-talk --runtime inline --check-offline --strip-notes --out ~/Desktop/review-shared.html
```

| Option | Effect |
|---|---|
| `--runtime inline` | Embeds the viewer, the theme, the templates' CSS and every image in the one file, behind a CSP that blocks the network |
| `--check-offline` | Fails with exit code 2 if the output would load anything over `http(s)` |
| `--strip-notes` | Leaves the speaker notes out, for a copy you hand over rather than present |

Set `runtime: inline` in `meta` to make it the default for the deck. The [technical starters](technical-decks) do.

## What the file contains

| Part | How it is stored |
|---|---|
| Slides | Static HTML: every slide is readable even with JavaScript off |
| Viewer | The deckforge viewer script and stylesheet, inline (about 20 KB) |
| Theme and templates | Inline CSS, only for the templates the deck uses |
| Images | Each `assets/…` image used by a slide, as a `data:` URI |
| Fonts | Locally installed fonts by name, or the theme's own font files as `data:` URIs (see below) |
| Speaker notes | Hidden `<aside>` elements, unless you build with `--strip-notes` |
| Sources | In the notes, and on the generated Sources slide (kept with `--strip-notes`) |

The file holds no tracking, no telemetry and no external link that loads by itself. Hyperlinks you put on slides
(`<a href>`) only open when someone clicks them.

`deckforge build` never fetches anything, and the [Copilot assistant](copilot) only uses the deck tools: no data
leaves your machine except through the Copilot service your organisation already approved.

## The Content-Security-Policy

With the `inline` runtime, `deck.html` always starts with this policy:

```text
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'
```

The browser then refuses any request the page could make, even one added to the file later by hand. Inline scripts and
styles are allowed because they are the deck itself. Hyperlinks still open when clicked: the policy blocks loading,
not navigation.

`deckforge build` warns about every remote resource the policy will block (`Blocked offline: <img src> loads https://…`),
so a deck never loses an image silently. `--check-offline` turns those warnings into errors. A deck that must load
something from the network has to use the `local` or `cdn` runtime. `deckforge edit` and `serve` replace the policy by
their own while they serve the deck, for live reload and the PowerPoint export.

## What `--check-offline` reports

It scans the built page for anything a browser would load: `src`, `srcset`, `<link href>`, CSS `url()` and `@import`.

| Reported | Fix |
|---|---|
| `<img src> loads https://…` | Copy the image into `assets/` (drop it in the editor) and point the slot at it |
| `<script src> loads https://cdn.jsdelivr.net/…` | Build with `--runtime inline` (or `local`) instead of `cdn` |
| `<style> loads https://…woff2` | A theme font on the web: download the licensed file into the deck folder (below) |

XML namespaces and ordinary hyperlinks are not resources and are not reported. With `--runtime local`, the check
also passes, but the deck is then a folder (`deck.html` + `deckforge/` + `assets/`), not one file.

## Fonts

The built-in themes name fonts that may be installed on the computer (`local()`), with fallbacks such as
Segoe UI or Arial. Nothing is downloaded: a computer without the font shows the fallback.

To get the same typography everywhere, embed the font. Put the licensed files in the deck folder and reference them
from a [deck theme](../reference/themes):

```yaml
fonts:
  heading:
    family: Brand Sans
    faces:
      - { weight: 700, url: fonts/brand-sans-700.woff2 }
```

With `--runtime inline`, each `url:` font file inside the deck folder (woff2, woff, ttf or otf, up to 5 MB) is
embedded as a `data:` URI. Check that the font's licence allows embedding in documents you distribute.

## Images

Images are `data:` URIs in the inline file. The editor refuses SVG files with scripts, event handlers or embedded
documents, and browsers never let an SVG shown as an image load anything. `https://` images are never downloaded by deckforge: an
inline build warns that its CSP blocks them, and `--check-offline` fails. Copy them into `assets/` first.

## Check it yourself

Open the file with the network off, or in a browser's developer tools with the **Network** panel open: apart from the
file itself and `data:` URIs, nothing is requested.
