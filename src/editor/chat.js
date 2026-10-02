// Copilot chat drawer: scope toggle, streaming replies, tool activity, undo,
// and the handoff of the conversation to Copilot CLI.

import { h, icon, toast } from "./dom.js";
import { api } from "./api.js";
import { markChanged, notify, selectedSlide, state } from "./state.js";
import { undo } from "./actions.js";
import { slideTitle } from "../core/deck.js";
import { toolLabel } from "./tool-labels.js";


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
  const linkBar = h("div", { class: "chat-link", hidden: true, "data-testid": "chat-link" });

  const root = h("aside", { class: "chat", "aria-label": "Copilot assistant", hidden: true },
    h("div", { class: "panel-head" },
      h("h2", {}, icon("sparkles", 16), "Copilot"),
      status,
      h("button", { type: "button", class: "icon-btn", title: "Continue in Copilot CLI or the Copilot app", "aria-label": "Continue in Copilot CLI or the Copilot app", "data-testid": "continue-cli", onClick: () => handoff() }, icon("terminal", 15)),
      h("button", { type: "button", class: "icon-btn", title: "New conversation", "aria-label": "New conversation", onClick: reset }, icon("undo", 15)),
      h("button", { type: "button", class: "icon-btn", title: "Close", "aria-label": "Close assistant", onClick: () => toggle(false) }, icon("close", 16)),
    ),
    h("div", { class: "chat-scope" }, h("div", { class: "segmented", role: "group", "aria-label": "Scope" }, scopeSlide, scopeDeck), scopeInfo),
    linkBar,
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

  function renderLink() {
    const { sessionId, handedOff } = state.agent;
    linkBar.hidden = !sessionId;
    if (!sessionId) return linkBar.replaceChildren();
    const chip = h("button", { type: "button", class: "session-chip", title: `Copilot session ${sessionId} · click to copy the ID`, onClick: () => copyText(sessionId, "Session ID copied") }, icon("copy", 12), `Session ${sessionId.slice(0, 8)}`);
    linkBar.replaceChildren(handedOff
      ? h("div", { class: "chat-handoff", role: "status" }, icon("terminal", 14),
        h("p", {}, h("strong", {}, "Continued outside the editor. "), "Exit Copilot CLI or close the session in the Copilot app, then send a message here to take the conversation back."), chip)
      : chip);
  }

  async function handoff() {
    let info;
    try {
      info = await api.agentHandoff();
    } catch (err) {
      toast(err.message, { kind: "error", timeout: 6000 });
      return;
    }
    state.agent.sessionId = info.sessionId;
    state.agent.handedOff = info.handedOff;
    state.agent.connected = false;
    renderLink();
    openHandoffDialog(info);
  }

  function onAgentEvent(event) {
    switch (event.type) {
      case "status":
        state.agent.state = event.state;
        state.agent.error = event.error;
        setBusy(event.state === "busy" || event.state === "starting");
        if (event.state === "starting") status.textContent = "Connecting…";
        break;
      case "link":
        state.agent.sessionId = event.sessionId;
        state.agent.connected = event.connected;
        state.agent.handedOff = event.handedOff;
        renderLink();
        break;
      case "history":
        state.agent.messages = event.history.map((m) => ({ role: m.role, text: m.text }));
        if (!root.hidden) renderHistory();
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
        const label = event.result?.label
          ? `${toolLabel(event.name)} · ${event.result.label}`
          : `${toolLabel(event.name)}${slide ? ` · ${slideTitle(slide, state.templates[slide.template])}` : ""}`;
        (turnTools || log).append(h("span", { class: "tool-chip" }, icon("check", 12), label));
        if (id) markChanged([id]);
        notify({ highlights: true });
        break;
      }
      case "tool_error":
        (turnTools || log).append(h("span", { class: "tool-chip tool-chip-error" }, icon("alert", 12), `${toolLabel(event.name)}: ${event.message}`));
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
        }
        if (event.changed?.length || event.summary?.toolCalls) {
          log.append(turnSummary(event));
          log.scrollTop = log.scrollHeight;
        }
        turnTools = null;
        break;
      }
      default:
        break;
    }
  }

  /** Per-turn change summary: slides and slots touched, tool calls made, undo and the agent log. */
  function turnSummary({ changed = [], summary }) {
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const counts = [plural(changed.length, "slide") + " changed"];
    if (summary) counts.push(plural(summary.toolCalls, "tool call") + (summary.failed ? ` (${summary.failed} failed)` : ""));
    const items = [];
    for (const { id, fields } of summary?.slides || []) {
      const slide = state.deck?.slides.find((s) => s.id === id);
      const name = slide ? slideTitle(slide, state.templates[slide.template]) : id;
      items.push(h("li", {}, h("strong", {}, name), fields.length ? ` · ${fields.join(", ")}` : ""));
    }
    if (summary?.deck?.length) items.push(h("li", {}, h("strong", {}, "Deck"), ` · ${summary.deck.join(", ")}`));
    const undoBtn = changed.length
      ? h("button", { type: "button", class: "btn btn-sm", "data-testid": "undo-agent", onClick: async (e) => { e.currentTarget.disabled = true; if ((state.undoLabel || "").startsWith("Agent:")) await undo(); } }, icon("undo", 14), "Undo these changes")
      : null;
    const logLink = h("a", { class: "btn btn-sm btn-ghost", href: "/api/agent/log?download=1", download: true, title: "Download the tool calls of every turn as JSON", "data-testid": "agent-log" }, icon("download", 14), "Agent log");
    return h("div", { class: "msg-actions turn-summary", "data-testid": "turn-summary" },
      h("div", { class: "turn-summary-body" },
        h("span", { class: "muted small" }, counts.join(" · ")),
        items.length ? h("ul", { class: "turn-summary-list small" }, ...items) : null),
      h("div", { class: "row" }, logLink, undoBtn),
    );
  }

  function toggle(force) {
    const open = force ?? root.hidden;
    root.hidden = !open;
    document.body.classList.toggle("chat-open", open);
    notify({ layout: true });
    if (open) {
      renderHistory();
      renderLink();
      updateScopeInfo();
      input.focus();
      // Show the remembered conversation (resumes it, which loads its history).
      const a = state.agent;
      if (a.sessionId && !a.connected && !a.handedOff && a.state !== "busy" && a.state !== "starting") {
        api.agentConnect().catch((err) => {
          state.agent.messages.push({ role: "error", text: err.message, auth: err.details?.auth });
          errorCard({ message: err.message, auth: err.details?.auth });
        });
      }
    }
    return open;
  }

  function update() {
    if (!root.hidden) updateScopeInfo();
  }

  return { root, toggle, update, onAgentEvent, isOpen: () => !root.hidden };
}

