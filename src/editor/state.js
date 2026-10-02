// Client-side editor state (mirrors the server snapshot) + render helpers.

import { parseTemplate } from "../core/template.js";
import { renderSlideDocument, visibleSlides } from "../core/render.js";

export const VIEWER_CSS = "/assets/deckforge.viewer.css";
let viewerCssText = null;

/** Fetch the viewer stylesheet once; previews inline it so they style synchronously. */
export async function loadViewerCss() {
  try {
    const res = await fetch(VIEWER_CSS, { credentials: "same-origin" });
    if (res.ok) viewerCssText = await res.text();
  } catch {
    viewerCssText = null;
  }
}

export const state = {
  version: 0,
  registryVersion: 0,
  deck: null,
  templates: {},
  templateList: [],
  themes: {},
  selectedId: null,
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  busy: false,
  lastBuild: null,
  registryErrors: [],
  configDir: "",
  deckFile: "deck.yaml",
  outFile: "deck.html",
  agent: { state: "idle", error: null, hint: null, messages: [] },
  highlights: new Map(),
  connection: "connecting",
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(info = {}) {
  for (const fn of listeners) {
    try {
      fn(info);
    } catch (err) {
      console.error(err);
    }
  }
}

function applyRegistry(snapshot) {
  const templates = {};
  for (const entry of snapshot.templates || []) {
    try {
      templates[entry.name] = parseTemplate(entry.source, { name: entry.name, scope: entry.scope });
    } catch (err) {
      console.warn(`template ${entry.name}: ${err.message}`);
    }
  }
  state.templates = templates;
  state.templateList = (snapshot.templates || []).filter((t) => templates[t.name]);
  state.themes = Object.fromEntries((snapshot.themes || []).map((t) => [t.name, t]));
  state.registryErrors = snapshot.registryErrors || [];
  state.configDir = snapshot.configDir || "";
  state.deckFile = snapshot.deckFile || state.deckFile;
  state.outFile = snapshot.outFile || state.outFile;
}

export function applySnapshot(snapshot, info = {}) {
  if (snapshot.templates) applyRegistry(snapshot);
  state.version = snapshot.version;
  state.registryVersion = snapshot.registryVersion ?? state.registryVersion;
  state.deck = snapshot.deck;
  state.canUndo = snapshot.canUndo;
  state.canRedo = snapshot.canRedo;
  state.undoLabel = snapshot.undoLabel;
  state.redoLabel = snapshot.redoLabel;
  state.busy = Boolean(snapshot.busy);
  if (snapshot.lastBuild) state.lastBuild = snapshot.lastBuild;
  if (snapshot.agent) {
    state.agent.state = snapshot.agent.state;
    state.agent.error = snapshot.agent.error;
    state.agent.hint = snapshot.agent.hint;
    if (!state.agent.messages.length && snapshot.agent.history) {
      state.agent.messages = snapshot.agent.history.map((m) => ({ role: m.role, text: m.text }));
    }
  }
  const ids = state.deck.slides.map((s) => s.id);
  if (!ids.includes(state.selectedId)) {
    const fallback = info.removedIndex !== undefined ? Math.min(info.removedIndex, ids.length - 1) : 0;
    state.selectedId = ids[Math.max(0, fallback)] ?? null;
  }
  notify(info);
}

export function selectedSlide() {
  return state.deck?.slides.find((s) => s.id === state.selectedId) ?? null;
}

export function select(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  notify({ selection: true });
}

export function currentTheme() {
  return state.themes[state.deck?.meta.theme] || state.themes.build || Object.values(state.themes)[0];
}

/** Slide number/total as shown in the generated deck (hidden slides keep their position). */
export function slidePosition(slide) {
  const visible = visibleSlides(state.deck);
  const index = visible.indexOf(slide);
  if (index >= 0) return { index, total: visible.length };
  return { index: state.deck.slides.indexOf(slide), total: visible.length };
}

export function slideDocument(slide, { edit = false, theme = currentTheme(), deck = state.deck, templates = state.templates } = {}) {
  const { index, total } = deck === state.deck ? slidePosition(slide) : { index: 0, total: 1 };
  return renderSlideDocument(deck, slide, { templates, theme, viewerCssHref: VIEWER_CSS, viewerCss: viewerCssText, edit, index, total });
}

export function markChanged(ids) {
  const until = Date.now() + 4000;
  for (const id of ids) state.highlights.set(id, until);
  setTimeout(() => notify({ highlights: true }), 4100);
}

export function isHighlighted(id) {
  const until = state.highlights.get(id);
  if (!until) return false;
  if (until < Date.now()) {
    state.highlights.delete(id);
    return false;
  }
  return true;
}
