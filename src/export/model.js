// Pure helpers shared by the PPTX exporter (no DOM, unit-testable).
// Geometry is measured in CSS px on the 1280×720 reference slide.

export const SLIDE_W = 1280;
export const SLIDE_H = 720;
/** 1280 px = 13.333 in: PowerPoint's 16:9 "wide" layout. */
export const PX_PER_IN = 96;

export const pxToIn = (px) => px / PX_PER_IN;
export const pxToPt = (px) => px * 0.75;

const round = (n, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Parse a computed CSS colour ("rgb(…)", "rgba(…)", "#rrggbb", "transparent",
 * or the space syntax "rgb(r g b / a)") into { hex: "RRGGBB", alpha: 0..1 }.
 * Returns null for anything else (other keywords, color(), …).
 */
export function parseColor(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || v === "none") return null;
  if (v === "transparent") return { hex: "000000", alpha: 0 };
  const hexMatch = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { hex: h.slice(0, 6).toUpperCase(), alpha };
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(v);
  if (!fn) return null;
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (p) => {
    const n = p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p);
    return Math.max(0, Math.min(255, Math.round(Number.isFinite(n) ? n : 0)));
  };
  let alpha = 1;
  if (parts[3] !== undefined) {
    const a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    alpha = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
  }
  const hex = [parts[0], parts[1], parts[2]].map((p) => channel(p).toString(16).padStart(2, "0")).join("").toUpperCase();
  return { hex, alpha };
}

/** PowerPoint transparency (0 opaque … 100 invisible) from an alpha value. */
export const transparency = (alpha = 1) => Math.round((1 - Math.max(0, Math.min(1, alpha))) * 100);

/** Split a CSS value on top-level separators (not inside parentheses or quotes). */
export function splitTopLevel(value, separator = ",") {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === separator && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out.filter(Boolean);
}

