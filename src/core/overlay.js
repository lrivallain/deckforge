// Free overlay layer: per-slide `overlays[]` positioned in percent of the
// 1280×720 slide, rendered above the template in `.df-overlay`.

import { escapeAttr, sanitizeRichText } from "./html.js";
import { IMAGE_FITS, imageIssues, normalizeFocus, renderImage } from "./image.js";

export const OVERLAY_KINDS = ["image", "text", "callout", "arrow", "shape"];
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;
const ID_RE = /^[A-Za-z][\w-]{0,63}$/;

// Theme tokens only: overlays never carry raw colors or fonts.
export const OVERLAY_OPTIONS = {
  text: {
    style: ["body", "heading", "title", "caption", "label"],
    align: ["left", "center", "right"],
    color: ["ink", "muted", "primary", "accent"],
  },
  callout: { tone: ["primary", "accent", "neutral"], align: ["left", "center", "right"] },
  arrow: { color: ["primary", "accent", "ink", "muted"], head: ["end", "start", "both", "none"], weight: ["thin", "regular", "bold"], line: ["solid", "dashed"] },
  shape: {
    shape: ["rounded", "rect", "ellipse", "pill"],
    fill: ["primary", "accent", "neutral", "paper", "none"],
    stroke: ["primary", "accent", "line", "dashed", "none"],
  },
  image: { fit: IMAGE_FITS },
};

const DEFAULT_DATA = {
  text: { text: "Text", style: "body", align: "left", color: "ink" },
  callout: { text: "Callout", tone: "primary", align: "left" },
  arrow: { color: "primary", head: "end", weight: "regular", line: "solid" },
  shape: { shape: "rounded", fill: "primary", stroke: "primary" },
  image: { src: "", alt: "", fit: "cover", focus: "50% 50%" },
};

// Default sizes (in %) land on the 8 px editor grid of the 1280×720 slide.
export const DEFAULT_SIZE = {
  text: { w: 30, h: 10 }, // 384×72
  callout: { w: 27.5, h: 14.44 }, // 352×104
  arrow: { w: 15, h: 6.67 }, // 192×48
  shape: { w: 15, h: 26.67 }, // 192×192
  image: { w: 30, h: 40 }, // 384×288
};

export class OverlayError extends Error {
  constructor(message) {
    super(message);
    this.name = "OverlayError";
  }
}

const round = (n) => Math.round(n * 100) / 100;

function num(value, name, { min = -1000, max = 1000 } = {}) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new OverlayError(`overlay ${name} must be a number`);
  return round(Math.min(max, Math.max(min, n)));
}

export function makeOverlayId(existing, kind = "ov") {
  const used = new Set(existing);
  for (let i = 1; ; i++) if (!used.has(`${kind}-${i}`)) return `${kind}-${i}`;
}

/** Keep only known, well-typed data fields for a kind (theme tokens are enumerated). */
export function normalizeOverlayData(kind, data = {}) {
  const raw = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const out = { ...DEFAULT_DATA[kind] };
  for (const [key, allowed] of Object.entries(OVERLAY_OPTIONS[kind] || {})) {
    if (raw[key] !== undefined && allowed.includes(raw[key])) out[key] = raw[key];
  }
  if (kind === "text" || kind === "callout") {
    if (raw.text !== undefined) out.text = sanitizeRichText(String(raw.text ?? ""));
  }
  if (kind === "image") {
    out.src = String(raw.src ?? "").trim();
    out.alt = String(raw.alt ?? "");
    out.focus = normalizeFocus(raw.focus);
  }
  return out;
}

/** Validate and normalize one overlay. Throws OverlayError on malformed input. */
export function normalizeOverlay(raw, existingIds = []) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new OverlayError("Each overlay must be a mapping");
  const kind = raw.kind;
  if (!OVERLAY_KINDS.includes(kind)) throw new OverlayError(`Unknown overlay kind "${kind}" (expected ${OVERLAY_KINDS.join(", ")})`);
  let id = raw.id === undefined || raw.id === null ? "" : String(raw.id);
  if (!ID_RE.test(id) || existingIds.includes(id)) id = makeOverlayId(existingIds, kind);
  const size = DEFAULT_SIZE[kind];
  const overlay = {
    id,
    kind,
    x: num(raw.x ?? 0, "x", { min: -100, max: 200 }),
    y: num(raw.y ?? 0, "y", { min: -100, max: 200 }),
    w: num(raw.w ?? size.w, "w", { min: 0.5, max: 300 }),
    h: num(raw.h ?? size.h, "h", { min: 0.5, max: 300 }),
    z: Math.round(num(raw.z ?? 1, "z", { min: 0, max: 999 })),
  };
  if (raw.rotate !== undefined && raw.rotate !== null && Number(raw.rotate) !== 0) {
    const r = num(raw.rotate, "rotate", { min: -360, max: 360 });
    if (r) overlay.rotate = r;
  }
  if (raw.order !== undefined && raw.order !== null && raw.order !== "") {
    overlay.order = Math.round(num(raw.order, "order", { min: 0, max: 99 }));
  }
  overlay.data = normalizeOverlayData(kind, raw.data);
  return overlay;
}

