// Deck tools shared by the embedded Copilot chat (SDK custom tools) and the
// `deckforge mcp` server: JSON-schema specs plus handlers bound to a DeckStore.

import { slideTitle } from "../core/deck.js";
import { applyOp, OpError } from "../core/ops.js";
import { slideImageSources } from "../core/image.js";
import { OVERLAY_KINDS, OVERLAY_OPTIONS } from "../core/overlay.js";
import { listAssets, resolveAsset } from "./assets.js";
import { mcpGuide } from "./prompt.js";

const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const ID = { type: "string", description: "Slide id" };
const GEOMETRY = {
  x: { type: "number", description: "Left edge, % of the slide width (0–100)" },
  y: { type: "number", description: "Top edge, % of the slide height (0–100)" },
  w: { type: "number", description: "Width, % of the slide width" },
  h: { type: "number", description: "Height, % of the slide height" },
  z: { type: "integer", description: "Stacking order among overlays (higher is in front)" },
  rotate: { type: "number", description: "Rotation in degrees (0 to clear)" },
  order: { type: ["integer", "null"], description: "Reveal step (0 = with the first template element); omit to reveal after the template, null to clear" },
};
const OVERLAY_DATA = {
  type: "object",
  additionalProperties: true,
  description: `Kind-specific fields, theme tokens only. text: {text (richtext), style: ${OVERLAY_OPTIONS.text.style.join("|")}, align: ${OVERLAY_OPTIONS.text.align.join("|")}, color: ${OVERLAY_OPTIONS.text.color.join("|")}}. callout: {text, tone: ${OVERLAY_OPTIONS.callout.tone.join("|")}, align}. arrow: {color: ${OVERLAY_OPTIONS.arrow.color.join("|")}, head: ${OVERLAY_OPTIONS.arrow.head.join("|")}, weight: ${OVERLAY_OPTIONS.arrow.weight.join("|")}, line: solid|dashed} (points right; use rotate). shape: {shape: ${OVERLAY_OPTIONS.shape.shape.join("|")}, fill: ${OVERLAY_OPTIONS.shape.fill.join("|")}, stroke: ${OVERLAY_OPTIONS.shape.stroke.join("|")}}. image: {src: "assets/…" from list_assets, alt (required), fit: cover|contain, focus: "x% y%"}.`,
};

