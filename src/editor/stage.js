// Center stage: live 16:9 preview of the selected slide with inline editing.

import { h, icon, fitFrame, frameIsCurrent, writeFrame, debounce, toast } from "./dom.js";
import { notify, selectedSlide, selectOverlays, slideDocument, state, slidePosition } from "./state.js";
import { opQuiet } from "./actions.js";
import { sanitizeRichText } from "../core/html.js";
import { slideTitle } from "../core/deck.js";
import { normalizeImage } from "../core/image.js";
import { createOverlayLayer, insertOverlay } from "./overlays.js";
import { createPreviewReorder } from "./reorder.js";
import { chooseImageFile, hasFiles, imageFiles, uploadImage } from "./assets.js";

const INSERT_KINDS = [
  { kind: "image", label: "Image…", hint: "PNG, JPEG, WebP, GIF or SVG" },
  { kind: "text", label: "Text", hint: "Uses the theme fonts" },
  { kind: "callout", label: "Callout", hint: "Highlighted note" },
  { kind: "arrow", label: "Arrow", hint: "Points at a detail" },
  { kind: "shape", label: "Shape", hint: "Frame or highlight an area" },
];

/** Overlay size in slide px for an image, keeping its aspect ratio. */
function imageSize(info) {
  const ratio = info?.width > 0 && info?.height > 0 ? info.width / info.height : 4 / 3;
  let w = 384;
  let hh = w / ratio;
  if (hh > 432) {
    hh = 432;
    w = hh * ratio;
  }
  return { w: Math.round(w), h: Math.round(hh) };
}

function getPath(data, path) {
  return path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), data);
}

/** Put an uploaded image into an image slot (a new picture gets a fresh alt text). */
export function setSlotImage(slide, path, src) {
  const previous = normalizeImage(getPath(slide.data, path));
  const value = { src, alt: "", fit: previous?.fit || "cover", focus: "50% 50%" };
  return opQuiet("update_slide", { id: slide.id, set: { [path]: value } }, { label: previous ? "Replace image" : "Add image" });
}

