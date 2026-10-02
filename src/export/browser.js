// Browser bundle entry (dist/deckforge.export.js): window.DeckforgeExport.
import { exportDeck, exportDeckBase64, measureDeck, prepareDocument } from "./index.js";

/** The measured slide model, for debugging and tests. */
async function measure(doc) {
  await prepareDocument(doc);
  return measureDeck(doc);
}

globalThis.DeckforgeExport = { exportDeck, exportDeckBase64, measure };