/** The family names of a computed font-family list, unquoted. */
export function fontFamilies(value) {
  return splitTopLevel(String(value ?? "")).map((f) => f.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
}

const GENERIC_FONTS = {
  "sans-serif": "Arial",
  serif: "Times New Roman",
  monospace: "Courier New",
  "system-ui": "Segoe UI",
  "ui-sans-serif": "Arial",
  "ui-serif": "Times New Roman",
  "ui-monospace": "Courier New",
  "ui-rounded": "Arial",
  cursive: "Comic Sans MS",
  fantasy: "Impact",
  "-apple-system": "Segoe UI",
  blinkmacsystemfont: "Segoe UI",
};

/**
 * The font PowerPoint should use: the first family of the stack that is
 * available (`available(name)`), generic families mapped to common fonts.
 */
export function pickFont(value, available = () => true) {
  for (const family of fontFamilies(value)) {
    const generic = GENERIC_FONTS[family.toLowerCase()];
    if (generic) return generic;
    if (available(family)) return family;
  }
  return "Arial";
}

/** Apply CSS text-transform to a string. */
export function applyTextTransform(text, transform) {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(/(^|[\s\-–—(["'“‘])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
    default:
      return text;
  }
}

/** Whether CSS `white-space` keeps newlines and collapses spaces. */
export function whiteSpaceMode(value) {
  const v = String(value || "normal").trim().split(/\s+/)[0];
  return {
    keepNewlines: ["pre", "pre-wrap", "pre-line", "break-spaces", "preserve", "preserve-breaks"].includes(v),
    collapseSpaces: !["pre", "pre-wrap", "break-spaces", "preserve", "preserve-spaces"].includes(v),
  };
}

export function sameStyle(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Normalize the runs of one paragraph like CSS: collapse white space, trim
 * the paragraph's start and end, merge neighbours with the same style and
 * drop empty runs. Run: { text, style, softBreak?, collapse? }.
 */
export function normalizeRuns(runs) {
  const out = [];
  let afterSpace = true; // trims the paragraph's leading spaces
  for (const run of runs) {
    let text = run.text;
    if (run.collapse !== false) {
      text = text.replace(/[ \t\n\r\f]+/g, " ");
      if (afterSpace || run.softBreak) text = text.replace(/^ /, "");
    }
    if (!text && !run.softBreak) continue;
    if (run.softBreak) {
      // Spaces before a line break are not rendered.
      const prev = out[out.length - 1];
      if (prev) prev.text = prev.text.replace(/ +$/, "");
    }
    afterSpace = text ? text.endsWith(" ") : true;
    const prev = out[out.length - 1];
    if (prev && !run.softBreak && sameStyle(prev.style, run.style)) prev.text += text;
    else out.push({ ...run, text });
  }
  while (out.length) {
    const last = out[out.length - 1];
    last.text = last.text.replace(/ +$/, "");
    if (last.text) break;
    out.pop();
  }
  return out;
}

/** Parse a CSS angle ("120deg", "0.5turn", "1rad", "100grad") into degrees. */
export function parseAngle(value) {
  const m = /^(-?[\d.]+)(deg|turn|rad|grad)?$/.exec(String(value).trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case "turn":
      return n * 360;
    case "rad":
      return (n * 180) / Math.PI;
    case "grad":
      return n * 0.9;
    default:
      return n;
  }
}

const SIDE_ANGLES = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270 };

/** Split a computed background-image into its layers. */
export function backgroundLayers(value) {
  const v = String(value ?? "").trim();
  if (!v || v === "none") return [];
  return splitTopLevel(v);
}

/** Length of a CSS linear-gradient line for an angle in a w×h box. */
export function gradientLength(angle, w, h) {
  const rad = (angle * Math.PI) / 180;
  return Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
}

function firstToken(arg) {
  const fn = /^[a-z-]+\([^)]*\)/i.exec(arg);
  return fn ? fn[0] : arg.split(/\s+/)[0];
}

function parseStop(arg, length) {
  const colorText = firstToken(arg);
  const color = parseColor(colorText);
  if (!color) return null;
  const rest = arg.slice(colorText.length).trim().split(/\s+/).filter(Boolean);
  const offset = (token) => {
    if (token.endsWith("%")) return parseFloat(token) / 100;
    if (token.endsWith("px")) return length ? parseFloat(token) / length : 0;
    return null;
  };
  if (!rest.length) return [{ offset: null, ...color }];
  return rest.slice(0, 2).map((t) => ({ offset: offset(t), ...color }));
}

/**
 * Parse a computed linear-gradient()/radial-gradient() for a w×h box.
 * Returns { type: "linear", angle, stops } or { type: "radial", stops },
 * stops [{ offset 0..1, hex, alpha }], or null when unsupported.
 */
export function parseGradient(value, w, h) {
  const m = /^(repeating-)?(linear|radial)-gradient\((.*)\)$/s.exec(String(value).trim());
  if (!m || (m[1] && m[2] !== "linear")) return null;
  const type = m[2];
  const repeating = Boolean(m[1]);
  const args = splitTopLevel(m[3]);
  let angle = 180;
  if (args.length && !parseColor(firstToken(args[0]))) {
    const head = args.shift().trim();
    if (type === "linear") {
      const deg = parseAngle(head);
      if (deg !== null) angle = deg;
      else if (SIDE_ANGLES[head] !== undefined) angle = SIDE_ANGLES[head];
      else {
        const corner = /^to (top|bottom) (left|right)$|^to (left|right) (top|bottom)$/.exec(head);
        if (!corner) return null;
        const vertical = corner[1] || corner[4];
        const horizontal = corner[2] || corner[3];
        const a = (Math.atan2(w, h) * 180) / Math.PI;
        angle = vertical === "top" ? (horizontal === "right" ? a : 360 - a) : horizontal === "right" ? 180 - a : 180 + a;
      }
    }
  }
  const length = type === "linear" ? gradientLength(angle, w, h) : Math.hypot(w, h) / 2;
  const stops = [];
  for (const arg of args) {
    const parsed = parseStop(arg, length);
    if (!parsed) return null;
    stops.push(...parsed);
  }
  if (stops.length < 2) return null;
  // Missing offsets, like CSS: first 0, last 1, others spread evenly.
  if (stops[0].offset === null) stops[0].offset = 0;
  if (stops[stops.length - 1].offset === null) stops[stops.length - 1].offset = 1;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].offset !== null) {
      stops[i].offset = Math.max(stops[i].offset, stops[i - 1].offset);
      continue;
    }
    let j = i;
    while (stops[j].offset === null) j++;
    const from = stops[i - 1].offset;
    const step = (stops[j].offset - from) / (j - i + 1);
    for (let k = i; k < j; k++) stops[k].offset = from + step * (k - i + 1);
  }
  // CSS interpolates with premultiplied alpha: a transparent stop takes its
  // neighbour's colour, so a fade to "transparent" does not go through grey.
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].alpha > 0) continue;
    const neighbour = stops[i - 1]?.alpha > 0 ? stops[i - 1] : stops[i + 1]?.alpha > 0 ? stops[i + 1] : null;
    if (neighbour) stops[i].hex = neighbour.hex;
  }
  // repeating-linear-gradient: the stops span one period of the line, repeated (spreadMethod="repeat").
  let period = null;
  if (repeating) {
    period = stops[stops.length - 1].offset - stops[0].offset;
    if (!(period > 0) || stops[0].offset !== 0) return null;
    for (const s of stops) s.offset /= period;
  }
  for (const s of stops) s.offset = round(Math.max(0, Math.min(1, s.offset)));
  if (type !== "linear") return { type, stops };
  const out = { type, angle: ((angle % 360) + 360) % 360, stops };
  if (period) out.period = period;
  return out;
}

