// Free overlay layer on the stage: click-to-select inside the preview, a
// selection box drawn by the parent page (the preview is an about:blank
// document written with document.write), drag, 8 resize handles, rotation,
// snapping to an 8 px grid and to template edges with guides, keyboard
// nudges and the arrange/align/distribute actions. Every pointer gesture is
// sent as one op, i.e. one undo step.

import { h } from "./dom.js";
import { selectedSlide, selectOverlays, selectedOverlays, state } from "./state.js";
import { op, opQuiet } from "./actions.js";
import { DEFAULT_SIZE, OVERLAY_KINDS, SLIDE_HEIGHT as H, SLIDE_WIDTH as W } from "../core/overlay.js";

const GRID = 8;
const SNAP_SCREEN_PX = 6;
const MIN_SIZE = 8;
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const round2 = (n) => Math.round(n * 100) / 100;
export const toPx = (o) => ({ x: (o.x * W) / 100, y: (o.y * H) / 100, w: (o.w * W) / 100, h: (o.h * H) / 100, r: o.rotate || 0 });
export const toPct = (b) => ({ x: round2((b.x * 100) / W), y: round2((b.y * 100) / H), w: round2((b.w * 100) / W), h: round2((b.h * 100) / H) });
const snapGrid = (v) => Math.round(v / GRID) * GRID;

function union(boxes) {
  const l = Math.min(...boxes.map((b) => b.x));
  const t = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const b = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: l, y: t, w: r - l, h: b - t };
}

// ------------------------------------------------------------ actions

function slideId() {
  return selectedSlide()?.id;
}

/** Insert a new overlay centred on the slide (or at `at`, in slide px) and select it. */
export async function insertOverlay(kind, { data = {}, size, at } = {}) {
  const slide = selectedSlide();
  if (!slide || !OVERLAY_KINDS.includes(kind)) return null;
  const base = size || { w: (DEFAULT_SIZE[kind].w * W) / 100, h: (DEFAULT_SIZE[kind].h * H) / 100 };
  let x = snapGrid((at?.x ?? W / 2) - base.w / 2);
  let y = snapGrid((at?.y ?? H / 2) - base.h / 2);
  x = Math.max(0, Math.min(W - base.w, x));
  y = Math.max(0, Math.min(H - base.h, y));
  // Cascade so repeated inserts do not stack exactly.
  const taken = (slide.overlays || []).map(toPx);
  while (taken.some((b) => Math.abs(b.x - x) < 1 && Math.abs(b.y - y) < 1) && x + base.w + 16 <= W && y + base.h + 16 <= H) {
    x += 16;
    y += 16;
  }
  const overlay = { kind, ...toPct({ x, y, w: base.w, h: base.h }), data };
  try {
    const res = await op("add_overlay", { id: slide.id, overlay }, { label: `Insert ${kind}` });
    const ids = res?.result?.overlayIds || [];
    if (ids.length) selectOverlays(ids);
    return ids[0] ?? null;
  } catch {
    return null;
  }
}

export function updateOverlays(updates, { label = "Move overlay", coalesce } = {}) {
  const id = slideId();
  if (!id || !updates.length) return Promise.resolve(null);
  return opQuiet("update_overlay", { id, updates }, { label, coalesce });
}

export async function duplicateSelected() {
  const id = slideId();
  const selected = selectedOverlays();
  if (!id || !selected.length) return;
  const overlays = selected.map((o) => {
    const copy = structuredClone(o);
    delete copy.id;
    delete copy.z;
    const b = toPx(o);
    const pct = toPct({ ...b, x: Math.min(W - b.w, b.x + 16), y: Math.min(H - b.h, b.y + 16) });
    return { ...copy, x: pct.x, y: pct.y };
  });
  try {
    const res = await op("add_overlay", { id, overlays }, { label: selected.length > 1 ? "Duplicate overlays" : "Duplicate overlay" });
    if (res?.result?.overlayIds?.length) selectOverlays(res.result.overlayIds);
  } catch {
    /* toast shown */
  }
}

