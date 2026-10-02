// deckforge editor entry point.

import { h, icon, toast } from "./dom.js";
import { api, connectEvents } from "./api.js";
import { applySnapshot, loadViewerCss, notify, select, selectedSlide, state, subscribe, markChanged } from "./state.js";
import { createRail } from "./rail.js";
import { createStage } from "./stage.js";
import { createInspector } from "./inspector.js";
import { createChat } from "./chat.js";
import { pickTemplate } from "./picker.js";
import { openSettings } from "./settings.js";
import { openTemplateEditor } from "./template-editor.js";
import { op, opQuiet, undo, redo } from "./actions.js";

async function addSlide() {
  const name = await pickTemplate({ title: "Add a slide", confirmLabel: "Add slide" });
  if (!name) return;
  try {
    const res = await op("add_slide", { template: name, after: state.selectedId ?? undefined }, { label: "Add slide" });
    if (res?.result?.id) select(res.result.id);
  } catch {
    /* toast shown */
  }
}

function themeSwatch(theme) {
  const p = theme.palette || {};
  return h("span", { class: "swatch", "aria-hidden": "true" },
    h("i", { style: { background: p.paper } }), h("i", { style: { background: p.primary } }), h("i", { style: { background: p.accent } }));
}

function createTopbar({ onToggleChat }) {
  const title = h("span", { class: "deck-title", "data-testid": "deck-title" });
  const saveState = h("span", { class: "save-state", "aria-live": "polite", "data-testid": "save-state" });
  const undoBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Undo", "data-testid": "undo", onClick: undo }, icon("undo"));
  const redoBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Redo", "data-testid": "redo", onClick: redo }, icon("redo"));
  const themeSelect = h("select", { class: "input input-sm theme-select", "aria-label": "Theme", "data-testid": "theme-select" });
  themeSelect.addEventListener("change", () => opQuiet("set_theme", { theme: themeSelect.value }, { label: "Change theme" }));
  const swatchHost = h("span", { class: "swatch-host" });
  const chatBtn = h("button", { type: "button", class: "btn btn-accent", "aria-pressed": "false", "data-testid": "toggle-chat", onClick: () => chatBtn.setAttribute("aria-pressed", String(onToggleChat())) }, icon("sparkles", 16), "Copilot");
  const viewLink = h("a", { class: "btn", target: "_blank", rel: "noopener", "data-testid": "open-viewer" }, icon("play", 14), "Present");
  const root = h("header", { class: "topbar" },
    h("div", { class: "brand" }, h("span", { class: "logo", "aria-hidden": "true" }, "df"), h("span", { class: "brand-name" }, "deckforge")),
    h("div", { class: "deck-info" }, title, saveState),
    h("div", { class: "toolbar" },
      undoBtn, redoBtn,
      h("span", { class: "divider" }),
      h("label", { class: "theme-picker" }, swatchHost, themeSelect),
      h("button", { type: "button", class: "btn btn-ghost", onClick: () => openTemplateEditor(), "data-testid": "open-template-editor" }, icon("code", 16), "Templates"),
      h("button", { type: "button", class: "btn btn-ghost", onClick: openSettings, "data-testid": "open-settings" }, icon("settings", 16), "Deck"),
      viewLink,
      chatBtn,
    ),
  );
  function update() {
    title.textContent = state.deck.meta.title;
    document.title = `${state.deck.meta.title} · deckforge`;
    undoBtn.disabled = !state.canUndo;
    redoBtn.disabled = !state.canRedo;
    undoBtn.title = state.canUndo ? `Undo ${state.undoLabel} (⌘Z)` : "Nothing to undo";
    redoBtn.title = state.canRedo ? `Redo ${state.redoLabel} (⇧⌘Z)` : "Nothing to redo";
    const themes = Object.values(state.themes);
    if (themeSelect.options.length !== themes.length || [...themeSelect.options].some((o, i) => o.value !== themes[i].name)) {
      themeSelect.replaceChildren(...themes.map((t) => h("option", { value: t.name }, t.label)));
    }
    themeSelect.value = state.deck.meta.theme;
    const theme = state.themes[state.deck.meta.theme];
    swatchHost.replaceChildren(theme ? themeSwatch(theme) : "");
    const slide = selectedSlide();
    const visibleIndex = slide && !slide.hidden ? state.deck.slides.filter((s) => !s.hidden).indexOf(slide) : -1;
    viewLink.href = `/deck/${state.outFile}${visibleIndex >= 0 ? `#${visibleIndex + 1}` : ""}`;
    const offline = state.connection === "offline";
    const failed = state.lastBuild?.ok === false;
    saveState.textContent = offline ? "Offline – reconnecting…" : state.busy ? "Copilot is editing…" : failed ? "Build failed" : "Saved";
    saveState.className = `save-state ${offline || failed ? "is-error" : state.busy ? "is-busy" : "is-ok"}`;
    saveState.title = failed ? state.lastBuild.error : `Saved to ${state.deckFile} · built ${state.outFile}`;
  }
  return { root, update, chatBtn };
}