/** Tool definitions (JSON schema) – shared by the real SDK and the mock. */
export function deckToolSpecs() {
  return [
    { name: "get_deck", description: "Return the full deck: meta (title, lang, theme, footer, brief) and slides (id, template, hidden, title, data, notes) in order.", parameters: obj({}) },
    { name: "list_templates", description: "List available slide templates with their description and slot schema (type, max, fields).", parameters: obj({}) },
    { name: "list_themes", description: "List available themes (name, label, description).", parameters: obj({}) },
    {
      name: "update_slide",
      description: "Update one slide. `data` merges top-level slot values (null deletes a slot). `set` assigns values by dotted path, e.g. {\"cards.0.title\": \"New\"}. Also updates notes, nav title or footer override.",
      parameters: obj({
        id: ID,
        data: { type: "object", description: "Slot values to merge", additionalProperties: true },
        set: { type: "object", description: "Dotted slot path → value", additionalProperties: true },
        notes: { type: "string", description: "Speaker notes (replaces existing)" },
        title: { type: "string", description: "Short title used in navigation (optional)" },
        footer: { type: "string", description: "Footer override for this slide (richtext); empty string to clear" },
      }, ["id"]),
    },
    {
      name: "add_slide",
      description: "Insert a new slide using a template. Slots you do not provide show the template's sample text as editor-only placeholders (listed in the slide's `placeholders`, never published), so provide real data for every slot that should appear.",
      parameters: obj({
        template: { type: "string" },
        data: { type: "object", additionalProperties: true },
        notes: { type: "string" },
        title: { type: "string", description: "Short navigation title" },
        after: { type: "string", description: "Insert after this slide id (default: end of deck)" },
        id: { type: "string", description: "Optional explicit id (letters, digits, dashes)" },
      }, ["template"]),
    },
    { name: "remove_slide", description: "Delete a slide.", parameters: obj({ id: ID }, ["id"]) },
    {
      name: "move_slide",
      description: "Move a slide to a new 0-based index, or after another slide (after: null moves it first).",
      parameters: obj({ id: ID, index: { type: "integer", minimum: 0 }, after: { type: ["string", "null"] } }, ["id"]),
    },
    { name: "set_hidden", description: "Hide or show a slide (hidden slides are skipped in the presentation).", parameters: obj({ id: ID, hidden: { type: "boolean" } }, ["id", "hidden"]) },
    {
      name: "set_template",
      description: "Change a slide's template. Compatible slot values are kept; values the new template does not use are kept in the slide's `stash` and restored if it switches back. Provide `data` for new slots, otherwise they become editor-only sample placeholders.",
      parameters: obj({ id: ID, template: { type: "string" }, data: { type: "object", additionalProperties: true } }, ["id", "template"]),
    },
    { name: "set_theme", description: "Switch the deck theme.", parameters: obj({ theme: { type: "string" } }, ["theme"]) },
    { name: "list_assets", description: "List the image files already in the deck's assets/ folder (path, type, pixel size, slides using them). Only these files can be used; you cannot download images.", parameters: obj({}) },
    {
      name: "set_image",
      description: "Put an image from assets/ into a slide's image slot (default: the template's first image slot). Always write a concise, descriptive alt text; when you cannot know what the image shows, derive it from the file name/slide context and tell the user it is a suggestion to check.",
      parameters: obj({
        id: ID,
        path: { type: "string", description: "Asset path from list_assets, e.g. assets/1a2b3c4d5e6f.png" },
        alt: { type: "string", description: "Alternative text (what the image shows, for screen readers)" },
        fit: { type: "string", enum: ["cover", "contain"], description: "cover crops to fill the frame, contain shows the whole image" },
        focus: { type: "string", description: "Focal point kept visible when cropping, \"x% y%\" (default \"50% 50%\")" },
        slot: { type: "string", description: "Image slot name (optional)" },
      }, ["id", "path", "alt"]),
    },
    {
      name: "add_overlay",
      description: `Add a freely positioned element above a slide's template (${OVERLAY_KINDS.join(", ")}). Geometry is in % of the 1280×720 slide. Keep overlays inside the slide and off the template's text. Prefer template slots; use overlays for annotations (arrows, callouts) and extra pictures.`,
      parameters: obj({ id: ID, kind: { type: "string", enum: OVERLAY_KINDS }, ...GEOMETRY, data: OVERLAY_DATA }, ["id", "kind", "x", "y", "w", "h"]),
    },
    {
      name: "update_overlay",
      description: "Move, resize or edit an overlay. Only the given properties change; data fields are merged.",
      parameters: obj({ id: ID, overlayId: { type: "string" }, ...GEOMETRY, data: OVERLAY_DATA }, ["id", "overlayId"]),
    },
    { name: "remove_overlay", description: "Delete an overlay from a slide.", parameters: obj({ id: ID, overlayId: { type: "string" } }, ["id", "overlayId"]) },
    {
      name: "update_meta",
      description: "Update deck metadata: title, subtitle, author, date, footer, description, lang, and brief {topic, audience, goal, sources[], duration}.",
      parameters: obj({ meta: { type: "object", additionalProperties: true } }, ["meta"]),
    },
  ];
}

export const SLIDE_SCOPED_OPS = new Set(["update_slide", "set_template", "set_hidden", "set_image", "add_overlay", "update_overlay", "remove_overlay"]);

// Tool arguments → op arguments.
const TOOL_ARGS = {
  add_overlay: ({ id, ...overlay }) => ({ id, overlay }),
  update_overlay: ({ id, overlayId, ...props }) => ({ id, overlayId, props }),
};

