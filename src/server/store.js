// Server-side deck state: load/persist deck.yaml, apply ops, undo/redo
// groups, rebuild deck.html, watch the deck directory for external edits.

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { parseDeckYaml, stringifyDeck } from "../core/deck.js";
import { applyOp, OpError } from "../core/ops.js";
import { parseTemplate } from "../core/template.js";
import { buildDeckObject, outputPathFor, writeFileAtomic } from "./build.js";
import { configDir, loadTemplates, loadThemes, templateDirFor } from "./registry.js";

const COALESCE_MS = 2000;
const MAX_UNDO = 200;

export class DeckStore extends EventEmitter {
  constructor({ deckPath, runtime, log = () => {} }) {
    super();
    this.deckPath = path.resolve(deckPath);
    this.deckDir = path.dirname(this.deckPath);
    this.outPath = outputPathFor(this.deckPath);
    this.runtime = runtime;
    this.log = log;
    this.version = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.group = null;
    this.lastWritten = null;
    this.buildTimer = null;
    this.watchers = [];
    this.lastBuild = null;
    this.loadRegistry();
    this.loadDeck();
  }

  loadRegistry() {
    const t = loadTemplates(this.deckDir);
    const th = loadThemes(this.deckDir);
    this.templates = t.templates;
    this.themes = th.themes;
    this.registryErrors = [...t.errors, ...th.errors];
    this.registryVersion = (this.registryVersion || 0) + 1;
  }

  loadDeck() {
    const source = fs.readFileSync(this.deckPath, "utf8");
    this.deck = parseDeckYaml(source);
    this.lastWritten = source;
    this.version++;
  }

  get ctx() {
    return { templates: this.templates, themes: this.themes };
  }

  /** Small state payload broadcast on every change. */
  lightSnapshot() {
    return {
      version: this.version,
      registryVersion: this.registryVersion,
      deck: this.deck,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
      busy: Boolean(this.group),
    };
  }

  snapshot() {
    return {
      ...this.lightSnapshot(),
      version: this.version,
      deck: this.deck,
      deckPath: this.deckPath,
      deckFile: path.basename(this.deckPath),
      outFile: path.basename(this.outPath),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
      templates: Object.values(this.templates)
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
        .map((t) => ({ name: t.name, label: t.label, description: t.description, category: t.category, scope: t.scope, source: t.source })),
      themes: Object.values(this.themes).map((t) => ({ name: t.name, label: t.label, description: t.description, scope: t.scope, css: t.css, palette: t.palette })),
      registryErrors: this.registryErrors.map((e) => ({ path: path.relative(this.deckDir, e.path) || e.path, message: e.message })),
      configDir: configDir(),
      lastBuild: this.lastBuild,
    };
  }

  /** Apply an operation. Returns the op result. */
  apply(name, args, { source = "user", label, coalesce } = {}) {
    // Keep agent turns atomic: their undo entry must only contain agent changes.
    if (this.group && source !== this.group.source) {
      throw new OpError("Copilot is applying changes. Wait for it to finish or press Stop, then edit again.");
    }
    const before = this.deck;
    const { deck, changed, result } = applyOp(before, name, args, this.ctx);
    this.deck = deck;
    this.version++;
    const now = Date.now();
    if (this.group) {
      this.group.changed.push(...changed);
    } else {
      const top = this.undoStack.at(-1);
      if (coalesce && top && top.coalesce === coalesce && now - top.at < COALESCE_MS && !this.redoStack.length) {
        top.after = deck;
        top.at = now;
      } else {
        this.pushUndo({ before, after: deck, label: label || name, source, coalesce, at: now });
      }
    }
    this.persist();
    this.emitChange({ changed, source, op: name });
    return result;
  }

