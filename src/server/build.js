// deck.yaml → deck.html (+ runtime assets for the "local" mode).

import fs from "node:fs";
import path from "node:path";
import { parseDeckYaml, validateDeck } from "../core/deck.js";
import { renderDeck, VERSION } from "../core/render.js";
import { DIST_DIR, loadTemplates, loadThemes } from "./registry.js";
import { writeFileAtomic } from "./fs-util.js";
import { assetDataUri, assetReport, copyAssets } from "./assets.js";
import { findExternalReferences, OFFLINE_CSP } from "../core/offline.js";

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

const FONT_TYPES = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };
export const MAX_FONT_BYTES = 5 * 1024 * 1024;

/**
 * Inline runtime: embed the theme's relative font files (url("fonts/x.woff2"),
 * relative to the deck folder) as data URIs, so a licensed font travels inside
 * the one file. Missing, oversized or out-of-folder files are left as they are.
 */
export function embedFontFiles(css, baseDir) {
  const root = path.resolve(baseDir);
  return String(css ?? "").replace(/url\("([^"]+)"\)/g, (match, url) => {
    const ext = /\.(woff2|woff|ttf|otf)$/i.exec(url)?.[1]?.toLowerCase();
    if (!ext || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(url)) return match;
    const file = path.resolve(root, url);
    if (!file.startsWith(root + path.sep)) return match;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_FONT_BYTES) return match;
      return `url("data:${FONT_TYPES[ext]};base64,${fs.readFileSync(file).toString("base64")}")`;
    } catch {
      return match;
    }
  });
}

export function outputPathFor(deckPath) {
  return path.join(path.dirname(deckPath), path.basename(deckPath).replace(/\.ya?ml$/i, "") + ".html");
}

/**
 * Render a deck object to HTML and write it to outPath.
 * `sourceDir` holds deck.yaml and assets/; `deckDir` is where the runtime
 * (and, for --out elsewhere, the used assets) are copied.
 * `checkOffline` reports every network reference of the output as an error
 * (and adds a CSP that blocks the network to inline decks); `stripNotes`
 * leaves the speaker notes out.
 * @returns {{ html: string, outPath: string, issues: object[], assets: object, external?: object[] }}
 */
export function buildDeckObject(deck, { deckDir, sourceDir = deckDir, outPath, runtime, templates, themes, write = true, checkOffline = false, stripNotes = false }) {
  const mode = runtime || deck.meta.runtime || "local";
  let theme = themes[deck.meta.theme] || themes.build || Object.values(themes)[0];
  const issues = validateDeck(deck, { templates, themes });
  const report = assetReport(deck, templates, sourceDir);
  for (const src of report.missing) issues.push({ level: "warning", message: `Image ${src} was not found in the deck folder` });
  for (const src of report.unused) issues.push({ level: "info", message: `Unused asset ${src} (not referenced by any slide; delete it by hand if no longer needed)` });
  const assets = mode === "inline" ? readRuntimeAssets() : {};
  if (mode === "inline" && theme?.css) theme = { ...theme, css: embedFontFiles(theme.css, sourceDir) };
  const assetUrl = mode === "inline" ? (src) => assetDataUri(sourceDir, src) || src : undefined;
  const csp = checkOffline && mode === "inline" ? OFFLINE_CSP : "";
  const html = renderDeck(deck, { templates, theme, runtime: mode, assets, version: VERSION, assetUrl, stripNotes, csp });
  let external;
  if (checkOffline) {
    external = findExternalReferences(html);
    for (const ref of external) issues.push({ level: "error", message: `Not offline: ${ref.where} loads ${ref.url}` });
  }
  if (write) {
    writeFileAtomic(outPath, html);
    if (mode === "local") {
      copyRuntime(deckDir);
      copyAssets(sourceDir, deckDir, report.used);
    }
  }
  return { html, outPath, issues, runtime: mode, assets: report, ...(checkOffline ? { external } : {}) };
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

export function buildDeckFile(deckPath, { runtime, out, checkOffline = false, stripNotes = false } = {}) {
  const absolute = path.resolve(deckPath);
  const deckDir = path.dirname(absolute);
  const deck = parseDeckYaml(fs.readFileSync(absolute, "utf8"));
  const { templates, errors: templateErrors } = loadTemplates(deckDir);
  const { themes, errors: themeErrors } = loadThemes(deckDir);
  const outPath = out ? path.resolve(out) : outputPathFor(absolute);
  const result = buildDeckObject(deck, { deckDir: path.dirname(outPath), sourceDir: deckDir, outPath, runtime, templates, themes, checkOffline, stripNotes });
  return { ...result, deck, loadErrors: [...templateErrors, ...themeErrors] };
}