const svgOpen = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${round(w, 2)}" height="${round(h, 2)}" viewBox="0 0 ${round(w, 2)} ${round(h, 2)}">`;

/** An SVG document painting a gradient in a w×h box with rounded corners. */
export function gradientSvg(gradient, w, h, radius = 0) {
  const stops = gradient.stops.map((s) => `<stop offset="${s.offset}" stop-color="#${s.hex}" stop-opacity="${round(s.alpha, 3)}"/>`).join("");
  let def;
  if (gradient.type === "linear") {
    const rad = (gradient.angle * Math.PI) / 180;
    const half = gradientLength(gradient.angle, w, h) / 2;
    const dx = Math.sin(rad) * half;
    const dy = -Math.cos(rad) * half;
    const span = gradient.period || 1;
    const [x1, y1, x2, y2] = [w / 2 - dx, h / 2 - dy, w / 2 - dx + 2 * dx * span, h / 2 - dy + 2 * dy * span].map((n) => round(n, 2));
    def = `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${gradient.period ? ' spreadMethod="repeat"' : ""}>${stops}</linearGradient>`;
  } else {
    def = `<radialGradient id="g" cx="0.5" cy="0.5" r="0.7071">${stops}</radialGradient>`;
  }
  const r = round(Math.min(radius, w / 2, h / 2), 2);
  return `${svgOpen(w, h)}<defs>${def}</defs><rect width="${round(w, 2)}" height="${round(h, 2)}"${r ? ` rx="${r}" ry="${r}"` : ""} fill="url(#g)"/></svg>`;
}

/**
 * An SVG document for a `clip-path: polygon(…)` box filled with a colour.
 * Points are "x y" pairs in px or % of the w×h box.
 */
export function polygonSvg(clipPath, w, h, color) {
  const m = /^polygon\((?:(?:nonzero|evenodd)\s*,\s*)?(.*)\)$/s.exec(String(clipPath).trim());
  if (!m) return null;
  const coord = (token, size) => (token.endsWith("%") ? (parseFloat(token) / 100) * size : parseFloat(token));
  const pts = [];
  for (const pair of splitTopLevel(m[1])) {
    const [x = "", y = ""] = pair.split(/\s+/);
    const px = coord(x, w);
    const py = coord(y, h);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    pts.push(`${round(px, 2)},${round(py, 2)}`);
  }
  if (pts.length < 3) return null;
  return `${svgOpen(w, h)}<polygon points="${pts.join(" ")}" fill="#${color.hex}" fill-opacity="${round(color.alpha, 3)}"/></svg>`;
}

/** Parse the first outer box-shadow: { x, y, blur, color } in px, or null. */
export function parseBoxShadow(value) {
  const v = String(value ?? "").trim();
  if (!v || v === "none") return null;
  for (const layer of splitTopLevel(v)) {
    if (/\binset\b/.test(layer)) continue;
    const colorText = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}|transparent)/i.exec(layer)?.[1];
    const color = parseColor(colorText ?? "rgb(0, 0, 0)");
    const lengths = layer.replace(colorText ?? "", "").trim().split(/\s+/).map(parseFloat).filter(Number.isFinite);
    if (lengths.length < 2 || !color || color.alpha === 0) continue;
    return { x: lengths[0], y: lengths[1], blur: lengths[2] || 0, color };
  }
  return null;
}

