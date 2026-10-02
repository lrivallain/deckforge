// Template files: YAML front-matter + HTML body with a tiny mustache-like
// language and <style scoped> blocks.
//
//   {{slot}}                     value formatted by its slot type (escaped)
//   {{#each slot}}…{{/each}}     iterate a list/cards slot ({{this}}, {{@index}}, {{@number}})
//   {{#if slot}}…{{else}}…{{/if}} / {{#unless slot}}…{{/unless}}
//   {{> foot}}                   built-in partial (slide footer)
//   {{slide.number}} {{slide.total}} {{slide.titleId}} {{slide.footer}} {{deck.title}}
//   {{! comment }}

import YAML from "yaml";
import { escapeAttr, escapeHtml, isSafeUrl, sanitizeRichText, stripTags, textToHtml } from "./html.js";
import { renderIcon } from "./icons.js";
import { scopeCss } from "./css.js";

export const SLOT_TYPES = ["text", "richtext", "list", "cards", "icon", "link", "boolean"];
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const RESERVED_SLOTS = new Set(["slide", "deck", "this"]);

export class TemplateError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "TemplateError";
    this.details = details;
  }
}

/** Split "---\nyaml\n---\nbody" into parts. */
export function splitFrontMatter(source) {
  const text = String(source ?? "").replace(/^\uFEFF/, "");
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { frontMatter: "", body: text };
  return { frontMatter: m[1], body: text.slice(m[0].length) };
}

/** Split a template body into html and css (all <style> blocks are scoped). */
export function splitStyles(body) {
  const css = [];
  const html = String(body).replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, content) => {
    css.push(content.trim());
    return "";
  });
  return { html: html.trim(), css: css.join("\n\n") };
}

/** Rebuild a template file from its parts (used by the template editor). */
export function joinTemplateSource({ frontMatter, html, css }) {
  const fm = String(frontMatter ?? "").trim();
  let out = `---\n${fm}\n---\n${String(html ?? "").trim()}\n`;
  if (css && css.trim()) out += `\n<style scoped>\n${css.trim()}\n</style>\n`;
  return out;
}

// ---------------------------------------------------------------- tokenizer

function tokenize(source) {
  const tokens = [];
  let inTag = false;
  let quote = null;
  let pos = 0;
  const re = /\{\{(!--[\s\S]*?--|![\s\S]*?|[^}]*?)\}\}/g;
  const trackLiteral = (text) => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inTag) {
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ">") inTag = false;
      } else if (ch === "<" && /[a-zA-Z/!]/.test(text[i + 1] || "")) {
        inTag = true;
      }
    }
  };
  let m;
  while ((m = re.exec(source))) {
    if (m.index > pos) {
      const text = source.slice(pos, m.index);
      tokens.push({ type: "text", value: text });
      trackLiteral(text);
    }
    const raw = m[1].trim();
    pos = m.index + m[0].length;
    if (raw.startsWith("!")) continue;
    tokens.push({ type: "tag", raw, inTag, index: m.index });
  }
  if (pos < source.length) tokens.push({ type: "text", value: source.slice(pos) });
  return tokens;
}

function parse(source) {
  const root = { type: "root", children: [] };
  const stack = [root];
  const current = () => stack[stack.length - 1];
  for (const token of tokenize(source)) {
    if (token.type === "text") {
      current().children.push(token);
      continue;
    }
    const { raw } = token;
    const block = /^#(each|if|unless)\s+([\w.@-]+)$/.exec(raw);
    if (block) {
      const node = { type: block[1], path: block[2], children: [], alternate: null };
      current().children.push(node);
      stack.push(node);
      continue;
    }
    if (raw === "else") {
      const node = current();
      if (node.type === "root" || node.type === "else") throw new TemplateError("Unexpected {{else}}");
      const alt = { type: "else", parent: node, children: [] };
      node.alternate = alt;
      stack.push(alt);
      continue;
    }
    const close = /^\/(each|if|unless)$/.exec(raw);
    if (close) {
      if (current().type === "else") stack.pop();
      const node = stack.pop();
      if (!node || node.type !== close[1]) throw new TemplateError(`Unexpected {{/${close[1]}}}`);
      continue;
    }
    const partial = /^>\s*([\w-]+)$/.exec(raw);
    if (partial) {
      current().children.push({ type: "partial", name: partial[1] });
      continue;
    }
    if (/^[\w.@-]+$/.test(raw)) {
      current().children.push({ type: "value", path: raw, inTag: token.inTag });
      continue;
    }
    throw new TemplateError(`Invalid tag {{${raw}}}`);
  }
  if (current().type === "else") stack.pop();
  if (stack.length !== 1) throw new TemplateError(`Unclosed {{#${current().type} ${current().path}}}`);
  return root;
}

