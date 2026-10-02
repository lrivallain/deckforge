# Security model

The editor is a local web server that can write files, so it is locked down by default.
To report a vulnerability, see [SECURITY.md](https://github.com/lrivallain/deckforge/blob/master/SECURITY.md).

- The server binds `127.0.0.1` with a random port and a per-run token. The token is exchanged for an
  `HttpOnly; SameSite=Lax` cookie named after the port (`df_token_<port>`), so several editors can run
  side by side. The cookie is `Lax`, not `Strict`, because some hosts (the GitHub Copilot app's built-in
  browser, for example) open the URL from another site: browsers drop a `Strict` cookie on that first
  redirect and the editor answers 401. `Lax` only adds the cookie to top-level `GET` navigations, which
  don't change anything. Writes still need a same-origin (or absent) Origin header and a JSON body, so a
  cross-site form or `fetch` can't use the cookie.
- The server checks the Host header against DNS rebinding and the Origin header on writes. It requires JSON request bodies and sends
  a strict Content-Security-Policy for the editor.
- Writes happen only in the deck folder (`deck.yaml`, `deck.html`, `deck.pptx`, `deckforge/`, `templates/`, `themes/`, `assets/`) and in
  `~/.config/deckforge/` (`templates/`, `themes/` and the Copilot handoff files below), plus the `deckforge` entry of
  `~/.copilot/mcp-config.json` when you ask for it. Dot-files and paths outside the deck folder are never served.
- Uploads (`POST /api/assets`) need the token, pass the Origin check and are limited to 10 MB. The file
  type comes from its magic bytes, never from its name or Content-Type. SVG files with scripts, event
  handlers, `javascript:` URLs, `foreignObject` or entity declarations are refused. Files are stored as
  `assets/<sha256-12>.<ext>`. Assets are served with `X-Content-Type-Options: nosniff`, and SVG with a
  `sandbox` Content-Security-Policy. User images are always `<img>` elements, never inline SVG. The server
  never fetches remote URLs.
- PowerPoint export (`POST /api/export/pptx`) needs the token and passes the Origin check. It accepts only a ZIP
  package up to 200 MB and always writes `deck.pptx` (named after `deck.yaml`) next to the deck. The browser
  builds the file from the laid-out deck; the server never parses it.
- Slot text is HTML-escaped and rich text is sanitized with an allow-list. Theme values are validated, including themes saved
  from the theme editor (`PUT /api/themes/<name>`) and palettes proposed by Copilot (6-digit hex colours only).
- deckforge sends no telemetry.

## The Copilot assistant

- Copilot can only use deck tools. It has no shell, file or web tools, and every other permission request is refused.
- It places only images that are already in `assets/`. It never downloads anything.
- `deckforge mcp` gives MCP clients the same deck tools. To reach a running editor, it reads a private record
  (`~/.config/deckforge/editors/<id>.json`, mode 0600) that holds the editor's loopback address and token.
  `deckforge edit` deletes the record when it stops. Tool calls send the same token as the browser, and they are
  refused while the editor's own Copilot turn is running.
- The editor remembers the last Copilot session ID of each deck in `~/.config/deckforge/sessions.json`. It writes the
  MCP configuration for **Continue in Copilot** to `~/.config/deckforge/mcp/`. Neither is written in the deck folder.
- Only when you ask (**Add the deck tools to Copilot**, or `deckforge mcp --install`) does deckforge write to
  `~/.copilot/mcp-config.json`, and then only its own `deckforge` entry. **Open in Copilot app** opens a
  `ghapp://sessions/<id>` link built from a validated session ID, and the app asks you to confirm.
