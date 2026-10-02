---
essentials:
  - { src: /screenshots/templates/cover.png, title: "Cover", name: cover, caption: "Kicker, oversized headline, byline." }
  - { src: /screenshots/templates/agenda.png, title: "Agenda", name: agenda, caption: "Up to six numbered chapters." }
  - { src: /screenshots/templates/statement.png, title: "Statement", name: statement, caption: "One sentence, set very large." }
  - { src: /screenshots/templates/points.png, title: "Points", name: points, caption: "Up to four numbered rows." }
  - { src: /screenshots/templates/split.png, title: "Split", name: split, caption: "Two plain columns: before/after." }
  - { src: /screenshots/templates/metric.png, title: "Metrics", name: metric, caption: "Up to three big numbers." }
  - { src: /screenshots/templates/visual.png, title: "Visual", name: visual, caption: "Full-bleed picture, one line." }
  - { src: /screenshots/templates/closing.png, title: "Closing", name: closing, caption: "Thanks, next step and a link." }
structure:
  - { src: /screenshots/templates/title.png, title: "Title", name: title, caption: "Eyebrow, two-part headline, promise." }
  - { src: /screenshots/templates/section.png, title: "Section", name: section, caption: "Chapter number and title." }
  - { src: /screenshots/templates/resources.png, title: "Resources & next step", name: resources, caption: "Resource groups and one action." }
diagram:
  - { src: /screenshots/templates/concept-map.png, title: "Concept map", name: concept-map, caption: "Audiences, a shared boundary, capabilities." }
  - { src: /screenshots/templates/implementation-map.png, title: "Implementation map", name: implementation-map, caption: "Same geometry, concrete components." }
  - { src: /screenshots/templates/lifecycle.png, title: "Lifecycle", name: lifecycle, caption: "Three stages with owners." }
  - { src: /screenshots/templates/zoom.png, title: "Problem → response", name: zoom, caption: "One problem, up to four responses." }
content:
  - { src: /screenshots/templates/bullets.png, title: "Key points", name: bullets, caption: "Up to five points and a takeaway." }
  - { src: /screenshots/templates/two-column.png, title: "Two columns", name: two-column, caption: "Compare two options side by side." }
  - { src: /screenshots/templates/quote.png, title: "Quote", name: quote, caption: "One quotation with attribution." }
media:
  - { src: /screenshots/templates/image.png, title: "Image", name: image, caption: "One picture with a caption or panel." }
  - { src: /screenshots/templates/image-text.png, title: "Image and text", name: image-text, caption: "Picture next to headline and points." }
---

# Templates

A template is a slide layout with typed **slots**. You fill the slots, and the template handles the layout.
Each thumbnail below shows the template's sample content with the `build` theme.

List them, with every slot and limit, from the command line:

```bash
deckforge templates my-talk          # add --json for tools and scripts
```

## Essentials

Simple slides with one point each, large type and no diagrams. They work best with the `aurora` theme.

<Gallery :items="$frontmatter.essentials" />

## Structure

<Gallery :items="$frontmatter.structure" />

## Diagrams

Use these slides to explain a system. A concept map and an implementation map share the same layout,
so you can show the idea first and then the real components.

<Gallery :items="$frontmatter.diagram" />

## Content

<Gallery :items="$frontmatter.content" />

## Media

<Gallery :items="$frontmatter.media" />

## Pick or change a template in the editor

**Add slide** opens the picker with live previews in the current theme. **Change** in the inspector
switches the template of the current slide. Slot values that the new template doesn't use are kept,
and they come back if you switch again.

![The template picker](/screenshots/picker.png){.shot}

## Make your own

Use the **Templates** button in the editor, or add a `.html` file to `<deck>/templates/`.
You can edit the front-matter, HTML and CSS with a live preview. Validation flags unknown slots and
content that overflows the 1280×720 slide.

![The template editor](/screenshots/template-editor.png){.shot}

The format is described in the [template file reference](../reference/templates).