// ---------------------------------------------------------------- schema

const SLOT_PROPERTIES = new Set(["type", "max", "required", "sample", "description", "label", "fields", "of", "maxLength"]);

function normalizeSlot(name, def, errors, where = "") {
  if (typeof def === "string") def = { type: def };
  if (!def || typeof def !== "object") {
    errors.push(`Slot "${where}${name}" must be an object or a type name`);
    return { type: "text" };
  }
  for (const key of Object.keys(def)) {
    // Usually an unquoted comma in a YAML flow mapping: { sample: a, b }.
    if (!SLOT_PROPERTIES.has(key)) errors.push(`Slot "${where}${name}" has an unknown property "${key}" (quote values that contain commas)`);
  }
  const slot = { ...def, type: def.type || "text" };
  if (!SLOT_TYPES.includes(slot.type)) {
    errors.push(`Slot "${where}${name}" has unknown type "${slot.type}" (expected ${SLOT_TYPES.join(", ")})`);
    slot.type = "text";
  }
  if (slot.type === "cards") {
    const fields = {};
    for (const [key, value] of Object.entries(def.fields || {})) fields[key] = normalizeSlot(key, value, errors, `${where}${name}.`);
    slot.fields = fields;
  }
  if (slot.type === "list") slot.of = ["text", "richtext"].includes(def.of) ? def.of : "text";
  if (slot.max !== undefined && !(Number.isInteger(slot.max) && slot.max > 0)) {
    errors.push(`Slot "${where}${name}" max must be a positive integer`);
    delete slot.max;
  }
  return slot;
}

export function parseTemplate(source, { name, scope = "builtin", path = null } = {}) {
  const { frontMatter, body } = splitFrontMatter(source);
  const errors = [];
  let meta;
  try {
    meta = frontMatter ? YAML.parse(frontMatter) || {} : {};
  } catch (err) {
    throw new TemplateError(`Invalid front-matter YAML: ${err.message}`);
  }
  if (typeof meta !== "object" || Array.isArray(meta)) throw new TemplateError("Front-matter must be a mapping");
  const templateName = String(meta.name || name || "").trim();
  if (!NAME_RE.test(templateName)) errors.push(`Template name "${templateName}" must match ${NAME_RE}`);
  const slots = {};
  for (const [key, def] of Object.entries(meta.slots || {})) {
    if (RESERVED_SLOTS.has(key) || key === "__proto__" || key === "constructor" || key === "prototype") errors.push(`Slot name "${key}" is reserved`);
    else if (!/^[A-Za-z_][\w-]*$/.test(key)) errors.push(`Invalid slot name "${key}"`);
    slots[key] = normalizeSlot(key, def, errors);
  }
  const { html, css } = splitStyles(body);
  let ast;
  try {
    ast = parse(html);
  } catch (err) {
    throw new TemplateError(err.message);
  }
  if (errors.length) throw new TemplateError(`Invalid template "${templateName}": ${errors[0]}`, errors);
  const template = {
    name: templateName,
    label: meta.label || templateName,
    description: String(meta.description || ""),
    category: meta.category || "content",
    order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : 50,
    classes: String(meta.class || "").split(/\s+/).filter(Boolean),
    slots,
    html,
    css,
    scopedCss: scopeCss(css, `.df-t-${templateName}`),
    source: String(source),
    scope,
    path,
    ast,
  };
  template.issues = analyzeTemplate(template);
  return template;
}

