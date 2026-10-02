# Copilot skill

deckforge includes a skill for GitHub Copilot (the Copilot CLI and the GitHub Copilot app). With it, Copilot builds
a deck from a short brief:

1. It **plans** a storyline from your topic, audience, goal and duration.
2. It **writes** `deck.yaml` using the live template catalogue (`deckforge templates --json`).
3. It **checks** the deck with `deckforge build --json` and fixes issues until the build is clean.
4. It **measures** every slide at 1280×720 to find text that overflows or is clipped, and overlays that cover text.
5. It **opens** the deck in `deckforge edit` so you can review it.

If you ask, it can also rebuild the approved deck as an editable PowerPoint file.

## Install

```bash
deckforge skill install-copilot
```

| Option | Effect |
|---|---|
| *(none)* | Installs to `$COPILOT_HOME/skills/deckforge`, or `~/.copilot/skills/deckforge` if `COPILOT_HOME` is not set |
| `--dest <dir>` | Installs to another skills folder, for example `<repo>/.github/skills` |
| `--force` | Replaces a folder that the command did not create |
| `--replace-build-presentation` | Also removes the older `build-presentation` skill |

Run the command again to update the skill. Then start a new Copilot session and run `/skills` to check that the skill is loaded.

## Example prompts

- *"Create a 20-minute deck for engineering managers on release safety; the goal is to agree on one release gate."*
- *"Restyle these notes into a deckforge deck, in French, with the `build` theme."*
- *"Add a lifecycle slide after the concept map and check the layout."*
- *"Turn the approved deck into an editable PowerPoint."*

The skill's files are listed in [skills/deckforge](https://github.com/lrivallain/deckforge/tree/master/skills/deckforge).

## With the deck tools

The skill writes `deck.yaml` with the CLI. When a session also has the [`deckforge mcp`](../reference/cli#mcp) tools,
for example a conversation [continued from the editor](./copilot#continue-in-copilot-cli), Copilot edits that deck
through the tools instead. An open editor then shows each change as it happens.
