// deckforge → PowerPoint: measure a laid-out deck.html, then write native slides.

import { measureDeck, prepareDocument } from "./measure.js";
import { writePptx } from "./pptx.js";
import { bytesToBase64 } from "./model.js";

export { measureDeck, prepareDocument, writePptx };

/**
 * Export a built deck document (same-origin) to .pptx bytes.
 * @param {Document} doc a loaded deck.html
 * @param {{ title?: string, author?: string }} [meta]
 * @returns {Promise<{ bytes: Uint8Array, slides: number, warnings: string[] }>}
 */
export async function exportDeck(doc, meta = {}) {
  await prepareDocument(doc);
  const model = await measureDeck(doc);
  const bytes = await writePptx(model, meta);
  return { bytes, slides: model.slides.length, warnings: model.warnings };
}

/** Same as exportDeck, with the bytes as base64 (to cross a CDP/Playwright boundary). */
export async function exportDeckBase64(doc, meta = {}) {
  const { bytes, ...rest } = await exportDeck(doc, meta);
  return { base64: bytesToBase64(bytes), ...rest };
}
