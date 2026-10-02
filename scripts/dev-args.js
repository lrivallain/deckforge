// CLI arguments that scripts/dev.js hands to `deckforge edit|serve`.

/**
 * The token goes in `--token=<t>` form: node's parseArgs rejects a separate
 * value that starts with "-", and older .demo/preview-token files can.
 */
export function devCliArgs({ mode, deckPath, port, token }) {
  const args = [mode, deckPath, "--port", String(port), "--no-open"];
  if (mode === "edit") args.push(`--token=${token}`);
  return args;
}