async function main() {
  const app = document.getElementById("app");
  let snapshot;
  try {
    [snapshot] = await Promise.all([api.state(), loadViewerCss()]);
  } catch (err) {
    app.replaceChildren(h("div", { class: "fatal" }, h("h1", {}, "Cannot reach the deckforge server"), h("p", {}, err.status === 401 ? "Open the editor with the URL printed by `deckforge edit` (it includes the access token)." : err.message)));
    return;
  }

  const chat = createChat();
  const topbar = createTopbar({ onToggleChat: () => chat.toggle() });
  const rail = createRail({ onAddSlide: addSlide });
  let stage = null;
  const inspector = createInspector({ onFieldFocus: (path) => stage?.highlightSlot(path) });
  stage = createStage({ onSlotFocus: (path, opts) => inspector.revealField(path, opts) });

  app.removeAttribute("aria-busy");
  app.replaceChildren(topbar.root, h("main", { class: "workspace" }, rail.root, stage.root, inspector.root, chat.root));

  subscribe((info) => {
    topbar.update(info);
    if (info.layout) return;
    rail.update(info);
    if (!info.highlights) {
      stage.update(info);
      inspector.update(info);
    }
    chat.update(info);
  });

  applySnapshot(snapshot);

  if (state.registryErrors.length) {
    const first = state.registryErrors[0];
    toast(`${state.registryErrors.length} template/theme file(s) could not be loaded — ${first.path}: ${first.message}`, { kind: "error", timeout: 8000 });
  }

  connectEvents({
    open: async () => {
      if (state.connection === "offline") applySnapshot(await api.state(), { source: "reconnect" });
      state.connection = "online";
      topbar.update();
    },
    error: () => {
      state.connection = "offline";
      topbar.update();
    },
    deck: async (event) => {
      if (event.source === "agent" && event.changed?.length) markChanged(event.changed);
      if (event.state.registryVersion !== state.registryVersion) {
        applySnapshot(await api.state(), event);
      } else {
        const removedIndex = event.op === "remove_slide" ? state.deck.slides.findIndex((s) => s.id === state.selectedId) : undefined;
        applySnapshot(event.state, { ...event, removedIndex });
      }
      if (event.source === "disk" && event.op === "reload") toast("deck.yaml changed on disk — reloaded", { action: "Undo", onAction: undo });
      if (event.op === "set_template" && event.label) {
        if (event.source === "agent") toast(`Copilot changed the layout · ${event.label}`, { timeout: 6000 });
        else toast(event.label, { action: "Undo", onAction: undo, timeout: 6000 });
      }
    },
    built: (info) => {
      state.lastBuild = info;
      topbar.update();
    },
    warning: (info) => toast(info.message, { kind: "error", timeout: 8000 }),
    agent: (event) => chat.onAgentEvent(event),
  });

  window.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const inField = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable], .cm-editor");
    if (document.querySelector("dialog[open]")) return;
    if (mod && !e.altKey && e.key.toLowerCase() === "z" && !inField) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === "y" && !inField) {
      e.preventDefault();
      redo();
    } else if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      topbar.chatBtn.setAttribute("aria-pressed", String(chat.toggle(true)));
    }
  });
  window.addEventListener("resize", () => notify({ layout: true }));
}

main();
