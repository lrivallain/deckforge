// Bundle the viewer, editor and PPTX export runtimes into dist/.
// Usage: node scripts/build.js [--watch]

import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
const banner = { js: "/*! deckforge | MIT License | https://github.com/lrivallain/deckforge */", css: "/*! deckforge | MIT License | https://github.com/lrivallain/deckforge */" };

const entries = [
  { in: "src/viewer/viewer.js", out: "deckforge.viewer", format: "iife" },
  { in: "src/viewer/viewer.css", out: "deckforge.viewer" },
  // PPTX exporter (PptxGenJS + JSZip), loaded on demand by the editor and the CLI's headless page.
  { in: "src/export/browser.js", out: "deckforge.export", format: "iife", platform: "browser" },
];
if (fs.existsSync(path.join(root, "src/editor/main.js"))) {
  entries.push({ in: "src/editor/main.js", out: "deckforge.editor", format: "esm" });
  entries.push({ in: "src/editor/editor.css", out: "deckforge.editor" });
}

const configs = entries.map((entry) => ({
  absWorkingDir: root,
  entryPoints: [{ in: entry.in, out: entry.out }],
  outdir: "dist",
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ["es2022", "chrome110", "firefox115", "safari16"],
  format: entry.format,
  ...(entry.platform ? { platform: entry.platform } : {}),
  banner,
  legalComments: "none",
  logLevel: "info",
}));

// The editor favicon; the master lives with the docs site assets.
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.copyFileSync(path.join(root, "docs/public/logo.svg"), path.join(root, "dist/deckforge.icon.svg"));

if (watch) {
  for (const config of configs) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
  }
  console.log("[deckforge] watching src/ for changes…");
} else {
  await Promise.all(configs.map((config) => esbuild.build(config)));
}
