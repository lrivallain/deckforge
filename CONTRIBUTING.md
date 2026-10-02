# Contributing to deckforge

Thanks for helping! Bug reports, docs fixes, new templates and themes are all welcome.

- **Bugs and ideas:** [open an issue](https://github.com/lrivallain/deckforge/issues/new/choose).
- **Security issues:** don't open a public issue. Follow [SECURITY.md](https://github.com/lrivallain/deckforge/blob/master/SECURITY.md).
- **Code of conduct:** everyone who takes part must follow the [Code of Conduct](https://github.com/lrivallain/deckforge/blob/master/CODE_OF_CONDUCT.md).

## Set up

You need Node.js 20.19 or later (or 22.12 or later).

```bash
git clone https://github.com/lrivallain/deckforge.git && cd deckforge
npm ci
npx playwright install chromium webkit   # for e2e tests and screenshots
```

## Develop

```bash
npm run dev             # rebuild on change + `deckforge edit` on a scratch copy of the example
npm run dev -- --reset  # same, after restoring .demo/preview from examples/starter
npm run dev -- --serve  # read-only viewer instead of the editor
```

`npm run dev` picks a free port between 4370 and 4399 and keeps it across restarts. It prints the `Editor:` URL after each restart.
Ctrl+C stops everything.

## Check

| Command | What it runs |
|---|---|
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests: core, server, CLI, agent with a mocked SDK |
| `npm run test:e2e` | Build, then Playwright on Chromium and WebKit: viewer, editor, a11y, print |
| `npm run check` | All of the above |

CI also checks that the committed build output is up to date. After you change `src/`, `themes/` or `templates/`, run this and commit the result:

```bash
npm run build
for deck in examples/*/; do node bin/deckforge.js build "$deck"; done
```

## Documentation

The site in `docs/` uses [VitePress](https://vitepress.dev) and is deployed to GitHub Pages from `master`.

```bash
npm run docs:dev           # live preview
npm run docs:build         # production build (fails on dead links)
npm run docs:screenshots   # regenerate every screenshot, the favicons and the social card
```

Screenshots come from the example decks with a scripted Copilot (`scripts/docs-agent-mock.js`), so they are reproducible.
Regenerate them when a change affects the UI or a template.

Keep each page short: lead with what the reader does, use tables for options, and add one screenshot per concept.

## Ground rules

- **Editor previews** must be written with `document.open/write/close`, never with `srcdoc` or `blob:` URLs. Some WebKit hosts, such as Tauri WKWebView, never load those. An e2e test guards this.
- **New built-in templates or CLI options** must also be added to `skills/deckforge/references/authoring.md` (§4) and to the CLI help. `test/unit/skill.test.js` checks this.
- **No network by default:** the viewer and the built-in themes must not fetch anything in `local` and `inline` modes.
- Install dependencies with `npm ci` and keep the lockfile URLs as they are.

## Pull requests

1. Make one focused change per pull request, with tests.
2. Run `npm run check`.
3. Add a line under `## [Unreleased]` in [CHANGELOG.md](https://github.com/lrivallain/deckforge/blob/master/CHANGELOG.md) when users will notice the change.

## Releases

Maintainers release by tagging:

1. In `CHANGELOG.md`, move the `Unreleased` entries to a new `## [x.y.z] - YYYY-MM-DD` section and update the compare links at the bottom.
2. Update `version` in `package.json`, run `npm install --package-lock-only`, then commit.
3. Run `git tag vX.Y.Z && git push origin vX.Y.Z`.

The **Release** workflow checks the tag against `package.json`, runs the tests, and publishes a GitHub Release.
The release notes come from the changelog, and the `npm pack` tarball is attached. jsDelivr serves `dist/` from the tag for `--runtime cdn`.
