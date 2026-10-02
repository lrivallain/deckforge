---
layout: home
title: deckforge
titleTemplate: Agent-native presentations

hero:
  name: deckforge
  text: Agent-native presentations
  tagline: Typed slides an AI can edit safely, on the Copilot you already have. Review every turn, undo it in one step, and ship one static HTML file or an editable PowerPoint.
  image:
    src: /logo.svg
    alt: deckforge logo
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why deckforge
      link: /guide/why-deckforge
    - theme: alt
      text: Open a live deck
      link: /demo/aurora.html
      target: _blank
    - theme: alt
      text: GitHub
      link: https://github.com/lrivallain/deckforge

features:
  - icon: 🛡️
    title: An agent that edits safely
    details: Copilot can only call typed deck tools, with no shell, file or web access. Limit it to one slide or open the whole deck. Every call is validated.
    link: /guide/agent-model
  - icon: ↩️
    title: Reviewable, reversible turns
    details: Each request is one undo step. The rail highlights the changed slides, the drawer lists the slots touched, and the agent log records every tool call.
    link: /guide/agent-model#change-summary-and-agent-log
  - icon: ✨
    title: On the Copilot you already have
    details: It runs on your GitHub Copilot sign-in, grounded on the deck's brief. No new account, no API key, no extra AI bill. Copilot CLI and other agents get the same tools through MCP.
    link: /guide/copilot
  - icon: 📄
    title: deck.yaml is the source
    details: Slides are data in templates with typed slots. Diffs stay readable, text is checked against slot limits, and layouts stay consistent.
    link: /guide/writing-decks
  - icon: ✏️
    title: Live editor, themes and templates
    details: Edit text in place, use a typed inspector, add images and overlays with snapping. 4 themes and 20 templates, and you can add your own.
    link: /guide/editor
  - icon: 🚀
    title: One static file, or PowerPoint
    details: Keyboard navigation, speaker notes, a presenter window and print to PDF, with no network requests by default. Or export an editable .pptx.
    link: /guide/presenting
---

<div class="home-shot">

![The deckforge editor: slide rail, live preview and inspector](/screenshots/editor.png)

![A whole-deck request to Copilot: three slides highlighted and listed in the turn summary, then one click on Undo these changes restores them](/screenshots/agent-turn.gif)

Try the examples as visitors see them: the [Aurora deck](/demo/aurora.html){target="_blank"}, the [Build specimen](/demo/starter.html){target="_blank"}, or [Agent-native decks](/demo/agent-native.html){target="_blank"}, written from a brief by the [Copilot skill](/guide/copilot-skill#example). Press <kbd>→</kbd> to go to the next slide and <kbd>N</kbd> to show the speaker notes.

</div>
