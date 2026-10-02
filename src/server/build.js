// deck.yaml → deck.html (+ runtime assets for the "local" mode).

import fs from "node:fs";
import path from "node:path";
import { parseDeckYaml, validateDeck } from "../core/deck.js";
import { renderDeck, VERSION } from "../core/render.js";
import { DIST_DIR, loadTemplates, loadThemes } from "./registry.js";
import { writeFileAtomic } from "./fs-util.js";
import { assetDataUri, assetReport, copyAssets } from "./assets.js";

export const RUNTIME_DIR_NAME = "deckforge";

export function readRuntimeAssets() {
  const read = (name) => {
    const file = path.join(DIST_DIR, name);
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run "npm run build" in the deckforge package first.`);
    return fs.readFileSync(file, "utf8");
  };
  return { css: read("deckforge.viewer.css"), js: read("deckforge.viewer.js") };
}

export { writeFileAtomic };

export function outputPathFor(deckPath) {
  return path.join(path.dirname(deckPath), path.basename(deckPath).replace(/\.ya?ml$/i, "") + ".html");
}

/**
 * Render a deck object to HTML and write it to outPath.
 * `sourceDir` holds deck.yaml and assets/; `deckDir` is where the runtime
 * (and, for --out elsewhere, the used assets) are copied.
 * @returns {{ html: string, outPath: string, issues: object[], assets: object }}
 */
export function buildDeckObject(deck, { deckDir, sourceDir = deckDir, outPath, runtime, templates, themes, write = true }) {
  const mode = runtime || deck.meta.runtime || "local";
  const theme = themes[deck.meta.theme] || themes.build || Object.values(themes)[0];
  const issues = validateDeck(deck, { templates, themes });
  const report = assetReport(deck, templates, sourceDir);
  for (const src of report.missing) issues.push({ level: "warning", message: `Image ${src} was not found in the deck folder` });
  for (const src of report.unused) issues.push({ level: "info", message: `Unused asset ${src} (not referenced by any slide; delete it by hand if no longer needed)` });
  const assets = mode === "inline" ? readRuntimeAssets() : {};
  const assetUrl = mode === "inline" ? (src) => assetDataUri(sourceDir, src) || src : undefined;
  const html = renderDeck(deck, { templates, theme, runtime: mode, assets, version: VERSION, assetUrl });
  if (write) {
    writeFileAtomic(outPath, html);
    if (mode === "local") {
      copyRuntime(deckDir);
      copyAssets(sourceDir, deckDir, report.used);
    }
  }
  return { html, outPath, issues, runtime: mode, assets: report };
}

export function copyRuntime(deckDir) {
  const target = path.join(deckDir, RUNTIME_DIR_NAME);
  fs.mkdirSync(target, { recursive: true });
  const assets = readRuntimeAssets();
  for (const [name, content] of [["deckforge.viewer.css", assets.css], ["deckforge.viewer.js", assets.js]]) {
    const file = path.join(target, name);
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) writeFileAtomic(file, content);
  }
}

export function buildDeckFile(deckPath, { runtime, out } = {}) {
  const absolute = path.resolve(deckPath);
  const deckDir = path.dirname(absolute);
  const deck = parseDeckYaml(fs.readFileSync(absolute, "utf8"));
  const { templates, errors: templateErrors } = loadTemplates(deckDir);
  const { themes, errors: themeErrors } = loadThemes(deckDir);
  const outPath = out ? path.resolve(out) : outputPathFor(absolute);
  const result = buildDeckObject(deck, { deckDir: path.dirname(outPath), sourceDir: deckDir, outPath, runtime, templates, themes });
  return { ...result, deck, loadErrors: [...templateErrors, ...themeErrors] };
}