/** Static checks: unknown slot references and unused slots. */
export function analyzeTemplate(template) {
  const issues = [];
  const used = new Set();
  const walk = (nodes, scopes) => {
    for (const node of nodes) {
      if (node.type === "text" || node.type === "partial") continue;
      if (node.type === "value" || node.type === "if" || node.type === "unless" || node.type === "each") {
        const head = node.path.split(".")[0];
        if (!(head.startsWith("@") || head === "this" || head === "slide" || head === "deck")) {
          const found = [...scopes].reverse().find((s) => s.fields && Object.hasOwn(s.fields, head));
          if (!found) issues.push({ level: "error", message: `Unknown slot "${node.path}"` });
          else if (found.root) used.add(head);
        }
      }
      if (node.type === "each") {
        const head = node.path.split(".")[0];
        const found = [...scopes].reverse().find((s) => s.fields && Object.hasOwn(s.fields, head));
        const slot = found?.fields[head];
        if (slot && slot.type !== "list" && slot.type !== "cards") {
          issues.push({ level: "error", message: `{{#each ${node.path}}} needs a list or cards slot` });
        }
        walk(node.children, [...scopes, { fields: slot?.type === "cards" ? slot.fields : {} }]);
        if (node.alternate) walk(node.alternate.children, scopes);
        continue;
      }
      if (node.children) walk(node.children, scopes);
      if (node.alternate) walk(node.alternate.children, scopes);
    }
  };
  walk(template.ast.children, [{ fields: template.slots, root: true }]);
  for (const key of Object.keys(template.slots)) {
    if (!used.has(key)) issues.push({ level: "warning", message: `Slot "${key}" is declared but never used` });
  }
  return issues;
}

// ---------------------------------------------------------------- rendering

const PARTIALS = {
  foot: parse('<footer class="foot"><span>{{slide.footer}}</span><span class="num">{{slide.number}} / {{slide.total}}</span></footer>'),
};

function truthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(value);
}

function linkParts(value) {
  if (!value) return { label: "", href: "" };
  if (typeof value === "string") return { label: value, href: value };
  return { label: String(value.label ?? value.href ?? ""), href: String(value.href ?? "") };
}

function formatValue(value, type, { inTag, edit, path }) {
  if (value === undefined || value === null) value = "";
  if (inTag) {
    if (type === "link") return escapeAttr(isSafeUrl(linkParts(value).href) ? linkParts(value).href : "");
    if (type === "boolean") return value ? "true" : "false";
    if (Array.isArray(value) || typeof value === "object") return "";
    return escapeAttr(type === "richtext" ? stripTags(value) : String(value));
  }
  let html;
  switch (type) {
    case "richtext":
      html = sanitizeRichText(value);
      break;
    case "icon":
      return renderIcon(value);
    case "link": {
      const { label, href } = linkParts(value);
      if (!label) return "";
      if (!isSafeUrl(href)) return escapeHtml(label);
      const external = !href.startsWith("#");
      return `<a href="${escapeAttr(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(label)}</a>`;
    }
    case "boolean":
      return value ? "true" : "";
    case "list":
    case "cards":
      return "";
    default:
      html = textToHtml(typeof value === "object" ? "" : value);
  }
  if (edit && path) {
    // A custom element keeps template selectors such as `.label span` unaffected.
    return `<df-slot class="df-slot" data-df-slot="${escapeAttr(path)}" data-df-type="${type === "richtext" ? "richtext" : "text"}">${html}</df-slot>`;
  }
  return html;
}

function lookup(path, frames) {
  const parts = path.split(".");
  const head = parts[0];
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    if (head.startsWith("@")) {
      if (frame.loop && head in frame.loop) return { value: frame.loop[head], type: "text" };
      continue;
    }
    if (head === "this") {
      if (frame.item === undefined) continue;
      return resolveIn(frame.item, frame.itemSchema, parts.slice(1), frame.path);
    }
    if (frame.fields && (Object.hasOwn(frame.fields, head) || (frame.value && typeof frame.value === "object" && Object.hasOwn(frame.value, head)))) {
      return resolveIn(frame.value?.[head], frame.fields[head] || { type: "text" }, parts.slice(1), frame.path ? `${frame.path}.${head}` : head);
    }
  }
  return { value: undefined, type: "text", path: null };
}

function resolveIn(value, schema, rest, path) {
  let type = schema?.type || "text";
  let current = value;
  let currentSchema = schema;
  let currentPath = path;
  for (const part of rest) {
    if (current === undefined || current === null) break;
    if (typeof current !== "object" || !Object.hasOwn(current, part)) {
      current = undefined;
      break;
    }
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      currentSchema = currentSchema?.type === "cards" ? { type: "object", fields: currentSchema.fields } : { type: currentSchema?.of || "text" };
    } else {
      current = current[part];
      currentSchema = currentSchema?.fields?.[part] || { type: "text" };
    }
    currentPath = currentPath ? `${currentPath}.${part}` : part;
    type = currentSchema?.type || "text";
  }
  return { value: current, type, schema: currentSchema, path: currentPath };
}

