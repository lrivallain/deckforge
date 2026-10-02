# Decks in git and CI

`deck.yaml` is plain text, so a deck lives well in a repository: changes are diffs, reviews are pull requests and
validation is a CI check.

## Repository layout

```text
reviews/
└── order-platform/            # one folder per deck
    ├── deck.yaml              # the source of truth: review it like code
    ├── assets/                # images, named by content hash (assets/3f2a9c1b04de.png)
    ├── templates/             # optional deck-local templates (*.html)
    ├── themes/                # optional deck theme (*.yaml) and its licensed fonts/
    ├── fonts/
    └── deck.html              # generated: commit it, or ignore it and let CI build it
```

- **Commit `deck.html`** when people read the deck straight from the repository. Make CI check it is up to date.
- **Ignore it** (`echo deck.html >> .gitignore`) when CI publishes it as an artifact. With the `local` runtime, also
  ignore the generated `deckforge/` folder.
- Keep `assets/` committed: images are added by content hash, so a changed picture is a new file and an obvious diff.
  `deckforge build` lists assets no slide uses; delete them by hand.
- `deckforge edit` rewrites `deck.yaml` in a stable order, without YAML comments: put explanations in speaker notes.

## Validate and publish in GitHub Actions

This workflow validates every deck on each pull request (a required check fails on any deck error or network
reference) and uploads the self-contained HTML files as an artifact:

```yaml
# .github/workflows/decks.yml
name: Decks
on:
  pull_request:
    paths: ["reviews/**"]
  push:
    branches: [main]
    paths: ["reviews/**"]

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install deckforge
        run: npm install -g https://github.com/lrivallain/deckforge/archive/refs/heads/master.tar.gz --omit=optional
      - name: Build and check every deck
        run: |
          mkdir -p out
          for deck in reviews/*/; do
            name=$(basename "$deck")
            deckforge build "$deck" --runtime inline --check-offline --out "out/$name.html"
            deckforge build "$deck" --runtime inline --check-offline --strip-notes --out "out/$name-shared.html"
          done
      - name: Summarise the changes
        if: github.event_name == 'pull_request'
        run: |
          for deck in reviews/*/; do
            base="origin/${{ github.base_ref }}:${deck}deck.yaml"
            if git cat-file -e "$base" 2>/dev/null; then
              echo '```' >> "$GITHUB_STEP_SUMMARY"
              git show "$base" | deckforge diff - "$deck" >> "$GITHUB_STEP_SUMMARY"
              echo '```' >> "$GITHUB_STEP_SUMMARY"
            fi
          done
      - uses: actions/upload-artifact@v4
        with:
          name: decks
          path: out/
          retention-days: 30
```

`deckforge build` exits with code **2** on any validation error (an unknown template, a broken slot) and, with
`--check-offline`, on any `http(s)` resource. Mark the job as a required status check in your branch protection.
Pin a released version instead of `master` for reproducible builds.

To check that a committed `deck.html` is up to date instead, rebuild it in place and compare:

```bash
deckforge build reviews/order-platform && git diff --exit-code -- reviews/order-platform/deck.html
```

## Review changes with `deckforge diff`

A YAML diff shows every changed line; `deckforge diff` says what changed on which slide:

```bash
git show main:reviews/order-platform/deck.yaml | deckforge diff - reviews/order-platform
```

```text
deckforge diff stdin → reviews/order-platform/deck.yaml
~ latency [bars]: items (item 1)
↕ options [options-matrix] moved 6 → 5
+ rollback [checklist] added at 9
  1 added, 0 removed, 1 changed, 1 moved, 6 unchanged
```

Add `--json` for tooling. See the [CLI reference](../reference/cli#diff).
