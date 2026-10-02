// Pure deck mutations shared by the editor UI and the agent tools.
// Every op takes (deck, args, ctx) and returns { deck, changed: [slideIds], result }.
// The input deck is never mutated.

import { makeSlideId, normalizeSlide } from "./deck.js";
import { sampleData } from "./template.js";
import { RUNTIME_MODES } from "./deck.js";

export class OpError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpError";
  }
}

const clone = (value) => structuredClone(value);

function findIndex(deck, id) {
  const index = deck.slides.findIndex((s) => s.id === id);
  if (index === -1) throw new OpError(`No slide with id "${id}"`);
  return index;
}

function requireTemplate(ctx, name) {
  const template = ctx.templates?.[name];
  if (!template) throw new OpError(`Unknown template "${name}". Available: ${Object.keys(ctx.templates || {}).join(", ")}`);
  return template;
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const KEY_RE = /^(?:\d+|[A-Za-z_][\w-]*)$/;

function checkKey(key) {
  if (UNSAFE_KEYS.has(key) || !KEY_RE.test(key)) throw new OpError(`Invalid slot key "${key}"`);
  return key;
}

/** Deep-copy plain data, rejecting keys that could pollute prototypes. */
function cleanData(value, depth = 0) {
  if (depth > 12) throw new OpError("Slot data is nested too deeply");
  if (Array.isArray(value)) return value.map((item) => cleanData(item, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[checkKey(key)] = cleanData(value[key], depth + 1);
    return out;
  }
  return value;
}

function setPath(target, path, value) {
  const parts = String(path).split(".").map(checkKey);
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = /^\d+$/.test(parts[i]) && Array.isArray(node) ? Number(parts[i]) : parts[i];
    if (!Object.hasOwn(node, key) || node[key] === null || typeof node[key] !== "object") {
      node[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    node = node[key];
  }
  const last = parts[parts.length - 1];
  const key = /^\d+$/.test(last) && Array.isArray(node) ? Number(last) : last;
  if (value === null) {
    if (Array.isArray(node)) node.splice(key, 1);
    else delete node[key];
  } else node[key] = value;
}

function hasContent(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false; // booleans are layout switches, never placeholder content
}

function compatible(slot, value) {
  if (value === undefined || value === null) return false;
  if (slot.type === "list" || slot.type === "cards") return Array.isArray(value);
  if (slot.type === "boolean") return typeof value === "boolean";
  if (slot.type === "link") return typeof value === "string" || (typeof value === "object" && !Array.isArray(value));
  return typeof value === "string";
}

/**
 * Fill a slide's data for a template. Real content is taken from `provided`,
 * then the current data, then the stash; slots without content get the
 * template sample marked as placeholder. Real values the template does not
 * use are kept in `slide.stash` so switching back restores them.
 */
function fitToTemplate(slide, template, provided = {}) {
  const placeholders = new Set(slide.placeholders || []);
  const pool = { ...(slide.stash || {}) };
  for (const [key, value] of Object.entries(slide.data || {})) if (!placeholders.has(key)) pool[key] = value;
  Object.assign(pool, provided);
  const sample = sampleData(template);
  const data = {};
  const nextPlaceholders = [];
  for (const [key, slot] of Object.entries(template.slots)) {
    if (compatible(slot, pool[key])) {
      data[key] = pool[key];
      delete pool[key];
    } else {
      data[key] = sample[key];
      if (hasContent(sample[key])) nextPlaceholders.push(key);
    }
  }
  for (const key of Object.keys(pool)) if (!hasContent(pool[key]) && typeof pool[key] !== "boolean") delete pool[key];
  slide.data = data;
  if (nextPlaceholders.length) slide.placeholders = nextPlaceholders;
  else delete slide.placeholders;
  if (Object.keys(pool).length) slide.stash = pool;
  else delete slide.stash;
  return slide;
}

function realize(slide, keys) {
  if (!slide.placeholders) return;
  const touched = new Set(keys);
  slide.placeholders = slide.placeholders.filter((k) => !touched.has(k));
  if (!slide.placeholders.length) delete slide.placeholders;
}

function slideLabel(deck, slide) {
  return `Slide ${deck.slides.indexOf(slide) + 1}`;
}

export const OPS = {
  update_slide(deck, { id, data, set, notes, title, footer, replace = false }) {
    const next = clone(deck);
    const slide = next.slides[findIndex(next, id)];
    if (data !== undefined) {
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new OpError("data must be an object of slot values");
      const clean = cleanData(data);
      slide.data = replace ? clean : { ...slide.data, ...clean };
      for (const [key, value] of Object.entries(slide.data)) if (value === null) delete slide.data[key];
      if (replace) delete slide.placeholders;
      else realize(slide, Object.keys(clean));
    }
    if (set !== undefined) {
      if (!set || typeof set !== "object") throw new OpError("set must map slot paths to values");
      for (const [path, value] of Object.entries(set)) setPath(slide.data, path, cleanData(value));
      realize(slide, Object.keys(set).map((path) => String(path).split(".")[0]));
    }
    if (notes !== undefined) slide.notes = String(notes ?? "");
    if (title !== undefined) {
      if (title) slide.title = String(title);
      else delete slide.title;
    }
    if (footer !== undefined) {
      if (footer) slide.footer = String(footer);
      else delete slide.footer;
    }
    return { deck: next, changed: [id], result: { id } };
  },

  add_slide(deck, { template, data, notes, after, index, id, title }, ctx) {
    const tpl = requireTemplate(ctx, template);
    const next = clone(deck);
    const slide = normalizeSlide(
      { id: id || makeSlideId(next.slides.map((s) => s.id), title || template), template, data: {}, notes, title },
      next.slides.map((s) => s.id),
    );
    fitToTemplate(slide, tpl, data ? cleanData(data) : {});
    let position = next.slides.length;
    if (after !== undefined && after !== null) position = findIndex(next, after) + 1;
    else if (Number.isInteger(index)) position = Math.max(0, Math.min(next.slides.length, index));
    next.slides.splice(position, 0, slide);
    return { deck: next, changed: [slide.id], result: { id: slide.id, index: position } };
  },

  duplicate_slide(deck, { id }) {
    const next = clone(deck);
    const index = findIndex(next, id);
    const copy = clone(next.slides[index]);
    copy.id = makeSlideId(next.slides.map((s) => s.id), `${id}-copy`);
    next.slides.splice(index + 1, 0, copy);
    return { deck: next, changed: [copy.id], result: { id: copy.id, index: index + 1 } };
  },

  remove_slide(deck, { id }) {
    const next = clone(deck);
    next.slides.splice(findIndex(next, id), 1);
    return { deck: next, changed: [], result: { removed: id } };
  },

  move_slide(deck, { id, index, after }) {
    const next = clone(deck);
    const from = findIndex(next, id);
    const [slide] = next.slides.splice(from, 1);
    let to;
    if (after !== undefined) to = after === null ? 0 : findIndex(next, after) + 1;
    else if (Number.isInteger(index)) to = Math.max(0, Math.min(next.slides.length, index));
    else throw new OpError("move_slide needs index or after");
    next.slides.splice(to, 0, slide);
    return { deck: next, changed: [id], result: { id, index: to } };
  },

  set_hidden(deck, { id, hidden }) {
    const next = clone(deck);
    next.slides[findIndex(next, id)].hidden = Boolean(hidden);
    return { deck: next, changed: [id], result: { id, hidden: Boolean(hidden) } };
  },

  set_template(deck, { id, template, data }, ctx) {
    const tpl = requireTemplate(ctx, template);
    const next = clone(deck);
    const slide = next.slides[findIndex(next, id)];
    const from = slide.template;
    const fromLabel = ctx.templates?.[from]?.label || from;
    // A navigation title equal to the old template's label described the layout, not the content.
    if (slide.title && slide.title === fromLabel) delete slide.title;
    slide.template = template;
    fitToTemplate(slide, tpl, data ? cleanData(data) : {});
    const label = `${slideLabel(next, slide)}: ${fromLabel} → ${tpl.label}`;
    return { deck: next, changed: [id], result: { id, template, from, label, stashed: Object.keys(slide.stash || {}) } };
  },

  set_theme(deck, { theme }, ctx) {
    if (ctx.themes && !ctx.themes[theme]) throw new OpError(`Unknown theme "${theme}". Available: ${Object.keys(ctx.themes).join(", ")}`);
    const next = clone(deck);
    next.meta.theme = theme;
    return { deck: next, changed: next.slides.map((s) => s.id), result: { theme } };
  },

  update_meta(deck, { meta }) {
    if (!meta || typeof meta !== "object") throw new OpError("meta must be an object");
    const next = clone(deck);
    for (const [key, value] of Object.entries(meta)) {
      if (key === "brief") {
        const known = ["topic", "audience", "goal", "sources", "duration", "language", "notes"];
        const patch = Object.fromEntries(Object.entries(value || {}).filter(([k]) => known.includes(k)));
        next.meta.brief = { ...next.meta.brief, ...patch };
        for (const [k, v] of Object.entries(next.meta.brief)) if (v === null || v === "") delete next.meta.brief[k];
        if (next.meta.brief.sources && !Array.isArray(next.meta.brief.sources)) next.meta.brief.sources = [String(next.meta.brief.sources)];
      } else if (["title", "subtitle", "author", "date", "footer", "description", "lang"].includes(key)) {
        if (value === null || value === "") {
          if (key === "title" || key === "lang") throw new OpError(`meta.${key} cannot be empty`);
          delete next.meta[key];
        } else next.meta[key] = String(value);
      } else if (key === "runtime") {
        if (!RUNTIME_MODES.includes(value)) throw new OpError(`runtime must be one of ${RUNTIME_MODES.join(", ")}`);
        next.meta.runtime = value;
      } else if (key === "theme") {
        throw new OpError("Use set_theme to change the theme");
      } else throw new OpError(`Unknown meta field "${key}"`);
    }
    return { deck: next, changed: next.slides.map((s) => s.id), result: { meta: next.meta } };
  },
};

export function applyOp(deck, name, args = {}, ctx = {}) {
  const op = OPS[name];
  if (!op) throw new OpError(`Unknown operation "${name}"`);
  return op(deck, args || {}, ctx);
}
