// Theme YAML → CSS custom properties.

import YAML from "yaml";
import { isSafeUrl } from "./html.js";

export const PALETTE_KEYS = [
  "bg", "paper", "line", "ink", "muted", "node",
  "primary", "primary-soft", "primary-line",
  "accent", "accent-soft", "accent-line",
];
const OPTIONAL_PALETTE = { frame: null, ok: "#1F9D6B", dashed: null, chrome: null };
const DEFAULT_RADII = { slide: "12px", card: "10px", panel: "12px", frame: "14px", small: "8px", pill: "99px" };
const DEFAULT_SPACING = { padding: "3cqw 4cqw 2cqw", gap: "1.3cqw", grid: "1.1cqw" };
const DEFAULT_MOTION = { duration: ".55s", easing: "ease", distance: "8px", stagger: ".15s" };
const DEFAULT_SHADOW = { slide: "0 24px 60px rgb(22 32 47 / 10%)" };
const FONT_ROLES = ["heading", "body", "mono"];
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
  if (!text || !CSS_VALUE_RE.test(text)) {
    errors.push(`Invalid CSS value for "${key}": ${JSON.stringify(value)}`);
    return null;
  }
  return text;
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