  pushUndo(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  beginGroup(label, source = "agent") {
    if (this.group) return;
    this.group = { before: this.deck, label, source, changed: [] };
  }

  endGroup() {
    const group = this.group;
    this.group = null;
    if (!group || group.before === this.deck) return [];
    this.pushUndo({ before: group.before, after: this.deck, label: group.label, source: group.source, at: Date.now() });
    this.emitChange({ changed: [], source: group.source, op: "group" });
    return [...new Set(group.changed)];
  }

  undo() {
    if (this.group) throw new OpError("Cannot undo while the agent is working");
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push(entry);
    this.deck = entry.before;
    this.version++;
    this.persist();
    this.emitChange({ changed: this.deck.slides.map((s) => s.id), source: "undo", op: "undo", label: entry.label });
    return true;
  }

  redo() {
    if (this.group) throw new OpError("Cannot redo while the agent is working");
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push(entry);
    this.deck = entry.after;
    this.version++;
    this.persist();
    this.emitChange({ changed: this.deck.slides.map((s) => s.id), source: "redo", op: "redo", label: entry.label });
    return true;
  }

  emitChange(info) {
    this.emit("change", { ...info, version: this.version });
  }

  persist() {
    const yaml = stringifyDeck(this.deck);
    if (yaml !== this.lastWritten) {
      this.lastWritten = yaml;
      writeFileAtomic(this.deckPath, yaml);
    }
    this.scheduleBuild();
  }

  scheduleBuild(delay = 150) {
    clearTimeout(this.buildTimer);
    this.buildTimer = setTimeout(() => this.build(), delay);
  }

  build() {
    clearTimeout(this.buildTimer);
    try {
      const { issues, runtime } = buildDeckObject(this.deck, {
        deckDir: this.deckDir, outPath: this.outPath, runtime: this.runtime, templates: this.templates, themes: this.themes,
      });
      this.lastBuild = { at: new Date().toISOString(), ok: true, runtime, issues };
    } catch (err) {
      this.lastBuild = { at: new Date().toISOString(), ok: false, error: err.message };
      this.log(`build failed: ${err.message}`);
    }
    this.emit("built", this.lastBuild);
    return this.lastBuild;
  }

  /** Save a template file (scope: deck | user). */
  saveTemplate(name, source, scope) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new OpError("Template names use lowercase letters, digits and dashes");
    const template = parseTemplate(source, { name, scope });
    if (template.name !== name) throw new OpError(`front-matter name "${template.name}" must match "${name}"`);
    const dir = templateDirFor(scope, this.deckDir);
    const file = path.resolve(dir, `${name}.html`);
    if (path.dirname(file) !== path.resolve(dir)) throw new OpError("Invalid template path");
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(file, source);
    this.loadRegistry();
    this.version++;
    this.scheduleBuild();
    this.emitChange({ changed: this.deck.slides.filter((s) => s.template === name).map((s) => s.id), source: "template", op: "save_template" });
    return { name, scope, path: file, issues: template.issues };
  }

  watch() {
    const onDeck = () => {
      clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(() => {
        let source;
        try {
          source = fs.readFileSync(this.deckPath, "utf8");
        } catch {
          return;
        }
        if (source === this.lastWritten) return;
        try {
          const deck = parseDeckYaml(source);
          this.pushUndo({ before: this.deck, after: deck, label: "external edit", source: "disk", at: Date.now() });
          this.deck = deck;
          this.lastWritten = source;
          this.version++;
          this.scheduleBuild();
          this.emitChange({ changed: deck.slides.map((s) => s.id), source: "disk", op: "reload" });
        } catch (err) {
          this.log(`ignored invalid external edit: ${err.message}`);
          this.emit("warning", { message: `deck.yaml was edited outside the editor but is invalid: ${err.message}` });
        }
      }, 120);
    };
    const onRegistry = () => {
      clearTimeout(this.registryTimer);
      this.registryTimer = setTimeout(() => {
        this.loadRegistry();
        this.version++;
        this.scheduleBuild();
        this.emitChange({ changed: this.deck.slides.map((s) => s.id), source: "disk", op: "registry" });
      }, 150);
    };
    const tryWatch = (target, handler, filter) => {
      try {
        const w = fs.watch(target, (event, file) => {
          if (!filter || filter(file)) handler();
        });
        w.on("error", () => {});
        this.watchers.push(w);
      } catch {
        /* directory may not exist */
      }
    };
    const deckFile = path.basename(this.deckPath);
    tryWatch(this.deckDir, onDeck, (file) => file === deckFile);
    for (const dir of [path.join(this.deckDir, "templates"), path.join(this.deckDir, "themes"), path.join(configDir(), "templates"), path.join(configDir(), "themes")]) {
      tryWatch(dir, onRegistry);
    }
  }

  close() {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    clearTimeout(this.buildTimer);
    clearTimeout(this.watchTimer);
    clearTimeout(this.registryTimer);
  }
}
