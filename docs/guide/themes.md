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

## Your own theme

Copy a built-in theme into `<deck>/themes/<name>.yaml` or `~/.config/deckforge/themes/<name>.yaml`,
then rename it and change its palette:

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
