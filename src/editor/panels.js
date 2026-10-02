// Resizable side panels: a splitter on the inner edge of the slide rail, the
// inspector and the Copilot panel. Widths persist in localStorage.

import { h } from "./dom.js";

const STORAGE_KEY = "deckforge.editor.panels";
const STAGE_MIN = 360;
const STEP = 16;

export const PANELS = {
  rail: { cssVar: "--rail-w", min: 180, max: 480, edge: "right", label: "Resize slides panel" },
  inspector: { cssVar: "--insp-w", min: 280, max: 640, edge: "left", label: "Resize inspector" },
  chat: { cssVar: "--chat-w", min: 300, max: 720, edge: "left", label: "Resize Copilot panel" },
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return Object.fromEntries(Object.entries(saved).filter(([k, v]) => PANELS[k] && Number.isFinite(v)));
  } catch {
    return {};
  }
}

function save(widths) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    /* storage unavailable: widths last for this session only */
  }
}

/** Clamp a panel width to its limits and to the room left for the stage. */
export function clampWidth(key, width, { viewport, others = 0 }) {
  const { min, max } = PANELS[key];
  const room = viewport - others - STAGE_MIN;
  return Math.round(Math.max(min, Math.min(width, max, room)));
}

/** Add splitters to the given panel elements ({ rail, inspector, chat }). */
export function createPanelResizers(roots) {
  const widths = load();
  const root = document.documentElement;
  const handles = {};

  const visibleWidth = (key) => {
    const el = roots[key];
    return el && el.getClientRects().length ? el.getBoundingClientRect().width : 0;
  };
  const othersWidth = (key) => Object.keys(roots).filter((k) => k !== key).reduce((sum, k) => sum + visibleWidth(k), 0);
  const limits = (key) => ({ viewport: window.innerWidth, others: othersWidth(key) });

  function apply(key) {
    if (widths[key] === undefined) root.style.removeProperty(PANELS[key].cssVar);
    else root.style.setProperty(PANELS[key].cssVar, `${clampWidth(key, widths[key], limits(key))}px`);
    syncAria(key);
  }

  function syncAria(key) {
    const handle = handles[key];
    const { min, max } = PANELS[key];
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute("aria-valuemax", String(max));
    handle.setAttribute("aria-valuenow", String(Math.round(visibleWidth(key) || widths[key] || min)));
  }

  function set(key, width, { persist = true } = {}) {
    widths[key] = clampWidth(key, width, limits(key));
    apply(key);
    if (persist) save(widths);
  }

  function reset(key) {
    delete widths[key];
    apply(key);
    save(widths);
  }

  for (const [key, panel] of Object.entries(PANELS)) {
    const el = roots[key];
    if (!el) continue;
    const sign = panel.edge === "right" ? 1 : -1;
    const handle = h("div", {
      class: `panel-resizer panel-resizer-${panel.edge}`,
      role: "separator",
      tabindex: "0",
      "aria-orientation": "vertical",
      "aria-label": panel.label,
      title: `${panel.label} (double-click to reset)`,
      dataset: { panel: key },
      onDblclick: () => reset(key),
      onKeydown: (e) => {
        const step = e.shiftKey ? STEP * 4 : STEP;
        const current = visibleWidth(key);
        let next = null;
        if (e.key === "ArrowLeft") next = current - sign * step;
        else if (e.key === "ArrowRight") next = current + sign * step;
        else if (e.key === "Home") next = panel.min;
        else if (e.key === "End") next = panel.max;
        if (next === null) return;
        e.preventDefault();
        set(key, next);
      },
    });
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = visibleWidth(key);
      document.body.classList.add("is-resizing");
      handle.classList.add("is-active");
      const move = (ev) => set(key, startWidth + sign * (ev.clientX - startX), { persist: false });
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        document.body.classList.remove("is-resizing");
        handle.classList.remove("is-active");
        save(widths);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
    handles[key] = handle;
    el.append(handle);
  }

  const applyAll = () => Object.keys(handles).forEach(apply);
  applyAll();
  // Panels appear/disappear (window size, chat toggle): keep widths within the window.
  window.addEventListener("resize", applyAll);
  new MutationObserver(applyAll).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  const ro = new ResizeObserver(() => Object.keys(handles).forEach(syncAria));
  Object.keys(handles).forEach((key) => ro.observe(roots[key]));
  return { reset, set, applyAll };
}
