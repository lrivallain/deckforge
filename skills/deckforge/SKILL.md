---
name: deckforge
description: >-
  Create, restyle or refine presentations with deckforge: themeable, template-driven
  HTML decks (white 16:9 slides, blue and amber accents, diagram-led layouts, staged
  reveals) written as deck.yaml, validated, then refined in the deckforge editor. It
  can also rebuild an approved deck as editable PowerPoint. Use for "create a
  presentation", "build a deck", "HTML presentation", "slides for my talk",
  "PowerPoint deck", "HTML to PowerPoint", "deck.yaml", "deckforge", "use my Build
  presentation style", "crée une présentation", "présentation HTML puis PowerPoint",
  /deckforge or /build-presentation. Reuse the style for any topic. An explicit
  customer template or a different style takes precedence. Not for websites, social
  video or one-page documents.
---

# deckforge presentations

deckforge turns a `deck.yaml` (the source of truth) into a static, accessible
`deck.html`. Its templates, themes and validator already implement this style. Work
through the CLI and the files. Never hand-edit `deck.html`.

Resolve every bundled path from **the directory containing this SKILL.md**.

## Procedure

1. **Tooling.** Run `deckforge --version`. If that fails, use `npx -y github:lrivallain/deckforge <command>`,
   which needs Node.js 20.19+ or 22.12+. Install only with the user's approval
   ([authoring.md §1](references/authoring.md#1-tooling)).
2. **Brief and evidence.** Topic, audience, goal, duration, language, approved sources and
   output (`html`, `pptx` or both). Ask only for decisions that change the result
   ([workflow.md §1](references/workflow.md#1-brief-and-evidence)).
3. **Storyline plan.** `slide | takeaway | template | evidence | speaker note`. Get the user's approval for
   a new storyline ([workflow.md §2](references/workflow.md#2-storyline-plan)). Follow
   [design-system.md](references/design-system.md).
4. **Author.** Run `deckforge new <dir> --title "…"`, then `deckforge templates <dir> --json` to read the
   **live** catalogue (slots, `max`, required slots, deck-local and user templates, themes, icons).
   Write `deck.yaml` with `meta.brief` and speaker notes ([authoring.md](references/authoring.md)).
5. **Validate.** Run `deckforge build <dir> --json`. Fix every `error` and `warning` and rebuild until
   `ok` is true and no issues are left that you cannot explain. `info` lines (unused assets) are advisory.
6. **Inspect.** Serve the deck and measure it at 1280×720 with
   [scripts/layout-check.js](scripts/layout-check.js). Look at every slide
   ([workflow.md §5](references/workflow.md#5-inspect-the-rendered-deck)). Fix, rebuild, re-check.
7. **Hand off.** Report the `deck.html` path and how to present it. Offer `deckforge edit <dir>` for
   hands-on refinement with the in-editor Copilot ([workflow.md §6](references/workflow.md#6-hand-off)).
8. **PowerPoint**, when asked. After the user approves the HTML, run `deckforge export <dir> --json`
   and check the result ([html-to-pptx.md](references/html-to-pptx.md)). Rebuild by hand only what it cannot do.

## Rules

- Never invent facts, metrics, dates, customer names, quotes or availability ("GA", "live today").
  If the brief and sources do not support a claim, ask, or flag it in the notes.
- Respect each slot's `max`. When copy does not fit, shorten it, split the slide or move the detail to `notes`.
  Never shrink the type, and never fake a layout with overlays.
- Use only images the user provided or approved, copied into `<dir>/assets/`, each with a specific alt text.
  No image is better than an unapproved one.
- Keep private paths, mailbox links, account context and credentials out of slides and footers.
- `deckforge edit` and `serve` bind to 127.0.0.1. The `edit` URL carries a per-run token, so never share it.
  Stop any server you started once the work is done.
- When the `deckforge-*` MCP tools are available (`deckforge mcp`, e.g. a conversation continued from the editor),
  edit that deck through them, starting with `get_authoring_guide` and `get_deck`. Do not write its `deck.yaml` directly:
  the tools validate each change and keep an open editor in sync. In a resumed session they may be deferred: search the
  tools for `deckforge` before concluding they are missing.
- Do not install software, publish, upload, commit or send the deck without explicit approval.
  A local artifact does not authorize publication.
- If PowerPoint tooling is unavailable, say so. Do not pass off HTML, PDF or slide images as editable PowerPoint.
