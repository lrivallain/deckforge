// Center stage: live 16:9 preview of the selected slide with inline editing.

import { h, fitFrame, frameIsCurrent, writeFrame, debounce } from "./dom.js";
import { selectedSlide, slideDocument, state, slidePosition } from "./state.js";
import { opQuiet } from "./actions.js";
import { sanitizeRichText } from "../core/html.js";
import { slideTitle } from "../core/deck.js";

export function createStage({ onSlotFocus }) {
  const frame = h("iframe", { class: "stage-frame", title: "Slide preview (click text to edit)", "data-testid": "stage-frame" });
  const wrap = h("div", { class: "stage-frame-wrap" }, frame);
  const canvas = h("div", { class: "stage-canvas" }, wrap);
  const title = h("span", { class: "stage-title" });
  const templateBadge = h("span", { class: "badge" });
  const hiddenBadge = h("span", { class: "badge badge-warn" }, "Hidden in presentation");
  const hint = h("span", { class: "stage-hint" }, "Click any text on the slide to edit it");
  const empty = h("div", { class: "stage-empty" }, h("p", {}, "This deck has no slides yet."), h("p", { class: "muted" }, "Use “Add slide” to start."));
  const root = h("section", { class: "stage", "aria-label": "Slide preview" },
    h("div", { class: "stage-bar" }, h("div", { class: "stage-heading" }, title, templateBadge, hiddenBadge), hint),
    canvas,
    empty,
  );

  let currentId = null;
  let editing = null; // { el, path, slideId }
  let selectedPath = null;
  let pendingWrite = false;

  const resize = () => {
    // The stage may have been hidden/re-attached: make sure the frame shows the slide.
    if (pendingWrite || (currentId && !frameIsCurrent(frame))) {
      const slide = selectedSlide();
      if (slide) pendingWrite = !writeFrame(frame, slideDocument(slide, { edit: true }));
    }
    const scale = fitFrame(canvas, frame);
    wrap.style.width = `${1280 * scale}px`;
    wrap.style.height = `${720 * scale}px`;
  };
  new ResizeObserver(resize).observe(canvas);

  const commit = debounce((el, slideId, path, type) => {
    const value = type === "richtext" ? sanitizeRichText(el.innerHTML) : el.innerText.replace(/\n$/, "");
    opQuiet("update_slide", { id: slideId, set: { [path]: value } }, { coalesce: `${slideId}:${path}`, label: "Edit text" });
  }, 350);

  function wire() {
    const doc = frame.contentDocument;
    if (!doc) return;
    if (!doc.__dfWired) {
      doc.__dfWired = true;
      doc.addEventListener("click", (e) => {
        if (e.target.closest("a")) e.preventDefault();
      });
    }
    for (const el of doc.querySelectorAll(".df-slot")) {
      const type = el.dataset.dfType;
      const path = el.dataset.dfSlot;
      el.setAttribute("contenteditable", type === "richtext" ? "true" : "plaintext-only");
      el.setAttribute("role", "textbox");
      el.setAttribute("aria-label", `Edit ${path}`);
      el.spellcheck = true;
      if (path === selectedPath) el.classList.add("df-selected");
      let original = null;
      el.addEventListener("focus", () => {
        original = el.innerHTML;
        // Sample text: select it so typing replaces it.
        if (el.hasAttribute("data-df-placeholder")) {
          const range = doc.createRange();
          range.selectNodeContents(el);
          const selection = doc.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        editing = { el, path, slideId: currentId };
        onSlotFocus?.(path);
      });
      el.addEventListener("input", () => commit(el, currentId, path, type));
      el.addEventListener("blur", () => {
        commit.flush(el, editing?.slideId ?? currentId, path, type);
        editing = null;
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          commit.cancel();
          el.innerHTML = original;
          commit.flush(el, currentId, path, type);
          el.blur();
        } else if (e.key === "Enter" && !e.shiftKey && type !== "richtext") {
          e.preventDefault();
          el.blur();
        } else if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "y")) {
          // Let the editor's global undo handle it once the edit is committed.
          e.preventDefault();
          commit.flush(el, currentId, path, type);
          el.blur();
          window.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey }));
        }
      });
      el.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        doc.execCommand("insertText", false, text);
      });
    }
  }
  frame.addEventListener("frame-updated", wire);

  function update(info = {}) {
    const slide = selectedSlide();
    empty.hidden = Boolean(slide);
    canvas.hidden = !slide;
    if (!slide) {
      currentId = null;
      title.textContent = "";
      return;
    }
    const { index } = slidePosition(slide);
    title.textContent = `${slide.hidden ? "–" : index + 1}. ${slideTitle(slide, state.templates[slide.template])}`;
    templateBadge.textContent = state.templates[slide.template]?.label || `${slide.template} (missing)`;
    templateBadge.classList.toggle("badge-danger", !state.templates[slide.template]);
    hiddenBadge.hidden = !slide.hidden;
    const sameSlide = currentId === slide.id;
    currentId = slide.id;
    // Keep the caret: our own inline edit round-trips are already on screen.
    if (sameSlide && editing && info.source === "user" && !info.selection) return;
    if (sameSlide && editing && frame.contentDocument?.activeElement === editing.el && info.source === "user") return;
    writeFrame(frame, slideDocument(slide, { edit: true }));
    pendingWrite = !frameIsCurrent(frame);
    requestAnimationFrame(resize);
  }

  function highlightSlot(path) {
    selectedPath = path;
    const doc = frame.contentDocument;
    if (!doc) return;
    for (const el of doc.querySelectorAll(".df-selected")) el.classList.remove("df-selected");
    if (!path) return;
    for (const el of doc.querySelectorAll(".df-slot")) {
      if (el.dataset.dfSlot === path || el.dataset.dfSlot.startsWith(path + ".")) el.classList.add("df-selected");
    }
  }

  return { root, update, highlightSlot, frame };
}

