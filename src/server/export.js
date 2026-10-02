// `deckforge export`: deck.yaml → deck.pptx through a headless Chromium page.
// The deck is built in memory with the inline runtime (images as data URIs),
// laid out by the browser and converted by dist/deckforge.export.js — the
// same exporter the editor's "Export PPTX" button runs.

import fs from "node:fs";
import path from "node:path";
import { parseDeckYaml } from "../core/deck.js";
import { buildDeckObject } from "./build.js";
import { DIST_DIR, loadTemplates, loadThemes } from "./registry.js";
import { writeFileAtomic } from "./fs-util.js";

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export class ExportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExportError";
  }
}

export const PLAYWRIGHT_HINT = "PowerPoint export from the CLI needs Playwright and a Chromium browser:\n"
  + "  npm install -g playwright && npx playwright install chromium\n"
  + "(or export from the editor: deckforge edit <deck>, then Export PPTX)";

/** The .pptx written next to deck.yaml: <dir>/deck.pptx. */
export function pptxPathFor(deckPath) {
  return path.join(path.dirname(deckPath), path.basename(deckPath).replace(/\.ya?ml$/i, "") + ".pptx");
}

/** True when the bytes look like a ZIP package (every .pptx is one). */
export function looksLikePptx(buf) {
  return Buffer.isBuffer(buf) && buf.length > 22 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

async function importPlaywright(importer) {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      const mod = await importer(name);
      const chromium = mod.chromium || mod.default?.chromium;
      if (chromium) return chromium;
    } catch {
      /* try the next package */
    }
  }
  throw new ExportError(`Playwright is not installed. ${PLAYWRIGHT_HINT}`);
}

/** Launch Chromium: Playwright's own build, else an installed Chrome or Edge. */
export async function launchChromium({ importer = (name) => import(name) } = {}) {
  const chromium = await importPlaywright(importer);
  let firstError;
  for (const options of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch (err) {
      firstError ??= err;
    }
  }
  throw new ExportError(`Could not start a Chromium browser (${String(firstError?.message || firstError).split("\n")[0]}). ${PLAYWRIGHT_HINT}`);
}

/**
 * Export deck.yaml to PowerPoint.
 * @returns {Promise<{ outPath, slides, warnings: string[], issues: object[], deck, loadErrors }>}
 */
export async function exportPptxFile(deckPath, { out, launch = launchChromium } = {}) {
  const absolute = path.resolve(deckPath);
  const deckDir = path.dirname(absolute);
  const deck = parseDeckYaml(fs.readFileSync(absolute, "utf8"));
  const { templates, errors: templateErrors } = loadTemplates(deckDir);
  const { themes, errors: themeErrors } = loadThemes(deckDir);
  const outPath = out ? path.resolve(out) : pptxPathFor(absolute);
  const built = buildDeckObject(deck, { deckDir, sourceDir: deckDir, outPath: path.join(deckDir, "deck.html"), runtime: "inline", templates, themes, write: false, offlineCsp: false });
  const loadErrors = [...templateErrors, ...themeErrors];
  if (built.issues.some((i) => i.level === "error")) return { outPath: null, slides: 0, warnings: [], issues: built.issues, deck, loadErrors };
  const bundle = path.join(DIST_DIR, "deckforge.export.js");
  if (!fs.existsSync(bundle)) throw new ExportError(`Missing ${bundle}. Run "npm run build" in the deckforge package first.`);

  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await page.setContent(built.html, { waitUntil: "load" });
    await page.addScriptTag({ path: bundle });
    const meta = { title: deck.meta.title, author: deck.meta.author || "" };
    const result = await page.evaluate((m) => globalThis.DeckforgeExport.exportDeckBase64(globalThis.document, m), meta);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileAtomic(outPath, Buffer.from(result.base64, "base64"));
    return { outPath, slides: result.slides, warnings: result.warnings, issues: built.issues, deck, loadErrors };
  } finally {
    await browser.close().catch(() => {});
  }
}
