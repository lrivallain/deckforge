// "Improve with Copilot" button for text areas. One click asks Copilot to
// rewrite the text. The button then turns into a cancel icon that restores the
// previous text. Typing by hand drops that revert offer.

import { h, icon, toast } from "./dom.js";
import { api } from "./api.js";

// Revert offers by field key ({ previous, improved }). They survive inspector re-renders.
const reverts = new Map();
// In-flight requests by field key.
const pending = new Map();
// The field currently mounted for each key (the inspector may rebuild it mid-request).
const live = new Map();

const LABELS = {
  improve: "Improve with Copilot",
  busy: "Copilot is improving this text. Click to stop",
  revert: "Cancel Copilot's change and restore the previous text",
};

/**
 * Wrap `textarea` with an improve button and return the wrapper to insert in
 * its place. `key` must be stable for the same field (e.g. "slideId:path").
 * `context()` returns {label, description, max, richtext, kind, slideId}.
 */
export function aiImprove(textarea, { key, context = () => ({}) }) {
  const button = h("button", { type: "button", class: "ai-btn", "data-testid": "ai-improve" });
  const wrap = h("div", { class: "ai-field" }, textarea, button);
  let applying = false;

  const field = {
    textarea,
    render() {
      const busy = pending.has(key);
      const mode = busy ? "busy" : reverts.has(key) ? "revert" : "improve";
      button.dataset.state = mode;
      button.replaceChildren(busy ? h("span", { class: "ai-spinner", "aria-hidden": "true" }) : icon(mode === "revert" ? "cancel" : "sparkles", 14));
      button.title = LABELS[mode];
      button.setAttribute("aria-label", LABELS[mode]);
      button.disabled = mode === "improve" && !textarea.value.trim();
      textarea.readOnly = busy;
      if (busy) textarea.setAttribute("aria-busy", "true");
      else textarea.removeAttribute("aria-busy");
      wrap.classList.toggle("is-busy", busy);
    },
    setValue(value) {
      applying = true;
      try {
        textarea.value = value;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      } finally {
        applying = false;
      }
    },
    /** Re-check the revert offer after the value changed without typing (undo, remote edit). */
    sync() {
      const entry = reverts.get(key);
      if (entry && textarea.value !== entry.improved) reverts.delete(key);
      field.render();
    },
  };
  textarea._aiField = field;
  live.set(key, field);

  textarea.addEventListener("input", () => {
    if (!applying) reverts.delete(key);
    field.render();
  });

  button.addEventListener("click", async () => {
    const running = pending.get(key);
    if (running) {
      pending.delete(key);
      running.controller.abort();
      field.render();
      return;
    }
    const entry = reverts.get(key);
    if (entry && textarea.value === entry.improved) {
      reverts.delete(key);
      field.setValue(entry.previous);
      field.render();
      return;
    }
    reverts.delete(key);
    const original = textarea.value;
    if (!original.trim()) return field.render();
    const job = { controller: new AbortController() };
    pending.set(key, job);
    field.render();
    try {
      const { text } = await api.improve({ ...context(), text: original }, { signal: job.controller.signal });
      if (pending.get(key) !== job) return;
      pending.delete(key);
      const target = live.get(key);
      if (!target?.textarea.isConnected) return;
      if (target.textarea.value !== original || text === original) {
        target.render();
        if (text === original) toast("Copilot found nothing to improve.");
        return;
      }
      reverts.set(key, { previous: original, improved: text });
      target.setValue(text);
      target.render();
    } catch (err) {
      if (pending.get(key) !== job) return; // stopped by the user
      pending.delete(key);
      live.get(key)?.render();
      const message = err.details?.auth ? `Copilot is not available: ${err.message} ${err.details.hint || ""}` : `Could not improve the text: ${err.message}`;
      toast(message.trim(), { kind: "error", timeout: 6000 });
    }
  });

  field.sync();
  return wrap;
}

/** Refresh every improve button under `root` after values were set programmatically. */
export function syncImproveFields(root) {
  for (const textarea of root.querySelectorAll(".ai-field > textarea")) textarea._aiField?.sync();
}
