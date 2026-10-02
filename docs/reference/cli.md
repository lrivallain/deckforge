# CLI

```text
deckforge <command> [options]
deckforge --help | --version
```

| Command | What it does |
|---|---|
| [`new`](#new) | Create a deck folder |
| [`build`](#build) | Render `deck.yaml` to `deck.html` and report issues |
| [`templates`](#templates) | List templates, slots, themes and icons |
| [`edit`](#edit) | Start the local editor |
| [`serve`](#serve) | Serve the deck read-only with live reload |
| [`mcp`](#mcp) | Give Copilot CLI and the Copilot app the deck tools (MCP server) |
| [`skill`](#skill) | Install the GitHub Copilot skill |

`<deck>` is a `deck.yaml` file or the folder that contains it.

## new

```bash
deckforge new <dir> [--title "My talk"] [--theme build] [--example [starter|aurora]] [--force]
```

Creates `<dir>/deck.yaml` with a title slide and builds it. `--example` copies a bundled example deck and its
assets instead (`starter` by default). `--force` overwrites an existing `deck.yaml`.

## build

```bash
deckforge build <deck> [--runtime local|cdn|inline] [--out deck.html] [--json]
```

Renders the deck and prints validation issues. It exits with code **2** when there are errors.

| Option | Effect |
|---|---|
| `--runtime` | How the page loads the viewer. See [runtime modes](../guide/presenting#runtime-modes). The default is `meta.runtime`, or `local` |
| `--out`, `-o` | Output file. The default is `deck.html` next to `deck.yaml` |
| `--json` | Prints a machine-readable report: `ok`, `outPath`, `issues`, `loadErrors`, `assets` |

It also lists assets that no slide uses. It never deletes them.

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
