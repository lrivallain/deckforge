import { escapeHtml } from "../core/html.js";

export function editorPage({ title }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · deckforge</title>
  <link rel="icon" href="/assets/deckforge.icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/deckforge.editor.css">
  <script type="module" src="/assets/deckforge.editor.js"></script>
</head>
<body>
  <div id="app" class="df-app" aria-busy="true"><p class="df-loading">Loading editor…</p></div>
  <noscript>The deckforge editor needs JavaScript. The generated deck is still readable at /deck/.</noscript>
</body>
</html>`;
}
