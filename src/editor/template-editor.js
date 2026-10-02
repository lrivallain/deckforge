// Template editor: front-matter / HTML / CSS in CodeMirror, live preview with
// sample data, theme switcher, validation (unknown slots, overflow at 1280×720)
// and save to the deck folder or ~/.config/deckforge/templates.

import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { html as htmlLang } from "@codemirror/lang-html";
import { css as cssLang } from "@codemirror/lang-css";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { h, icon, debounce, fitFrame, writeFrame, toast } from "./dom.js";
import { api } from "./api.js";
import { currentTheme, slideDocument, state } from "./state.js";
import { joinTemplateSource, parseTemplate, sampleData, splitFrontMatter, splitStyles, checkSlotLimits } from "../core/template.js";

const NEW_TEMPLATE = `---
name: my-template
label: My template
description: Describe when to use this layout.
category: content
slots:
  eyebrow: { type: text, max: 40, sample: "Section / topic" }
  title: { type: richtext, max: 60, required: true, sample: 'A clear <span class="blue">headline</span>' }
  cards:
    type: cards
    max: 3
    fields:
      title: { type: text, max: 24 }
      text: { type: text, max: 70 }
    sample:
      - { title: First, text: One short sentence. }
      - { title: Second, text: One short sentence. }
      - { title: Third, text: One short sentence. }
---
<header class="header reveal">
  <div><p class="eyebrow">{{eyebrow}}</p><h1 id="{{slide.titleId}}">{{title}}</h1></div>
</header>
<div class="grid">
  {{#each cards}}<article class="card reveal"><h2>{{title}}</h2><p>{{text}}</p></article>{{/each}}
</div>
{{> foot}}

<style scoped>
.grid { flex: 1; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: var(--df-space-grid); align-items: center; }
.card p { margin-top: .6cqw; font-size: 1.7cqw; line-height: 1.4; color: var(--df-muted); }
</style>
`;

function withName(frontMatter, name) {
  return /^name:.*$/m.test(frontMatter) ? frontMatter.replace(/^name:.*$/m, `name: ${name}`) : `name: ${name}\n${frontMatter}`;
}

function splitSource(source) {
  const { frontMatter, body } = splitFrontMatter(source);
  const { html, css } = splitStyles(body);
  return { frontMatter, html, css };
}

