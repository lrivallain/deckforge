// Slide rail: thumbnails, selection, drag-and-drop reorder, add/duplicate/hide/delete.

import { frameIsCurrent, h, icon, writeFrame } from "./dom.js";
import { isHighlighted, select, slideDocument, state, slidePosition } from "./state.js";
import { op, opQuiet, removeSlide } from "./actions.js";
import { slideTitle } from "../core/deck.js";

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

  // Thumbnails follow the rail width (it is resizable): scale the 1280px frames to fit.
  function fitThumbs() {
    const thumb = list.querySelector(".thumb");
    if (thumb?.clientWidth) list.style.setProperty("--thumb-scale", String(thumb.clientWidth / 1280));
  }
  new ResizeObserver(fitThumbs).observe(list);

  let dragId = null;
  const indicator = h("li", { class: "drop-indicator", "aria-hidden": "true" });

  function makeItem(slide) {
    const frame = h("iframe", { class: "thumb-frame", tabindex: "-1", "aria-hidden": "true", title: "" });
    const thumb = h("div", { class: "thumb" }, frame);
    const num = h("span", { class: "rail-num" });
    const title = h("span", { class: "rail-title" });
    const badge = h("span", { class: "badge badge-muted rail-hidden-badge" }, "Hidden");
    const layout = h("span", { class: "rail-layout" });
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
      layout,
      thumb,
      actions,
    );
    const item = { id: slide.id, li, frame, num, title, layout, hideBtn, html: "" };
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
    const seen = new Set(slides.map((s) => s.id));
    for (const [id, item] of items) {
      if (!seen.has(id)) {
        item.li.remove();
        items.delete(id);
      }
    }
    slides.forEach((slide, index0) => {
      let item = items.get(slide.id);
      if (!item) {
        item = makeItem(slide);
        items.set(slide.id, item);
      }
      const { index } = slidePosition(slide);
      item.num.textContent = slide.hidden ? "–" : String(index + 1);
      const title = slideTitle(slide, state.templates[slide.template]);
      item.title.textContent = title;
      // A custom navigation title can hide a layout change: show the template too.
      const templateLabel = state.templates[slide.template]?.label || slide.template;
      item.layout.textContent = slide.title ? templateLabel : "";
      item.layout.hidden = !slide.title;
      item.li.setAttribute("aria-label", `Slide ${slide.hidden ? "(hidden)" : index + 1}: ${title} (${templateLabel})`);
      item.li.classList.toggle("is-hidden", slide.hidden);
      item.li.classList.toggle("is-selected", slide.id === state.selectedId);
      item.li.setAttribute("aria-current", slide.id === state.selectedId ? "true" : "false");
      item.li.tabIndex = slide.id === state.selectedId ? 0 : -1;
      item.li.classList.toggle("is-changed", isHighlighted(slide.id));
      item.hideBtn.replaceChildren(icon(slide.hidden ? "eye" : "eyeOff", 15));
      item.hideBtn.title = slide.hidden ? "Show slide" : "Hide slide";
      item.hideBtn.setAttribute("aria-label", item.hideBtn.title);
      // Only move nodes that are out of order: moving an iframe resets its document.
      const expected = index0 === 0 ? list.firstElementChild : items.get(slides[index0 - 1].id)?.li.nextElementSibling;
      if (expected !== item.li) {
        if (index0 === 0) list.prepend(item.li);
        else items.get(slides[index0 - 1].id).li.after(item.li);
      }
      const html = slideDocument(slide);
      if (html !== item.html || !frameIsCurrent(item.frame)) {
        if (writeFrame(item.frame, html)) item.html = html;
      }
    });
    fitThumbs();
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
