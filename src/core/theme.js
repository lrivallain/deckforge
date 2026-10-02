// Theme YAML → CSS custom properties.

import YAML from "yaml";
import { isSafeUrl } from "./html.js";

export const PALETTE_KEYS = [
  "bg", "paper", "line", "ink", "muted", "node",
  "primary", "primary-soft", "primary-line",
  "accent", "accent-soft", "accent-line",
];
const OPTIONAL_PALETTE = { frame: null, ok: "#1F9D6B", dashed: null, chrome: null, "accent-text": null, "primary-text": null };
export const OPTIONAL_PALETTE_KEYS = Object.keys(OPTIONAL_PALETTE);
const DEFAULT_RADII = { slide: "12px", card: "10px", panel: "12px", frame: "14px", small: "8px", pill: "99px" };
const DEFAULT_SPACING = { padding: "3cqw 4cqw 2cqw", gap: "1.3cqw", grid: "1.1cqw" };
const DEFAULT_MOTION = { duration: ".55s", easing: "ease", distance: "8px", stagger: ".15s" };
const DEFAULT_SHADOW = { slide: "0 24px 60px rgb(22 32 47 / 10%)" };
/** Defaults of the non-colour token groups (what an omitted key resolves to). */
export const THEME_DEFAULTS = { radii: DEFAULT_RADII, spacing: DEFAULT_SPACING, motion: DEFAULT_MOTION, shadow: DEFAULT_SHADOW };
export const FONT_ROLES = ["heading", "body", "mono"];
const DEFAULT_FALLBACKS = {
  heading: '"Segoe UI", system-ui, sans-serif',
  body: '"Segoe UI", system-ui, Arial, sans-serif',
  mono: "Consolas, Menlo, monospace",
};

const CSS_VALUE_RE = /^[#\w\s().,%/+*-]+$/;
const FONT_NAME_RE = /^[\w\s.-]+$/;

export class ThemeError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ThemeError";
    this.details = details;
  }
}

function cssValue(value, key, errors) {
  const text = String(value ?? "").trim();
  if (!text || !CSS_VALUE_RE.test(text) || !balancedParens(text)) {
    errors.push(`Invalid CSS value for "${key}": ${JSON.stringify(value)}`);
    return null;
  }
  return text;
}

