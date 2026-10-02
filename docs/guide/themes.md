---
themes:
  - { src: /screenshots/themes/build.png, title: Build, name: build, caption: "White slides, azure and amber, diagram-friendly. The default." }
  - { src: /screenshots/themes/atelier.png, title: Atelier, name: atelier, caption: "Warm ivory, teal and rose, editorial serif headings." }
  - { src: /screenshots/themes/aurora.png, title: Aurora, name: aurora, caption: "Dark and modern: violet and mint, oversized headings." }
  - { src: /screenshots/themes/azure.png, title: Azure, name: azure, caption: "Azure brand: Azure blue, AI purple, Segoe UI." }
metrics:
  - { src: /screenshots/themes/build-metric.png, title: Build }
  - { src: /screenshots/themes/atelier-metric.png, title: Atelier }
  - { src: /screenshots/themes/aurora-metric.png, title: Aurora }
  - { src: /screenshots/themes/azure-metric.png, title: Azure }
---

# Themes

A theme sets the colours, fonts, corner radii, spacing and motion. Every template works with every theme.
Change the theme without touching the content:

```yaml
meta:
  theme: aurora
```

You can also use the theme menu in the editor's top bar.

## Built-in themes

<Gallery :items="$frontmatter.themes" />

The same slide in each theme:

<Gallery :items="$frontmatter.metrics" />

::: tip Fonts are never downloaded
The themes use fonts installed on your computer, with named fallbacks, so a deck makes no network requests.
To get the exact look of the `build` theme, install Bricolage Grotesque, Instrument Sans and IBM Plex Mono.
:::

## Theme editor

Click **Themes** in the editor's top bar to create or change a theme without writing YAML.

![The theme editor with a palette proposed by Copilot](/screenshots/theme-editor.png){.shot}

- Pick a theme in the list to start from it, or click **New** to start from the deck's theme. Built-in themes are
  read-only, so saving one creates a copy named `<name>-custom`. Keep the built-in name to override it.
- **Colours** has a colour picker and a text field for every palette token. Clear an optional token to use its
  default, for example `accent-text` follows `accent`. **Typography** sets the font family and fallback for headings,
  body text and labels. **Shape & motion** sets the corner radii, spacing, motion and shadow. **YAML** shows the whole
  file, including font faces. Every tab edits the same file, and comments are kept.
- **Ask Copilot for a palette**: describe the look you want and click **Generate**. Copilot fills in the colours for
  you to review. See [Generate a palette](./copilot#generate-a-palette).
- The preview shows three sample slides with the theme. **Validation** lists invalid values and text colours below
  4.5:1 contrast on the paper, node and soft tints.
- **Save to** writes `<deck>/themes/<name>.yaml` (this deck) or `~/.config/deckforge/themes/<name>.yaml` (all your
  decks). Then click **Use in this deck** to switch the deck to it. A deck theme takes precedence over a user theme with the same name.

## Your own theme

You can also write the file by hand. Copy a built-in theme into `<deck>/themes/<name>.yaml` or
`~/.config/deckforge/themes/<name>.yaml`, then rename it and change its palette:

```yaml
name: my-theme
label: My theme
palette:
  primary: "#0F6CBD"
  accent: "#C2620A"
  # …
```

deckforge checks every value. Anything that could break out of CSS is rejected.
The [theme file reference](../reference/themes) lists every token.
