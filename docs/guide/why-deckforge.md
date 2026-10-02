# Why deckforge

Viewers with speaker notes, presenter windows and themes are well covered by mature tools such as
[reveal.js](https://revealjs.com/), [Slidev](https://sli.dev/), [Marp](https://marp.app/) and
[Quarto](https://quarto.org/docs/presentations/). Hosted services such as [Gamma](https://gamma.app/),
[Beautiful.ai](https://www.beautiful.ai/) and Microsoft 365 Copilot in PowerPoint generate decks with AI.

deckforge is built around a different idea: **an AI agent edits typed slides through validated tools, and you can review and
undo every turn.** This page compares the approaches with facts from each project's own documentation, so you can pick
the right tool.

## What deckforge does differently

- **Typed slots, not free text.** Each slide picks a template and fills its typed slots in `deck.yaml`. The agent writes
  slot values (`cards.0.title`), not Markdown or HTML, and the text is checked against each slot's limits.
- **A restricted assistant in the editor.** The Copilot drawer can only call the [deck tools](./agent-model#tool-catalogue).
  It has no shell, file or web access, and it can only place images that are already in `assets/`.
- **Scoped, reversible turns.** Limit a request to one slide or open the whole deck. Each turn is one undo step, and the
  drawer lists the slides and slots it touched. The [agent log](./agent-model#change-summary-and-agent-log) records every
  tool call.
- **On the Copilot you already have.** The assistant runs on your GitHub Copilot sign-in through the Copilot SDK:
  no new account and no API key. It needs a GitHub Copilot subscription.
- **The same tools for other agents.** [`deckforge mcp`](../reference/cli#mcp) gives Copilot CLI, the Copilot app or any MCP
  client the same typed tools, and their changes appear live in the editor.
- **Measured, not eyeballed.** The [Copilot skill](./copilot-skill) measures every slide at 1280×720 for overflow,
  clipped text and overlays that cover text. See the [example deck](./copilot-skill#example) and its validation report.

## Comparison

| | Source | AI and agents | Runs | PowerPoint export |
|---|---|---|---|---|
| **deckforge** | `deck.yaml`: templates with typed slots | Embedded Copilot assistant limited to typed deck tools; MCP server with the same tools | Locally, MIT license | Editable: native text boxes, shapes, pictures and notes |
| **Slidev** | Markdown with Vue components ([guide](https://sli.dev/guide/)) | Official MCP server whose tools update a slide's content, notes and frontmatter, plus agent skills ([MCP](https://sli.dev/features/mcp), [AI](https://sli.dev/guide/work-with-ai)) | Locally, [MIT](https://github.com/slidevjs/slidev/blob/main/LICENSE) | Images by default; `pptx-editable` rebuilds native shapes, with SVG and some effects kept as pictures ([exporting](https://sli.dev/guide/exporting)) |
| **Marp** | Markdown ([marp.app](https://marp.app/)) | No official AI integration documented | Locally, [MIT](https://github.com/marp-team/marp-cli/blob/main/LICENSE) | Pre-rendered images; experimental editable export needs LibreOffice Impress and drops presenter notes ([Marp CLI](https://github.com/marp-team/marp-cli#readme)) |
| **reveal.js** | HTML, or Markdown with a plugin ([Markdown](https://revealjs.com/markdown/)) | No official AI integration documented | Locally, [MIT](https://github.com/hakimel/reveal.js/blob/master/LICENSE) | None; PDF through the browser's print dialog ([PDF export](https://revealjs.com/pdf-export/)) |
| **Quarto** | Markdown (`.qmd`) ([presentations](https://quarto.org/docs/presentations/)) | No official AI integration documented | Locally, [open source](https://quarto.org/license.html) | Native PowerPoint output with speaker notes ([PowerPoint](https://quarto.org/docs/presentations/powerpoint.html)) |
| **Gamma** | Hosted Gamma documents | AI generation in the app; an API generates decks from text, with credit-based usage ([API](https://developers.gamma.app/get-started/understanding-the-api-options), [credits](https://help.gamma.app/en/articles/7834324-how-do-ai-credits-work-in-gamma)) | Hosted service with an account | PPTX, PDF and PNG from the API ([API generation](https://developers.gamma.app/generations/create-generation)) |
| **Beautiful.ai** | Hosted Beautiful.ai presentations | AI-powered content generation on paid plans ([pricing](https://www.beautiful.ai/pricing)) | Hosted service with an account | Editable PowerPoint and Google Slides on Pro, Team and Enterprise plans ([exporting](https://support.beautiful.ai/hc/en-us/articles/30629528652685-Exporting-your-slides-and-presentations)) |
| **Microsoft 365 Copilot in PowerPoint** | PowerPoint files | Copilot inside PowerPoint | Microsoft 365 apps; needs a Microsoft 365 Copilot license, an add-on to eligible plans ([licensing](https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-licensing)) | Native `.pptx` |

Sources were checked in October 2026. Features change quickly: follow the links for the current state, and
[open an issue](https://github.com/lrivallain/deckforge/issues) if a row is out of date.

## When to use deckforge

- You want an AI to do the editing, but every change must be typed, scoped, reviewable and reversible.
- You already have GitHub Copilot and don't want another AI account, API key or bill.
- You need consistent layouts across a team: templates with slot limits rather than free-form slides.
- You want a source that reads well in a diff (`deck.yaml`), one static HTML file to share, and an editable `.pptx` to hand
  off.

## When to use something else

- **Code-heavy talks, live demos or custom components.** Slidev's Markdown, Vue components and code features fit better.
- **Free-form slides.** If most slides need a one-off layout, Markdown frameworks or PowerPoint give you more freedom than
  templates do. deckforge overlays help for annotations, not for whole layouts.
- **Documents, notebooks and papers from one source.** Quarto renders the same Markdown to many formats.
- **No GitHub Copilot.** The deckforge assistant needs a Copilot subscription. The editor, viewer and export work without
  it, but the agent loop is the main reason to choose deckforge.
- **Your organization already lives in PowerPoint with Microsoft 365 Copilot.** Editing the `.pptx` there avoids a
  round-trip.
- **A design-first deck from a prompt, in the cloud.** Hosted generators such as Gamma and Beautiful.ai are built for that.
