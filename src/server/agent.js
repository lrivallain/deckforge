// Embedded Copilot agent (via @github/copilot-sdk). The agent can only use
// the deck tools defined here; every turn is one undo group.

import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { slideTitle } from "../core/deck.js";
import { applyOp, OpError } from "../core/ops.js";
import { slideImageSources } from "../core/image.js";
import { OVERLAY_KINDS, OVERLAY_OPTIONS } from "../core/overlay.js";
import { systemPrompt } from "./prompt.js";
import { listAssets, resolveAsset } from "./assets.js";

const TURN_TIMEOUT_MS = 5 * 60 * 1000;
export const AUTH_HINT = "Sign in with `gh auth login` (GitHub CLI) or `copilot` → `/login` (Copilot CLI), then retry. A GitHub Copilot subscription is required.";

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

const SLIDE_SCOPED_OPS = new Set(["update_slide", "set_template", "set_hidden", "set_image", "add_overlay", "update_overlay", "remove_overlay"]);

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

export class AgentController extends EventEmitter {
  constructor({ store, factory, log = () => {} }) {
    super();
    this.store = store;
    this.factory = factory || defaultFactory();
    this.log = log;
    this.state = "idle";
    this.error = null;
    this.client = null;
    this.session = null;
    this.turn = null;
    this.history = [];
  }

  status() {
    return { state: this.state, error: this.error, history: this.history.slice(-50), hint: this.error?.auth ? AUTH_HINT : null };
  }

  setState(state, error = null) {
    this.state = state;
    this.error = error;
    this.emit("event", { type: "status", state, error });
  }

  record(entry) {
    this.history.push({ ...entry, at: Date.now() });
    if (this.history.length > 200) this.history.shift();
  }

