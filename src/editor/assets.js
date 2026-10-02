// Image uploads and asset helpers shared by the stage and the inspector.

import { api } from "./api.js";
import { toast } from "./dom.js";
import { isAssetPath } from "../core/image.js";

export const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
const MAX_BYTES = 10 * 1024 * 1024;

/** URL of an image src inside the editor (assets are served under /deck/). */
export function previewUrl(src) {
  return isAssetPath(src) ? `/deck/${src}` : src;
}

let assetCache = null;
export async function listAssets({ refresh = false } = {}) {
  if (!assetCache || refresh) assetCache = api.assets().then((r) => r.assets || []).catch(() => []);
  return assetCache;
}

/** Upload one image file; resolves to { path, width, height, … } or null (toast shown). */
export async function uploadImage(file) {
  if (!file) return null;
  if (file.size > MAX_BYTES) {
    toast(`${file.name || "Image"} is larger than 10 MB`, { kind: "error" });
    return null;
  }
  try {
    const result = await api.upload(file);
    assetCache = null;
    return result;
  } catch (err) {
    toast(`Cannot add ${file.name || "the image"}: ${err.message}`, { kind: "error", timeout: 6000 });
    return null;
  }
}

export function imageFiles(dataTransfer) {
  return [...(dataTransfer?.files || [])].filter((f) => !f.type || f.type.startsWith("image/"));
}

export function hasFiles(dataTransfer) {
  return [...(dataTransfer?.types || [])].includes("Files");
}

/** Open the native file picker; resolves to a File or null. */
export function chooseImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.style.display = "none";
    input.dataset.testid = "insert-image-file";
    input.addEventListener("change", () => {
      resolve(input.files?.[0] || null);
      input.remove();
    });
    input.addEventListener("cancel", () => {
      resolve(null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/** Natural size of an uploaded image (falls back to the server-reported size). */
export function imageAspect(info) {
  if (info?.width > 0 && info?.height > 0) return info.width / info.height;
  return 4 / 3;
}