export function normalizeOverlays(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new OverlayError("overlays must be a list");
  const out = [];
  for (const raw of list) out.push(normalizeOverlay(raw, out.map((o) => o.id)));
  return out;
}

/** YAML-friendly form (defaults omitted where harmless). */
export function stringifyOverlay(overlay) {
  const out = { id: overlay.id, kind: overlay.kind, x: overlay.x, y: overlay.y, w: overlay.w, h: overlay.h, z: overlay.z };
  if (overlay.rotate) out.rotate = overlay.rotate;
  if (overlay.order !== undefined) out.order = overlay.order;
  out.data = overlay.data;
  return out;
}

// ---------------------------------------------------------------- rendering

function overlayStyle(o) {
  const parts = [`left: ${o.x}%`, `top: ${o.y}%`, `width: ${o.w}%`, `height: ${o.h}%`, `z-index: ${o.z}`];
  if (o.rotate) parts.push(`rotate: ${o.rotate}deg`);
  return parts.join("; ");
}

function overlayInner(o, ctx) {
  const d = o.data || {};
  switch (o.kind) {
    case "image":
      return renderImage(d, { assetUrl: ctx.assetUrl, className: "df-img" }) || (ctx.edit ? '<span class="df-ov-empty">Image</span>' : "");
    case "text":
      return `<div class="df-ov-text-inner">${sanitizeRichText(d.text)}</div>`;
    case "callout":
      return `<div class="df-ov-callout-inner">${sanitizeRichText(d.text)}</div>`;
    case "arrow": {
      const heads = d.head === "both" ? ["start", "end"] : d.head === "none" ? [] : [d.head || "end"];
      return `<span class="df-ah-shaft"></span>${heads.map((h) => `<span class="df-ah df-ah-${h}"></span>`).join("")}`;
    }
    default:
      return "";
  }
}

function overlayClasses(o) {
  const d = o.data || {};
  const classes = ["df-ov", `df-ov-${o.kind}`, "reveal"];
  if (o.kind === "text") classes.push(`df-text-${d.style}`, `df-align-${d.align}`, `df-color-${d.color}`);
  if (o.kind === "callout") classes.push(`df-tone-${d.tone}`, `df-align-${d.align}`);
  if (o.kind === "arrow") classes.push(`df-color-${d.color}`, `df-weight-${d.weight}`, `df-line-${d.line}`);
  if (o.kind === "shape") classes.push(`df-shape-${d.shape}`, `df-fill-${d.fill}`, `df-stroke-${d.stroke}`);
  if (o.kind === "image") classes.push(`df-fit-${d.fit}`);
  return classes.join(" ");
}

/** Render the overlay layer for a slide ("" when it has no overlays). */
export function renderOverlays(slide, ctx = {}) {
  const overlays = slide.overlays || [];
  if (!overlays.length) return "";
  const items = [...overlays]
    .sort((a, b) => a.z - b.z)
    .map((o) => {
      const decorative = o.kind === "arrow" || o.kind === "shape";
      const attrs = [
        `class="${escapeAttr(overlayClasses(o))}"`,
        `data-ov-id="${escapeAttr(o.id)}"`,
        `style="${escapeAttr(overlayStyle(o))}"`,
      ];
      if (o.order !== undefined) attrs.push(`data-df-order="${o.order}"`);
      if (decorative) attrs.push('aria-hidden="true"');
      return `<div ${attrs.join(" ")}>${overlayInner(o, ctx)}</div>`;
    });
  return `<div class="df-overlay">${items.join("")}</div>`;
}

// ---------------------------------------------------------------- validation

/** Bounds and content checks (layout overlaps are measured by the editor). */
export function overlayIssues(slide) {
  const issues = [];
  for (const o of slide.overlays || []) {
    const where = `Overlay "${o.id}"`;
    if (o.x < 0 || o.y < 0 || o.x + o.w > 100.01 || o.y + o.h > 100.01) {
      issues.push({ level: "warning", overlay: o.id, message: `${where} extends beyond the slide` });
    }
    if (o.kind === "image") {
      if (!o.data?.src) issues.push({ level: "warning", overlay: o.id, message: `${where} has no image` });
      else for (const issue of imageIssues(o.data, where)) issues.push({ ...issue, overlay: o.id });
    }
    if ((o.kind === "text" || o.kind === "callout") && !String(o.data?.text ?? "").trim()) {
      issues.push({ level: "warning", overlay: o.id, message: `${where} is empty` });
    }
  }
  return issues;
}

/** Intersection area (in % units²) of two {x,y,w,h} boxes. */
export function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
