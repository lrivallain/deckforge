// "Export PPTX": lay the built deck out in a hidden same-origin frame, convert
// it with the on-demand exporter bundle, save it next to deck.yaml through the
// server, then download it.

import { api } from "./api.js";
import { h, toast } from "./dom.js";
import { state } from "./state.js";

let exporterPromise = null;
let running = false;

function loadExporter() {
  if (globalThis.DeckforgeExport) return Promise.resolve(globalThis.DeckforgeExport);
  exporterPromise ||= new Promise((resolve, reject) => {
    const script = h("script", { src: "/assets/deckforge.export.js" });
    script.addEventListener("load", () => resolve(globalThis.DeckforgeExport));
    script.addEventListener("error", () => {
      exporterPromise = null;
      script.remove();
      reject(new Error("could not load the exporter"));
    });
    document.head.append(script);
  });
  return exporterPromise;
}

/**
 * The deck page at its 1280 px reference width, off screen. It is a normal
 * same-origin navigation (never srcdoc or blob:, which some WebKit hosts do not load).
 */
function loadDeckFrame(url) {
  return new Promise((resolve, reject) => {
    const frame = h("iframe", {
      class: "export-frame",
      title: "PowerPoint export",
      "aria-hidden": "true",
      tabindex: "-1",
      style: { position: "fixed", left: "-20000px", top: "0", width: "1280px", height: "720px", border: "0", pointerEvents: "none" },
    });
    const timer = setTimeout(() => reject(new Error("the deck took too long to load")), 30000);
    frame.addEventListener("load", () => {
      clearTimeout(timer);
      if (frame.contentDocument?.querySelector("section.slide")) resolve(frame);
      else reject(new Error("the built deck has no slides"));
    }, { once: true });
    frame.src = url;
    document.body.append(frame);
  });
}

function download(url, file) {
  const link = h("a", { href: url, download: file, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
}

export async function exportPptx() {
  if (running) return;
  running = true;
  const progress = toast("Exporting to PowerPoint…", { timeout: 120000 });
  let frame;
  try {
    const build = await api.build();
    if (build?.ok === false) throw new Error(`the deck does not build (${build.error})`);
    const exporter = await loadExporter();
    frame = await loadDeckFrame(`/deck/${encodeURIComponent(state.outFile)}`);
    const { bytes, slides, warnings } = await exporter.exportDeck(frame.contentDocument, { title: state.deck.meta.title, author: state.deck.meta.author || "" });
    const saved = await api.savePptx(bytes);
    download(saved.url, saved.file);
    toast(`Exported ${saved.file} (${slides} slide${slides === 1 ? "" : "s"}), saved next to ${state.deckFile}`, { timeout: 6000 });
    if (warnings.length) {
      for (const w of warnings) console.warn(`[deckforge export] ${w}`);
      toast(warnings.length === 1 ? warnings[0] : `${warnings[0]} (+${warnings.length - 1} more export notes in the browser console)`, { timeout: 9000 });
    }
    return saved;
  } catch (err) {
    toast(`PowerPoint export failed: ${err.message}`, { kind: "error", timeout: 8000 });
    return null;
  } finally {
    progress.remove();
    frame?.remove();
    running = false;
  }
}
