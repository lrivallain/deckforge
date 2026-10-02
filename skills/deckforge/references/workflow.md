# Workflow: from brief to approved deck

## 1. Brief and evidence

Resolve these before you write slides:

| Decision | Default when the user wants a quick start |
|---|---|
| Topic and goal (what the audience must understand or decide) | Ask. It cannot be assumed |
| Audience | Ask, or infer from the request and say so |
| Duration and slide count | About one slide per 2–3 minutes, plus title and resources |
| Language (`meta.lang`) | The user's language |
| Output | HTML (deckforge). PowerPoint only when asked, after the HTML is approved |
| Theme | `build` (white/blue/amber) unless the user picks another |
| Sources | Only what the user supplied or authorized |

Record the brief in `meta.brief`. The editor's Copilot uses it later.

Evidence:
- For every factual claim, record the source and an as-of date in the slide's `notes`.
- Check availability, licensing, pricing and roadmap claims against current first-party documentation.
- Keep private material (local paths, mailbox links, account details, credentials) out of slides, footers and links.
  Use synthetic examples for demonstrations.
- Do not retrieve workplace material when the task is only restyling existing content.

## 2. Storyline plan

Write the plan before filling slots:

```
slide | takeaway | template | evidence | speaker note
```

For a new, substantive storyline, review the plan critically and get the user's approval first.
Use an independent reviewer when the host provides one. For a restyle of existing content,
keep the user's order and wording, and map it onto templates.

The narrative menu, which is not a compulsory sequence:

1. **Shift**: a before/after headline that explains why the topic matters (`title` or `concept-map`).
2. **Concept map**: the system in audience language before product names (`concept-map`).
3. **Implementation map**: the same geometry with real components (`implementation-map`).
4. **Lifecycle**: the flow and who owns each step (`lifecycle`).
5. **Zoom**: problem → concrete response → observable outcome (`zoom`).
6. **Decision and resources**: one next step and a few real links (`resources`).

Use `section`, `bullets`, `two-column`, `quote`, `image` and `image-text` where they fit.
Do not force every topic into an architecture story. One focal diagram and one takeaway per slide.
Put the detail in notes or in hidden backup slides (`hidden: true`).

## 3. Author

1. `deckforge new <dir> --title "…"` (or edit the user's existing deck folder).
2. `deckforge templates <dir> --json`: choose templates from this live list and fill exactly their slots.
3. Write all of `deck.yaml` in one pass: meta, brief, then one slide per plan row, with notes.
   Give slides stable, meaningful `id`s (`shift`, `concept`, `gate`, `next-step`).
4. A `concept-map` / `implementation-map` pair keeps the same number of audiences, lanes and capabilities.
5. Alternate `image-text` sides (`imageRight`) on consecutive picture slides.

## 4. Validate

```bash
deckforge build <dir> --json
```

Loop until `ok` is `true` and every `warning` is fixed or explained (see [authoring.md §8](authoring.md#8-build)).
Validation proves the deck is well-formed, not that it looks right.

## 5. Inspect the rendered deck

Serve the built deck and look at it. In the GitHub Copilot app:

1. Start `deckforge serve <dir> --no-open` as a background command. Read the `Viewer:` URL it prints.
   Use `edit` instead when the user wants to tweak alongside you; its URL carries a token, so keep it private.
2. Open that URL in the **browser canvas** (`open_canvas` with canvasId `browser`, an `instanceId` such as `deck-preview`,
   and input `{ "url": "<viewer url>" }`). The canvas actions take that `instanceId` as their `page_id`. The canvas is
   WebKit on macOS, the engine the deck must work in anyway.
3. Run the layout check: read [../scripts/layout-check.js](../scripts/layout-check.js) and pass its whole content as the
   `script` of the canvas action `evaluate_javascript`. It returns `{ ok, checked, problems[] }`.
   Each problem lists elements `outside` the slide, `clipped` text, overlays `covering` template text,
   overlays `overlapping` the painted box around a text (a takeaway bar, a pill, a card), and `brokenImages`.
   Fix them all; an overlap is acceptable only for a deliberate annotation that keeps the text readable.
   Reload the page (`navigate_page` with `reload`) afterwards.
4. Look at each slide (`navigate_page` to `#slide-<id>`, then `screenshot_page` with selector `#slide-<id>`), or use
   Playwright screenshots when the canvas does not return the image to you. Look for awkward wraps, empty areas,
   unbalanced cards, wrong emphasis and unreadable contrast.
5. Without the canvas, use Playwright when available:
   `page.evaluate(\`(async () => { ${fs.readFileSync(".../layout-check.js", "utf8")} })()\`)` on `deck.html`.
   Otherwise, say that the visual check was not done. Never report it as passed.

Also check, at least once per deck:
- keyboard navigation and `#slide-<id>` deep links;
- the static/reduced-motion state (all content visible);
- print preview (one page per slide);
- that every link is real and descriptive.

Fix in `deck.yaml` (shorter copy, another template, a split slide), rebuild, re-check.
Stop the server once you are done, unless the user asked to keep it running.

## 6. Hand off

Deliver:
- the `deck.html` path and how to open it (double-click, or `deckforge serve <dir>`);
- for sharing as one file: `deckforge build <dir> --runtime inline --out <name>.html`;
- the refinement path: `deckforge edit <dir>` (inline editing, images, overlays, the Copilot drawer, undo);
- genuine limitations: unsupported claims flagged in the notes, font substitution, images still to approve.

Never commit, publish, upload, email or deploy the deck unless the user explicitly asks.

## 7. PowerPoint

Only after the user approves the HTML deck: follow [html-to-pptx.md](html-to-pptx.md).
If the user asks for PowerPoint only, still author in deckforge: it is the fastest way to a reviewed layout.
Then rebuild the result natively.