export async function removeSelected() {
  const id = slideId();
  const ids = [...state.overlaySelection];
  if (!id || !ids.length) return;
  selectOverlays([]);
  await opQuiet("remove_overlay", { id, overlayIds: ids }, { label: ids.length > 1 ? "Delete overlays" : "Delete overlay" });
}

/** Bring the selection forward/backward one step (or to the front/back). */
export function arrangeSelected(direction) {
  const slide = selectedSlide();
  if (!slide?.overlays?.length || !state.overlaySelection.length) return;
  const order = [...slide.overlays].sort((a, b) => a.z - b.z).map((o) => o.id);
  const selected = new Set(state.overlaySelection);
  let next;
  if (direction === "front" || direction === "back") {
    const rest = order.filter((x) => !selected.has(x));
    const picked = order.filter((x) => selected.has(x));
    next = direction === "front" ? [...rest, ...picked] : [...picked, ...rest];
  } else {
    next = [...order];
    const step = direction === "forward" ? 1 : -1;
    const indices = next.map((x, i) => (selected.has(x) ? i : -1)).filter((i) => i >= 0);
    if (step > 0) indices.reverse();
    for (const i of indices) {
      const j = i + step;
      if (j < 0 || j >= next.length || selected.has(next[j])) continue;
      [next[i], next[j]] = [next[j], next[i]];
    }
  }
  const updates = next.map((overlayId, i) => ({ overlayId, props: { z: i + 1 } })).filter((u) => zOf(slide, u.overlayId) !== u.props.z);
  updateOverlays(updates, { label: direction === "forward" || direction === "front" ? "Bring forward" : "Send backward" });
}

function zOf(slide, id) {
  return slide.overlays.find((o) => o.id === id)?.z ?? 0;
}

/** Align the selection to its bounds (or to the slide when one overlay is selected). */
export function alignSelected(edge) {
  const selected = selectedOverlays();
  if (!selected.length) return;
  const boxes = selected.map(toPx);
  const ref = selected.length === 1 ? { x: 0, y: 0, w: W, h: H } : union(boxes);
  const updates = selected.map((o, i) => {
    const b = boxes[i];
    const pos = { x: b.x, y: b.y };
    if (edge === "left") pos.x = ref.x;
    if (edge === "center") pos.x = ref.x + (ref.w - b.w) / 2;
    if (edge === "right") pos.x = ref.x + ref.w - b.w;
    if (edge === "top") pos.y = ref.y;
    if (edge === "middle") pos.y = ref.y + (ref.h - b.h) / 2;
    if (edge === "bottom") pos.y = ref.y + ref.h - b.h;
    const pct = toPct({ ...b, ...pos });
    return { overlayId: o.id, props: { x: pct.x, y: pct.y } };
  });
  updateOverlays(updates, { label: `Align ${edge}` });
}

/** Equal gaps between three or more overlays along an axis. */
export function distributeSelected(axis) {
  const selected = selectedOverlays();
  if (selected.length < 3) return;
  const key = axis === "horizontal" ? "x" : "y";
  const size = axis === "horizontal" ? "w" : "h";
  const items = selected.map((o) => ({ o, b: toPx(o) })).sort((a, b) => a.b[key] + a.b[size] / 2 - (b.b[key] + b.b[size] / 2));
  const start = items[0].b[key];
  const end = Math.max(...items.map((i) => i.b[key] + i.b[size]));
  const gap = (end - start - items.reduce((sum, i) => sum + i.b[size], 0)) / (items.length - 1);
  let cursor = start;
  const updates = items.map(({ o, b }) => {
    const pct = toPct({ ...b, [key]: cursor });
    cursor += b[size] + gap;
    return { overlayId: o.id, props: { [key]: pct[key] } };
  });
  updateOverlays(updates, { label: `Distribute ${axis}ly` });
}

export function nudgeSelected(dx, dy) {
  const selected = selectedOverlays();
  if (!selected.length) return;
  const updates = selected.map((o) => {
    const b = toPx(o);
    const pct = toPct({ ...b, x: b.x + dx, y: b.y + dy });
    return { overlayId: o.id, props: { x: pct.x, y: pct.y } };
  });
  updateOverlays(updates, { label: "Nudge overlay", coalesce: `nudge:${slideId()}:${state.overlaySelection.join(",")}` });
}

