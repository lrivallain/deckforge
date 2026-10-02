# Present and share

`deck.html` is a static page. Open it in any browser, put it on a web server, or send it as one file.

![The viewer with the speaker notes panel](/screenshots/viewer-notes.png){.shot}

## Keyboard

| Key | Action |
|---|---|
| <kbd>→</kbd> <kbd>PageDown</kbd> <kbd>Space</kbd> | Next slide |
| <kbd>←</kbd> <kbd>PageUp</kbd> | Previous slide |
| <kbd>Home</kbd> / <kbd>End</kbd> | First / last slide |
| <kbd>N</kbd> | Speaker notes panel |
| <kbd>P</kbd> | Presenter window: notes, next slide, timer |
| <kbd>S</kbd> | Static mode (no animations) |
| <kbd>F</kbd> | Fullscreen |
| <kbd>E</kbd> | Back to the editor (only when `deckforge edit` serves the deck) |

- **Links to a slide:** `deck.html#3` or `deck.html#slide-<id>`.
- **Reduced motion:** if the system asks for reduced motion, slides appear in their final state.
- **No JavaScript:** every slide stays readable.

## Print or save as PDF

Print from the browser. You get one 13.333 × 7.5 in page per slide, without the controls.
For other paper sizes or margins, each slide is scaled down to fit. Images on slides you never opened are still printed.

## Runtime modes

The `--runtime` option sets how `deck.html` loads the viewer's script and stylesheet:

| Mode | Output | Network |
|---|---|---|
| `local` (default) | `deck.html` + `deckforge/` folder (+ `assets/`) | none |
| `inline` | One self-contained `deck.html`, images included | none |
| `cdn` | `deck.html` that loads the runtime from jsDelivr (tagged releases only) | jsDelivr |

```bash
deckforge build my-talk --runtime inline --out ~/Desktop/talk.html
```

::: tip Share one file
Use `inline` to send a deck by email or chat. It opens offline from any folder.
:::

## Preview while you write

```bash
deckforge serve my-talk
```

This command serves the deck read-only on `127.0.0.1`. It rebuilds and reloads the page whenever `deck.yaml` changes.
