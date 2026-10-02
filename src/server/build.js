// deck.yaml → deck.html (+ runtime assets for the "local" mode).

import fs from "node:fs";
import path from "node:path";
import { parseDeckYaml, validateDeck } from "../core/deck.js";
import { renderDeck, VERSION } from "../core/render.js";
import { DIST_DIR, loadTemplates, loadThemes } from "./registry.js";

export const RUNTIME_DIR_NAME = "deckforge";

export function readRuntimeAssets() {
  const read = (name) => {
    const file = path.join(DIST_DIR, name);
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run "npm run build" in the deckforge package first.`);
    return fs.readFileSync(file, "utf8");
  };
  return { css: read("deckforge.viewer.css"), js: read("deckforge.viewer.js") };
}

export function writeFileAtomic(file, content) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function outputPathFor(deckPath) {
  return path.join(path.dirname(deckPath), path.basename(deckPath).replace(/\.ya?ml$/i, "") + ".html");
}

/**
 * Render a deck object to HTML and write it next to deck.yaml.
 * @returns {{ html: string, outPath: string, issues: object[] }}
 */
export function buildDeckObject(deck, { deckDir, outPath, runtime, templates, themes, write = true }) {
  const mode = runtime || deck.meta.runtime || "local";
  const theme = themes[deck.meta.theme] || themes.build || Object.values(themes)[0];
  const issues = validateDeck(deck, { templates, themes });
  const assets = mode === "inline" ? readRuntimeAssets() : {};
  const html = renderDeck(deck, { templates, theme, runtime: mode, assets, version: VERSION });
  if (write) {
    writeFileAtomic(outPath, html);
    if (mode === "local") copyRuntime(deckDir);
  }
  return { html, outPath, issues, runtime: mode };
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
  const result = buildDeckObject(deck, { deckDir: path.dirname(outPath), outPath, runtime, templates, themes });
  return { ...result, deck, loadErrors: [...templateErrors, ...themeErrors] };
}
