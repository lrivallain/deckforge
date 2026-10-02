# Copilot assistant

Open the drawer with **Copilot** (<kbd>⌘/Ctrl</kbd> <kbd>K</kbd>). Ask Copilot to change your slides in plain words.

![Copilot tightened a slide and wrote its speaker notes](/screenshots/copilot.png){.shot}

## Sign in

The assistant uses your existing GitHub sign-in: `gh auth login`, or `/login` in the Copilot CLI.
You need a GitHub Copilot subscription. If you are not signed in, the drawer explains how to sign in.

## Scope

| Scope | What Copilot can change |
|---|---|
| **This slide** | Only the selected slide: text, notes, images, overlays |
| **Whole deck** | Every slide. It can also add, remove, reorder and hide slides, and change the theme or deck settings |

## What it can and cannot do

- Copilot can only use **deck tools**, such as `update_slide`, `add_slide`, `set_template`, `set_theme` and `add_overlay`.
  It has no shell, file or web access, and every other permission request is refused.
- It places only images that are already in `assets/`. It writes alt texts and tells you when one is a guess.
- Its instructions include the style's design rules, the template catalogue and your `meta.brief`.
  Fill in the brief to get better results.

## Undo

The rail highlights the slides that Copilot changed. A whole turn is **one undo step**: use **Undo these changes**
or <kbd>⌘/Ctrl</kbd> <kbd>Z</kbd>.

## Model

By default, Copilot uses your default model. To pick another one, set `DECKFORGE_MODEL`:

```bash
DECKFORGE_MODEL=<model-id> deckforge edit my-talk
```

::: info Optional dependency
The assistant needs `@github/copilot-sdk`, which is installed by default. If you installed with `--omit=optional`,
the drawer explains how to add it.
:::
