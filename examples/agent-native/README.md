# Example: Agent-native decks

An 8-slide, 10-minute pitch of deckforge's agent model. GitHub Copilot wrote it from a brief, following the
[deckforge Copilot skill](../../skills/deckforge/SKILL.md). This folder keeps the evidence next to the deck:
the brief, the storyline plan, the commands that checked it, and the [validation report](validation.json).

- Source: [`deck.yaml`](deck.yaml). Built page: [`deck.html`](deck.html), also published as the
  [live demo](https://deckforge.vuptime.io/demo/agent-native.html).
- Start your own copy: `deckforge new my-talk --example agent-native`.

## 1. Brief

Recorded in `meta.brief`, which the editor's Copilot also uses to ground its edits:

| Field | Value |
|---|---|
| Topic | Why deckforge is built around an agent loop rather than a slide format |
| Audience | Developers and tech leads who already use Markdown slide tools or hosted AI generators |
| Goal | The audience understands the guarantees of the agent loop and tries one whole-deck request on their own deck |
| Duration | 10 minutes |
| Sources | [Agent model](https://deckforge.vuptime.io/guide/agent-model), [Why deckforge](https://deckforge.vuptime.io/guide/why-deckforge), [Security model](https://deckforge.vuptime.io/reference/security) |

Every factual statement comes from these pages or from the code they describe (`src/server/deck-tools.js`,
`src/server/agent.js`). The speaker notes cite the source and its as-of date. The deck has no market figures,
customer names or availability claims.

## 2. Storyline plan

| Slide | Takeaway | Template | Evidence | Speaker note |
|---|---|---|---|---|
| `shift` | AI edits you can audit, not files you must re-read | `title` | Agent model | Name the shift |
| `concept` | The agent works inside a boundary you can read | `concept-map` | Agent model, "The loop" | Roles, boundary, shared pieces, without component names |
| `implementation` | Same map, real components | `implementation-map` | `deck-tools.js`: 16 tools, 7 slide-scoped | Only the labels change |
| `turn` | You own the start and the end of every turn | `lifecycle` | Agent model: scope and undo | Trace the undo path |
| `never` | Guarantees live in code, not in the prompt | `bullets` | Agent model "never do", Security model | One check per point |
| `statement` | Every change is a typed tool call you can scope, read and undo | `statement` | Agent log | The line to repeat |
| `fit` | When deckforge fits, and when it doesn't | `split` | Why deckforge | Stay fair to other tools |
| `next` | One action: try one whole-deck change | `resources` | Real docs links | End on the action |

## 3. Validation

```bash
deckforge build examples/agent-native --json   # ok: true, no issues
node scripts/validate-example.js               # build report + layout check → validation.json
```

`validation.json` records both checks. The build validates every slot against its template, and
[`layout-check.js`](../../skills/deckforge/scripts/layout-check.js) measures all 8 slides at 1280×720 for elements
outside the slide, clipped text, overlays that cover text, and broken images. Both report no problems.
Copilot also looked at a screenshot of every slide. That review changed one thing: the lifecycle step labels no
longer repeat the stage titles.

The e2e suite runs the same layout check on this deck (`test/e2e/layout-check.spec.js`), so a template change that
breaks it fails CI.
