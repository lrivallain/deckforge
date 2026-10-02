# Editor

```bash
deckforge edit my-talk
```

This command opens the editor in your browser. Every change saves `deck.yaml` and rebuilds `deck.html` right away.

![The editor: slide rail, preview and inspector](/screenshots/editor.png){.shot}

| Area | What you do there |
|---|---|
| **Slide rail** (left) | Select, drag to reorder, duplicate, hide or delete slides. Use **Add slide** to add one |
| **Preview** (centre) | Click any text to edit it in place. <kbd>Enter</kbd> commits, <kbd>Esc</kbd> reverts |
| **Inspector** (right) | The template, a form for every slot with character counters, speaker notes, footer and visibility |
| **Top bar** | Undo/redo, theme, **Templates**, **Deck** settings, **Present** and **Copilot** |

Drag the edge of the slide rail, the inspector or the Copilot panel to resize it. The editor remembers the widths. Double-click an edge to restore the default width.

## Images

Drop or paste a picture on the slide, or use the image control in the inspector.
PNG, JPEG, WebP, GIF and SVG files up to 10 MB are accepted.

- Click the thumbnail to set the **focal point**. It is the part that stays visible when the picture is cropped.
- **Fill** crops the picture to fill the frame. **Fit** shows the whole picture.
- The **alt text** field shows a warning while it is empty.

![Image control in the inspector](/screenshots/editor-image.png){.shot}

## Overlays

Use **Insert** to add an image, text, callout, arrow or shape on top of the template.

![A callout and an arrow, selected in the editor](/screenshots/editor-overlays.png){.shot}

- Drag to move. Use the 8 handles to resize (hold <kbd>Shift</kbd> to keep the proportions) and the round handle to rotate.
- Overlays snap to an 8 px grid, the template's elements and other overlays. Hold <kbd>Alt</kbd> to move freely.
- The inspector sets the exact position, the reveal step, and the theme colours. It can also align several overlays.
- deckforge warns when an overlay goes off the slide or covers the template's text.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| <kbd>⌘/Ctrl</kbd> <kbd>Z</kbd> · <kbd>⇧</kbd> <kbd>⌘/Ctrl</kbd> <kbd>Z</kbd> | Undo · redo |
| <kbd>⌘/Ctrl</kbd> <kbd>K</kbd> | Open Copilot |
| <kbd>Alt</kbd> <kbd>↑</kbd> / <kbd>↓</kbd> | Move the selected slide |
| <kbd>⌘/Ctrl</kbd> <kbd>D</kbd> | Duplicate the slide or overlay |
| <kbd>Delete</kbd> | Delete the slide or overlay |
| Arrow keys · <kbd>Shift</kbd> + arrows | Nudge an overlay by 1 px · 10 px |
| <kbd>⌘/Ctrl</kbd> <kbd>]</kbd> / <kbd>[</kbd> | Bring an overlay forward / send it backward |
| <kbd>←</kbd> / <kbd>→</kbd> on a focused panel edge (<kbd>Shift</kbd> for bigger steps) | Resize the panel |

## Reorder items

To reorder a card or list item, hover it on the slide and drag its grip. You can also drag a row in the inspector.
Each drop is one undo step.

::: tip Safe by default
The editor runs only on `127.0.0.1` and opens with a token that is new each time it starts.
Do not share the URL it prints. See the [security model](../reference/security).
:::
