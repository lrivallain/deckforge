# Design system

deckforge's built-in `build` theme and templates implement this style. Use these rules to choose
templates, write copy and judge the rendered result. They also apply when you write a deck-local
template or theme, or rebuild the deck in PowerPoint.

The visual reference is the published eight-slide *Agentic Platform* deck
(<https://ozgurkarahan.com/agentic-platform/>). It supplies composition only. Its product names,
status badges, metrics and dates are not current evidence. Do not copy "GA", "live today",
customer names or event footers from it.

## Palette (`build` theme)

| Theme token (`--df-*`) | Hex | Role |
|---|---|---|
| `paper` | `#FFFFFF` | Slide surface |
| `bg` | `#EDF1F7` | Surround outside the slide |
| `ink` | `#16202F` | Main text |
| `muted` | `#53617A` | Secondary text (readable on tinted surfaces) |
| `line` | `#E2E8F2` | Decorative separators, never a meaningful boundary on their own |
| `node` | `#F7F9FC` | Neutral cards |
| `primary` | `#0F6CBD` | Main emphasis, diagram icons, current step |
| `primary-soft` / `primary-line` | `#EAF3FC` / `#BBD7F0` | Focus/response card fill and border |
| `accent` | `#C2620A` | Contrast, chosen distinction, governance label |
| `accent-text` | `#A8550A` | Amber for small text (4.5:1 on white) |
| `accent-soft` / `accent-line` | `#FFF4E4` / `#F0C078` | Highlight/governance fill and frame |
| `frame` | `#FFFCF5` | Shared frame fill |
| `dashed` | `#53617A` | Meaningful dashed boundaries (with a label) |
| `ok` | `#1F9D6B` | Small factual status marker, always with text |

Blue is the main accent, not the background. Amber explains a distinction; it does not decorate
every card. A status, boundary or availability is never shown by colour alone.

## Typography and density

| Role | Family | At 1280 px |
|---|---|---|
| Headline | Bricolage Grotesque 800, `-.02em` | 40–48 px (`h1` is 3.4cqw ≈ 44 px) |
| Card or stage title | Bricolage Grotesque 600 | 24–28 px |
| Body | Instrument Sans 400/600, line height 1.35–1.5 | 22–24 px |
| Eyebrow or step | IBM Plex Mono, uppercase, `.13em` tracking | 16–18 px |
| Footer or source | IBM Plex Mono | 14–16 px, never essential argument |

The fallbacks are Trebuchet MS/Segoe UI (headings), Segoe UI/Arial (body) and Consolas (mono).
They keep decks usable offline but are not exact-font fidelity. Mention the substitution when it matters.

Density:
- A headline wraps at most twice.
- A card has a title and one short sentence.
- At most four response cards on a projected slide.
- When copy does not fit, shorten it, split the slide or move it to notes. Never shrink the type,
  and never reuse the source deck's tiny labels for essential content.

## Canvas and geometry

- 16:9, authored and measured at **1280 × 720 CSS px**. Slides use container units (`cqw`):
  1cqw = 12.8 px at the reference width.
- Slide padding `3cqw 4cqw 2cqw` (38.4 / 51.2 / 25.6 px). Gaps of 1.1–1.6cqw.
- Cards have 10–12 px radii and shared frames about 14 px. Borders are 1–1.6 px. No heavy shadow in every card.
- In a deck-local template, take sizes from `--df-*` tokens and `cqw`, never from the browser width.

## Diagram grammar

| Motif | Meaning |
|---|---|
| Rounded neutral card | Actor, stage or capability |
| Blue-tinted card | Current focus or concrete response |
| Amber frame with a label | Shared policy, constraint, governance or chosen contrast |
| Dashed labelled container | Execution or responsibility boundary |
| Short pill | Status, category or lifecycle step, always with text |
| Connector or arrow | A real direction, dependency or handoff |
| Outcome bar (takeaway) | One consequence or next step, not another paragraph |

Icons are thin outline glyphs (the built-in `icon` names). They are decorative unless the
diagram has its own text description. Connectors must not cross labels. Where a boundary matters,
its label and contents sit inside it.

## Layout recipes → templates

- **A. Shift + concept map** (`concept-map`): eyebrow and a "From … / To …" headline. The old state is muted
  (never shown only by a strike-through). Then the audience row, a labelled boundary with two lanes,
  the capability row and one takeaway. Concepts before product names.
- **B. Same map, real implementation** (`implementation-map`): the same positions, counts and reading order as A,
  with verified component names. Change the labels, not the geometry, so the audience recognises the structure instantly.
- **C. Lifecycle with responsibility** (`lifecycle`): three main stages, numbered labels, connectors and an owner per stage.
  The complex or focused stage gets more width (`focus`). Add a feedback path only where the system really has one.
- **D. Focused lifecycle overview** (`lifecycle` with `focus` on one or two stages): the other stages stay legible but quieter.
  No "new", "GA" or "solved" without evidence and an as-of date.
- **E. Problem → response → outcome** (`zoom`): a compact stepper, a small problem card, a bridge, at most four responses
  (one highlighted) and a wide outcome bar.
- **F. Capability boundary** (deck-local template, or a `concept-map` variant): one dashed, labelled container with small
  capability cards inside. One amber exception card is enough. Placement must not imply included services, guarantees or pricing.
- **G. Resources and decision** (`resources`): two or three groups with real, descriptive links and one final action.

## Motion and static state

Reveals follow the speaker's explanation: eyebrow and headline, then the main diagram or problem,
then supporting cards in order, then the frame or outcome. deckforge staggers `class="reveal"` elements
in reading order. Entrances last 400–800 ms, with 150–300 ms between neighbours.
Overlays reveal after the template, or at their `order` step.

No word-by-word animation, auto-advance, continuous drift or infinite pulses. Every essential label exists in
the static DOM, in static mode (`S`), with reduced motion, in print and without JavaScript. A finished
screenshot is not proof that playback works.

## Accessibility

- Contrast: body text 4.5:1. Use `accent-text` for small amber text. Meaningful boundaries get a darker stroke and a label.
- Every image has a specific alt text. Decorative overlays (arrows, shapes) are already `aria-hidden`.
- Charts in deck-local templates use `role="img"`, an `aria-label` and an `sr-only` data table.
- Links are real and descriptive. Never use "click here" or links that cannot be clicked.

## Review expectations

A final deck keeps this grammar, but it is simpler than the reference wherever readability needs it.
Inspect the rendered output (workflow.md §5): a valid build is not evidence of visual quality.
Source-backed wording and privacy are separate requirements, and both must hold.
