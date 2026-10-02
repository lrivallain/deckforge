// deck.yaml schema: normalization and validation.

import YAML from "yaml";
import { checkSlotLimits } from "./template.js";
import { stripTags } from "./html.js";

export const RUNTIME_MODES = ["local", "cdn", "inline"];
const ID_RE = /^[A-Za-z][\w-]{0,63}$/;
const BRIEF_KEYS = ["topic", "audience", "goal", "sources", "duration", "language", "notes"];

export class DeckError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "DeckError";
    this.details = details;
  }
}

export function parseDeckYaml(source) {
  let raw;
  try {
    raw = YAML.parse(String(source ?? "")) ?? {};
  } catch (err) {
    throw new DeckError(`Invalid deck YAML: ${err.message}`);
  }
  return normalizeDeck(raw);
}

export function stringifyDeck(deck) {
  const clean = {
    meta: pruneEmpty(deck.meta),
    slides: deck.slides.map((slide) => {
      const out = { id: slide.id, template: slide.template };
      if (slide.title) out.title = slide.title;
      if (slide.hidden) out.hidden = true;
      if (slide.footer) out.footer = slide.footer;
      out.data = slide.data || {};
      if (slide.placeholders?.length) out.placeholders = slide.placeholders;
      if (slide.stash && Object.keys(slide.stash).length) out.stash = slide.stash;
      if (slide.notes) out.notes = slide.notes;
      return out;
    }),
  };
  return YAML.stringify(clean, { lineWidth: 0, blockQuote: "literal" });
}

function pruneEmpty(object) {
  const out = {};
  for (const [key, value] of Object.entries(object || {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      const nested = pruneEmpty(value);
      if (Object.keys(nested).length) out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function makeSlideId(existing, base = "slide") {
  const used = new Set(existing);
  const stem = String(base).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "slide";
  const safe = /^[a-z]/.test(stem) ? stem : `s-${stem}`;
  if (!used.has(safe)) return safe;
  for (let i = 2; ; i++) if (!used.has(`${safe}-${i}`)) return `${safe}-${i}`;
}

export function normalizeSlide(raw, existingIds = []) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DeckError("Each slide must be a mapping");
  if (!raw.template || typeof raw.template !== "string") throw new DeckError(`Slide ${raw.id ?? "?"} has no template`);
  let id = raw.id === undefined || raw.id === null ? "" : String(raw.id);
  if (!ID_RE.test(id) || existingIds.includes(id)) id = makeSlideId(existingIds, id || raw.template);
  const slide = {
    id,
    template: raw.template,
    hidden: Boolean(raw.hidden),
    data: raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? raw.data : {},
    notes: raw.notes ? String(raw.notes) : "",
  };
  if (raw.title) slide.title = String(raw.title);
  if (raw.footer) slide.footer = String(raw.footer);
  // Slots filled with template sample text: shown in the editor only.
  if (Array.isArray(raw.placeholders)) {
    const keys = raw.placeholders.map(String).filter((k) => Object.hasOwn(slide.data, k));
    if (keys.length) slide.placeholders = [...new Set(keys)];
  }
  // Content of slots the current template does not use (kept across template switches).
  if (raw.stash && typeof raw.stash === "object" && !Array.isArray(raw.stash) && Object.keys(raw.stash).length) slide.stash = raw.stash;
  return slide;
}

export function normalizeDeck(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DeckError("deck.yaml must be a mapping with meta and slides");
  const metaIn = raw.meta && typeof raw.meta === "object" ? raw.meta : {};
  const meta = {
    title: String(metaIn.title ?? "Untitled deck"),
    lang: String(metaIn.lang ?? "en"),
    theme: String(metaIn.theme ?? "build"),
  };
  for (const key of ["subtitle", "author", "date", "footer", "description"]) if (metaIn[key]) meta[key] = String(metaIn[key]);
  if (metaIn.runtime !== undefined) {
    if (!RUNTIME_MODES.includes(metaIn.runtime)) throw new DeckError(`meta.runtime must be one of ${RUNTIME_MODES.join(", ")}`);
    meta.runtime = metaIn.runtime;
  }
  if (!/^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(meta.lang)) throw new DeckError(`Invalid meta.lang "${meta.lang}"`);
  const brief = {};
  if (metaIn.brief && typeof metaIn.brief === "object") {
    for (const key of BRIEF_KEYS) {
      const value = metaIn.brief[key];
      if (value === undefined || value === null) continue;
      brief[key] = key === "sources" ? [].concat(value).map(String) : String(value);
    }
  }
  meta.brief = brief;
  if (!Array.isArray(raw.slides ?? [])) throw new DeckError("slides must be a list");
  const slides = [];
  for (const entry of raw.slides ?? []) slides.push(normalizeSlide(entry, slides.map((s) => s.id)));
  return { meta, slides };
}

/** Slot values that are real content (sample placeholders removed). */
export function publishedData(slide) {
  if (!slide.placeholders?.length) return slide.data || {};
  const data = { ...slide.data };
  for (const key of slide.placeholders) delete data[key];
  return data;
}

export function slideTitle(slide, template) {
  if (slide.title) return slide.title;
  // Never derive a title from template sample text.
  const data = publishedData(slide);
  for (const key of ["title", "headline", "heading", "quote"]) {
    // Separate adjacent elements (e.g. "<span>From X.</span><span>To Y.</span>").
    if (typeof data[key] === "string" && data[key].trim()) return stripTags(data[key].replace(/>\s*</g, "> <")).slice(0, 80);
  }
  return template?.label || slide.template;
}

/** Validate a normalized deck against the available templates/themes. */
export function validateDeck(deck, { templates = {}, themes = {} } = {}) {
  const issues = [];
  if (Object.keys(themes).length && !themes[deck.meta.theme]) {
    issues.push({ level: "error", message: `Unknown theme "${deck.meta.theme}"` });
  }
  for (const slide of deck.slides) {
    const template = templates[slide.template];
    if (!template) {
      issues.push({ level: "error", slide: slide.id, message: `Unknown template "${slide.template}"` });
      continue;
    }
    for (const key of Object.keys(slide.data || {})) {
      if (!(key in template.slots)) issues.push({ level: "warning", slide: slide.id, message: `Slot "${key}" is not defined by template "${slide.template}"` });
    }
    const placeholders = new Set(slide.placeholders || []);
    for (const issue of checkSlotLimits(template, publishedData(slide))) issues.push({ ...issue, slide: slide.id });
    for (const key of placeholders) {
      if (template.slots[key]?.required) issues.push({ level: "warning", slide: slide.id, slot: key, message: `"${key}" still shows sample text (not published)` });
    }
  }
  return issues;
}