// An unclosed "(" would swallow the rest of the :root block (e.g. a YAML
// comment cutting "linear-gradient(90deg, #fff …" short).
function balancedParens(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

function fontStack(value, errors, key) {
  const text = String(value ?? "").trim();
  if (!/^[\w\s"',.-]*$/.test(text)) {
    errors.push(`Invalid font fallback for "${key}"`);
    return "";
  }
  return text;
}

export function parseTheme(source, { name, scope = "builtin", path = null } = {}) {
  let raw;
  try {
    raw = typeof source === "string" ? YAML.parse(source) : source;
  } catch (err) {
    throw new ThemeError(`Invalid theme YAML: ${err.message}`);
  }
  const theme = normalizeTheme(raw, { name, scope, path });
  if (typeof source === "string") theme.source = source;
  return theme;
}

export function normalizeTheme(raw, { name, scope = "builtin", path = null } = {}) {
  if (!raw || typeof raw !== "object") throw new ThemeError("Theme must be a mapping");
  const errors = [];
  const themeName = String(raw.name || name || "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(themeName)) errors.push(`Invalid theme name "${themeName}"`);
  const palette = {};
  for (const key of PALETTE_KEYS) {
    if (raw.palette?.[key] === undefined) errors.push(`Missing palette.${key}`);
    else palette[key] = cssValue(raw.palette[key], `palette.${key}`, errors);
  }
  for (const [key, fallback] of Object.entries(OPTIONAL_PALETTE)) {
    if (raw.palette?.[key] !== undefined) palette[key] = cssValue(raw.palette[key], `palette.${key}`, errors);
    else if (fallback) palette[key] = fallback;
  }
  for (const key of Object.keys(raw.palette || {})) {
    if (!(key in palette) && /^[a-z][a-z0-9-]*$/.test(key)) palette[key] = cssValue(raw.palette[key], `palette.${key}`, errors);
  }
  palette.frame ??= palette["accent-soft"];
  palette.dashed ??= palette.muted;
  palette.chrome ??= palette.bg;
  // Small text in accent colours must still reach 4.5:1 (WCAG AA).
  palette["accent-text"] ??= palette.accent;
  palette["primary-text"] ??= palette.primary;

  const fonts = {};
  for (const role of FONT_ROLES) {
    const def = raw.fonts?.[role] || {};
    const family = typeof def === "string" ? def : def.family;
    if (family && !FONT_NAME_RE.test(family)) errors.push(`Invalid font family for ${role}`);
    const faces = [];
    for (const face of def.faces || []) {
      const weight = Number(face.weight || 400);
      const style = face.style === "italic" ? "italic" : "normal";
      const sources = [];
      for (const local of [].concat(face.local || [])) {
        if (FONT_NAME_RE.test(local)) sources.push(`local("${local}")`);
        else errors.push(`Invalid local font name "${local}"`);
      }
      for (const url of [].concat(face.url || [])) {
        if (isSafeUrl(url) && !/["'()\s]/.test(url)) {
          const format = /\.woff2(\?|$)/.test(url) ? "woff2" : /\.woff(\?|$)/.test(url) ? "woff" : /\.ttf(\?|$)/.test(url) ? "truetype" : null;
          sources.push(`url("${url}")${format ? ` format("${format}")` : ""}`);
        } else errors.push(`Invalid font url "${url}"`);
      }
      if (sources.length && Number.isFinite(weight)) faces.push({ weight, style, sources });
    }
    fonts[role] = {
      family: family || null,
      fallback: fontStack(typeof def === "object" && def.fallback ? def.fallback : DEFAULT_FALLBACKS[role], errors, role),
      faces,
    };
  }
  const section = (input, defaults, prefix) => {
    const out = {};
    for (const [key, value] of Object.entries({ ...defaults, ...(input || {}) })) {
      if (!/^[a-z][a-z0-9-]*$/.test(key)) continue;
      out[key] = cssValue(value, `${prefix}.${key}`, errors);
    }
    return out;
  };
  const theme = {
    name: themeName,
    label: String(raw.label || themeName),
    description: String(raw.description || ""),
    colorScheme: raw.colorScheme === "dark" ? "dark" : "light",
    palette,
    fonts,
    radii: section(raw.radii, DEFAULT_RADII, "radii"),
    spacing: section(raw.spacing, DEFAULT_SPACING, "spacing"),
    motion: section(raw.motion, DEFAULT_MOTION, "motion"),
    shadow: section(raw.shadow, DEFAULT_SHADOW, "shadow"),
    scope,
    path,
    source: null,
  };
  if (errors.length) throw new ThemeError(`Invalid theme "${themeName}": ${errors[0]}`, errors);
  theme.css = themeToCss(theme);
  return theme;
}

function familyCss(font) {
  return font.family ? `"${font.family}", ${font.fallback}` : font.fallback;
}

export function themeToCss(theme) {
  const lines = [];
  for (const role of FONT_ROLES) {
    const font = theme.fonts[role];
    if (!font.family) continue;
    for (const face of font.faces) {
      lines.push(`@font-face { font-family: "${font.family}"; font-weight: ${face.weight}; font-style: ${face.style}; font-display: swap; src: ${face.sources.join(", ")}; }`);
    }
  }
  const vars = [`color-scheme: ${theme.colorScheme};`];
  for (const [key, value] of Object.entries(theme.palette)) vars.push(`--df-${key}: ${value};`);
  for (const role of FONT_ROLES) vars.push(`--df-font-${role}: ${familyCss(theme.fonts[role])};`);
  for (const [key, value] of Object.entries(theme.radii)) vars.push(`--df-radius-${key}: ${value};`);
  for (const [key, value] of Object.entries(theme.spacing)) vars.push(`--df-space-${key}: ${value};`);
  for (const [key, value] of Object.entries(theme.motion)) vars.push(`--df-motion-${key}: ${value};`);
  for (const [key, value] of Object.entries(theme.shadow)) vars.push(`--df-shadow-${key}: ${value};`);
  lines.push(`:root {\n  ${vars.join("\n  ")}\n}`);
  return lines.join("\n");
}

/** sRGB colour of a CSS value ("#rgb", "#rrggbb", "#rrggbbaa", "rgb(…)"); null when unknown or translucent. */
export function parseColor(value) {
  const text = String(value ?? "").trim().toLowerCase();
  let rgb;
  let alpha = 1;
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
    rgb = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
    if (digits.length === 8) alpha = parseInt(digits.slice(6, 8), 16) / 255;
  } else {
    const fn = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(text);
    if (!fn) return null;
    const channel = (v) => (v.endsWith("%") ? (parseFloat(v) * 255) / 100 : parseFloat(v));
    rgb = fn.slice(1, 4).map(channel);
    if (fn[4] !== undefined) alpha = fn[4].endsWith("%") ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
  }
  if (rgb.some((c) => !Number.isFinite(c) || c < 0 || c > 255) || alpha < 1) return null;
  return rgb.map((c) => Math.round(c));
}

/** "#rrggbb" for an opaque colour value, else null (e.g. for <input type="color">). */
export function colorToHex(value) {
  const rgb = parseColor(value);
  return rgb ? `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}` : null;
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two colour values (1–21), or null when either cannot be parsed. */
export function contrastRatio(a, b) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text tokens and the surfaces they are read on: every pair needs WCAG AA (4.5:1).
export const TEXT_TOKENS = ["ink", "muted", "primary-text", "accent-text"];
export const TEXT_SURFACES = ["paper", "node", "primary-soft", "accent-soft"];
const CONTRAST_PAIRS = TEXT_TOKENS.flatMap((fg) => TEXT_SURFACES.map((bg) => [fg, bg]));
export const MIN_CONTRAST = 4.5;

/** Readability warnings for a normalized theme's palette. */
export function themeContrastIssues(theme) {
  const issues = [];
  for (const [fg, bg] of CONTRAST_PAIRS) {
    const ratio = contrastRatio(theme.palette[fg], theme.palette[bg]);
    if (ratio !== null && ratio < MIN_CONTRAST) {
      issues.push({ level: "warning", pair: [fg, bg], ratio, message: `Low contrast: ${fg} on ${bg} is ${ratio.toFixed(2)}:1 (text needs at least ${MIN_CONTRAST}:1).` });
    }
  }
  return issues;
}
