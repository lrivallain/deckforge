// Slide rail: thumbnails, selection, drag-and-drop reorder, add/duplicate/hide/delete.

import { h, icon, writeFrame } from "./dom.js";
import { isHighlighted, select, slideDocument, state, slidePosition } from "./state.js";
import { op, opQuiet, removeSlide } from "./actions.js";
import { slideTitle } from "../core/deck.js";

const THUMB_WIDTH = 188;

export function createRail({ onAddSlide }) {
  const items = new Map();
  const count = h("span", { class: "rail-count" });
  const list = h("ol", { class: "rail-list", "aria-label": "Slides" });
  const addButton = h("button", { type: "button", class: "btn btn-soft rail-add", onClick: () => onAddSlide(), "data-testid": "add-slide" }, icon("plus", 16), "Add slide");
  const root = h("aside", { class: "rail", "aria-label": "Slides" },
    h("div", { class: "panel-head" }, h("h2", {}, "Slides"), count),
    list,
    h("div", { class: "rail-foot" }, addButton),
  );

  let dragId = null;
  const indicator = h("li", { class: "drop-indicator", "aria-hidden": "true" });

  function makeItem(slide) {
    const frame = h("iframe", { class: "thumb-frame", tabindex: "-1", "aria-hidden": "true", title: "" });
    const thumb = h("div", { class: "thumb" }, frame);
    frame.style.transform = `scale(${THUMB_WIDTH / 1280})`;
    const num = h("span", { class: "rail-num" });
    const title = h("span", { class: "rail-title" });
    const badge = h("span", { class: "badge badge-muted rail-hidden-badge" }, "Hidden");
    const hideBtn = h("button", { type: "button", class: "icon-btn", "data-action": "hide" });
    const actions = h("div", { class: "rail-actions" },
      h("button", { type: "button", class: "icon-btn", title: "Duplicate slide", "aria-label": "Duplicate slide", "data-action": "duplicate", onClick: (e) => { e.stopPropagation(); duplicate(item.id); } }, icon("copy", 15)),
      hideBtn,
      h("button", { type: "button", class: "icon-btn danger", title: "Delete slide", "aria-label": "Delete slide", "data-action": "delete", onClick: (e) => { e.stopPropagation(); remove(item.id); } }, icon("trash", 15)),
    );
    hideBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const current = state.deck.slides.find((s) => s.id === item.id);
      opQuiet("set_hidden", { id: item.id, hidden: !current.hidden }, { label: current.hidden ? "Show slide" : "Hide slide" });
    });
    const li = h("li", {
      class: "rail-item",
      tabindex: "-1",
      draggable: "true",
      dataset: { id: slide.id },
      onClick: () => select(item.id),
      onKeydown: (e) => onKey(e, item.id),
      onDragstart: (e) => {
        dragId = item.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.id);
        li.classList.add("dragging");
      },
      onDragend: () => {
        dragId = null;
        li.classList.remove("dragging");
        indicator.remove();
      },
    },
      h("div", { class: "rail-meta" }, num, title, badge),
      thumb,
      actions,
    );
    const item = { id: slide.id, li, frame, num, title, hideBtn, html: "" };
    return item;
  }

  function duplicate(id) {
    op("duplicate_slide", { id }, { label: "Duplicate slide" }).then((r) => r?.result?.id && select(r.result.id)).catch(() => {});
  }

  async function remove(id) {
    try {
      await removeSlide(id);
    } catch {
      /* toast shown */
    }
  }

  function onKey(event, id) {
    const index = state.deck.slides.findIndex((s) => s.id === id);
    const mod = event.metaKey || event.ctrlKey;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const to = index + (event.key === "ArrowUp" ? -1 : 1);
      if (to >= 0 && to < state.deck.slides.length) opQuiet("move_slide", { id, index: to }, { label: "Move slide" }).then(() => focusSelected());
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = state.deck.slides[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (next) {
        select(next.id);
        focusSelected();
      }
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove(id);
    } else if (mod && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicate(id);
    }
  }

  function focusSelected() {
    requestAnimationFrame(() => items.get(state.selectedId)?.li.focus());
  }

  list.addEventListener("dragover", (event) => {
    if (!dragId) return;
    event.preventDefault();
    const target = event.target.closest(".rail-item");
    if (!target || target.dataset.id === dragId) return;
    const rect = target.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    target.parentNode.insertBefore(indicator, before ? target : target.nextSibling);
  });
  list.addEventListener("drop", (event) => {
    if (!dragId) return;
    event.preventDefault();
    const ordered = [...list.children].filter((el) => el.classList.contains("rail-item") || el === indicator);
    let index = 0;
    for (const el of ordered) {
      if (el === indicator) break;
      if (el.dataset.id !== dragId) index++;
    }
    const id = dragId;
    indicator.remove();
    if (state.deck.slides.findIndex((s) => s.id === id) !== index) opQuiet("move_slide", { id, index }, { label: "Move slide" });
  });

  function update() {
    if (!state.deck) return;
    const slides = state.deck.slides;
    count.textContent = `${slides.filter((s) => !s.hidden).length}/${slides.length}`;
    const seen = new Set();
    slides.forEach((slide) => {
      let item = items.get(slide.id);
      if (!item) {
        item = makeItem(slide);
        items.set(slide.id, item);
      }
      seen.add(slide.id);
      const { index } = slidePosition(slide);
      item.num.textContent = slide.hidden ? "–" : String(index + 1);
      const title = slideTitle(slide, state.templates[slide.template]);
      item.title.textContent = title;
      item.li.setAttribute("aria-label", `Slide ${slide.hidden ? "(hidden)" : index + 1}: ${title}`);
      item.li.classList.toggle("is-hidden", slide.hidden);
      item.li.classList.toggle("is-selected", slide.id === state.selectedId);
      item.li.setAttribute("aria-current", slide.id === state.selectedId ? "true" : "false");
      item.li.tabIndex = slide.id === state.selectedId ? 0 : -1;
      item.li.classList.toggle("is-changed", isHighlighted(slide.id));
      item.hideBtn.replaceChildren(icon(slide.hidden ? "eye" : "eyeOff", 15));
      item.hideBtn.title = slide.hidden ? "Show slide" : "Hide slide";
      item.hideBtn.setAttribute("aria-label", item.hideBtn.title);
      const html = slideDocument(slide);
      if (html !== item.html) {
        item.html = html;
        writeFrame(item.frame, html);
      }
      list.append(item.li);
    });
    for (const [id, item] of items) {
      if (!seen.has(id)) {
        item.li.remove();
        items.delete(id);
      }
    }
    const selected = items.get(state.selectedId);
    if (selected && !isInView(selected.li)) selected.li.scrollIntoView({ block: "nearest" });
  }

  function isInView(el) {
    const r = el.getBoundingClientRect();
    const p = list.getBoundingClientRect();
    return r.top >= p.top && r.bottom <= p.bottom;
  }

  return { root, update, focusSelected };
}
