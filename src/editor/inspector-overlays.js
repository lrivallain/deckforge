// Inspector panel for the free overlay layer: layers list, arrange/align/
// distribute actions, geometry and kind-specific properties (theme tokens).

import { h, icon, debounce } from "./dom.js";
import { selectOverlays, state } from "./state.js";
import { imageControl } from "./image-control.js";
import { aiImprove } from "./improve.js";
import { alignSelected, arrangeSelected, distributeSelected, duplicateSelected, removeSelected, toPct, toPx, updateOverlays } from "./overlays.js";
import { OVERLAY_OPTIONS, overlayIssues } from "../core/overlay.js";
import { stripTags } from "../core/html.js";

const KIND_LABELS = { image: "Image", text: "Text", callout: "Callout", arrow: "Arrow", shape: "Shape" };
const OPTION_LABELS = {
  style: "Style", align: "Align", color: "Color", tone: "Tone", head: "Arrow head", weight: "Weight", line: "Line", shape: "Shape", fill: "Fill", stroke: "Border",
};

export function overlaySummary(o) {
  if (o.kind === "text" || o.kind === "callout") return stripTags(o.data?.text || "").slice(0, 40) || "(empty)";
  if (o.kind === "image") return o.data?.alt || o.data?.src?.replace(/^assets\//, "") || "(no image)";
  if (o.kind === "arrow") return `${o.data?.color || ""} arrow`;
  return `${o.data?.shape || ""} shape`;
}

function warningsFor(slide) {
  const out = new Map();
  for (const issue of overlayIssues(slide)) out.set(issue.overlay, [...(out.get(issue.overlay) || []), issue.message.replace(/^Overlay "[^"]+" /, "")]);
  for (const w of state.overlayWarnings.get(slide.id) || []) {
    out.set(w.overlayId, [...(out.get(w.overlayId) || []), `covers the template text “${w.slot}”`]);
  }
  return out;
}

/** Layers list (always shown when the slide has overlays). */
export function layersSection(slide) {
  const overlays = [...(slide.overlays || [])].sort((a, b) => b.z - a.z);
  const warnings = warningsFor(slide);
  const rows = overlays.map((o) => {
    const selected = state.overlaySelection.includes(o.id);
    const warn = warnings.get(o.id);
    return h("li", {},
      h("button", {
        type: "button",
        class: `layer-row${selected ? " is-selected" : ""}`,
        "aria-pressed": String(selected),
        dataset: { ovId: o.id },
        title: warn ? warn.join("; ") : `Select ${o.id}`,
        onClick: (e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) selectOverlays(selected ? state.overlaySelection.filter((x) => x !== o.id) : [...state.overlaySelection, o.id]);
          else selectOverlays([o.id]);
        },
      },
      h("span", { class: "layer-kind" }, KIND_LABELS[o.kind]),
      h("span", { class: "layer-name" }, overlaySummary(o)),
      warn ? h("span", { class: "layer-warn", "aria-label": "Warning" }, icon("alert", 14)) : null),
    );
  });
  return h("ul", { class: "layer-list", "aria-label": "Overlays, front to back", "data-testid": "layer-list" }, rows);
}

function actionButton(name, label, onClick, disabled = false) {
  return h("button", { type: "button", class: "icon-btn", title: label, "aria-label": label, disabled, onClick }, icon(name, 16));
}

/** Properties of the selected overlay(s). `setters` receives refreshers for drag updates. */
export function overlayPanel(slide, setters) {
  const selected = (slide.overlays || []).filter((o) => state.overlaySelection.includes(o.id));
  if (!selected.length) return null;
  const many = selected.length > 1;
  const warnings = warningsFor(slide);

  const actions = h("div", { class: "ov-actions" },
    h("div", { class: "toolbar-group", role: "group", "aria-label": "Arrange" },
      actionButton("copy", "Duplicate (⌘D)", duplicateSelected),
      actionButton("forward", "Bring forward (⌘])", () => arrangeSelected("forward")),
      actionButton("backward", "Send backward (⌘[)", () => arrangeSelected("backward")),
      actionButton("trash", "Delete (⌫)", removeSelected)),
    h("div", { class: "toolbar-group", role: "group", "aria-label": many ? "Align to the selection" : "Align to the slide" },
      actionButton("alignLeft", "Align left", () => alignSelected("left")),
      actionButton("alignCenter", "Align centers horizontally", () => alignSelected("center")),
      actionButton("alignRight", "Align right", () => alignSelected("right")),
      actionButton("alignTop", "Align top", () => alignSelected("top")),
      actionButton("alignMiddle", "Align centers vertically", () => alignSelected("middle")),
      actionButton("alignBottom", "Align bottom", () => alignSelected("bottom"))),
    many ? h("div", { class: "toolbar-group", role: "group", "aria-label": "Distribute" },
      actionButton("distributeH", "Distribute horizontally", () => distributeSelected("horizontal"), selected.length < 3),
      actionButton("distributeV", "Distribute vertically", () => distributeSelected("vertical"), selected.length < 3)) : null,
  );

  const out = h("section", { class: "insp-section insp-overlay", "data-testid": "overlay-panel" },
    h("h3", { class: "insp-title" }, many ? `${selected.length} overlays` : `${KIND_LABELS[selected[0].kind]} overlay`),
    actions,
    h("p", { class: "muted small" }, many
      ? "Align uses the selection bounds. Drag any selected box to move them together."
      : "Drag to move, handles to resize (Shift keeps proportions, Alt disables snapping). Arrow keys nudge 1 px, Shift+arrow 10 px."),
  );
  if (many) return out;

  const o = selected[0];
  const issues = warnings.get(o.id);
  if (issues) out.append(h("ul", { class: "issues", "data-testid": "overlay-issues" }, issues.map((m) => h("li", {}, icon("alert", 14), m))));

  // Geometry in slide pixels (stored as % of 1280×720).
  const px = toPx(o);
  const geometry = h("div", { class: "geom-grid" });
  const numberField = (key, label, value, { suffix = "px", step = 1 } = {}) => {
    const input = h("input", { class: "input input-sm", type: "number", step, value: String(Math.round(value * 10) / 10), "aria-label": label, dataset: { path: `@ov:${o.id}:${key}` } });
    input.addEventListener("change", () => {
      const n = Number(input.value);
      if (!Number.isFinite(n)) return;
      const box = { ...toPx(o), [key]: n };
      if (key === "r") return updateOverlays([{ overlayId: o.id, props: { rotate: n } }], { label: "Rotate overlay" });
      if ((key === "w" || key === "h") && n < 1) return;
      const pct = toPct(box);
      updateOverlays([{ overlayId: o.id, props: { [key]: pct[key] } }], { label: "Edit overlay" });
    });
    setters.set(`@ov:${o.id}:${key}`, (ov) => {
      if (document.activeElement !== input) input.value = String(Math.round((key === "r" ? ov.rotate || 0 : toPx(ov)[key]) * 10) / 10);
    });
    return h("label", { class: "geom" }, h("span", {}, label), input, h("span", { class: "unit" }, suffix));
  };
  geometry.append(numberField("x", "X", px.x), numberField("y", "Y", px.y), numberField("w", "W", px.w), numberField("h", "H", px.h), numberField("r", "Rotate", o.rotate || 0, { suffix: "°" }));
  const order = h("input", { class: "input input-sm", type: "number", min: 0, step: 1, value: o.order ?? "", placeholder: "auto", "aria-label": "Reveal step", dataset: { path: `@ov:${o.id}:order` } });
  order.addEventListener("change", () => updateOverlays([{ overlayId: o.id, props: { order: order.value === "" ? null : Math.max(0, Math.round(Number(order.value))) } }], { label: "Reveal order" }));
  geometry.append(h("label", { class: "geom" }, h("span", {}, "Reveal"), order, h("span", { class: "unit" }, "#")));
  out.append(geometry, h("p", { class: "field-hint" }, "Reveal: empty shows the overlay after the template elements; 0 reveals it with the first one."));

  const patchData = (data, opts = {}) => updateOverlays([{ overlayId: o.id, props: { data } }], { label: `Edit ${o.kind}`, ...opts });

  if (o.kind === "image") {
    out.append(imageControl({
      value: o.data,
      label: "Picture",
      path: `@ov:${o.id}:image`,
      required: true,
      slideId: slide.id,
      onChange: (next, opts = {}) => {
        if (!next) return removeSelected();
        patchData(next, opts.coalesce ? { coalesce: `${slide.id}:${o.id}:${opts.coalesce}` } : {});
      },
    }));
  }
  if (o.kind === "text" || o.kind === "callout") {
    const id = `ov-text-${o.id}`;
    const textarea = h("textarea", { id, class: "input", rows: 3, value: o.data.text || "", dataset: { path: `@ov:${o.id}:text` }, "data-testid": "overlay-text" });
    const send = debounce(() => patchData({ text: textarea.value }, { coalesce: `${slide.id}:${o.id}:text` }), 300);
    textarea.addEventListener("input", send);
    textarea.addEventListener("blur", () => send.flush());
    setters.set(`@ov:${o.id}:text`, (ov) => {
      if (document.activeElement !== textarea) textarea.value = ov.data?.text ?? "";
    });
    const improvable = aiImprove(textarea, {
      key: `${slide.id}:@ov:${o.id}:text`,
      context: () => ({ label: o.kind === "callout" ? "Callout text" : "Overlay text", description: "A short annotation placed over the slide.", richtext: true, kind: `${o.kind} overlay`, slideId: slide.id }),
    });
    out.append(h("div", { class: "field" }, h("div", { class: "field-label" }, h("label", { for: id }, "Text")), improvable,
      h("p", { class: "field-hint" }, "Rich text: <strong>, <em>, <span class=\"blue\">…</span>. Fonts and colors come from the theme.")));
  }
  const options = OVERLAY_OPTIONS[o.kind] || {};
  const selects = Object.entries(options).filter(([key]) => key !== "fit");
  if (selects.length) {
    const grid = h("div", { class: "option-grid" });
    for (const [key, values] of selects) {
      const select = h("select", { class: "input input-sm", "aria-label": OPTION_LABELS[key] || key, dataset: { path: `@ov:${o.id}:${key}` } },
        values.map((v) => h("option", { value: v, selected: o.data?.[key] === v }, v)));
      select.addEventListener("change", () => patchData({ [key]: select.value }));
      grid.append(h("label", { class: "geom" }, h("span", {}, OPTION_LABELS[key] || key), select));
    }
    out.append(grid);
  }
  return out;
}
