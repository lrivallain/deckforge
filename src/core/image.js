// Image values ({src, alt, fit, focus}) shared by `image` slots and image
// overlays: normalization, safe sources, rendering and validation.

import { escapeAttr } from "./html.js";

export const IMAGE_FITS = ["cover", "contain"];
export const IMAGE_EXTENSIONS = ["png", "jpg", "webp", "gif", "svg"];
export const ASSET_DIR = "assets";
const ASSET_PATH_RE = /^assets\/[A-Za-z0-9][\w-]*\.(?:png|jpe?g|webp|gif|svg)$/;
const FOCUS_RE = /^(\d{1,3}(?:\.\d+)?)% (\d{1,3}(?:\.\d+)?)%$/;

/** A deck-relative asset path such as "assets/3f2a9c1b04de.png" (no traversal). */
export function isAssetPath(src) {
  return ASSET_PATH_RE.test(String(src ?? ""));
}

export function isRemoteSrc(src) {
  return /^https:\/\//i.test(String(src ?? "").trim());
}

/** Image sources deckforge renders: files in assets/ or https:// URLs. */
export function isSafeImageSrc(src) {
  const value = String(src ?? "").trim();
  if (isAssetPath(value)) return true;
  if (!isRemoteSrc(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function normalizeFocus(value) {
  const m = FOCUS_RE.exec(String(value ?? "").trim());
  if (!m) return "50% 50%";
  const clamp = (n) => Math.round(Math.min(100, Math.max(0, Number(n))) * 10) / 10;
  return `${clamp(m[1])}% ${clamp(m[2])}%`;
}

/** Coerce a raw image value to {src, alt, fit, focus}; null when there is no image. */
export function normalizeImage(value) {
  if (!value) return null;
  if (typeof value === "string") value = { src: value };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const src = String(value.src ?? "").trim();
  if (!src) return null;
  return {
    src,
    alt: String(value.alt ?? ""),
    fit: IMAGE_FITS.includes(value.fit) ? value.fit : "cover",
    focus: normalizeFocus(value.focus),
  };
}

/**
 * <img> markup for an image value. `assetUrl(src)` maps an asset path to the
 * URL used in the document (editor: /deck/assets/…, inline build: data URI).
 */
export function renderImage(value, { assetUrl = (src) => src, className = "df-img", attrs = "" } = {}) {
  const image = normalizeImage(value);
  if (!image || !isSafeImageSrc(image.src)) return "";
  const src = isAssetPath(image.src) ? assetUrl(image.src) : image.src;
  if (!src) return "";
  return `<img class="${escapeAttr(className)}" src="${escapeAttr(src)}" alt="${escapeAttr(image.alt)}" loading="lazy" decoding="async" style="object-fit: ${image.fit}; object-position: ${image.focus}"${attrs}>`;
}

/** Validation messages for one image value. */
export function imageIssues(value, where) {
  const issues = [];
  const image = normalizeImage(value);
  if (!image) return issues;
  if (!isSafeImageSrc(image.src)) issues.push({ level: "error", message: `${where}: unsupported image source "${image.src}" (use a file in assets/ or an https:// URL)` });
  else if (isRemoteSrc(image.src)) issues.push({ level: "warning", message: `${where}: image loads from the network (${new URL(image.src).hostname})` });
  if (!image.alt.trim()) issues.push({ level: "warning", message: `${where}: image has no alt text` });
  return issues;
}

/** Collect every image src used by a slide (slots, nested cards and overlays). */
export function slideImageSources(slide, template) {
  const out = [];
  const walk = (slots, data) => {
    for (const [key, slot] of Object.entries(slots || {})) {
      const value = data?.[key];
      if (slot.type === "image") {
        const image = normalizeImage(value);
        if (image) out.push(image.src);
      } else if (slot.type === "cards" && Array.isArray(value)) {
        for (const item of value) walk(slot.fields, item);
      }
    }
  };
  if (template) walk(template.slots, slide.data);
  for (const overlay of slide.overlays || []) {
    if (overlay.kind === "image" && overlay.data?.src) out.push(String(overlay.data.src));
  }
  return out;
}