  buildTools() {
    const store = this.store;
    const handlers = {
      get_deck: () => ({
        meta: store.deck.meta,
        slides: store.deck.slides.map((s, index) => ({ index, ...s, navTitle: slideTitle(s, store.templates[s.template]) })),
        scope: this.turn?.scope === "slide" ? { scope: "this slide", slideId: this.turn.slideId } : { scope: "whole deck" },
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
      if (!this.turn || !this.store.group) throw new OpError("No active request: changes are only accepted while answering the user.");
      if (this.turn.scope === "slide") {
        if (!SLIDE_SCOPED_OPS.has(name)) throw new OpError(`"${name}" is not allowed: the user limited this request to one slide (${this.turn.slideId}).`);
        if (args.id !== this.turn.slideId) throw new OpError(`Out of scope: only slide "${this.turn.slideId}" may be modified in this request.`);
      }
      const opArgs = TOOL_ARGS[name] ? TOOL_ARGS[name](args) : args;
      // The agent may only use images that are already in the deck's assets/ folder.
      const preview = applyOp(store.deck, name, opArgs, store.ctx);
      for (const src of newImageSources(store.deck, preview.deck, store.templates, preview.changed)) {
        if (!resolveAsset(store.deckDir, String(src))) throw new OpError(`Image "${src}" is not a file in assets/. Call list_assets; you cannot fetch images from the web.`);
      }
      const result = store.apply(name, opArgs, { source: "agent", label: name });
      this.emit("event", { type: "tool", name, args, result });
      return { ok: true, ...result };
    };
    for (const name of ["update_slide", "add_slide", "remove_slide", "move_slide", "set_hidden", "set_template", "set_theme", "update_meta", "set_image", "add_overlay", "update_overlay", "remove_overlay"]) handlers[name] = mutate(name);

    return deckToolSpecs().map((spec) => ({
      ...spec,
      skipPermission: true,
      defer: "never",
      handler: async (args) => {
        try {
          const result = await handlers[spec.name](args || {});
          return JSON.stringify(result);
        } catch (err) {
          this.emit("event", { type: "tool_error", name: spec.name, message: err.message });
          return { textResultForLlm: `Error: ${err.message}`, resultType: "failure", error: err.message };
        }
      },
    }));
  }

  ensureSession() {
    if (this.session) return Promise.resolve(this.session);
    // Memoize the in-flight start so concurrent callers share one client.
    this.starting ??= this.startSession().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async startSession() {
    this.setState("starting");
    try {
      this.client = await this.factory.createClient({ cwd: this.store.deckDir });
      if (typeof this.client.getAuthStatus === "function") {
        const auth = await this.client.getAuthStatus().catch(() => null);
        if (auth && auth.isAuthenticated === false) {
          throw Object.assign(new Error(`Not signed in to GitHub Copilot. ${auth.statusMessage || ""}`.trim()), { auth: true });
        }
      }
      const tools = this.buildTools();
      const names = new Set(tools.map((t) => t.name));
      this.session = await this.client.createSession({
        model: process.env.DECKFORGE_MODEL || undefined,
        streaming: true,
        tools,
        availableTools: [...names].map((n) => `custom:${n}`),
        workingDirectory: this.store.deckDir,
        systemMessage: {
          mode: "customize",
          sections: {
            identity: { action: "replace", content: "You are the deckforge presentation assistant." },
            code_change_rules: { action: "remove" },
          },
          content: systemPrompt({ deck: this.store.deck, templates: this.store.templates }),
        },
        onPermissionRequest: (request) =>
          request.kind === "custom-tool" && names.has(request.toolName)
            ? { kind: "approve-once" }
            : { kind: "reject", feedback: "deckforge only allows the deck tools." },
      });
      this.session.on((event) => this.onSessionEvent(event));
      this.setState("idle");
      return this.session;
    } catch (err) {
      const auth = err.auth || /auth|login|token|credential|unauthori[sz]ed|401|not signed/i.test(err.message);
      this.session = null;
      await this.disposeClient();
      this.setState("error", { message: err.message, auth });
      throw err;
    }
  }

  onSessionEvent(event) {
    const turn = this.turn;
    switch (event.type) {
      case "assistant.message_delta":
        if (turn) turn.text += event.data?.deltaContent ?? "";
        this.emit("event", { type: "delta", text: event.data?.deltaContent ?? "" });
        break;
      case "assistant.message":
        if (turn && event.data?.content) turn.final = event.data.content;
        this.emit("event", { type: "message", text: event.data?.content ?? "" });
        break;
      case "tool.execution_start":
        this.emit("event", { type: "tool_start", name: event.data?.toolName });
        break;
      case "session.error":
        this.finishTurn({ message: event.data?.message || "The agent failed", auth: /auth|login|401|token/i.test(event.data?.message || "") });
        break;
      case "session.idle":
        this.finishTurn();
        break;
      default:
        break;
    }
  }

  finishTurn(error = null, expected = this.turn) {
    const turn = this.turn;
    if (!turn || turn !== expected) return;
    clearTimeout(turn.timer);
    this.turn = null;
    const changed = this.store.endGroup();
    const text = turn.final || turn.text;
    if (text) this.record({ role: "assistant", text });
    if (error) this.record({ role: "error", text: error.message });
    this.emit("event", { type: "done", changed, error, text });
    this.setState(error ? "error" : "idle", error);
  }

  async chat({ prompt, scope = "deck", slideId = null }) {
    prompt = String(prompt || "").trim();
    if (!prompt) throw new OpError("Empty prompt");
    if (this.turn || this.pending) throw new OpError("The agent is still working on the previous request");
    if (scope === "slide" && !this.store.deck.slides.some((s) => s.id === slideId)) throw new OpError("Select a slide first");
    this.record({ role: "user", text: prompt, scope, slideId });
    this.pending = true;
    // Run asynchronously; progress is streamed as events.
    (async () => {
      try {
        await this.ensureSession();
      } catch (err) {
        this.pending = false;
        this.emit("event", { type: "done", changed: [], error: { message: err.message, auth: Boolean(this.error?.auth) }, text: "" });
        this.record({ role: "error", text: err.message });
        return;
      }
      this.pending = false;
      const turn = { scope, slideId, text: "", final: "" };
      turn.timer = setTimeout(() => {
        if (this.turn === turn) this.abort("timeout");
      }, TURN_TIMEOUT_MS);
      this.turn = turn;
      this.store.beginGroup(`Agent: ${prompt.slice(0, 48)}`, "agent");
      this.setState("busy");
      this.emit("event", { type: "start", scope, slideId });
      const slide = scope === "slide" ? this.store.deck.slides.find((s) => s.id === slideId) : null;
      const context = slide
        ? `[Scope: THIS SLIDE ONLY – id "${slide.id}", template "${slide.template}". Do not modify other slides.]\nCurrent slide data: ${JSON.stringify({ data: slide.data, notes: slide.notes })}`
        : "[Scope: whole deck]";
      try {
        await this.session.send({ prompt: `${context}\n\n${prompt}` });
      } catch (err) {
        this.finishTurn({ message: err.message, auth: /auth|login|401|token/i.test(err.message) }, turn);
      }
    })();
  }

  async abort(reason = "aborted") {
    if (!this.turn) return false;
    try {
      await this.session?.abort?.();
    } catch {
      /* ignore */
    }
    this.finishTurn(reason === "timeout" ? { message: "The agent timed out" } : null);
    return true;
  }

  async reset() {
    await this.abort();
    try {
      await this.session?.disconnect?.();
    } catch {
      /* ignore */
    }
    this.session = null;
    this.history = [];
    this.setState("idle");
    return true;
  }

  async disposeClient() {
    try {
      await this.client?.stop?.();
    } catch {
      /* ignore */
    }
    this.client = null;
  }

  async dispose() {
    await this.abort();
    try {
      await this.session?.disconnect?.();
    } catch {
      /* ignore */
    }
    this.session = null;
    await this.disposeClient();
  }
}

/** Default factory: real SDK, or a mock module when DECKFORGE_AGENT_MOCK is set (tests). */
export function defaultFactory() {
  return {
    async createClient({ cwd }) {
      if (process.env.DECKFORGE_AGENT_MOCK) {
        const mod = await import(pathToFileURL(path.resolve(process.env.DECKFORGE_AGENT_MOCK)).href);
        return mod.createClient({ cwd });
      }
      let sdk;
      try {
        sdk = await import("@github/copilot-sdk");
      } catch (err) {
        throw new Error(`The Copilot SDK is not installed (${err.message}). It is an optional dependency: install it with "npm install @github/copilot-sdk" next to deckforge.`, { cause: err });
      }
      const client = new sdk.CopilotClient({ workingDirectory: cwd, logLevel: "error", useLoggedInUser: true });
      await client.start();
      return client;
    },
  };
}
