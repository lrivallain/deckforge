// Deck image assets: magic-byte validation, content-addressed storage in
// <deck>/assets/<sha256-12>.<ext>, listing, data URIs and usage reports.
// Never fetches remote URLs.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ASSET_DIR, isAssetPath, slideImageSources } from "../core/image.js";
import { writeFileAtomic } from "./fs-util.js";

export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

export const ASSET_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export class AssetError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AssetError";
    this.status = status;
  }
}

const startsWith = (buf, bytes, offset = 0) => buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

/** Detect the image type from its first bytes. Returns "png" | "jpg" | "webp" | "gif" | "svg" | null. */
export function detectImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(buf, ascii("GIF87a")) || startsWith(buf, ascii("GIF89a"))) return "gif";
  if (startsWith(buf, ascii("RIFF")) && startsWith(buf, ascii("WEBP"), 8)) return "webp";
  if (looksLikeSvg(buf)) return "svg";
  return null;
}

function decodeUtf8(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
}

const SVG_PROLOG_RE = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE\s+svg[^>[]*>)\s*)*<svg[\s>]/i;

function looksLikeSvg(buf) {
  const text = decodeUtf8(buf.subarray(0, Math.min(buf.length, 4096)));
  return text !== null && SVG_PROLOG_RE.test(text);
}

// SVG is only ever displayed through <img> (no script execution) and served
// with a sandbox CSP; still refuse active or external content outright.
const SVG_FORBIDDEN = [
  [/<script[\s>/]/i, "scripts"],
  [/<foreignObject[\s>/]/i, "foreignObject"],
  [/\son[a-z]+\s*=/i, "event handler attributes"],
  [/javascript:/i, "javascript: URLs"],
  [/<!ENTITY/i, "entity declarations"],
  [/<(?:iframe|embed|object)[\s>/]/i, "embedded documents"],
];

export function checkSvg(buf) {
  const text = decodeUtf8(buf);
  if (text === null || !SVG_PROLOG_RE.test(text)) throw new AssetError("Not a valid SVG file");
  for (const [re, what] of SVG_FORBIDDEN) if (re.test(text)) throw new AssetError(`SVG files with ${what} are not allowed`);
  if (!/<\/svg\s*>\s*(?:<!--[\s\S]*?-->\s*)*$/i.test(text)) throw new AssetError("Not a valid SVG file (missing </svg>)");
  return text;
}

/** Intrinsic pixel size when it can be read from the header (null otherwise). */
export function imageSize(buf, type = detectImageType(buf)) {
  try {
    switch (type) {
      case "png":
        return buf.length >= 24 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
      case "gif":
        return buf.length >= 10 ? { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) } : null;
      case "webp": {
        const chunk = buf.toString("latin1", 12, 16);
        if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
        if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
        if (chunk === "VP8L") {
          const bits = buf.readUInt32LE(21);
          return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
        }
        return null;
      }
      case "jpg": {
        let offset = 2;
        while (offset + 9 < buf.length) {
          if (buf[offset] !== 0xff) return null;
          const marker = buf[offset + 1];
          const length = buf.readUInt16BE(offset + 2);
          if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
          }
          offset += 2 + length;
        }
        return null;
      }
      case "svg": {
        const text = decodeUtf8(buf) || "";
        const tag = /<svg\b[^>]*>/i.exec(text)?.[0] || "";
        const attr = (name) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
        const viewBox = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
        const w = parseFloat(attr("width"));
        const h = parseFloat(attr("height"));
        if (w > 0 && h > 0 && !/%/.test(attr("width") + attr("height"))) return { width: w, height: h };
        if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) return { width: viewBox[2], height: viewBox[3] };
        return null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Validate image bytes; returns { ext, mime, size, width, height }. */
export function validateImage(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new AssetError("Empty file");
  if (buf.length > MAX_ASSET_BYTES) throw new AssetError(`Images are limited to ${MAX_ASSET_BYTES / 1024 / 1024} MB`, 413);
  const ext = detectImageType(buf);
  if (!ext) throw new AssetError("Unsupported file: use a PNG, JPEG, WebP, GIF or SVG image", 415);
  if (ext === "svg") checkSvg(buf);
  return { ext, mime: ASSET_TYPES[ext], size: buf.length, ...(imageSize(buf, ext) || {}) };
}

export function assetsDir(deckDir) {
  return path.join(deckDir, ASSET_DIR);
}

/** Absolute file for an "assets/…" path, or null (bad path, missing, or escaping via symlink). */
export function resolveAsset(deckDir, src) {
  if (!isAssetPath(src)) return null;
  const dir = assetsDir(deckDir);
  const file = path.join(dir, path.basename(src));
  try {
    const real = fs.realpathSync(file);
    const realDir = fs.realpathSync(dir);
    if (path.dirname(real) !== realDir || !fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

/** Store validated image bytes as assets/<sha256-12>.<ext> (idempotent). */
export function saveAsset(deckDir, buf) {
  const info = validateImage(buf);
  const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
  const name = `${hash}.${info.ext}`;
  const dir = assetsDir(deckDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) writeFileAtomic(file, buf);
  return { path: `${ASSET_DIR}/${name}`, ...info };
}

export function listAssets(deckDir) {
  let names;
  try {
    names = fs.readdirSync(assetsDir(deckDir));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.sort()) {
    const src = `${ASSET_DIR}/${name}`;
    const file = resolveAsset(deckDir, src);
    if (!file) continue;
    const buf = fs.readFileSync(file);
    const ext = detectImageType(buf);
    if (!ext) continue;
    out.push({ path: src, type: ASSET_TYPES[ext], size: buf.length, ...(imageSize(buf, ext) || {}) });
  }
  return out;
}

/** data: URI for an asset (inline runtime). Returns null when missing or invalid. */
export function assetDataUri(deckDir, src) {
  const file = resolveAsset(deckDir, src);
  if (!file) return null;
  const buf = fs.readFileSync(file);
  const ext = detectImageType(buf);
  if (!ext) return null;
  return `data:${ASSET_TYPES[ext]};base64,${buf.toString("base64")}`;
}

/** Which assets the deck uses, which are missing and which are unused. */
export function assetReport(deck, templates, deckDir) {
  const used = new Set();
  for (const slide of deck.slides) {
    for (const src of slideImageSources(slide, templates[slide.template])) if (isAssetPath(src)) used.add(src);
  }
  const available = new Set(listAssets(deckDir).map((a) => a.path));
  return {
    used: [...used].filter((src) => available.has(src)).sort(),
    missing: [...used].filter((src) => !available.has(src)).sort(),
    unused: [...available].filter((src) => !used.has(src)).sort(),
  };
}

/** Copy the used asset files to another output directory (local runtime with --out). */
export function copyAssets(deckDir, outDir, sources) {
  if (path.resolve(deckDir) === path.resolve(outDir)) return 0;
  let copied = 0;
  for (const src of sources) {
    const file = resolveAsset(deckDir, src);
    if (!file) continue;
    const target = path.join(outDir, ASSET_DIR, path.basename(src));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    copied++;
  }
  return copied;
}
