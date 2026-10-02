# deckforge skill for GitHub Copilot

This skill teaches GitHub Copilot (the CLI and the GitHub Copilot app) to build presentations with deckforge:
- plan a storyline from a brief;
- write `deck.yaml` against the live template catalogue;
- validate it with `deckforge build --json`;
- measure the rendered slides at 1280 × 720 in the app's browser canvas;
- hand the deck over to the deckforge editor.

On request, it exports the approved deck as editable PowerPoint (`deckforge export`). It replaces the older `build-presentation` skill.

## Install

```bash
deckforge skill install-copilot                                 # → ~/.copilot/skills/deckforge
deckforge skill install-copilot --replace-build-presentation    # also removes ~/.copilot/skills/build-presentation
npx -y github:lrivallain/deckforge skill install-copilot        # without a global install
```

The skill goes into `$COPILOT_HOME/skills/deckforge` when `COPILOT_HOME` is set. Use `--dest <skills dir>` for any
other location, for example `<project>/.github/skills` for a single repository. Re-running the command updates a copy
it installed earlier. `--force` replaces a folder it did not install.

Start a new Copilot session afterwards and check that the skill is loaded with `/skills`.

## Contents

| File | Purpose |
|---|---|
| `SKILL.md` | Trigger description and the procedure |
| `references/workflow.md` | Brief → plan → author → validate → inspect → hand off |
| `references/authoring.md` | The `deck.yaml` format, the template map, slot rules, overlays, deck-local templates, build issues |
| `references/design-system.md` | Palette, typography, geometry, diagram grammar, motion, accessibility |
| `references/html-to-pptx.md` | Exporting and checking an approved deck as native, editable PowerPoint |
| `scripts/layout-check.js` | In-page check: overflow, clipped text, overlays covering text or sitting on bars and labels, broken images |

## Example prompts

- "Create a 20-minute deck for engineering managers on release safety; the goal is to agree on one release gate."
- "Restyle these notes into a deckforge deck, French, `build` theme."
- "Add a lifecycle slide after the concept map and check the layout."
- "Turn the approved deck into an editable PowerPoint."
