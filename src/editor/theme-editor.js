// Theme editor: edit every theme token (colours, fonts, radii, spacing, motion,
// shadow) in a form or as YAML, ask Copilot for a palette, preview sample
// slides live, and save to the deck folder or ~/.config/deckforge/themes.
// The YAML document is the source of truth: form edits update it in place so
// comments and font faces survive.

import YAML from "yaml";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { h, icon, debounce, fitFrame, writeFrame, toast } from "./dom.js";
import { api } from "./api.js";
import { op } from "./actions.js";
import { currentTheme, slideDocument, state } from "./state.js";
import { sampleData } from "../core/template.js";
import { colorToHex, FONT_ROLES, normalizeTheme, OPTIONAL_PALETTE_KEYS, PALETTE_KEYS, THEME_DEFAULTS, themeContrastIssues } from "../core/theme.js";

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const PREVIEW_TEMPLATES = ["cover", "concept-map", "points", "metric", "bullets", "title"];

const COLOR_GROUPS = [
  { title: "Surfaces", keys: ["bg", "paper", "node", "line"] },
  { title: "Text", keys: ["ink", "muted"] },
  { title: "Primary", keys: ["primary", "primary-soft", "primary-line", "primary-text"] },
  { title: "Accent", keys: ["accent", "accent-soft", "accent-line", "accent-text"] },
  { title: "Details", keys: ["frame", "dashed", "chrome", "ok"] },
];
const COLOR_HINTS = {
  bg: "Surround behind the slides",
  paper: "Slide background",
  node: "Cards and diagram nodes",
  line: "Borders and dividers",
  ink: "Main text",
  muted: "Secondary text",
  primary: "Main brand colour",
  "primary-soft": "Primary tint behind text",
  "primary-line": "Primary borders",
  "primary-text": "Primary for small text",
  accent: "Restrained emphasis",
  "accent-soft": "Accent tint behind text",
  "accent-line": "Accent borders",
  "accent-text": "Accent for small text",
  frame: "Highlight frame fill",
  dashed: "Dashed lines",
  chrome: "Viewer chrome",
  ok: "Success marks",
};
// What an omitted optional colour falls back to (see normalizeTheme).
const DERIVED = { frame: "accent-soft", dashed: "muted", chrome: "bg", "accent-text": "accent", "primary-text": "primary" };
const TOKEN_GROUPS = [
  { key: "radii", title: "Corner radii" },
  { key: "spacing", title: "Spacing" },
  { key: "motion", title: "Motion" },
  { key: "shadow", title: "Shadow" },
];
const FONT_TITLES = { heading: "Headings", body: "Body text", mono: "Labels (monospace)" };

function sortedThemes() {
  return Object.values(state.themes).sort((a, b) => a.label.localeCompare(b.label));
}

