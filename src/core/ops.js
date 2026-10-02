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

/** Keep data keys compatible with a (new) template. */
function adaptData(data, template) {
  const out = {};
  const sample = sampleData(template);
  for (const [key, slot] of Object.entries(template.slots)) {
    const value = data?.[key];
    const ok =
      value !== undefined &&
      ((slot.type === "list" || slot.type === "cards") ? Array.isArray(value) : slot.type === "boolean" ? typeof value === "boolean" : typeof value === "string" || (slot.type === "link" && typeof value === "object"));
    out[key] = ok ? value : sample[key];
  }
  return out;
}

export const OPS = {
  update_slide(deck, { id, data, set, notes, title, footer, replace = false }) {
    const next = clone(deck);
    const slide = next.slides[findIndex(next, id)];
    if (data !== undefined) {
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new OpError("data must be an object of slot values");
      slide.data = replace ? cleanData(data) : { ...slide.data, ...cleanData(data) };
      for (const [key, value] of Object.entries(slide.data)) if (value === null) delete slide.data[key];
    }
    if (set !== undefined) {
      if (!set || typeof set !== "object") throw new OpError("set must map slot paths to values");
      for (const [path, value] of Object.entries(set)) setPath(slide.data, path, cleanData(value));
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
      { id: id || makeSlideId(next.slides.map((s) => s.id), title || template), template, data: data ? { ...sampleData(tpl), ...cleanData(data) } : sampleData(tpl), notes, title },
      next.slides.map((s) => s.id),
    );
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
    slide.template = template;
    slide.data = adaptData(data ? { ...slide.data, ...cleanData(data) } : slide.data, tpl);
    return { deck: next, changed: [id], result: { id, template } };
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
