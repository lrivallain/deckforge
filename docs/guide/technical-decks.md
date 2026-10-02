# Technical decks

Architecture reviews, incident postmortems, migration or cost assessments and decision records share the same constraints:

- **The content is confidential.** It must not leave your machine: no upload to a hosted tool.
- **One file to share.** A single HTML file that opens anywhere, offline, and still renders in five years.
- **Changes are reviewed.** Text diffs in git, pull requests and CI checks.
- **The numbers must be right.** Charts and tables match their source data exactly.

deckforge covers all four: `deck.yaml` lives in your repository, charts are computed from the figures when the deck
is built, and `--runtime inline --check-offline` proves the output loads nothing from the network.

## Start from a starter deck

```bash
deckforge new incident-review --example postmortem
deckforge edit incident-review
```

| Starter | Storyline | Live demo |
|---|---|---|
| `architecture-review` | Key figures → request flow → latency budget → options → decision → risks → points to confirm | [Open](/demo/architecture-review.html){target="_blank"} |
| `postmortem` | Impact → timeline → blast radius → root cause → follow-up actions | [Open](/demo/postmortem.html){target="_blank"} |
| `assessment` | Scope funnel → current cost → cost by workload → current vs target → risks → plan → decisions | [Open](/demo/assessment.html){target="_blank"} |
| `decision-record` | Context → options matrix → cost comparison → decision (ADR) → the ask | [Open](/demo/decision-record.html){target="_blank"} |

Every figure in the starters is illustrative: replace them with yours, and keep each slide's `sources:` up to date.
The starters use the `inline` runtime, so `deck.html` is one self-contained file from the start.

## Charts from the figures

The [data templates](templates#charts-and-data) take plain numbers. Bar lengths, donut segments and table totals
are computed when the deck is built, so a figure you edit can't leave a chart out of sync:

```yaml
- id: latency
  template: bars
  data:
    title: The inventory lock <span class="amber">takes half the budget</span>
    unit: ms
    items:
      - { label: Inventory lock, value: 210, projected: 160, focus: true }
      - { label: Pricing, value: 85, projected: 40 }
      - { label: Gateway, value: 60 }
    projectedLabel: Added at 2.1× traffic
    source: "Source: load test LT-48"
```

| Template | Use it for |
|---|---|
| `bars` | Up to 8 horizontal bars, or columns with `vertical: true`. An optional `projected` amount is stacked and hatched |
| `donut` | Share of a whole, with the total in the centre |
| `compare-bars` | Current vs target: two stacked bars on the same scale |
| `kpis` | Three or four key figures with a `good`, `warn` or `focus` tone |
| `table` | Up to 8 rows and 4 numeric columns, right-aligned, with a computed total row |

Each chart also gets an `aria-label` and a screen-reader table generated from the same data.
In the editor, number fields are edited in the inspector and the chart follows as you type.

## Technical storytelling

| Template | Use it for |
|---|---|
| `timeline` | Incident or migration phases: up to 7 dated events |
| `options-matrix` | Options × criteria → recommendation |
| `risk-register` | Risk, impact, likelihood, owner, mitigation |
| `decision` | An ADR: context → decision → consequences |
| `funnel` | Inventory → exclusions → scope |
| `checklist` | Points to confirm, with owners and due dates |

See them all in [Templates](templates#technical).

## Sources and traceability

Add `sources:` to any slide. The sources are listed in its speaker notes and, at the end of the deck, on a generated
**Sources** slide that names the slide each one supports:

```yaml
- id: spend
  template: donut
  sources:
    - Finance cost centre 4410, FY2026
    - { label: Cloud pricing calculator, href: "https://example.com/pricing" }
```

See [deck.yaml › Sources](../reference/deck-yaml#sources).

## Share it, review it

- [Share offline](offline): one file, no network, no speaker notes if you want.
- [Decks in git and CI](git-ci): the repository layout, a GitHub Actions workflow and `deckforge diff` for reviews.
- [Export to PowerPoint](presenting#export-to-powerpoint) when someone needs a `.pptx`: bars become native shapes, donuts and hatching vector pictures.
