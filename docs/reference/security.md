# Security model

The editor is a local web server that can write files, so it is locked down by default.
To report a vulnerability, see [SECURITY.md](https://github.com/lrivallain/deckforge/blob/master/SECURITY.md).

- The server binds `127.0.0.1` with a random port and a per-run token. The token is exchanged for an
  `HttpOnly; SameSite=Strict` cookie named after the port (`df_token_<port>`), so several editors can run
  side by side.
- The server checks the Host header against DNS rebinding and the Origin header on writes. It requires JSON request bodies and sends
  a strict Content-Security-Policy for the editor.
- Writes happen only in the deck folder (`deck.yaml`, `deck.html`, `deckforge/`, `templates/`, `assets/`) and in
  `~/.config/deckforge/` (`templates/` and the Copilot handoff files below). Dot-files and paths outside the deck folder are never served.
- Uploads (`POST /api/assets`) need the token, pass the Origin check and are limited to 10 MB. The file
  type comes from its magic bytes, never from its name or Content-Type. SVG files with scripts, event
  handlers, `javascript:` URLs, `foreignObject` or entity declarations are refused. Files are stored as
  `assets/<sha256-12>.<ext>`. Assets are served with `X-Content-Type-Options: nosniff`, and SVG with a
  `sandbox` Content-Security-Policy. User images are always `<img>` elements, never inline SVG. The server
  never fetches remote URLs.
- Slot text is HTML-escaped and rich text is sanitized with an allow-list. Theme values are validated.
- deckforge sends no telemetry.

## The Copilot assistant

- Copilot can only use deck tools. It has no shell, file or web tools, and every other permission request is refused.
- It places only images that are already in `assets/`. It never downloads anything.
- `deckforge mcp` gives MCP clients the same deck tools. To reach a running editor, it reads a private record
  (`~/.config/deckforge/editors/<id>.json`, mode 0600) that holds the editor's loopback address and token.
  `deckforge edit` deletes the record when it stops. Tool calls send the same token as the browser, and they are
  refused while the editor's own Copilot turn is running.
- The editor remembers the last Copilot session ID of each deck in `~/.config/deckforge/sessions.json`. It writes the
  MCP configuration for **Continue in Copilot CLI** to `~/.config/deckforge/mcp/`. Neither is written in the deck folder.
