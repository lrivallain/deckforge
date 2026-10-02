// Entry point that scripts/dev.js runs under `node --watch`. The CLI arguments
// come from DECKFORGE_DEV_ARGS instead of argv, so node's "Restarting '…'"
// line shows neither the port nor the token. The GitHub Copilot app would
// otherwise detect "--port N" as the server URL and open it without the token.

process.argv.push(...JSON.parse(process.env.DECKFORGE_DEV_ARGS || "[]"));
await import("../bin/deckforge.js");
