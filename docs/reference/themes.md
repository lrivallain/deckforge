# Theme files

A theme is a YAML file that compiles to CSS custom properties (`--df-*`). Put it in
`<deck>/themes/<name>.yaml` or `~/.config/deckforge/themes/<name>.yaml`. The built-in themes are in
[`themes/`](https://github.com/lrivallain/deckforge/tree/master/themes), so copy one to start.

```yaml
name: my-theme
label: My theme
palette:            # required: bg paper line ink muted node primary primary-soft primary-line accent accent-soft accent-line
  bg: "#EDF1F7"     # optional: frame (boundary fill), dashed (dashed borders), ok, chrome (viewer surround; a colour or a quoted gradient),
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

## Palette

| Token | Required | Used for |
|---|---|---|
| `bg` | yes | Surround behind the slide |
| `paper` | yes | Slide background |
| `line` | yes | Hairlines and card borders |
| `ink` / `muted` | yes | Main and secondary text |
| `node` | yes | Card and node fill |
| `primary`, `primary-soft`, `primary-line` | yes | Main colour, its tint and its border |
| `accent`, `accent-soft`, `accent-line` | yes | Emphasis colour, its tint and its border |
| `frame` | no | Fill of boundary boxes |
| `dashed` | no | Dashed borders |
| `ok` | no | Positive state |
| `chrome` | no | Viewer surround: a colour or a quoted gradient |
| `accent-text`, `primary-text` | no | Darker shades for small text (4.5:1 contrast) |

## Fonts

`heading`, `body` and `mono` each take a `family`, a `fallback` stack and optional `faces`.
A face uses `local` names (no network) or a `url`, relative to `deck.html` or `https://`.

## Validation

deckforge checks every value. Anything that could break out of CSS is rejected. The built-in themes don't bundle fonts:
they use locally installed fonts with named fallbacks, so they make no network requests.