/** Image sources a change introduces (slots and overlays of the changed slides). */
function newImageSources(before, after, templates, ids) {
  const out = [];
  for (const id of ids) {
    const next = after.slides.find((s) => s.id === id);
    if (!next) continue;
    const prev = before.slides.find((s) => s.id === id);
    const known = new Set(prev ? slideImageSources(prev, templates[prev.template]) : []);
    for (const src of slideImageSources(next, templates[next.template])) if (!known.has(src)) out.push(src);
  }
  return out;
}

const GUIDE_TOOL = {
  name: "get_authoring_guide",
  description: "Return the deckforge authoring guide for this deck: how to use these tools, design rules, the deck brief and the template catalogue (slots). Call it once before editing.",
  parameters: obj({}),
};

/** Tools of the `deckforge mcp` server: the deck tools plus the authoring guide. */
export const mcpToolSpecs = () => [GUIDE_TOOL, ...deckToolSpecs()];

export const MUTATING_TOOLS = ["update_slide", "add_slide", "remove_slide", "move_slide", "set_hidden", "set_template", "set_theme", "update_meta", "set_image", "add_overlay", "update_overlay", "remove_overlay"];

/**
 * Tool handlers bound to a store. Read tools return plain data; mutating tools
 * validate images against assets/ and apply the op through store.apply().
 * - guard(name, args): throw to refuse a change (e.g. outside an agent turn);
 * - deckScope(): extra "scope" field for get_deck;
 * - applyOptions(name): options for store.apply (source, label, coalesce…);
 * - onApplied({ name, args, result }): called after each successful change;
 * - guide: also handle get_authoring_guide (MCP).
 */
export function deckToolHandlers(store, { guard, deckScope, applyOptions = () => ({}), onApplied, guide = false } = {}) {
  const handlers = {
    ...(guide ? { get_authoring_guide: () => ({ guide: mcpGuide({ deck: store.deck, templates: store.templates, deckPath: store.deckPath }) }) } : {}),
    get_deck: () => ({
      meta: store.deck.meta,
      slides: store.deck.slides.map((s, index) => ({ index, ...s, navTitle: slideTitle(s, store.templates[s.template]) })),
      ...(deckScope ? { scope: deckScope() } : {}),
    }),
    list_templates: () => Object.values(store.templates).map((t) => ({ name: t.name, label: t.label, description: t.description, category: t.category, slots: t.slots })),
    list_themes: () => Object.values(store.themes).map((t) => ({ name: t.name, label: t.label, description: t.description, current: t.name === store.deck.meta.theme })),
    list_assets: () => {
      const usage = new Map();
      for (const slide of store.deck.slides) {
        for (const src of slideImageSources(slide, store.templates[slide.template])) usage.set(src, [...(usage.get(src) || []), slide.id]);
      }
      return { assets: listAssets(store.deckDir).map((a) => ({ ...a, usedBy: [...new Set(usage.get(a.path) || [])] })) };
    },
  };
  const mutate = (name) => (args) => {
    guard?.(name, args);
    const opArgs = TOOL_ARGS[name] ? TOOL_ARGS[name](args) : args;
    // Copilot may only use images that are already in the deck's assets/ folder.
    const preview = applyOp(store.deck, name, opArgs, store.ctx);
    for (const src of newImageSources(store.deck, preview.deck, store.templates, preview.changed)) {
      if (!resolveAsset(store.deckDir, String(src))) throw new OpError(`Image "${src}" is not a file in assets/. Call list_assets; you cannot fetch images from the web.`);
    }
    const result = store.apply(name, opArgs, { label: name, ...applyOptions(name) });
    onApplied?.({ name, args, result });
    return { ok: true, ...result };
  };
  for (const name of MUTATING_TOOLS) handlers[name] = mutate(name);
  return handlers;
}
