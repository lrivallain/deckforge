# Changelog

All notable changes to deckforge are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Editor: drag an edge to resize the slide rail, the inspector or the Copilot panel. You can also use the keyboard, and double-click restores the default width. The widths persist, and rail thumbnails scale with the rail.

### Fixed

- Editor: the page no longer scrolls past the app, which used to push the toolbar out of view.
- Editor: the URL printed by `deckforge edit` now opens from hosts that start navigations on another site, such as the GitHub Copilot app's built-in browser. The token cookie is `SameSite=Lax` instead of `Strict`.
- `npm run dev` no longer fails at random with "Option '--token' argument is ambiguous": tokens never start with `-`, and the token is passed as `--token=<t>`.

## [0.1.0]

First public version. Add the release date to this heading when you tag it.

### Added

- `deck.yaml` → static `deck.html` renderer, with `local`, `inline` and `cdn` runtime modes.
- Viewer: keyboard and hash navigation, static mode, speaker notes, presenter window, fullscreen, print to PDF.
- Themes: `build`, `atelier`, `aurora` and `azure`.
- 20 templates: Essentials, structure, diagrams, content and media.
- Editor: slide rail, inline text editing, typed inspector, images, overlays with snapping, reorder, undo/redo, autosave.
- Template editor with live preview and validation.
- Copilot assistant with slide or deck scope and deck-only tools, where each turn is one undo step.
- GitHub Copilot skill (`deckforge skill install-copilot`).
- CLI: `new`, `build`, `templates`, `edit`, `serve`, `skill`.
- Documentation site at <https://deckforge.vuptime.io/>, with screenshots and live example decks.
- deckforge icon: favicon for the editor and the site, and a social card.
- Community files, issue and pull request templates, Dependabot, and a release workflow that runs on `v*` tags.

### Fixed

- The inspector thumbnail of an SVG image that has only a `viewBox` no longer collapses to 0×0.

[Unreleased]: https://github.com/lrivallain/deckforge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lrivallain/deckforge/releases/tag/v0.1.0
