// Drag to reorder the items of list/cards slots: directly on the slide
// preview (a grip drawn by the parent page over the hovered item) and in the
// inspector lists. Each drop is one `move_item` op, i.e. one undo step.

import { h, icon } from "./dom.js";
import { selectedSlide } from "./state.js";
import { opQuiet } from "./actions.js";

const INDEX_RE = /^\d+$/;

/** Find the rendered root element of every item of every list slot in a preview document. */
export function findItems(doc) {
  const inner = doc?.querySelector(".slide-inner");
  if (!inner) return [];
  const groups = new Map();
  for (const el of inner.querySelectorAll("[data-df-slot], [data-df-image]")) {
    const parts = (el.dataset.dfSlot || el.dataset.dfImage).split(".");
    for (let k = 1; k < parts.length; k++) {
      if (!INDEX_RE.test(parts[k])) continue;
      const list = parts.slice(0, k).join(".");
      if (!groups.has(list)) groups.set(list, new Map());
      const byIndex = groups.get(list);
      const index = Number(parts[k]);
      if (!byIndex.has(index)) byIndex.set(index, []);
      byIndex.get(index).push(el);
    }
  }
  const items = [];
  for (const [list, byIndex] of groups) {
    if (byIndex.size < 2) continue;
    const others = (index) => [...byIndex].filter(([i]) => i !== index).flatMap(([, els]) => els);
    for (const [index, els] of byIndex) {
      const foreign = others(index);
      // Climb while the ancestor still only contains this item's slots.
      let node = els[0];
      while (node.parentElement && node.parentElement !== inner && !foreign.some((f) => node.parentElement.contains(f))) node = node.parentElement;
      items.push({ list, index, el: node, depth: list.split(".").length });
    }
  }
  return items;
}

export function createPreviewReorder({ frame, layer }) {
  const grip = h("button", { type: "button", class: "ov-grip", title: "Drag to reorder", "aria-label": "Drag to reorder", "data-testid": "reorder-grip", hidden: true }, icon("grip", 16));
  const indicator = h("div", { class: "ov-insert", hidden: true });
  layer.append(indicator, grip);
  let items = [];
  let hovered = null;
  let hideTimer = null;
  let drag = null;
  let busy = () => false;

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };

  function refresh() {
    items = findItems(frame.contentDocument);
    for (const item of items) item.el.classList.add("df-reorderable");
    hide(true);
  }

  function show(item) {
    clearTimeout(hideTimer);
    hovered = item;
    const r = rectOf(item.el);
    const inv = Number(getComputedStyle(layer).getPropertyValue("--inv")) || 1;
    const size = 24 * inv;
    grip.style.left = `${Math.max(0, r.left - size / 2)}px`;
    grip.style.top = `${Math.max(0, r.top + Math.min(8, r.height / 2 - size / 2))}px`;
    grip.hidden = false;
    grip.setAttribute("aria-label", `Drag to reorder ${item.list} item ${item.index + 1}`);
  }

  function hide(now = false) {
    clearTimeout(hideTimer);
    const run = () => {
      if (drag) return;
      grip.hidden = true;
      hovered = null;
    };
    if (now) run();
    else hideTimer = setTimeout(run, 450);
  }

  function itemAt(target) {
    let best = null;
    for (const item of items) if (item.el.contains(target) && (!best || item.depth > best.depth || best.el.contains(item.el))) best = item;
    return best;
  }

  function wire(doc, isBusy) {
    busy = isBusy;
    if (!doc || doc.__dfReorderWired) return;
    doc.__dfReorderWired = true;
    doc.addEventListener("pointermove", (e) => {
      if (drag || busy() || e.buttons) return;
      const item = itemAt(e.target);
      if (item && item !== hovered) show(item);
      else if (!item && hovered) hide();
      else if (item) clearTimeout(hideTimer);
    });
    doc.documentElement.addEventListener("pointerleave", () => hide());
  }

  grip.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  grip.addEventListener("pointerleave", () => hide());
  grip.addEventListener("pointerdown", (e) => {
    if (!hovered || e.button !== 0) return;
    e.preventDefault();
    const siblings = items.filter((i) => i.list === hovered.list).sort((a, b) => a.index - b.index);
    const rects = siblings.map((i) => ({ item: i, r: rectOf(i.el) }));
    const horizontal = rects.length > 1 && Math.abs(rects[1].r.left - rects[0].r.left) > Math.abs(rects[1].r.top - rects[0].r.top);
    drag = { from: hovered.index, to: hovered.index, list: hovered.list, rects, horizontal, el: hovered.el };
    hovered.el.classList.add("df-dragging");
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const rect = layer.getBoundingClientRect();
    const scale = rect.width / 1280;
    const p = { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
    let target = drag.rects.find(({ r }) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom);
    if (!target) {
      const dist = ({ r }) => Math.hypot(p.x - (r.left + r.width / 2), p.y - (r.top + r.height / 2));
      target = [...drag.rects].sort((a, b) => dist(a) - dist(b))[0];
    }
    drag.to = target.item.index;
    const r = target.r;
    const after = drag.to > drag.from;
    indicator.hidden = drag.to === drag.from;
    indicator.classList.toggle("is-vertical", drag.horizontal);
    if (drag.horizontal) Object.assign(indicator.style, { left: `${(after ? r.right : r.left) - 2}px`, top: `${r.top}px`, width: "4px", height: `${r.height}px` });
    else Object.assign(indicator.style, { left: `${r.left}px`, top: `${(after ? r.bottom : r.top) - 2}px`, width: `${r.width}px`, height: "4px" });
    grip.style.left = `${p.x - 12}px`;
    grip.style.top = `${p.y - 12}px`;
  });
  const end = () => {
    if (!drag) return;
    const { from, to, list, el } = drag;
    drag = null;
    el.classList.remove("df-dragging");
    indicator.hidden = true;
    hide(true);
    const slide = selectedSlide();
    if (slide && from !== to) opQuiet("move_item", { id: slide.id, path: list, from, to }, { label: "Reorder items" });
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("lostpointercapture", end);

  return { refresh, wire, hide: () => hide(true) };
}

/**
 * Pointer-driven sorting for inspector lists: rows are the direct children
 * of `list`; dragging a `.drag-handle` moves its row. Works in WebKit, where
 * HTML drag and drop cannot be scripted.
 */
export function makeSortable(list, onMove) {
  const indicator = h("li", { class: "sort-indicator", "aria-hidden": "true" });
  list.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle || e.button !== 0) return;
    const rows = [...list.children].filter((el) => el !== indicator);
    const row = rows.find((r) => r.contains(handle));
    const from = rows.indexOf(row);
    if (from < 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    row.classList.add("is-dragging");
    let to = from;
    const move = (ev) => {
      let slot = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          slot = i;
          break;
        }
      }
      list.insertBefore(indicator, rows[slot] || null);
      // Insertion slot (0..n) → final index once the dragged row is removed.
      to = slot > from ? slot - 1 : slot;
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      row.classList.remove("is-dragging");
      indicator.remove();
      if (to !== from) onMove(from, to);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}
