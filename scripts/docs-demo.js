// Build the example decks as self-contained pages for the docs site (docs/public/demo/).
// Usage: node scripts/docs-demo.js   (run by `npm run docs:build` and `npm run docs:dev`)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs/public/demo");
fs.mkdirSync(out, { recursive: true });

for (const name of ["starter", "aurora"]) {
  const file = path.join(out, `${name}.html`);
  execFileSync(process.execPath, [path.join(root, "bin/deckforge.js"), "build", path.join(root, "examples", name), "--runtime", "inline", "--out", file], { stdio: "inherit" });
}