function renderNodes(nodes, frames, options, out) {
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out.push(node.value);
        break;
      case "value": {
        const { value, type, path } = lookup(node.path, frames);
        const editable = options.edit && path && !path.startsWith("slide.") && !path.startsWith("deck.");
        out.push(formatValue(value, type, { inTag: node.inTag, edit: editable, path }));
        break;
      }
      case "partial": {
        const partial = PARTIALS[node.name];
        if (partial) renderNodes(partial.children, frames, options, out);
        break;
      }
      case "if":
      case "unless": {
        const { value } = lookup(node.path, frames);
        const pass = node.type === "if" ? truthy(value) : !truthy(value);
        if (pass) renderNodes(node.children, frames, options, out);
        else if (node.alternate) renderNodes(node.alternate.children, frames, options, out);
        break;
      }
      case "each": {
        const resolved = lookup(node.path, frames);
        const items = Array.isArray(resolved.value) ? resolved.value : [];
        if (!items.length) {
          if (node.alternate) renderNodes(node.alternate.children, frames, options, out);
          break;
        }
        const schema = resolved.schema || {};
        items.forEach((item, index) => {
          const isCards = schema.type === "cards";
          const itemPath = resolved.path ? `${resolved.path}.${index}` : null;
          const frame = {
            item,
            itemSchema: isCards ? { type: "object", fields: schema.fields } : { type: schema.of || "text" },
            path: itemPath,
            loop: {
              "@index": index,
              "@number": String(index + 1).padStart(2, "0"),
              "@first": index === 0,
              "@last": index === items.length - 1,
            },
          };
          if (isCards) {
            frame.fields = schema.fields || {};
            frame.value = item && typeof item === "object" ? item : {};
          }
          renderNodes(node.children, [...frames, frame], options, out);
        });
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Render a template body.
 * @param {object} template parsed template
 * @param {object} data slot values
 * @param {object} ctx { slide: {...builtins}, deck: {...builtins}, edit: boolean }
 */
export function renderTemplate(template, data, ctx = {}) {
  const out = [];
  const builtins = {
    fields: { slide: { type: "object", fields: BUILTIN_SLIDE_FIELDS }, deck: { type: "object", fields: BUILTIN_DECK_FIELDS } },
    value: { slide: ctx.slide || {}, deck: ctx.deck || {} },
    path: "",
  };
  const frames = [builtins, { fields: template.slots, value: data || {}, path: "" }];
  renderNodes(template.ast.children, frames, { edit: Boolean(ctx.edit) }, out);
  return out.join("");
}

const BUILTIN_SLIDE_FIELDS = {
  id: { type: "text" },
  number: { type: "text" },
  total: { type: "text" },
  index: { type: "text" },
  titleId: { type: "text" },
  title: { type: "text" },
  footer: { type: "richtext" },
};
const BUILTIN_DECK_FIELDS = {
  title: { type: "text" },
  subtitle: { type: "text" },
  author: { type: "text" },
  date: { type: "text" },
  footer: { type: "richtext" },
  lang: { type: "text" },
};

/** Build sample data from slot definitions. */
export function sampleData(template) {
  const data = {};
  for (const [key, slot] of Object.entries(template.slots)) {
    if (slot.sample !== undefined) data[key] = structuredClone(slot.sample);
    else if (slot.type === "list" || slot.type === "cards") data[key] = [];
    else if (slot.type === "boolean") data[key] = false;
    else data[key] = "";
  }
  return data;
}

/** Check slot values against template limits. Returns [{level, slot, message}]. */
export function checkSlotLimits(template, data) {
  const issues = [];
  const check = (slot, value, path) => {
    if (value === undefined || value === null || value === "") {
      if (slot.required) issues.push({ level: "warning", slot: path, message: `"${path}" is required` });
      return;
    }
    if ((slot.type === "list" || slot.type === "cards") && Array.isArray(value)) {
      if (slot.max && value.length > slot.max) issues.push({ level: "warning", slot: path, message: `"${path}" has ${value.length} items (max ${slot.max})` });
      if (slot.type === "cards") value.forEach((item, i) => {
        for (const [key, field] of Object.entries(slot.fields || {})) check(field, item?.[key], `${path}.${i}.${key}`);
      });
      else if (slot.maxLength) value.forEach((item, i) => check({ type: slot.of, max: slot.maxLength }, item, `${path}.${i}`));
      return;
    }
    if ((slot.type === "text" || slot.type === "richtext") && slot.max) {
      const length = stripTags(String(value)).length;
      if (length > slot.max) issues.push({ level: "warning", slot: path, message: `"${path}" is ${length} characters (max ${slot.max})` });
    }
  };
  for (const [key, slot] of Object.entries(template.slots)) check(slot, data?.[key], key);
  return issues;
}
