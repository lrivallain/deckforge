// Copilot chat drawer: scope toggle, streaming replies, tool activity, undo.

import { h, icon } from "./dom.js";
import { api } from "./api.js";
import { markChanged, notify, selectedSlide, state } from "./state.js";
import { undo } from "./actions.js";
import { slideTitle } from "../core/deck.js";

const TOOL_LABELS = {
  get_deck: "Read the deck",
  list_templates: "Listed templates",
  list_themes: "Listed themes",
  update_slide: "Updated slide",
  add_slide: "Added slide",
  remove_slide: "Removed slide",
  move_slide: "Moved slide",
  set_hidden: "Changed visibility",
  set_template: "Changed template",
  set_theme: "Changed theme",
  update_meta: "Updated deck info",
};

const SUGGESTIONS = {
  slide: ["Tighten the copy on this slide", "Write speaker notes for this slide", "Make the headline a before/after shift"],
  deck: ["Review the storyline against the brief", "Add a resources slide at the end", "Suggest speaker notes for every slide"],
};

export function createChat() {
  let scope = "slide";
  let streamingBubble = null;
  let turnTools = null;

  const log = h("div", { class: "chat-log", role: "log", "aria-live": "polite", "aria-label": "Conversation" });
  const input = h("textarea", { class: "input chat-input", rows: 3, placeholder: "Ask Copilot to edit your slides…", "aria-label": "Message to Copilot", "data-testid": "chat-input" });
  const sendBtn = h("button", { type: "button", class: "btn btn-primary", "data-testid": "chat-send" }, icon("send", 15), "Send");
  const stopBtn = h("button", { type: "button", class: "btn", hidden: true }, icon("stop", 15), "Stop");
  const scopeSlide = h("button", { type: "button", class: "seg", "aria-pressed": "true", onClick: () => setScope("slide") }, "This slide");
  const scopeDeck = h("button", { type: "button", class: "seg", "aria-pressed": "false", onClick: () => setScope("deck") }, "Whole deck");
  const scopeInfo = h("p", { class: "chat-scope-info muted small" });
  const status = h("span", { class: "chat-status" });
  const suggestions = h("div", { class: "chat-suggestions" });

  const root = h("aside", { class: "chat", "aria-label": "Copilot assistant", hidden: true },
    h("div", { class: "panel-head" },
      h("h2", {}, icon("sparkles", 16), "Copilot"),
      status,
      h("button", { type: "button", class: "icon-btn", title: "New conversation", "aria-label": "New conversation", onClick: reset }, icon("undo", 15)),
      h("button", { type: "button", class: "icon-btn", title: "Close", "aria-label": "Close assistant", onClick: () => toggle(false) }, icon("close", 16)),
    ),
    h("div", { class: "chat-scope" }, h("div", { class: "segmented", role: "group", "aria-label": "Scope" }, scopeSlide, scopeDeck), scopeInfo),
    log,
    suggestions,
    h("form", { class: "chat-compose", onSubmit: (e) => { e.preventDefault(); send(); } },
      input,
      h("div", { class: "row between" }, h("span", { class: "muted small" }, "Enter to send · Shift+Enter for a new line"), h("div", { class: "row" }, stopBtn, sendBtn)),
    ),
  );

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener("click", send);
  stopBtn.addEventListener("click", () => api.agentAbort().catch(() => {}));

  function setScope(next) {
    scope = next;
    scopeSlide.setAttribute("aria-pressed", String(scope === "slide"));
    scopeDeck.setAttribute("aria-pressed", String(scope === "deck"));
    updateScopeInfo();
    renderSuggestions();
  }

  function updateScopeInfo() {
    const slide = selectedSlide();
    scopeInfo.textContent = scope === "slide"
      ? slide ? `Changes limited to “${slideTitle(slide, state.templates[slide.template])}”.` : "Select a slide first."
      : "Copilot may add, remove, reorder and edit any slide.";
  }

  function renderSuggestions() {
    suggestions.replaceChildren();
    if (state.agent.messages.length) return;
    for (const text of SUGGESTIONS[scope]) {
      suggestions.append(h("button", { type: "button", class: "chip", onClick: () => { input.value = text; input.focus(); } }, text));
    }
  }

  function bubble(role, text) {
    const node = h("div", { class: `msg msg-${role}` }, h("div", { class: "msg-text" }, text));
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  function errorCard(error, hint) {
    const node = h("div", { class: "msg msg-error", role: "alert" },
      h("div", { class: "msg-text" }, h("strong", {}, error.auth ? "Copilot is not available" : "Something went wrong"), h("p", {}, error.message)),
    );
    if (error.auth) {
      node.append(h("div", { class: "auth-hint" },
        h("p", {}, "deckforge uses your existing GitHub Copilot sign-in. In a terminal run:"),
        h("pre", {}, "gh auth login"),
        h("p", { class: "muted small" }, hint || "or start `copilot` and use /login, then send your message again."),
      ));
    }
    log.append(node);
    log.scrollTop = log.scrollHeight;
  }

  function renderHistory() {
    log.replaceChildren();
    for (const m of state.agent.messages) {
      if (m.role === "error") errorCard({ message: m.text, auth: m.auth }, m.hint);
      else bubble(m.role === "user" ? "user" : "assistant", m.text);
    }
    renderSuggestions();
  }

  function setBusy(busy) {
    sendBtn.hidden = busy;
    stopBtn.hidden = !busy;
    input.disabled = false;
    status.textContent = busy ? "Working…" : "";
    status.classList.toggle("busy", busy);
    root.classList.toggle("is-busy", busy);
  }

  async function send() {
    const text = input.value.trim();
    if (!text || root.classList.contains("is-busy") || state.agent.state === "busy" || state.agent.state === "starting") return;
    const slide = selectedSlide();
    if (scope === "slide" && !slide) return;
    state.agent.messages.push({ role: "user", text });
    bubble("user", text);
    suggestions.replaceChildren();
    input.value = "";
    setBusy(true);
    try {
      await api.agent(text, scope, slide?.id ?? null);
    } catch (err) {
      setBusy(false);
      state.agent.messages.push({ role: "error", text: err.message });
      errorCard({ message: err.message });
    }
  }

  async function reset() {
    await api.agentReset().catch(() => {});
    state.agent.messages = [];
    renderHistory();
  }

  function onAgentEvent(event) {
    switch (event.type) {
      case "status":
        state.agent.state = event.state;
        state.agent.error = event.error;
        setBusy(event.state === "busy" || event.state === "starting");
        if (event.state === "starting") status.textContent = "Connecting…";
        break;
      case "start":
        turnTools = h("div", { class: "msg-tools" });
        log.append(turnTools);
        streamingBubble = null;
        break;
      case "delta":
        if (!streamingBubble) streamingBubble = bubble("assistant", "");
        streamingBubble.querySelector(".msg-text").textContent += event.text;
        log.scrollTop = log.scrollHeight;
        break;
      case "message":
        if (event.text) {
          if (!streamingBubble) streamingBubble = bubble("assistant", "");
          streamingBubble.querySelector(".msg-text").textContent = event.text;
          streamingBubble = null;
        }
        break;
      case "tool": {
        const id = event.result?.id || event.args?.id;
        const slide = state.deck?.slides.find((s) => s.id === id);
        const label = `${TOOL_LABELS[event.name] || event.name}${slide ? ` · ${slideTitle(slide, state.templates[slide.template])}` : ""}`;
        (turnTools || log).append(h("span", { class: "tool-chip" }, icon("check", 12), label));
        if (id) markChanged([id]);
        notify({ highlights: true });
        break;
      }
      case "tool_error":
        (turnTools || log).append(h("span", { class: "tool-chip tool-chip-error" }, icon("alert", 12), `${TOOL_LABELS[event.name] || event.name}: ${event.message}`));
        break;
      case "done": {
        setBusy(false);
        streamingBubble = null;
        if (event.text) state.agent.messages.push({ role: "assistant", text: event.text });
        if (event.error) {
          state.agent.messages.push({ role: "error", text: event.error.message, auth: event.error.auth });
          errorCard(event.error, state.agent.hint);
        }
        if (event.changed?.length) {
          markChanged(event.changed);
          notify({ highlights: true });
          const undoRow = h("div", { class: "msg-actions" },
            h("span", { class: "muted small" }, `${event.changed.length} slide${event.changed.length > 1 ? "s" : ""} changed`),
            h("button", { type: "button", class: "btn btn-sm", "data-testid": "undo-agent", onClick: async (e) => { e.currentTarget.disabled = true; if ((state.undoLabel || "").startsWith("Agent:")) await undo(); } }, icon("undo", 14), "Undo these changes"),
          );
          log.append(undoRow);
          log.scrollTop = log.scrollHeight;
        }
        turnTools = null;
        break;
      }
      default:
        break;
    }
  }

  function toggle(force) {
    const open = force ?? root.hidden;
    root.hidden = !open;
    document.body.classList.toggle("chat-open", open);
    notify({ layout: true });
    if (open) {
      renderHistory();
      updateScopeInfo();
      input.focus();
    }
    return open;
  }

  function update() {
    if (!root.hidden) updateScopeInfo();
  }

  return { root, toggle, update, onAgentEvent, isOpen: () => !root.hidden };
}
