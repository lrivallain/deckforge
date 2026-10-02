# Write a deck

`deck.yaml` is the source of truth. Each slide picks a **template** and fills its **slots**.
deckforge renders it to a static `deck.html`.

```yaml
meta:
  title: Shipping with confidence
  theme: build                 # see Themes
  footer: Platform team / Q3   # rich text in every slide footer
  brief:                       # gives Copilot context
    audience: Engineering managers
    goal: Agree on one release gate
slides:
  - id: gate                   # stable id: letters, digits, dashes
    template: statement        # see Templates
    data:
      kicker: The idea
      text: Every release passes <span class="accent">one gate</span>.
    notes: |
      Pause after the sentence.
```

Build it and check it:

```bash
deckforge build my-talk          # prints issues, exit code 2 on errors
deckforge templates my-talk      # every template, its slots and limits
```

## Rules of thumb

| Do | Why |
|---|---|
| One takeaway per slide | The templates have a `max` limit on every slot, and the editor counts characters |
| Use `<span class="accent">` for emphasis | Rich text accepts a short allow-list of tags and classes only |
| Write speaker notes in `notes` | They show in the notes panel and the presenter window |
| Keep `id` stable | Hash links (`#slide-gate`) and the editor rely on it |
| Never edit `deck.html` | It is rebuilt on every change |

## Images and overlays

- **Images** are files in `assets/` (the editor adds them) or `https://` URLs. Always set an `alt` text.
- **Overlays** are free elements (callouts, arrows, shapes, text, images) placed above the template, in % of the slide.

```yaml
  - id: photo
    template: image-text
    data:
      image: { src: assets/3f2a9c1b04de.jpg, alt: Review board, fit: cover, focus: 50% 30% }
      title: What reviewers see
    overlays:
      - { id: arrow-1, kind: arrow, x: 30, y: 20, w: 15, h: 6.67, rotate: 25, data: { color: accent } }
```

Every field is described in the [deck.yaml reference](../reference/deck-yaml).

::: info Comments are not kept
The editor rewrites `deck.yaml` on every change, so it drops YAML comments. Changes you make in a text editor are picked up live, and you can undo them.
:::
