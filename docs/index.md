---
layout: home
title: deckforge
titleTemplate: Presentations as YAML

hero:
  name: deckforge
  text: Presentations as YAML
  tagline: Write slides as data, pick a theme, refine them in a live editor with GitHub Copilot, and ship one static HTML file.
  image:
    src: /logo.svg
    alt: deckforge logo
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Open a live deck
      link: /demo/aurora.html
      target: _blank
    - theme: alt
      text: GitHub
      link: https://github.com/lrivallain/deckforge

features:
  - icon: 📄
    title: deck.yaml is the source
    details: Slides are data in templates. Diffs stay readable, content is validated, and layouts stay consistent across the deck.
    link: /guide/writing-decks
  - icon: 🎨
    title: Themes and templates
    details: 4 themes and 32 templates, from one-idea slides to diagrams and data-driven charts. Create your own with a front-matter, HTML and CSS file.
    link: /guide/templates
  - icon: ✏️
    title: Live editor
    details: Edit text in place, use a typed inspector, add images and overlays with snapping, and undo every change. Saves automatically.
    link: /guide/editor
  - icon: ✨
    title: GitHub Copilot inside
    details: Ask for changes to one slide or the whole deck. Copilot can only call deck tools, and each turn is one undo step.
    link: /guide/copilot
  - icon: 🚀
    title: One static file
    details: The viewer has keyboard navigation, speaker notes, a presenter window and print to PDF. No network requests by default.
    link: /guide/presenting
  - icon: 🤖
    title: Copilot skill
    details: Teach the Copilot CLI to plan, write, validate and measure a whole deck from a brief.
    link: /guide/copilot-skill
---

<div class="home-shot">

![The deckforge editor: slide rail, live preview and inspector](/screenshots/editor.png)

Try the examples as visitors see them: the [Aurora deck](/demo/aurora.html){target="_blank"} or the [Build specimen](/demo/starter.html){target="_blank"}. Press <kbd>→</kbd> to go to the next slide and <kbd>N</kbd> to show the speaker notes.

</div>