/** PptxGenJS shadow options from a parsed box-shadow. */
export function shadowOptions(shadow) {
  if (!shadow) return undefined;
  const offset = Math.hypot(shadow.x, shadow.y);
  const angle = offset ? ((Math.atan2(shadow.y, shadow.x) * 180) / Math.PI + 360) % 360 : 90;
  return {
    type: "outer",
    blur: round(pxToPt(shadow.blur), 2),
    offset: round(pxToPt(offset), 2),
    angle: Math.round(angle),
    color: shadow.color.hex,
    opacity: round(shadow.color.alpha, 3),
  };
}

/** Parse a computed object-position into fractions of the free space. */
export function parseObjectPosition(value, freeX = 0, freeY = 0) {
  const keywords = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  const tokens = String(value || "50% 50%").trim().split(/\s+/);
  if (tokens.length === 1) tokens.push("center");
  if (tokens[0] === "top" || tokens[0] === "bottom" || tokens[1] === "left" || tokens[1] === "right") tokens.reverse();
  const frac = (t, free) => {
    if (t in keywords) return keywords[t];
    if (t.endsWith("%")) return parseFloat(t) / 100;
    if (t.endsWith("px")) return free ? parseFloat(t) / free : 0;
    return 0.5;
  };
  return [frac(tokens[0], freeX), frac(tokens[1], freeY)];
}

export function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right - x <= 0.01 || bottom - y <= 0.01) return null;
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Where an image is drawn for a CSS object-fit, and the part of it that stays
 * visible inside its box (and an optional clip rect, e.g. overflow: hidden).
 * Returns { drawn: rect of the whole scaled image, visible: rect } or null.
 */
export function placeImage(box, natural, fit = "fill", position = [0.5, 0.5], clip = null) {
  const nw = natural?.w || box.w;
  const nh = natural?.h || box.h;
  let dw = box.w;
  let dh = box.h;
  if (fit !== "fill" && nw && nh) {
    let s = 1;
    if (fit === "cover") s = Math.max(box.w / nw, box.h / nh);
    else if (fit === "contain") s = Math.min(box.w / nw, box.h / nh);
    else if (fit === "scale-down") s = Math.min(1, box.w / nw, box.h / nh);
    dw = nw * s;
    dh = nh * s;
  }
  const drawn = { x: box.x + (box.w - dw) * position[0], y: box.y + (box.h - dh) * position[1], w: dw, h: dh };
  let visible = intersect(drawn, box);
  if (visible && clip) visible = intersect(visible, clip);
  if (!visible) return null;
  return { drawn, visible };
}

/** Rotate a point around a centre by `deg` degrees (clockwise, as in CSS). */
export function rotatePoint(px, py, cx, cy, deg) {
  const rad = (deg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * Math.cos(rad) - dy * Math.sin(rad), cy + dx * Math.sin(rad) + dy * Math.cos(rad)];
}

/**
 * Apply a rotation of `deg` around (cx, cy) to measured items: each item's
 * centre moves around the pivot and the item turns by the same angle.
 */
export function rotateItems(items, cx, cy, deg) {
  return items.map((item) => {
    if (item.kind === "line") {
      const [x1, y1] = rotatePoint(item.x1, item.y1, cx, cy, deg);
      const [x2, y2] = rotatePoint(item.x2, item.y2, cx, cy, deg);
      return { ...item, x1, y1, x2, y2 };
    }
    const [ncx, ncy] = rotatePoint(item.x + item.w / 2, item.y + item.h / 2, cx, cy, deg);
    return { ...item, x: ncx - item.w / 2, y: ncy - item.h / 2, rotate: (((item.rotate || 0) + deg) % 360 + 360) % 360 };
  });
}

/** Rotation in degrees from a computed `rotate` and `transform` pair. */
export function rotationOf(rotate, transform) {
  let deg = 0;
  const r = String(rotate ?? "none").trim();
  if (r && r !== "none") {
    // "30deg", or "z 30deg" / "0 0 1 30deg": the angle comes last.
    const angle = parseAngle(r.split(/\s+/).pop());
    if (angle) deg += angle;
  }
  const m = /^matrix\(([^)]*)\)$/.exec(String(transform ?? "none").trim());
  if (m) {
    const [a, b] = m[1].split(",").map(parseFloat);
    const angle = (Math.atan2(b, a) * 180) / Math.PI;
    if (Math.abs(angle) > 0.01) deg += angle;
  }
  return Math.abs(deg) < 0.01 ? 0 : deg;
}

export function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A base64 data URI for an SVG document (UTF-8 safe). */
export const svgDataUri = (svg) => `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`;
