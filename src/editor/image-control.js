// Inspector control for an image value {src, alt, fit, focus}: thumbnail,
// replace (file picker, drop, paste, deck assets, https URL), alt text with a
// counter, fit and a focal point picked by clicking the thumbnail.

import { h, icon, debounce, toast } from "./dom.js";
import { ACCEPT, hasFiles, imageFiles, listAssets, previewUrl, uploadImage } from "./assets.js";
import { IMAGE_FITS, isRemoteSrc, isSafeImageSrc, normalizeImage } from "../core/image.js";

const ALT_MAX = 150;
let counter = 0;

/**
 * @param {object} opts
 *   value      current image value (any shape; normalized here)
 *   label      field label
 *   path       data-path for focus restoration / reveal ("image", "@ov:id:image")
 *   onChange   (patch | "", { coalesce?: string, replace?: boolean }) => void
 *              `patch` holds only the changed fields, so edits never resend
 *              stale values; `replace` means a whole new image value.
 *   required   show the empty state as a warning
 */
export function imageControl({ value, label, path, onChange, required = false, description }) {
  const id = `img${++counter}`;
  const image = normalizeImage(value);
  const fileInput = h("input", { type: "file", accept: ACCEPT, hidden: true, "data-testid": "image-file", dataset: { path } });
  const commit = (patch, opts = {}) => onChange(patch, opts);
  // A new picture: fresh alt text and focal point, keep the chosen fit.
  const newImage = (src) => commit({ src, alt: "", fit: image?.fit || "cover", focus: "50% 50%" }, { replace: true });

  async function useFile(file) {
    if (!file) return;
    const info = await uploadImage(file);
    if (info) newImage(info.path);
  }
  fileInput.addEventListener("change", () => useFile(fileInput.files?.[0]));

  // Thumbnail / drop zone.
  let drop;
  if (image) {
    const img = h("img", { src: previewUrl(image.src), alt: "", draggable: false, "data-testid": "image-thumb" });
    const [fx, fy] = image.focus.split(" ").map((v) => parseFloat(v));
    const dot = h("span", { class: "focus-dot", style: { left: `${fx}%`, top: `${fy}%` }, "aria-hidden": "true" });
    const frame = h("span", { class: "image-thumb", title: "Click to set the focal point" }, img, dot);
    img.addEventListener("click", (e) => {
      const r = img.getBoundingClientRect();
      const x = Math.round(((e.clientX - r.left) / r.width) * 100);
      const y = Math.round(((e.clientY - r.top) / r.height) * 100);
      dot.style.left = `${x}%`;
      dot.style.top = `${y}%`;
      commit({ focus: `${Math.max(0, Math.min(100, x))}% ${Math.max(0, Math.min(100, y))}%` });
    });
    img.addEventListener("error", () => frame.classList.add("is-broken"));
    drop = h("div", { class: "image-drop has-image", tabindex: "0", "aria-label": `${label}: drop or paste an image to replace it` }, frame);
  } else {
    drop = h("button", { type: "button", class: `image-drop${required ? " is-required" : ""}`, onClick: () => fileInput.click(), "aria-label": `${label}: choose, drop or paste an image` },
      icon("image", 22), h("span", {}, "Drop, paste or choose an image"), h("span", { class: "muted small" }, "PNG, JPEG, WebP, GIF or SVG · up to 10 MB"));
  }
  drop.addEventListener("dragover", (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    drop.classList.remove("is-over");
    const [file] = imageFiles(e.dataTransfer);
    if (file) useFile(file);
    else toast("Drop a PNG, JPEG, WebP, GIF or SVG image", { kind: "error" });
  });
  drop.addEventListener("paste", (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    useFile(file);
  });

  // Source row: replace, deck assets, remove.
  const assets = h("select", { class: "input input-sm", "aria-label": "Use an image already in the deck", "data-testid": "image-assets" },
    h("option", { value: "" }, "From this deck…"));
  listAssets().then((list) => {
    for (const asset of list) {
      const size = asset.width ? ` · ${Math.round(asset.width)}×${Math.round(asset.height)}` : "";
      assets.append(h("option", { value: asset.path, selected: asset.path === image?.src }, `${asset.path.slice(7)}${size}`));
    }
    assets.disabled = !list.length;
  });
  assets.addEventListener("change", () => {
    if (assets.value && assets.value !== image?.src) newImage(assets.value);
  });
  const sourceRow = h("div", { class: "row wrap" },
    h("button", { type: "button", class: "btn btn-sm", onClick: () => fileInput.click(), "data-testid": "image-choose" }, icon("upload", 14), image ? "Replace" : "Choose file"),
    assets,
    image ? h("button", { type: "button", class: "icon-btn danger", title: "Remove image", "aria-label": "Remove image", onClick: () => commit("") }, icon("trash", 15)) : null,
  );

  const children = [
    h("div", { class: "field-label" }, h("span", { class: "label", id }, label), image && isRemoteSrc(image.src) ? h("span", { class: "badge badge-warn", title: "Viewers load this image from the internet" }, "Network") : null),
    drop,
    sourceRow,
    fileInput,
  ];

  if (image) {
    const altId = `${id}-alt`;
    const count = h("span", { class: "counter" });
    const altHint = h("p", { class: "field-hint alt-hint" });
    const alt = h("textarea", { id: altId, class: "input", rows: 2, value: image.alt, placeholder: "What does the picture show?", dataset: { path: `${path}.alt` }, "data-testid": "image-alt" });
    const refreshAlt = () => {
      const length = alt.value.trim().length;
      count.textContent = `${alt.value.length}/${ALT_MAX}`;
      count.classList.toggle("over", alt.value.length > ALT_MAX);
      alt.classList.toggle("is-warn", !length);
      altHint.textContent = !length
        ? "Required: screen readers read this instead of the picture. Leave it short and specific."
        : alt.value.length > ALT_MAX ? "Long alt texts are tiring to hear: move detail to the caption or notes." : "";
      altHint.classList.toggle("is-warn", !length || alt.value.length > ALT_MAX);
    };
    refreshAlt();
    const sendAlt = debounce(() => commit({ alt: alt.value }, { coalesce: `${path}.alt` }), 300);
    alt.addEventListener("input", () => {
      refreshAlt();
      sendAlt();
    });
    alt.addEventListener("blur", () => sendAlt.flush());

    const fit = h("div", { class: "segmented", role: "radiogroup", "aria-label": "Fit" },
      IMAGE_FITS.map((mode) => h("button", {
        type: "button", role: "radio", "aria-checked": String(image.fit === mode), class: "seg",
        title: mode === "cover" ? "Fill the frame (crops around the focal point)" : "Show the whole picture",
        onClick: () => image.fit !== mode && commit({ fit: mode }),
      }, mode === "cover" ? "Fill" : "Fit")));

    const src = h("input", { class: "input input-sm mono", value: image.src, "aria-label": "Image source", spellcheck: false, dataset: { path: `${path}.src` } });
    src.addEventListener("change", () => {
      const next = src.value.trim();
      if (next === image.src) return;
      if (!isSafeImageSrc(next)) {
        toast("Use a file in assets/ or an https:// address", { kind: "error" });
        src.value = image.src;
        return;
      }
      commit({ src: next });
    });

    children.push(
      h("div", { class: "field-label" }, h("label", { for: altId }, "Alt text"), count),
      alt,
      altHint,
      h("div", { class: "row between" }, h("span", { class: "label" }, "Fit"), fit),
      h("div", { class: "row between" },
        h("span", { class: "label" }, `Focal point ${image.focus}`),
        image.focus !== "50% 50%" ? h("button", { type: "button", class: "btn btn-link", onClick: () => commit({ focus: "50% 50%" }) }, "Center") : null),
      h("p", { class: "field-hint" }, image.fit === "cover" ? "Click the thumbnail to choose what stays visible when the frame crops the picture." : "The whole picture is shown; the focal point sets its alignment."),
      h("details", { class: "image-src" }, h("summary", {}, "Source"), src, h("p", { class: "field-hint" }, "A file in assets/ or an https:// address (https images are fetched by every viewer).")),
    );
  }
  if (description) children.push(h("p", { class: "field-hint" }, description));
  return h("div", { class: "field image-field", dataset: { path }, role: "group", "aria-labelledby": id }, ...children);
}