export function createStage({ onSlotFocus }) {
  const frame = h("iframe", { class: "stage-frame", title: "Slide preview (click text to edit)", "data-testid": "stage-frame" });
  // A rejected gesture (e.g. Copilot is editing) leaves the live DOM moved: re-render it.
  const layer = createOverlayLayer({ frame, getScale: () => scale, onRejected: () => {
    frame._body = null;
    update({});
  } });
  const reorder = createPreviewReorder({ frame, layer: layer.root });
  const wrap = h("div", { class: "stage-frame-wrap" }, frame, layer.root);
  const canvas = h("div", { class: "stage-canvas" }, wrap);
  const title = h("span", { class: "stage-title" });
  const templateBadge = h("span", { class: "badge" });
  const hiddenBadge = h("span", { class: "badge badge-warn" }, "Hidden in presentation");
  const hint = h("span", { class: "stage-hint" }, "Click text to edit · drag items by their grip");
  const insertMenu = h("div", { class: "menu", role: "menu", "aria-label": "Insert", hidden: true },
    INSERT_KINDS.map(({ kind, label, hint: sub }) => h("button", {
      type: "button", class: "menu-item", role: "menuitem", dataset: { kind },
      onClick: () => {
        closeMenu();
        insert(kind);
      },
    }, h("span", {}, label), h("span", { class: "menu-hint" }, sub))),
  );
  const insertBtn = h("button", { type: "button", class: "btn btn-sm", "aria-haspopup": "menu", "aria-expanded": "false", "data-testid": "insert-menu", onClick: () => (insertMenu.hidden ? openMenu() : closeMenu()) }, icon("plus", 14), "Insert");
  const empty = h("div", { class: "stage-empty" }, h("p", {}, "This deck has no slides yet."), h("p", { class: "muted" }, "Use “Add slide” to start."));
  const root = h("section", { class: "stage", "aria-label": "Slide preview" },
    h("div", { class: "stage-bar" },
      h("div", { class: "stage-heading" }, title, templateBadge, hiddenBadge),
      h("div", { class: "stage-tools" }, hint, h("div", { class: "menu-host" }, insertBtn, insertMenu)),
    ),
    canvas,
    empty,
  );

  let currentId = null;
  let editing = null; // { el, path, slideId }
  let selectedPath = null;
  let pendingWrite = false;
  let scale = 1;

  function openMenu() {
    insertMenu.hidden = false;
    insertBtn.setAttribute("aria-expanded", "true");
    insertMenu.querySelector(".menu-item")?.focus();
  }
  function closeMenu() {
    insertMenu.hidden = true;
    insertBtn.setAttribute("aria-expanded", "false");
  }
  document.addEventListener("pointerdown", (e) => {
    if (!insertMenu.hidden && !e.target.closest(".menu-host")) closeMenu();
  });
  insertMenu.addEventListener("keydown", (e) => {
    const items = [...insertMenu.querySelectorAll(".menu-item")];
    const index = items.indexOf(document.activeElement);
    if (e.key === "Escape") {
      closeMenu();
      insertBtn.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    }
  });

  async function insert(kind) {
    if (!selectedSlide()) return;
    if (kind !== "image") return insertOverlay(kind);
    const file = await chooseImageFile();
    if (file) await placeImage(file, { overlay: true });
  }

  /** Upload an image, then fill the targeted (or first required, empty) image slot or add an image overlay. */
  async function placeImage(file, { slotPath = null, at = null, overlay = false }) {
    const info = await uploadImage(file);
    const slide = selectedSlide();
    if (!info || !slide) return;
    const template = state.templates[slide.template];
    const target = (slotPath || overlay) ? slotPath : Object.entries(template?.slots || {}).find(([key, slot]) => slot.type === "image" && slot.required && !normalizeImage(slide.data?.[key]))?.[0];
    if (target) {
      await setSlotImage(slide, target, info.path);
      onSlotFocus?.(target, { focusAlt: true });
      toast("Image added: describe it in the alt text field", { timeout: 5000 });
      return;
    }
    await insertOverlay("image", { data: { src: info.path, alt: "", fit: "cover" }, size: imageSize(info), at });
  }

  // Drop files on the preview or around it.
  const dropTarget = (el) => el?.closest?.("[data-df-image]") || null;
  let dropHighlight = null;
  const setHighlight = (el) => {
    if (dropHighlight === el) return;
    dropHighlight?.classList.remove("df-drop");
    dropHighlight = el;
    el?.classList.add("df-drop");
  };
  function onDragOver(e, inFrame) {
    if (!hasFiles(e.dataTransfer) || !selectedSlide()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    wrap.classList.add("is-drop");
    setHighlight(inFrame ? dropTarget(e.target) : null);
  }
  function onDrop(e, inFrame) {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    const target = inFrame ? dropTarget(e.target) : null;
    setHighlight(null);
    wrap.classList.remove("is-drop");
    const [file] = imageFiles(e.dataTransfer);
    if (!file) return toast("Drop a PNG, JPEG, WebP, GIF or SVG image", { kind: "error" });
    let at = null;
    if (inFrame) at = { x: e.clientX, y: e.clientY };
    else {
      const rect = wrap.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) at = { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
    }
    placeImage(file, { slotPath: target?.dataset.dfImage || null, at });
  }
  canvas.addEventListener("dragover", (e) => onDragOver(e, false));
  canvas.addEventListener("dragleave", (e) => {
    if (!canvas.contains(e.relatedTarget)) wrap.classList.remove("is-drop");
  });
  canvas.addEventListener("drop", (e) => onDrop(e, false));

  // Paste an image (outside text fields): fill a required empty slot or add an overlay.
  function onPaste(e) {
    if (e.defaultPrevented || !selectedSlide()) return;
    const t = e.target;
    if (t?.closest?.("input, textarea, select, [contenteditable], .cm-editor, dialog")) return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    placeImage(file, {});
  }
  window.addEventListener("paste", onPaste);

  const resize = () => {
    // The stage may have been hidden/re-attached: make sure the frame shows the slide.
    if (pendingWrite || (currentId && !frameIsCurrent(frame))) {
      const slide = selectedSlide();
      if (slide) pendingWrite = !writeFrame(frame, slideDocument(slide, { edit: true }));
    }
    scale = fitFrame(canvas, frame);
    wrap.style.width = `${1280 * scale}px`;
    wrap.style.height = `${720 * scale}px`;
    layer.setScale(scale);
    layer.render();
  };
  new ResizeObserver(resize).observe(canvas);

  const commit = debounce((el, slideId, path, type) => {
    const value = type === "richtext" ? sanitizeRichText(el.innerHTML) : el.innerText.replace(/\n$/, "");
    opQuiet("update_slide", { id: slideId, set: { [path]: value } }, { coalesce: `${slideId}:${path}`, label: "Edit text" });
  }, 350);

  function wire() {
    const doc = frame.contentDocument;
    if (!doc) return;
    if (!doc.__dfWired) {
      doc.__dfWired = true;
      doc.addEventListener("click", (e) => {
        if (e.target.closest("a")) e.preventDefault();
        const image = e.target.closest("[data-df-image]");
        if (image) {
          onSlotFocus?.(image.dataset.dfImage);
          if (image.classList.contains("df-img-empty")) {
            chooseImageFile().then((file) => file && placeImage(file, { slotPath: image.dataset.dfImage }));
          }
        }
      });
      doc.addEventListener("dragover", (e) => onDragOver(e, true));
      doc.addEventListener("dragleave", (e) => {
        if (!e.relatedTarget) {
          setHighlight(null);
          wrap.classList.remove("is-drop");
        }
      });
      doc.addEventListener("drop", (e) => onDrop(e, true));
      doc.addEventListener("paste", onPaste);
    }
    layer.wire(doc);
    reorder.wire(doc, () => layer.busy());
    reorder.refresh();
    measure();
    for (const el of doc.querySelectorAll(".df-slot")) {
      const type = el.dataset.dfType;
      const path = el.dataset.dfSlot;
      el.setAttribute("contenteditable", type === "richtext" ? "true" : "plaintext-only");
      el.setAttribute("role", "textbox");
      el.setAttribute("aria-label", `Edit ${path}`);
      el.spellcheck = true;
      if (path === selectedPath) el.classList.add("df-selected");
      let original = null;
      el.addEventListener("focus", () => {
        original = el.innerHTML;
        // Sample text: select it so typing replaces it.
        if (el.hasAttribute("data-df-placeholder")) {
          const range = doc.createRange();
          range.selectNodeContents(el);
          const selection = doc.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        editing = { el, path, slideId: currentId };
        onSlotFocus?.(path);
      });
      el.addEventListener("input", () => commit(el, currentId, path, type));
      el.addEventListener("blur", () => {
        commit.flush(el, editing?.slideId ?? currentId, path, type);
        editing = null;
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          commit.cancel();
          el.innerHTML = original;
          commit.flush(el, currentId, path, type);
          el.blur();
        } else if (e.key === "Enter" && !e.shiftKey && type !== "richtext") {
          e.preventDefault();
          el.blur();
        } else if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "y")) {
          // Let the editor's global undo handle it once the edit is committed.
          e.preventDefault();
          commit.flush(el, currentId, path, type);
          el.blur();
          window.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey }));
        }
      });
      el.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        doc.execCommand("insertText", false, text);
      });
    }
  }
  frame.addEventListener("frame-updated", wire);

  /** Measure overlays covering template text on the laid-out preview. */
  function measure() {
    const slide = selectedSlide();
    if (!slide) return;
    const run = () => {
      const warnings = layer.measureWarnings();
      const before = JSON.stringify(state.overlayWarnings.get(slide.id) || []);
      if (JSON.stringify(warnings) !== before) {
        state.overlayWarnings.set(slide.id, warnings);
        notify({ overlayWarnings: true });
      }
      layer.render();
    };
    run();
    frame.contentDocument?.fonts?.ready.then(run);
  }

  function update(info = {}) {
    if (layer.busy()) {
      // Never swap the preview under a pointer gesture: apply once it ends.
      layer.defer(() => update(info));
      return;
    }
    if (info.overlaySelection || info.overlayWarnings) {
      layer.render();
      return;
    }
    const slide = selectedSlide();
    empty.hidden = Boolean(slide);
    canvas.hidden = !slide;
    if (!slide) {
      currentId = null;
      title.textContent = "";
      return;
    }
    const { index } = slidePosition(slide);
    title.textContent = `${slide.hidden ? "–" : index + 1}. ${slideTitle(slide, state.templates[slide.template])}`;
    templateBadge.textContent = state.templates[slide.template]?.label || `${slide.template} (missing)`;
    templateBadge.classList.toggle("badge-danger", !state.templates[slide.template]);
    hiddenBadge.hidden = !slide.hidden;
    const sameSlide = currentId === slide.id;
    if (!sameSlide) reorder.hide();
    currentId = slide.id;
    // Keep the caret: our own inline edit round-trips are already on screen.
    if (sameSlide && editing && info.source === "user" && !info.selection) return;
    if (sameSlide && editing && frame.contentDocument?.activeElement === editing.el && info.source === "user") return;
    writeFrame(frame, slideDocument(slide, { edit: true }));
    pendingWrite = !frameIsCurrent(frame);
    layer.render();
    requestAnimationFrame(resize);
  }

  function highlightSlot(path) {
    selectedPath = path;
    const doc = frame.contentDocument;
    if (!doc) return;
    for (const el of doc.querySelectorAll(".df-selected")) el.classList.remove("df-selected");
    if (!path) return;
    for (const el of doc.querySelectorAll(".df-slot")) {
      if (el.dataset.dfSlot === path || el.dataset.dfSlot.startsWith(path + ".")) el.classList.add("df-selected");
    }
  }

  layer.root.addEventListener("overlay-edit", (e) => onSlotFocus?.(`@overlay:${e.detail.id}`));

  return { root, update, highlightSlot, frame, selectOverlays };
}