// ------------------------------------------------------------ stage layer

export function createOverlayLayer({ frame, getScale, onRejected, focusStage }) {
  const guides = h("div", { class: "ov-guides" });
  const boxes = h("div", { class: "ov-boxes" });
  const root = h("div", { class: "ov-layer", "data-testid": "overlay-layer" }, guides, boxes);
  let gesture = null;
  let afterGesture = null;
  let drawn = "";

  const doc = () => frame.contentDocument;
  const scale = () => getScale() || 1;
  const parentPoint = (e) => {
    const rect = root.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale(), y: (e.clientY - rect.top) / scale() };
  };
  const framePoint = (e) => ({ x: e.clientX, y: e.clientY });

  function setScale(s) {
    root.style.transform = `scale(${s})`;
    root.style.setProperty("--inv", String(1 / s));
  }

  function overlayEl(id) {
    return doc()?.querySelector(`.df-overlay > [data-ov-id="${CSS.escape(id)}"]`) || null;
  }

  function styleBox(el, b) {
    el.style.left = `${b.x}px`;
    el.style.top = `${b.y}px`;
    el.style.width = `${b.w}px`;
    el.style.height = `${b.h}px`;
    el.style.rotate = b.r ? `${b.r}deg` : "";
  }

  function applyLive(live) {
    for (const [id, b] of live) {
      const el = overlayEl(id);
      if (el) {
        const pct = toPct(b);
        el.style.left = `${pct.x}%`;
        el.style.top = `${pct.y}%`;
        el.style.width = `${pct.w}%`;
        el.style.height = `${pct.h}%`;
        el.style.rotate = b.r ? `${b.r}deg` : "";
      }
      const box = boxes.querySelector(`[data-ov-id="${CSS.escape(id)}"]`);
      if (box) styleBox(box, b);
    }
  }

  // ---------------------------------------------------------- drawing

  function render() {
    if (gesture) return;
    const slide = selectedSlide();
    const selected = selectedOverlays();
    const warned = new Set((state.overlayWarnings.get(slide?.id) || []).map((w) => w.overlayId));
    // Keep the same boxes and handles while nothing changed (no flicker under the pointer).
    const key = JSON.stringify([slide?.id, selected.map((o) => [o.id, o.x, o.y, o.w, o.h, o.rotate || 0, warned.has(o.id)])]);
    if (key === drawn && boxes.childElementCount === selected.length) return;
    drawn = key;
    boxes.replaceChildren(...selected.map((o) => {
      const box = h("div", {
        class: `ov-box${warned.has(o.id) ? " is-warn" : ""}`,
        dataset: { ovId: o.id },
        "aria-hidden": "true",
        "data-testid": "overlay-box",
      });
      styleBox(box, toPx(o));
      box.addEventListener("pointerdown", (e) => onBoxPointerDown(e, o.id));
      box.addEventListener("dblclick", () => root.dispatchEvent(new CustomEvent("overlay-edit", { detail: { id: o.id } })));
      if (selected.length === 1) {
        for (const handle of HANDLES) {
          const el = h("div", { class: `ov-handle ov-${handle}`, dataset: { handle }, "data-testid": `handle-${handle}` });
          el.addEventListener("pointerdown", (e) => startGesture(e, "resize", { handle, source: "parent", el }));
          box.append(el);
        }
        const rotate = h("div", { class: "ov-rotate", title: "Rotate (Shift: 15° steps)", "data-testid": "handle-rotate" });
        rotate.addEventListener("pointerdown", (e) => startGesture(e, "rotate", { source: "parent", el: rotate }));
        box.append(rotate);
      }
      return box;
    }));
  }

  function showGuides(lines) {
    guides.replaceChildren(...lines.map((g) => h("div", {
      class: `ov-guide ov-guide-${g.axis}`,
      style: g.axis === "x" ? { left: `${g.pos}px` } : { top: `${g.pos}px` },
    })));
  }

  // ---------------------------------------------------------- snapping

  function snapTargets(exclude) {
    const xs = [0, W / 2, W];
    const ys = [0, H / 2, H];
    const d = doc();
    const inner = d?.querySelector(".slide-inner");
    if (inner) {
      const cs = d.defaultView.getComputedStyle(inner);
      xs.push(parseFloat(cs.paddingLeft) || 0, W - (parseFloat(cs.paddingRight) || 0));
      ys.push(parseFloat(cs.paddingTop) || 0, H - (parseFloat(cs.paddingBottom) || 0));
      const els = inner.querySelectorAll(":scope > *, .reveal, .card, .column, .media, h1, h2, h3, li, df-slot, .pill");
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width < 16 || r.height < 8) continue;
        xs.push(r.left, r.right, r.left + r.width / 2);
        ys.push(r.top, r.bottom, r.top + r.height / 2);
      }
    }
    for (const o of selectedSlide()?.overlays || []) {
      if (exclude.has(o.id) || o.rotate) continue;
      const b = toPx(o);
      xs.push(b.x, b.x + b.w, b.x + b.w / 2);
      ys.push(b.y, b.y + b.h, b.y + b.h / 2);
    }
    return { x: [...new Set(xs.map((v) => Math.round(v * 2) / 2))], y: [...new Set(ys.map((v) => Math.round(v * 2) / 2))] };
  }

  /** Best snap delta for any of `values` (edges) onto `targets`, else null. */
  function nearest(values, targets) {
    const threshold = SNAP_SCREEN_PX / scale();
    let best = null;
    for (const v of values) {
      for (const t of targets) {
        const d = t - v;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, pos: t };
      }
    }
    return best;
  }

  // ---------------------------------------------------------- gestures

  function startGesture(e, type, { handle = null, source, el }) {
    if (e.button !== 0) return;
    const slide = selectedSlide();
    const selected = selectedOverlays();
    if (!slide || !selected.length) return;
    e.preventDefault();
    e.stopPropagation();
    const point = source === "frame" ? framePoint(e) : parentPoint(e);
    const ids = selected.map((o) => o.id);
    gesture = {
      type,
      handle,
      source,
      slideId: slide.id,
      start: point,
      orig: new Map(selected.map((o) => [o.id, toPx(o)])),
      live: new Map(selected.map((o) => [o.id, toPx(o)])),
      targets: snapTargets(new Set(ids)),
      moved: false,
      el,
    };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* element may be gone */
    }
    const target = el;
    const move = (ev) => onMove(ev);
    const up = (ev) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      onUp(ev);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
    const d = doc();
    if (d?.body) d.body.classList.add("df-gesture");
    root.classList.add("is-active");
  }

  function onMove(e) {
    if (!gesture) return;
    const p = gesture.source === "frame" ? framePoint(e) : parentPoint(e);
    let dx = p.x - gesture.start.x;
    let dy = p.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 2) return;
    gesture.moved = true;
    const free = e.altKey;
    const lines = [];
    if (gesture.type === "move") {
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const u = union([...gesture.orig.values()]);
      if (!free) {
        const sx = nearest([u.x + dx, u.x + dx + u.w / 2, u.x + dx + u.w], gesture.targets.x);
        dx = sx ? dx + sx.d : snapGrid(u.x + dx) - u.x;
        if (sx) lines.push({ axis: "x", pos: sx.pos });
        const sy = nearest([u.y + dy, u.y + dy + u.h / 2, u.y + dy + u.h], gesture.targets.y);
        dy = sy ? dy + sy.d : snapGrid(u.y + dy) - u.y;
        if (sy) lines.push({ axis: "y", pos: sy.pos });
      }
      for (const [id, b] of gesture.orig) gesture.live.set(id, { ...b, x: b.x + dx, y: b.y + dy });
    } else if (gesture.type === "resize") {
      const [id, b] = [...gesture.orig][0];
      gesture.live.set(id, resizeBox(b, gesture.handle, dx, dy, { keepRatio: e.shiftKey, snap: !free && !b.r, lines }));
    } else if (gesture.type === "rotate") {
      const [id, b] = [...gesture.orig][0];
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      let angle = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      if (angle > 180) angle -= 360;
      if (e.shiftKey) angle = Math.round(angle / 15) * 15;
      else if (Math.abs(angle - Math.round(angle / 90) * 90) < 4) angle = Math.round(angle / 90) * 90;
      if (angle === -180) angle = 180;
      gesture.live.set(id, { ...b, r: Math.round(angle * 10) / 10 });
    }
    showGuides(lines);
    applyLive(gesture.live);
  }

  function resizeBox(b, handle, dx, dy, { keepRatio, snap, lines }) {
    if (b.r) return resizeRotated(b, handle, dx, dy, keepRatio);
    let l = b.x;
    let t = b.y;
    let r = b.x + b.w;
    let btm = b.y + b.h;
    const snapEdge = (value, axis) => {
      if (!snap) return value;
      const s = nearest([value], gesture.targets[axis]);
      if (s) {
        lines.push({ axis, pos: s.pos });
        return s.pos;
      }
      return snapGrid(value);
    };
    if (handle.includes("w")) l = snapEdge(l + dx, "x");
    if (handle.includes("e")) r = snapEdge(r + dx, "x");
    if (handle.includes("n")) t = snapEdge(t + dy, "y");
    if (handle.includes("s")) btm = snapEdge(btm + dy, "y");
    if (r - l < MIN_SIZE) {
      if (handle.includes("w")) l = r - MIN_SIZE;
      else r = l + MIN_SIZE;
    }
    if (btm - t < MIN_SIZE) {
      if (handle.includes("n")) t = btm - MIN_SIZE;
      else btm = t + MIN_SIZE;
    }
    if (keepRatio) {
      const ratio = b.w / b.h;
      let w = r - l;
      let hh = btm - t;
      const corner = handle.length === 2;
      if (corner) {
        if (w / hh > ratio) w = hh * ratio;
        else hh = w / ratio;
        if (handle.includes("w")) l = r - w;
        else r = l + w;
        if (handle.includes("n")) t = btm - hh;
        else btm = t + hh;
      } else if (handle === "e" || handle === "w") {
        hh = w / ratio;
        t = b.y + b.h / 2 - hh / 2;
        btm = t + hh;
      } else {
        w = hh * ratio;
        l = b.x + b.w / 2 - w / 2;
        r = l + w;
      }
      lines.length = 0;
    }
    return { x: l, y: t, w: r - l, h: btm - t, r: 0 };
  }

  function resizeRotated(b, handle, dx, dy, keepRatio) {
    const rad = (b.r * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Pointer delta in the overlay's own axes.
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
    const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
    let w = Math.max(MIN_SIZE, b.w + sx * lx);
    let hh = Math.max(MIN_SIZE, b.h + sy * ly);
    if (keepRatio) {
      const ratio = b.w / b.h;
      if (sx && (!sy || w / hh > ratio)) hh = w / ratio;
      else w = hh * ratio;
    }
    // Keep the opposite edge fixed: shift the centre along the local axes.
    const cx = (sx * (w - b.w)) / 2;
    const cy = (sy * (hh - b.h)) / 2;
    const centerX = b.x + b.w / 2 + cx * cos - cy * sin;
    const centerY = b.y + b.h / 2 + cx * sin + cy * cos;
    return { x: centerX - w / 2, y: centerY - hh / 2, w, h: hh, r: b.r };
  }

  function onUp() {
    const g = gesture;
    gesture = null;
    showGuides([]);
    root.classList.remove("is-active");
    doc()?.body?.classList.remove("df-gesture");
    if (g?.moved) {
      const updates = [];
      for (const [id, b] of g.live) {
        const before = g.orig.get(id);
        const pct = toPct(b);
        const was = toPct(before);
        const props = {};
        for (const key of ["x", "y", "w", "h"]) if (pct[key] !== was[key]) props[key] = pct[key];
        if ((b.r || 0) !== (before.r || 0)) props.rotate = b.r || 0;
        if (Object.keys(props).length) updates.push({ overlayId: id, props });
      }
      const label = g.type === "resize" ? "Resize overlay" : g.type === "rotate" ? "Rotate overlay" : updates.length > 1 ? "Move overlays" : "Move overlay";
      if (updates.length && g.slideId === slideId()) updateOverlays(updates, { label }).then((res) => !res && onRejected?.());
    }
    const pending = afterGesture;
    afterGesture = null;
    pending?.();
    // The boxes were moved live: redraw them from the deck.
    drawn = "";
    render();
  }

  function onBoxPointerDown(e, id) {
    focusStage?.();
    if (e.shiftKey) {
      e.preventDefault();
      selectOverlays(state.overlaySelection.filter((x) => x !== id));
      return;
    }
    startGesture(e, "move", { source: "parent", el: e.currentTarget });
  }

  /** pointerdown inside the preview document. */
  function onFramePointerDown(e) {
    const el = e.target.closest?.(".df-overlay > .df-ov");
    if (!el) {
      if (state.overlaySelection.length && !e.shiftKey) selectOverlays([]);
      return;
    }
    const id = el.dataset.ovId;
    // Keyboard shortcuts must reach the overlays, not a focused rail item.
    focusStage?.();
    if (e.shiftKey) {
      e.preventDefault();
      const has = state.overlaySelection.includes(id);
      selectOverlays(has ? state.overlaySelection.filter((x) => x !== id) : [...state.overlaySelection, id]);
      return;
    }
    if (!state.overlaySelection.includes(id)) selectOverlays([id]);
    startGesture(e, "move", { source: "frame", el });
  }

  function wire(d) {
    if (!d) return;
    d.addEventListener("pointerdown", onFramePointerDown, true);
    d.addEventListener("keydown", onKeyDown);
  }

  // ---------------------------------------------------------- keyboard

  function onKeyDown(e) {
    if (!state.overlaySelection.length || e.defaultPrevented || document.querySelector("dialog[open]")) return;
    const t = e.target;
    if (t instanceof (t?.ownerDocument?.defaultView?.Element || Element) && t.closest("input, textarea, select, [contenteditable], .cm-editor, .rail, .chat")) return;
    const mod = e.metaKey || e.ctrlKey;
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key] && !mod && !e.altKey) {
      e.preventDefault();
      nudgeSelected(...moves[e.key]);
    } else if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
      e.preventDefault();
      removeSelected();
    } else if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateSelected();
    } else if (mod && (e.key === "]" || e.key === "[")) {
      e.preventDefault();
      arrangeSelected(e.key === "]" ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward");
    } else if (e.key === "Escape") {
      selectOverlays([]);
    } else if (mod && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y") && t?.ownerDocument !== document) {
      // Undo/redo from inside the preview: hand over to the editor shortcuts.
      e.preventDefault();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey }));
    }
  }
  window.addEventListener("keydown", onKeyDown);

  // ---------------------------------------------------------- overlap check

  /** Overlays that cover template text (measured in the laid-out preview). */
  function measureWarnings() {
    const slide = selectedSlide();
    const d = doc();
    if (!slide || !d?.body) return [];
    const texts = [...d.querySelectorAll(".slide-inner df-slot")].filter((el) => el.textContent.trim() && !el.hasAttribute("data-df-placeholder"));
    const rects = texts.map((el) => ({ slot: el.dataset.dfSlot, rects: [...el.getClientRects()] }));
    const out = [];
    for (const o of slide.overlays || []) {
      const b = toPx(o);
      for (const { slot, rects: list } of rects) {
        const hit = list.some((r) => Math.min(b.x + b.w, r.right) - Math.max(b.x, r.left) > 2 && Math.min(b.y + b.h, r.bottom) - Math.max(b.y, r.top) > 2);
        if (hit) {
          out.push({ overlayId: o.id, slot });
          break;
        }
      }
    }
    return out;
  }

  return {
    root,
    render,
    wire,
    setScale,
    measureWarnings,
    busy: () => Boolean(gesture),
    defer: (fn) => {
      afterGesture = fn;
    },
  };
}