export function openTemplateEditor({ initial } = {}) {
  let currentName = initial || state.deck.slides.find((s) => s.id === state.selectedId)?.template || state.templateList[0]?.name;
  let parts = { frontMatter: "", html: "", css: "" };
  let activeTab = "frontMatter";
  let parsed = null;
  let previewTheme = state.deck.meta.theme;

  const list = h("ul", { class: "te-list", "aria-label": "Templates" });
  const nameInput = h("input", { class: "input", id: "te-name", "aria-label": "Template name", "data-testid": "te-name" });
  const scopeSelect = h("select", { class: "input", id: "te-scope", "aria-label": "Save location" },
    h("option", { value: "deck" }, "This deck (templates/)"),
    h("option", { value: "user" }, `All my decks (${state.configDir || "~/.config/deckforge"}/templates)`),
  );
  const themeSelect = h("select", { class: "input input-sm", "aria-label": "Preview theme" },
    Object.values(state.themes).map((t) => h("option", { value: t.name, selected: t.name === previewTheme }, t.label)),
  );
  const tabs = {
    frontMatter: h("button", { type: "button", role: "tab", class: "tab", "aria-selected": "true" }, "Front-matter"),
    html: h("button", { type: "button", role: "tab", class: "tab", "aria-selected": "false" }, "HTML"),
    css: h("button", { type: "button", role: "tab", class: "tab", "aria-selected": "false" }, "CSS"),
  };
  const editorHost = h("div", { class: "te-code", "data-testid": "te-code" });
  const frame = h("iframe", { class: "stage-frame", title: "Template preview", "data-testid": "te-frame" });
  const frameWrap = h("div", { class: "stage-frame-wrap" }, frame);
  const canvas = h("div", { class: "te-canvas" }, frameWrap);
  const issuesList = h("ul", { class: "te-issues", "aria-live": "polite", "data-testid": "te-issues" });
  const saveBtn = h("button", { type: "button", class: "btn btn-primary", "data-testid": "te-save" }, "Save template");

  const dialog = h("dialog", { class: "dialog template-editor", "aria-labelledby": "te-title" },
    h("header", { class: "dialog-head" },
      h("h2", { id: "te-title" }, icon("code", 18), "Template editor"),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close template editor", onClick: () => close() }, icon("close")),
    ),
    h("div", { class: "te-body" },
      h("nav", { class: "te-side" },
        h("div", { class: "te-side-head" }, h("span", { class: "label" }, "Templates"),
          h("button", { type: "button", class: "btn btn-sm btn-ghost", onClick: () => load(null) }, icon("plus", 14), "New")),
        list,
      ),
      h("div", { class: "te-main" },
        h("div", { class: "tabs", role: "tablist", "aria-label": "Template parts" }, tabs.frontMatter, tabs.html, tabs.css),
        editorHost,
      ),
      h("div", { class: "te-preview" },
        h("div", { class: "row between" }, h("span", { class: "label" }, "Preview · sample data"), themeSelect),
        canvas,
        h("h3", { class: "label" }, "Validation"),
        issuesList,
      ),
    ),
    h("footer", { class: "dialog-foot" },
      h("div", { class: "row" }, h("label", { for: "te-name", class: "label" }, "Name"), nameInput, h("label", { for: "te-scope", class: "label" }, "Save to"), scopeSelect),
      h("div", { class: "row" }, h("button", { type: "button", class: "btn", onClick: () => close() }, "Close"), saveBtn),
    ),
  );

  const view = new EditorView({
    parent: editorHost,
    state: EditorState.create({ doc: "", extensions: [basicSetup, EditorView.lineWrapping] }),
  });
  const languages = { frontMatter: yamlLang(), html: htmlLang(), css: cssLang() };
  const states = {};
  const onDocChange = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      parts[activeTab] = update.state.doc.toString();
      refresh();
    }
  });

  function makeState(tab) {
    return EditorState.create({ doc: parts[tab], extensions: [basicSetup, EditorView.lineWrapping, languages[tab], onDocChange] });
  }

  function showTab(tab) {
    if (states[activeTab]) states[activeTab] = view.state;
    activeTab = tab;
    for (const [key, el] of Object.entries(tabs)) el.setAttribute("aria-selected", String(key === tab));
    view.setState(states[tab] || (states[tab] = makeState(tab)));
  }
  for (const [key, el] of Object.entries(tabs)) el.addEventListener("click", () => showTab(key));

  function renderList() {
    list.replaceChildren(...state.templateList.map((t) => h("li", {},
      h("button", { type: "button", class: `te-item${t.name === currentName ? " is-selected" : ""}`, onClick: () => load(t.name) },
        h("span", {}, t.label), h("span", { class: `badge${t.scope === "builtin" ? " badge-muted" : ""}` }, t.scope)),
    )));
  }

  function load(name) {
    currentName = name;
    const entry = state.templateList.find((t) => t.name === name);
    parts = splitSource(entry ? entry.source : NEW_TEMPLATE);
    for (const key of Object.keys(states)) delete states[key];
    nameInput.value = entry ? (entry.scope === "builtin" ? `${entry.name}-custom` : entry.name) : "my-template";
    parts.frontMatter = withName(parts.frontMatter, nameInput.value);
    scopeSelect.value = entry?.scope === "user" ? "user" : "deck";
    if (entry?.scope === "builtin") toast("Built-in templates are read-only: saving creates a copy. Keep the same name to override it.", { timeout: 5000 });
    showTab(activeTab);
    renderList();
    refresh.flush();
  }

  function issue(level, message) {
    return h("li", { class: `te-issue te-${level}` }, icon(level === "ok" ? "check" : "alert", 14), message);
  }

  const refresh = debounce(() => {
    const issues = [];
    const name = nameInput.value.trim();
    const source = joinTemplateSource(parts);
    try {
      const fmName = (/^name:\s*(.+)$/m.exec(parts.frontMatter) || [])[1]?.trim();
      parsed = parseTemplate(source, { name: fmName || name, scope: "deck" });
      if (fmName && fmName !== name) issues.push({ level: "warning", message: `Front-matter name “${fmName}” differs from the file name “${name}”; it must match before saving.` });
      issues.push(...parsed.issues);
      issues.push(...checkSlotLimits(parsed, sampleData(parsed)).map((i) => ({ ...i, message: `Sample: ${i.message}` })));
    } catch (err) {
      parsed = null;
      issues.push({ level: "error", message: err.message });
      for (const d of err.details?.slice(1) || []) issues.push({ level: "error", message: d });
    }
    if (parsed) {
      const slide = { id: "preview", template: parsed.name, data: sampleData(parsed), notes: "", hidden: false };
      const deck = { meta: { ...state.deck.meta }, slides: [slide] };
      const theme = state.themes[previewTheme] || currentTheme();
      writeFrame(frame, slideDocument(slide, { deck, theme, templates: { ...state.templates, [parsed.name]: parsed } }));
    }
    renderIssues(issues);
  }, 250);

  function renderIssues(issues) {
    issuesList.replaceChildren(...issues.map((i) => issue(i.level, i.message)));
    issuesList.dataset.static = JSON.stringify(issues);
    checkOverflow();
  }

  function checkOverflow() {
    const doc = frame.contentDocument;
    const slide = doc?.querySelector(".slide");
    if (!slide || !parsed) return;
    const box = slide.getBoundingClientRect();
    const overflowing = [];
    for (const el of slide.querySelectorAll(".slide-inner *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > box.right + 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.top < box.top - 1) overflowing.push(el);
    }
    const inner = slide.querySelector(".slide-inner");
    const clipped = inner && inner.scrollHeight > inner.clientHeight + 1;
    for (const el of issuesList.querySelectorAll(".te-overflow")) el.remove();
    if (overflowing.length || clipped) {
      const what = overflowing[0] ? `<${overflowing[0].tagName.toLowerCase()}${overflowing[0].className ? ` class="${overflowing[0].className}"` : ""}>` : "content";
      issuesList.append(h("li", { class: "te-issue te-error te-overflow" }, icon("alert", 14), `Overflow at 1280×720: ${what} extends beyond the slide${overflowing.length > 1 ? ` (+${overflowing.length - 1} more)` : ""}. Shorten the sample or adjust the layout.`));
    }
    if (!issuesList.children.length) issuesList.append(h("li", { class: "te-issue te-ok" }, icon("check", 14), "No problems found"));
  }
  frame.addEventListener("frame-updated", () => requestAnimationFrame(checkOverflow));

  const resize = () => {
    const scale = fitFrame(canvas, frame);
    frameWrap.style.width = `${1280 * scale}px`;
    frameWrap.style.height = `${720 * scale}px`;
  };
  new ResizeObserver(resize).observe(canvas);

  themeSelect.addEventListener("change", () => {
    previewTheme = themeSelect.value;
    refresh.flush();
  });
  nameInput.addEventListener("input", () => {
    parts.frontMatter = withName(parts.frontMatter, nameInput.value.trim());
    if (activeTab === "frontMatter") {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: parts.frontMatter } });
    } else delete states.frontMatter;
    refresh();
  });

  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      toast("Use lowercase letters, digits and dashes for the template name.", { kind: "error" });
      return;
    }
    try {
      const result = await api.saveTemplate(name, joinTemplateSource(parts), scopeSelect.value);
      toast(`Saved ${name} (${scopeSelect.value === "user" ? "all decks" : "this deck"})`, { kind: "success" });
      currentName = name;
      await waitForRegistry();
      renderList();
      return result;
    } catch (err) {
      toast(err.message, { kind: "error" });
    }
  });

  async function waitForRegistry() {
    const start = state.registryVersion;
    for (let i = 0; i < 20 && state.registryVersion === start; i++) await new Promise((r) => setTimeout(r, 100));
  }

  function close() {
    view.destroy();
    dialog.close();
    dialog.remove();
  }
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
  load(currentName);
}
