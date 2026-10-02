<p align="center">
  <img src="docs/public/logo.svg" alt="" width="96" height="96">
</p>

<h1 align="center">deckforge</h1>

<p align="center">
  <strong>Presentations as YAML.</strong> Themes, templates, a live editor and GitHub Copilot, in one static HTML file.
</p>

<p align="center">
  <a href="https://github.com/lrivallain/deckforge/actions/workflows/ci.yml"><img src="https://github.com/lrivallain/deckforge/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://deckforge.vuptime.io/"><img src="https://img.shields.io/badge/docs-deckforge.vuptime.io-0F6CBD" alt="Documentation"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520.19-339933" alt="Node.js 20.19 or later">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-C2620A" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://deckforge.vuptime.io/guide/getting-started"><b>Get started</b></a> ·
  <a href="https://deckforge.vuptime.io/"><b>Documentation</b></a> ·
  <a href="https://deckforge.vuptime.io/demo/aurora.html"><b>Live demo</b></a>
</p>

![The deckforge editor](docs/public/screenshots/editor.png)

## Why deckforge

- **Write slides as data.** Each slide in `deck.yaml` picks a template and fills its slots. The text is validated and every slide keeps a consistent layout.
- **Themes and templates.** It ships with 4 themes and 20 templates, from one-idea slides to diagrams, and you can add your own. The theme editor lets you pick the colours yourself or ask Copilot for a palette.
- **Live editor.** Edit text in place, use a typed inspector, add images and overlays, and undo any change. Saves automatically.
- **GitHub Copilot inside.** Ask for changes to one slide or the whole deck. Copilot can only use deck tools.
  Continue the same conversation in Copilot CLI or the Copilot app (`deckforge mcp`) and watch its edits in the editor as they happen.
- **One static file.** Speaker notes, a presenter window and print to PDF. No network requests by default.
- **Editable PowerPoint export.** Native text boxes, shapes and pictures, with your speaker notes.

## Install

Node.js 20.19 or later (or 22.12 or later) is required.

```bash
npm install -g https://github.com/lrivallain/deckforge/archive/refs/heads/master.tar.gz
```

## Quick start

```bash
deckforge new my-talk --title "Shipping with confidence"   # creates my-talk/deck.yaml
deckforge edit my-talk                                      # opens the editor
deckforge build my-talk --runtime inline                    # one self-contained deck.html
deckforge export my-talk                                    # an editable deck.pptx
```

To start from a complete deck, run `deckforge new my-talk --example aurora`.

## Documentation

| | |
|---|---|
| [Getting started](https://deckforge.vuptime.io/guide/getting-started) | Install and create your first deck |
| [Write a deck](https://deckforge.vuptime.io/guide/writing-decks) | The basics of `deck.yaml` |
| [Themes](https://deckforge.vuptime.io/guide/themes) · [Templates](https://deckforge.vuptime.io/guide/templates) | Galleries of themes and templates |
| [Editor](https://deckforge.vuptime.io/guide/editor) · [Copilot](https://deckforge.vuptime.io/guide/copilot) | Edit slides visually or by asking Copilot |
| [Present and share](https://deckforge.vuptime.io/guide/presenting) | Viewer, print to PDF, PowerPoint export, runtime modes |
| [Copilot skill](https://deckforge.vuptime.io/guide/copilot-skill) | Let the Copilot CLI build a deck from a brief |
| [Reference](https://deckforge.vuptime.io/reference/cli) | CLI, `deck.yaml`, theme and template files, security model |

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop and checks, and
[SECURITY.md](SECURITY.md) to report a vulnerability. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © Ludovic Rivallain
