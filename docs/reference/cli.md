# CLI

```text
deckforge <command> [options]
deckforge --help | --version
```

| Command | What it does |
|---|---|
| [`new`](#new) | Create a deck folder |
| [`build`](#build) | Render `deck.yaml` to `deck.html` and report issues |
| [`diff`](#diff) | Summarise the changes between two decks, slide by slide |
| [`export`](#export) | Export the deck to an editable PowerPoint file |
| [`templates`](#templates) | List templates, slots, themes and icons |
| [`edit`](#edit) | Start the local editor |
| [`serve`](#serve) | Serve the deck read-only with live reload |
| [`mcp`](#mcp) | Give Copilot CLI and the Copilot app the deck tools (MCP server) |
| [`skill`](#skill) | Install the GitHub Copilot skill |

`<deck>` is a `deck.yaml` file or the folder that contains it.

## new

```bash
deckforge new <dir> [--title "My talk"] [--theme build] [--example [<name>]] [--force]
```

Creates `<dir>/deck.yaml` with a title slide and builds it. `--example` copies a bundled example deck and its
assets instead (`starter` by default). `--force` overwrites an existing `deck.yaml`.

| Example | What it is |
|---|---|
| `starter` | The diagram-led specimen: concept map, implementation map, lifecycle, zoom |
| `aurora` | The Essentials templates on the dark `aurora` theme |
| `architecture-review` | An architecture or design review: key figures, flow, latency chart, options, ADR, risks, checklist |
| `postmortem` | An incident postmortem: impact, timeline, blast radius, root cause, follow-up actions |
| `assessment` | A migration or cost assessment: scope funnel, cost split, cost table, current vs target, risks, plan |
| `decision-record` | A decision record: context, options matrix, cost comparison, ADR, the ask |

The four technical starters use the `inline` runtime and the [chart templates](../guide/templates#charts-and-data).
See [Technical decks](../guide/technical-decks).

## build

```bash
deckforge build <deck> [--runtime local|cdn|inline] [--out deck.html] [--check-offline] [--strip-notes] [--json]
```

Renders the deck and prints validation issues. It exits with code **2** when there are errors.

| Option | Effect |
|---|---|
| `--runtime` | How the page loads the viewer. See [runtime modes](../guide/presenting#runtime-modes). The default is `meta.runtime`, or `local` |
| `--out`, `-o` | Output file. The default is `deck.html` next to `deck.yaml` |
| `--check-offline` | Fails (exit code 2) when the output would load anything over `http(s)`: `https://` images, remote fonts, the `cdn` runtime. With `--runtime inline`, the page also gets a Content-Security-Policy that blocks the network. See [Share offline](../guide/offline) |
| `--strip-notes` | Leaves the speaker notes out of the output, for a copy to share |
| `--json` | Prints a machine-readable report: `ok`, `outPath`, `issues`, `loadErrors`, `assets`, and `offline {ok, external}` with `--check-offline` |

It also lists assets that no slide uses. It never deletes them.

## diff

```bash
deckforge diff <a.yaml|dir|-> <b.yaml|dir> [--json]
```

Prints one line per slide that was added (`+`), removed (`-`), moved (`↕`) or changed (`~`), with the fields and
slots that changed, then the changed `meta` keys. `-` reads the first deck from standard input:

```bash
git show origin/main:talk/deck.yaml | deckforge diff - talk
```

```text
deckforge diff stdin → talk/deck.yaml
  meta: title
~ latency [bars]: items (5 → 6 items)
+ risks [risk-register] added at 7
  1 added, 0 removed, 1 changed, 0 moved, 8 unchanged
```

`--json` prints `meta`, `slides[]` (`id`, `template`, `status`, `from`, `to`, `changes`) and `summary`. It always
exits with code 0 when both decks parse. See [Decks in git and CI](../guide/git-ci).

## export

```bash
deckforge export <deck> [--out deck.pptx] [--json]
```

Exports the visible slides to an editable PowerPoint file, `deck.pptx` next to `deck.yaml` by default.
Text, cards, lines and images become native PowerPoint objects; icons and gradients become vector pictures.
Speaker notes and links are kept. See [Export to PowerPoint](../guide/presenting#export-to-powerpoint).

The command lays the deck out in a headless Chromium browser through [Playwright](https://playwright.dev),
an optional dependency. If it is missing, install it once:

```bash
npm install -g playwright && npx playwright install chromium
```

It also uses an installed Google Chrome or Microsoft Edge when Playwright's own Chromium is absent.
Like `build`, it exits with code **2**, and writes nothing, when the deck has errors.

| Option | Effect |
|---|---|
| `--out`, `-o` | Output file. The default is `deck.pptx` next to `deck.yaml` |
| `--json` | Prints a machine-readable report: `ok`, `outPath`, `slides`, `warnings`, `issues`, `loadErrors` |

## templates

```bash
deckforge templates [<deck>] [--json]
```

Lists the templates (built-in, user and deck-local) with their slots and limits, plus the themes and icon names.

## edit

```bash
deckforge edit <deck> [--port 0] [--token <t>] [--runtime …] [--no-open]
```

Starts the [editor](../guide/editor) on `127.0.0.1` with a random port and a token that is new each time it starts. It then opens
`http://127.0.0.1:<port>/?token=…`. `--port` and `--token` set fixed values; write a token that starts with `-` as `--token=<t>`. `--no-open` doesn't open the browser.

## serve

```bash
deckforge serve <deck> [--port 0] [--no-open]
```

Serves the built deck read-only. It rebuilds and reloads the page when the deck changes.

## mcp

```bash
deckforge mcp [<deck>]
deckforge mcp --install [--force] [--dest <mcp-config.json>]
```

Runs a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio with the deck tools of the
[Copilot assistant](../guide/copilot#what-it-can-and-cannot-do), plus `get_authoring_guide`. MCP clients start it
themselves. Without `<deck>`, each call uses the `deck.yaml` of the server's working directory. Copilot starts
servers in the session's folder. Outside a deck folder the server still starts, but its tools explain that there is no deck.

When `deckforge edit` is running for the same deck, every call goes through the editor: changes appear live and can
be undone there. Otherwise the server edits `deck.yaml` and rebuilds `deck.html` itself. stdout carries only the protocol,
and logs go to stderr.

`--install` registers the argument-less server as `deckforge` in `$COPILOT_HOME/mcp-config.json`
(`~/.copilot/mcp-config.json` by default), which Copilot CLI and the Copilot app read for every session. It keeps
the other servers, uses the current Node.js and deckforge paths, and refuses to replace a `deckforge` entry it did not
write unless you pass `--force`. `--dest` writes another file. The editor's
[Continue in Copilot](../guide/copilot#continue-in-copilot-cli-or-the-copilot-app) dialog does the same with one click.

## skill

```bash
deckforge skill install-copilot [--dest <skills dir>] [--force] [--replace-build-presentation]
```

Installs the [Copilot skill](../guide/copilot-skill).

## Environment

| Variable | Effect |
|---|---|
| `DECKFORGE_CONFIG_DIR` | User folder for templates and themes. The default is `$XDG_CONFIG_HOME/deckforge` or `~/.config/deckforge` |
| `DECKFORGE_MODEL` | Model used by the Copilot assistant |
| `COPILOT_HOME` | Copilot folder: `skill install-copilot` and `mcp --install` write into it, and the editor checks its `session-state` before resuming a conversation |

## Lookup order

deckforge looks for templates and themes in this order, and the first match wins:

1. `<deck folder>/templates/` and `<deck folder>/themes/`
2. `~/.config/deckforge/templates/` and `~/.config/deckforge/themes/`
3. the built-in templates and themes