async function copyText(text, message = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(message, { timeout: 2500 });
    return true;
  } catch {
    toast("Copy is not available here: select the text and copy it.", { kind: "error", timeout: 5000 });
    return false;
  }
}

function commandBlock(command, testid) {
  return h("div", { class: "cmd" },
    h("pre", { class: "cmd-text", "data-testid": testid, tabindex: "0" }, command),
    h("button", { type: "button", class: "btn btn-sm", onClick: () => copyText(command, "Command copied") }, icon("copy", 14), "Copy"),
  );
}

/** Explain the handoff: open the conversation in the Copilot app, or resume it in Copilot CLI. */
function openHandoffDialog(info) {
  const toolsStatus = h("div", { class: "handoff-tools", "data-testid": "handoff-tools" });
  const renderTools = (status) => {
    if (status?.installed) {
      toolsStatus.replaceChildren(icon("check", 14), h("span", {}, "Deck tools are available in every Copilot session started in a deck folder."));
      return;
    }
    const install = h("button", { type: "button", class: "btn btn-sm", "data-testid": "install-tools" }, icon("plus", 14), "Add the deck tools to Copilot");
    install.addEventListener("click", async () => {
      install.disabled = true;
      try {
        renderTools((await api.installCopilotTools()).status);
        toast("Deck tools added to Copilot. New sessions load them.", { timeout: 4000 });
      } catch (err) {
        install.disabled = false;
        toast(err.message, { kind: "error", timeout: 8000 });
      }
    });
    toolsStatus.replaceChildren(icon("alert", 14),
      h("span", {}, "The Copilot app only gets the deck tools once they are registered in ", h("code", {}, "~/.copilot/mcp-config.json"), " (or run ", h("code", {}, "deckforge mcp --install"), ")."),
      install);
  };
  renderTools(info.globalTools);

  const openApp = h("button", { type: "button", class: "btn btn-accent", "data-testid": "open-app" }, icon("external", 15), "Open in Copilot app");
  openApp.addEventListener("click", async () => {
    openApp.disabled = true;
    try {
      await api.agentOpenApp();
      toast("Confirm in the Copilot app to open the conversation.", { timeout: 5000 });
    } catch (err) {
      toast(err.message, { kind: "error", timeout: 6000 });
    } finally {
      openApp.disabled = false;
    }
  });

  const body = h("div", { class: "dialog-body handoff-body" },
    h("p", {}, "Copilot outside the editor gets the same deck tools through ", h("code", {}, "deckforge mcp"), ". While this editor stays open, every change made there shows up here live and can be undone."),
    info.appUrl
      ? h("section", {},
        h("h3", {}, "GitHub Copilot app"),
        h("div", { class: "row" }, openApp, h("span", { class: "muted small" }, "The app asks you to confirm before it opens the conversation.")),
        toolsStatus)
      : null,
    info.command
      ? h("section", {},
        h("h3", {}, "Copilot CLI"),
        commandBlock(info.command, "handoff-command"))
      : h("section", {},
        h("p", { class: "muted" }, "There is no conversation to continue yet. Start a Copilot CLI session with the deck tools:"),
        commandBlock(info.commandNew, "handoff-command-new"),
        toolsStatus),
    info.command ? h("details", {}, h("summary", {}, "Start a new Copilot CLI session instead"), commandBlock(info.commandNew, "handoff-command-new")) : null,
    info.command
      ? h("p", { class: "muted small" }, "The editor has let go of the conversation so that only one Copilot works on it. Exit Copilot CLI, or close the session in the app, before you send a new message here.")
      : null,
  );
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const dialog = h("dialog", { class: "dialog handoff", "aria-labelledby": "handoff-title", "data-testid": "handoff-dialog" },
    h("header", { class: "dialog-head" }, h("h2", { id: "handoff-title" }, icon("terminal", 18), "Continue in Copilot"),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onClick: close }, icon("close"))),
    body,
    h("footer", { class: "dialog-foot" }, h("span", {}), h("button", { type: "button", class: "btn btn-primary", onClick: close }, "Done")),
  );
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
}