export function openThemeEditor({ initial } = {}) {
  let currentName = initial || state.deck.meta.theme;
  let doc = new YAML.Document({});
  let yamlError = null;
  let yamlStale = true;
  let activeTab = "colors";
  let theme = null;
  let identityTouched = false;
  let revertSource = null;
  let generating = null;

  const list = h("ul", { class: "te-list", "aria-label": "Themes" });
  const nameInput = h("input", { class: "input", id: "th-name", "aria-label": "Theme name", "data-testid": "th-name" });
  const scopeSelect = h("select", { class: "input", id: "th-scope", "aria-label": "Save location" },
    h("option", { value: "deck" }, "This deck (themes/)"),
    h("option", { value: "user" }, `All my decks (${state.configDir || "~/.config/deckforge"}/themes)`),
  );
  const labelInput = h("input", { class: "input", id: "th-label", "data-testid": "th-label" });
  const descInput = h("input", { class: "input", id: "th-description" });
  const schemeSelect = h("select", { class: "input", id: "th-scheme", "data-testid": "th-scheme" },
    h("option", { value: "light" }, "Light"), h("option", { value: "dark" }, "Dark"));

  const tabs = {
    colors: h("button", { type: "button", role: "tab", class: "tab", "aria-selected": "true" }, "Colours"),
    fonts: h("button", { type: "button", role: "tab", class: "tab", "aria-selected": "false" }, "Typography"),
    shape: h("button", { type: "button", role: "tab", class: "tab", "aria-selected": "false" }, "Shape & motion"),
    yaml: h("button", { type: "button", role: "tab", class: "tab", "aria-selected": "false" }, "YAML"),
  };
  const formHost = h("div", { class: "th-form", role: "tabpanel", "data-testid": "th-form" });
  const codeHost = h("div", { class: "te-code", role: "tabpanel", hidden: true, "data-testid": "th-code" });

  // Copilot palette request (kept across form re-renders).
  const promptInput = h("textarea", {
    class: "input", id: "th-prompt", rows: 2, "data-testid": "th-prompt",
    placeholder: "e.g. calm forest greens with a warm copper accent, for a sustainability report",
  });
  const generateBtn = h("button", { type: "button", class: "btn btn-accent btn-sm", "data-testid": "th-generate" });
  const revertBtn = h("button", { type: "button", class: "btn btn-sm btn-ghost", hidden: true, "data-testid": "th-revert" }, icon("undo", 14), "Restore previous colours");
  const copilotBox = h("section", { class: "th-copilot", "aria-labelledby": "th-copilot-title" },
    h("div", { class: "row between" },
      h("label", { id: "th-copilot-title", for: "th-prompt", class: "label" }, icon("sparkles", 14), " Ask Copilot for a palette"),
      revertBtn),
    promptInput,
    h("div", { class: "row between" }, h("span", { class: "field-hint" }, "Copilot fills the colours below. Review them, then save."), generateBtn),
  );

  const swatches = h("div", { class: "th-swatches", "aria-hidden": "true", "data-testid": "th-swatches" });
  const previews = h("div", { class: "th-previews" });
  const issuesList = h("ul", { class: "te-issues", "aria-live": "polite", "data-testid": "th-issues" });
  const saveBtn = h("button", { type: "button", class: "btn btn-primary", "data-testid": "th-save" }, "Save theme");
  const applyBtn = h("button", { type: "button", class: "btn", "data-testid": "th-apply" }, "Use in this deck");

  const dialog = h("dialog", { class: "dialog template-editor theme-editor", "aria-labelledby": "th-title" },
    h("header", { class: "dialog-head" },
      h("h2", { id: "th-title" }, icon("palette", 18), "Theme editor"),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close theme editor", onClick: () => close() }, icon("close")),
    ),
    h("div", { class: "te-body" },
      h("nav", { class: "te-side" },
        h("div", { class: "te-side-head" }, h("span", { class: "label" }, "Themes"),
          h("button", { type: "button", class: "btn btn-sm btn-ghost", onClick: () => load(null) }, icon("plus", 14), "New")),
        list,
      ),
      h("div", { class: "te-main" },
        h("div", { class: "th-general" },
          h("div", { class: "field" }, h("label", { for: "th-label", class: "field-label" }, "Label"), labelInput),
          h("div", { class: "field" }, h("label", { for: "th-description", class: "field-label" }, "Description"), descInput),
          h("div", { class: "field" }, h("label", { for: "th-scheme", class: "field-label" }, "Scheme"), schemeSelect),
        ),
        h("div", { class: "tabs", role: "tablist", "aria-label": "Theme tokens" }, ...Object.values(tabs)),
        formHost,
        codeHost,
      ),
      // Scrollable: focusable so keyboard users can scroll it.
      h("div", { class: "te-preview", role: "region", tabindex: "0", "aria-label": "Theme preview and validation" },
        h("div", { class: "row between" }, h("span", { class: "label" }, "Preview · sample slides"), swatches),
        previews,
        h("h3", { class: "label" }, "Validation"),
        issuesList,
      ),
    ),
    h("footer", { class: "dialog-foot" },
      h("div", { class: "row" }, h("label", { for: "th-name", class: "label" }, "Name"), nameInput, h("label", { for: "th-scope", class: "label" }, "Save to"), scopeSelect),
      h("div", { class: "row" }, h("button", { type: "button", class: "btn", onClick: () => close() }, "Close"), applyBtn, saveBtn),
    ),
  );

  // ---- YAML document helpers -------------------------------------------

  const get = (path) => {
    const value = doc.getIn(path);
    return value === undefined || value === null ? "" : typeof value === "object" ? value : String(value);
  };

  /** Assign one value; a comment on the old value (e.g. "# amber for small text") no longer applies. */
  function put(path, value) {
    doc.setIn(path, value);
    const node = doc.getIn(path, true);
    if (node && typeof node === "object" && "comment" in node) node.comment = undefined;
  }

  /** Set (or delete when empty) one token. `manual` edits drop the Copilot revert offer. */
  function set(path, value, { manual = true } = {}) {
    // The YAML pane holds unparsed text: editing the last valid document would lose it.
    if (activeTab === "yaml" && yamlError) {
      toast("Fix the YAML error before editing these fields.", { kind: "error" });
      renderForm();
      return;
    }
    try {
      if (value === "" || value === null || value === undefined) doc.deleteIn(path);
      else put(path, value);
    } catch (err) {
      toast(`Cannot edit ${path.join(".")}: ${err.message}. Fix the YAML first.`, { kind: "error" });
      return;
    }
    yamlStale = true;
    if (activeTab === "yaml") syncYaml();
    if (manual) dropRevert();
    refresh();
  }

  function setFont(role, field, value) {
    const node = doc.getIn(["fonts", role]);
    if (typeof node === "string") doc.setIn(["fonts", role], doc.createNode({ family: node }));
    set(["fonts", role, field], value.trim());
  }

  function dropRevert() {
    revertSource = null;
    revertBtn.hidden = true;
  }

  // ---- Form ------------------------------------------------------------

  function colorRow(key) {
    const required = PALETTE_KEYS.includes(key);
    const id = `th-color-${key}`;
    const raw = get(["palette", key]);
    const resolved = theme?.palette[key] ?? raw;
    const hex = colorToHex(typeof raw === "string" && raw ? raw : resolved);
    const picker = h("input", { type: "color", class: "th-picker", value: hex || "#000000", "aria-label": `Pick ${key}`, "data-testid": `th-pick-${key}` });
    const placeholder = DERIVED[key] ? `= ${DERIVED[key]}` : required ? "required" : "default";
    const text = h("input", { class: "input input-sm th-value", id, value: typeof raw === "string" ? raw : "", placeholder, spellcheck: "false", autocomplete: "off", "data-key": key });
    if (!hex) {
      picker.disabled = true;
      picker.title = "Not a plain colour (e.g. a gradient): edit the value as text";
    }
    picker.addEventListener("input", () => {
      text.value = picker.value.toUpperCase();
      set(["palette", key], text.value);
    });
    text.addEventListener("input", () => {
      const next = colorToHex(text.value);
      if (next) {
        picker.value = next;
        picker.disabled = false;
      }
      set(["palette", key], text.value.trim());
    });
    return h("div", { class: "th-row", "data-key": key },
      h("label", { for: id, class: "th-key" }, h("span", {}, key, required ? "" : h("span", { class: "muted" }, " · optional")), h("small", { class: "muted" }, COLOR_HINTS[key] || "Custom colour")),
      picker, text);
  }

  function colorsPanel() {
    const known = new Set([...PALETTE_KEYS, ...OPTIONAL_PALETTE_KEYS]);
    const palette = doc.getIn(["palette"]);
    const custom = palette?.items ? palette.items.map((p) => String(p.key?.value ?? p.key)).filter((k) => !known.has(k)) : [];
    const groups = custom.length ? [...COLOR_GROUPS, { title: "Custom", keys: custom }] : COLOR_GROUPS;
    return [copilotBox, ...groups.map((g) => h("fieldset", { class: "th-group" }, h("legend", {}, g.title), ...g.keys.map(colorRow)))];
  }

  function fontsPanel() {
    return [
      h("p", { class: "field-hint" }, "Fonts must be installed on the computers that show the deck; the fallback list is used otherwise. Font files and local names (faces) are edited in the YAML tab."),
      ...FONT_ROLES.map((role) => {
        const node = doc.getIn(["fonts", role]);
        const family = typeof node === "string" ? node : get(["fonts", role, "family"]);
        const fallback = typeof node === "string" ? "" : get(["fonts", role, "fallback"]);
        const faces = typeof node === "object" ? node?.getIn?.(["faces"])?.items?.length || 0 : 0;
        const familyInput = h("input", { class: "input", id: `th-font-${role}`, value: family, placeholder: "System font", "data-testid": `th-font-${role}` });
        const fallbackInput = h("input", { class: "input", id: `th-fallback-${role}`, value: fallback, placeholder: theme?.fonts[role].fallback || "" });
        familyInput.addEventListener("input", () => setFont(role, "family", familyInput.value));
        fallbackInput.addEventListener("input", () => setFont(role, "fallback", fallbackInput.value));
        const sample = h("p", { class: "th-font-sample", style: { fontFamily: theme ? fontCss(theme.fonts[role]) : "" } }, "The quick brown fox jumps over the lazy dog");
        return h("fieldset", { class: "th-group" }, h("legend", {}, FONT_TITLES[role]),
          h("div", { class: "th-pair" },
            h("div", { class: "field" }, h("label", { for: `th-font-${role}`, class: "field-label" }, "Family"), familyInput),
            h("div", { class: "field" }, h("label", { for: `th-fallback-${role}`, class: "field-label" }, "Fallback"), fallbackInput)),
          h("p", { class: "field-hint" }, faces ? `${faces} face${faces > 1 ? "s" : ""} defined in YAML.` : "No faces: the family is used as installed."),
          sample);
      }),
    ];
  }

  function shapePanel() {
    return TOKEN_GROUPS.map(({ key, title }) => h("fieldset", { class: "th-group" }, h("legend", {}, title),
      ...Object.entries(THEME_DEFAULTS[key]).map(([token, fallback]) => {
        const id = `th-${key}-${token}`;
        const input = h("input", { class: "input input-sm", id, value: get([key, token]), placeholder: fallback, spellcheck: "false" });
        input.addEventListener("input", () => set([key, token], input.value.trim()));
        return h("div", { class: "th-row th-row-token" }, h("label", { for: id, class: "th-key" }, token), input);
      }),
    ));
  }

  function renderForm() {
    labelInput.value = get(["label"]);
    descInput.value = get(["description"]);
    schemeSelect.value = get(["colorScheme"]) === "dark" ? "dark" : "light";
    if (activeTab === "yaml") return;
    const panel = activeTab === "colors" ? colorsPanel() : activeTab === "fonts" ? fontsPanel() : shapePanel();
    const scroll = formHost.scrollTop;
    formHost.replaceChildren(...panel);
    formHost.scrollTop = scroll;
  }

  labelInput.addEventListener("input", () => { identityTouched = true; set(["label"], labelInput.value.trim()); });
  descInput.addEventListener("input", () => { identityTouched = true; set(["description"], descInput.value.trim()); });
  schemeSelect.addEventListener("change", () => set(["colorScheme"], schemeSelect.value));

  // ---- YAML tab --------------------------------------------------------

  let applyingYaml = false;
  const onDocChange = EditorView.updateListener.of((update) => {
    if (!update.docChanged || applyingYaml) return;
    const next = YAML.parseDocument(update.state.doc.toString());
    if (next.errors.length) {
      yamlError = next.errors[0].message.split("\n")[0];
    } else {
      yamlError = null;
      doc = next;
      dropRevert();
      const name = doc.get("name");
      if (typeof name === "string" && name !== nameInput.value) nameInput.value = name;
      renderForm(); // label, description and scheme stay visible on the YAML tab
    }
    refresh();
  });
  const view = new EditorView({
    parent: codeHost,
    state: EditorState.create({ doc: "", extensions: [basicSetup, EditorView.lineWrapping, yamlLang(), onDocChange] }),
  });

  function syncYaml() {
    if (!yamlStale) return;
    applyingYaml = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc.toString() } });
    applyingYaml = false;
    yamlStale = false;
    yamlError = null;
  }

  function showTab(tab) {
    activeTab = tab;
    for (const [key, el] of Object.entries(tabs)) el.setAttribute("aria-selected", String(key === tab));
    codeHost.hidden = tab !== "yaml";
    formHost.hidden = tab === "yaml";
    if (tab === "yaml") {
      syncYaml();
      requestAnimationFrame(() => view.requestMeasure());
    } else {
      // Leaving the YAML tab with a parse error keeps the last valid document.
      if (yamlError) {
        yamlError = null;
        yamlStale = true;
        refresh();
      }
      renderForm();
    }
  }
  for (const [key, el] of Object.entries(tabs)) el.addEventListener("click", () => showTab(key));

  // ---- Theme list ------------------------------------------------------

  function renderList() {
    list.replaceChildren(...sortedThemes().map((t) => h("li", {},
      h("button", { type: "button", class: `te-item${t.name === currentName ? " is-selected" : ""}`, "data-theme": t.name, onClick: () => load(t.name) },
        h("span", { class: "th-item-label" }, themeChip(t), t.label, t.name === state.deck.meta.theme ? h("span", { class: "sr-only" }, " (used by this deck)") : ""),
        h("span", { class: `badge${t.scope === "builtin" ? " badge-muted" : ""}` }, t.name === state.deck.meta.theme ? "in use" : t.scope)),
    )));
  }

  function load(name) {
    const entry = name ? state.themes[name] : null;
    const base = entry || currentTheme();
    currentName = entry ? name : null;
    doc = YAML.parseDocument(base?.source || "name: my-theme\n");
    if (doc.errors.length) doc = new YAML.Document({ name: "my-theme" });
    const newName = !entry ? "my-theme" : entry.scope === "builtin" ? `${entry.name}-custom` : entry.name;
    nameInput.value = newName;
    doc.set("name", newName);
    if (!entry) {
      doc.set("label", "My theme");
      doc.set("description", `Based on ${base?.label || "the deck theme"}.`);
    } else if (entry.scope === "builtin") {
      doc.set("label", `${entry.label} (custom)`);
    }
    scopeSelect.value = entry?.scope === "user" ? "user" : "deck";
    if (entry?.scope === "builtin") toast("Built-in themes are read-only: saving creates a copy. Rename it to the built-in name to override it.", { timeout: 5000 });
    identityTouched = false;
    dropRevert();
    yamlError = null;
    yamlStale = true;
    if (activeTab === "yaml") syncYaml();
    renderList();
    refresh.flush();
    renderForm();
  }

  // ---- Copilot ---------------------------------------------------------

  function renderGenerate() {
    const busy = Boolean(generating);
    generateBtn.replaceChildren(busy ? h("span", { class: "ai-spinner", "aria-hidden": "true" }) : icon("sparkles", 14), busy ? "Stop" : "Generate");
    generateBtn.setAttribute("aria-label", busy ? "Stop generating the palette" : "Generate a palette with Copilot");
    promptInput.readOnly = busy;
    copilotBox.classList.toggle("is-busy", busy);
  }

  async function generate() {
    if (generating) {
      generating.abort();
      generating = null;
      renderGenerate();
      return;
    }
    const prompt = promptInput.value.trim();
    if (!prompt) {
      toast("Describe the palette you want, e.g. brand colours, mood or industry.");
      promptInput.focus();
      return;
    }
    const job = new AbortController();
    generating = job;
    renderGenerate();
    try {
      const palette = doc.getIn(["palette"])?.toJSON?.() || {};
      const result = await api.generateTheme({ prompt, current: { palette, colorScheme: get(["colorScheme"]) || "light" } }, { signal: job.signal });
      if (generating !== job) return;
      revertSource = doc.toString();
      for (const key of OPTIONAL_PALETTE_KEYS) if (!(key in result.palette)) doc.deleteIn(["palette", key]);
      for (const [key, value] of Object.entries(result.palette)) put(["palette", key], value);
      doc.set("colorScheme", result.colorScheme);
      if (!identityTouched && result.label) doc.set("label", result.label);
      if (!identityTouched && result.description) doc.set("description", result.description);
      yamlStale = true;
      revertBtn.hidden = false;
      if (activeTab !== "colors") showTab("colors");
      else renderForm();
      refresh.flush();
      toast(`Copilot proposed “${result.label || "a new palette"}”. Review the colours, then save.`, { kind: "success" });
    } catch (err) {
      if (generating !== job) return; // stopped by the user
      const message = err.details?.auth ? `Copilot is not available: ${err.message} ${err.details.hint || ""}` : `Could not generate a palette: ${err.message}`;
      toast(message.trim(), { kind: "error", timeout: 6000 });
    } finally {
      if (generating === job) generating = null;
      renderGenerate();
    }
  }
  generateBtn.addEventListener("click", generate);
  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      generate();
    }
  });
  revertBtn.addEventListener("click", () => {
    if (revertSource === null) return;
    doc = YAML.parseDocument(revertSource);
    dropRevert();
    yamlStale = true;
    if (activeTab === "yaml") syncYaml();
    renderForm();
    refresh.flush();
  });

  // ---- Validation and preview -----------------------------------------

  const frames = [];
  function buildPreviews() {
    const names = PREVIEW_TEMPLATES.filter((n) => state.templates[n]);
    for (const t of state.templateList) if (names.length < 3 && !names.includes(t.name)) names.push(t.name);
    previews.replaceChildren();
    frames.length = 0;
    for (const name of names.slice(0, 3)) {
      const frame = h("iframe", { class: "stage-frame", title: `Theme preview: ${state.templates[name].label}`, "data-testid": "th-frame", tabindex: "-1" });
      const wrap = h("div", { class: "stage-frame-wrap" }, frame);
      const canvas = h("div", { class: "th-canvas" }, wrap);
      previews.append(canvas);
      frames.push({ frame, wrap, canvas, template: state.templates[name] });
      new ResizeObserver(() => {
        const scale = fitFrame(canvas, frame);
        wrap.style.width = `${1280 * scale}px`;
        wrap.style.height = `${720 * scale}px`;
      }).observe(canvas);
    }
  }

  function issue(level, message) {
    return h("li", { class: `te-issue te-${level}` }, icon(level === "ok" ? "check" : "alert", 14), message);
  }

  const refresh = debounce(() => {
    const issues = [];
    if (yamlError) issues.push({ level: "error", message: `YAML: ${yamlError}` });
    const name = nameInput.value.trim();
    if (!NAME_RE.test(name)) issues.push({ level: "error", message: "Name: use lowercase letters, digits and dashes." });
    try {
      const raw = doc.toJS() || {};
      if (raw.name && raw.name !== name) issues.push({ level: "warning", message: `The YAML name “${raw.name}” differs from the file name “${name}”; it must match before saving.` });
      theme = normalizeTheme(raw, { name, scope: "deck" });
      issues.push(...themeContrastIssues(theme));
    } catch (err) {
      for (const d of err.details?.length ? err.details : [err.message]) issues.push({ level: "error", message: d });
    }
    if (theme) {
      for (const { frame, template } of frames) {
        const slide = { id: `preview-${template.name}`, template: template.name, data: sampleData(template), notes: "", hidden: false };
        writeFrame(frame, slideDocument(slide, { deck: { meta: { ...state.deck.meta, theme: theme.name }, slides: [slide] }, theme }));
      }
      swatches.replaceChildren(...["paper", "ink", "primary", "accent", "primary-soft", "accent-soft"].map((k) => h("i", { title: k, style: { background: theme.palette[k] } })));
      // Colour pickers follow derived values (e.g. accent-text = accent).
      for (const row of formHost.querySelectorAll(".th-row[data-key]")) {
        const picker = row.querySelector(".th-picker");
        const text = row.querySelector(".th-value");
        if (picker && text && !text.value && document.activeElement !== picker) {
          const hex = colorToHex(theme.palette[row.dataset.key]);
          if (hex) picker.value = hex;
        }
      }
    }
    issuesList.replaceChildren(...(issues.length ? issues.map((i) => issue(i.level, i.message)) : [issue("ok", "No problems found")]));
    saveBtn.disabled = issues.some((i) => i.level === "error");
    renderApply();
  }, 200);

  function renderApply() {
    const name = nameInput.value.trim();
    applyBtn.disabled = !state.themes[name] || state.deck.meta.theme === name;
    applyBtn.title = !state.themes[name] ? "Save the theme first" : state.deck.meta.theme === name ? "This deck already uses this theme" : `Switch this deck to “${name}”`;
  }

  nameInput.addEventListener("input", () => {
    const name = nameInput.value.trim();
    if (name && !(activeTab === "yaml" && yamlError)) {
      doc.set("name", name);
      yamlStale = true;
      if (activeTab === "yaml") syncYaml();
    }
    refresh();
  });

  // ---- Save / apply ----------------------------------------------------

  async function apply(name) {
    try {
      await op("set_theme", { theme: name }, { label: "Change theme" });
      toast(`This deck now uses “${state.themes[name]?.label || name}”.`, { kind: "success" });
      renderList();
      renderApply();
    } catch {
      /* toast shown */
    }
  }
  applyBtn.addEventListener("click", () => apply(nameInput.value.trim()));

  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!NAME_RE.test(name)) {
      toast("Use lowercase letters, digits and dashes for the theme name.", { kind: "error" });
      return;
    }
    refresh.flush();
    if (saveBtn.disabled) {
      toast("Fix the errors listed under Validation before saving.", { kind: "error" });
      return;
    }
    try {
      const scope = scopeSelect.value;
      const result = await api.saveTheme(name, doc.toString(), scope);
      await waitForRegistry();
      currentName = name;
      renderList();
      renderApply();
      if (!result.active) {
        toast(`Saved ${name}, but a theme with the same name in this deck takes precedence over ${scope === "user" ? "your decks" : "it"}.`, { kind: "error", timeout: 7000 });
      } else if (state.deck.meta.theme === name) {
        toast(`Saved ${name}. This deck uses it: the slides are updated.`, { kind: "success" });
      } else {
        toast(`Saved ${name} (${scope === "user" ? "all decks" : "this deck"})`, { kind: "success", action: "Use in this deck", onAction: () => apply(name), timeout: 8000 });
      }
    } catch (err) {
      toast(err.message, { kind: "error" });
    }
  });

  async function waitForRegistry() {
    const start = state.registryVersion;
    for (let i = 0; i < 20 && state.registryVersion === start; i++) await new Promise((r) => setTimeout(r, 100));
  }

  function close() {
    generating?.abort();
    generating = null;
    view.destroy();
    dialog.close();
    dialog.remove();
  }
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
  buildPreviews();
  renderGenerate();
  load(state.themes[currentName] ? currentName : null);
}

function fontCss(font) {
  return font.family ? `"${font.family}", ${font.fallback}` : font.fallback;
}

function themeChip(t) {
  const p = t.palette || {};
  return h("span", { class: "swatch", "aria-hidden": "true" },
    h("i", { style: { background: p.paper } }), h("i", { style: { background: p.primary } }), h("i", { style: { background: p.accent } }));
}
