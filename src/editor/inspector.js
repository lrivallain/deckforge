// Inspector: template, slot form, speaker notes and per-slide options.

import { h, icon, debounce } from "./dom.js";
import { selectedSlide, state } from "./state.js";
import { op, opQuiet } from "./actions.js";
import { pickTemplate } from "./picker.js";
import { ICON_NAMES, renderIcon } from "../core/icons.js";
import { checkSlotLimits } from "../core/template.js";
import { stripTags } from "../core/html.js";
import { imageControl } from "./image-control.js";
import { layersSection, overlayPanel } from "./inspector-overlays.js";
import { makeSortable } from "./reorder.js";

function humanize(name) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

let fieldCounter = 0;
const nextId = () => `f${++fieldCounter}`;

export function createInspector({ onFieldFocus }) {
  const body = h("div", { class: "inspector-body" });
  const root = h("aside", { class: "inspector", "aria-label": "Slide inspector" },
    h("div", { class: "panel-head" }, h("h2", {}, "Inspector")),
    body,
  );
  let renderedKey = null;
  const setters = new Map();

  const send = (slideId, path, value) =>
    opQuiet("update_slide", { id: slideId, set: { [path]: value } }, { coalesce: `${slideId}:${path}`, label: "Edit slot" });
  const sendDebounced = new Map();
  function sendLater(slideId, path, value) {
    const key = `${slideId}:${path}`;
    if (!sendDebounced.has(key)) sendDebounced.set(key, debounce(send, 300));
    sendDebounced.get(key)(slideId, path, value);
  }

  function structureKey(slide) {
    // Image values are shown as thumbnails: their source/fit/focus are structure; alt text is not.
    const shape = (value) => (Array.isArray(value) ? `[${value.map(shape).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).map((k) => `${k}:${["src", "fit", "focus"].includes(k) ? value[k] : shape(value[k])}`).join(",")}}` : "");
    const overlays = (slide.overlays || []).map((o) => `${o.id}:${o.kind}:${o.z}:${o.order ?? ""}:${Object.entries(o.data || {}).filter(([k]) => k !== "text" && k !== "alt").map(([k, v]) => `${k}=${v}`).join(";")}`).join(",");
    const warnings = JSON.stringify(state.overlayWarnings.get(slide.id) || []);
    return `${slide.id}|${slide.template}|${shape(slide.data)}|${(slide.placeholders || []).join(",")}|${Object.keys(slide.stash || {}).join(",")}|${state.registryVersion}|${overlays}|${state.overlaySelection.join(",")}|${warnings}`;
  }

  // ------------------------------------------------------------ field builders

  function field(label, control, { hint, counter, id, path } = {}) {
    return h("div", { class: "field", dataset: { path: path || "" } },
      h("div", { class: "field-label" }, h("label", { for: id }, label), counter || null),
      control,
      hint ? h("p", { class: "field-hint" }, hint) : null,
    );
  }

  function counterFor(value, max) {
    if (!max) return null;
    const el = h("span", { class: "counter" });
    const update = (v) => {
      const length = stripTags(String(v ?? "")).length;
      el.textContent = `${length}/${max}`;
      el.classList.toggle("over", length > max);
    };
    update(value);
    el.update = update;
    return el;
  }

  function autosize(textarea) {
    const fit = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight + 2}px`;
    };
    requestAnimationFrame(fit);
    textarea.addEventListener("input", fit);
  }

  function textControl(slot, value, path, slideId, { richtext = false } = {}) {
    const id = nextId();
    const counter = counterFor(value, slot.max);
    const textarea = h("textarea", { id, rows: 1, class: "input", value: value ?? "", spellcheck: true, dataset: { path } });
    autosize(textarea);
    textarea.addEventListener("input", () => {
      counter?.update(textarea.value);
      sendLater(slideId, path, textarea.value);
    });
    textarea.addEventListener("focus", () => onFieldFocus?.(path));
    setters.set(path, (v) => {
      if (document.activeElement !== textarea) textarea.value = v ?? "";
      counter?.update(v);
    });
    let control = textarea;
    if (richtext) {
      const wrap = (before, after) => () => {
        const { selectionStart: s, selectionEnd: e, value: v } = textarea;
        textarea.value = v.slice(0, s) + before + v.slice(s, e) + after + v.slice(e);
        textarea.setSelectionRange(s + before.length, e + before.length);
        textarea.focus();
        textarea.dispatchEvent(new Event("input"));
      };
      const tool = (label, title, action, cls = "") => h("button", { type: "button", class: `tool ${cls}`, title, "aria-label": title, onClick: action }, label);
      control = h("div", { class: "richtext" },
        h("div", { class: "richtext-tools", role: "toolbar", "aria-label": "Formatting" },
          tool("B", "Bold", wrap("<strong>", "</strong>"), "tool-bold"),
          tool("I", "Italic", wrap("<em>", "</em>"), "tool-italic"),
          tool("Primary", "Primary accent", wrap('<span class="blue">', "</span>"), "tool-primary"),
          tool("Accent", "Secondary accent", wrap('<span class="amber">', "</span>"), "tool-accent"),
          tool("Before", "Muted ‘old state’ line", wrap('<span class="old">', "</span>"), "tool-old"),
          tool("Link", "Link", wrap('<a href="https://">', "</a>")),
        ),
        textarea,
      );
    }
    return field(humanize(path.split(".").pop()), control, { hint: slot.description, counter, id, path });
  }

  function booleanControl(slot, value, path, slideId) {
    const id = nextId();
    const input = h("input", { id, type: "checkbox", class: "switch", checked: Boolean(value), dataset: { path } });
    input.addEventListener("change", () => send(slideId, path, input.checked));
    setters.set(path, (v) => { input.checked = Boolean(v); });
    return h("div", { class: "field field-inline", dataset: { path } }, input, h("label", { for: id }, humanize(path.split(".").pop())), slot.description ? h("span", { class: "field-hint" }, slot.description) : null);
  }

  function iconControl(slot, value, path, slideId) {
    const id = nextId();
    const preview = h("span", { class: "icon-preview", html: renderIcon(value) });
    const select = h("select", { id, class: "input", dataset: { path } },
      h("option", { value: "" }, "(none)"),
      ICON_NAMES.map((name) => h("option", { value: name, selected: name === value }, name)),
    );
    select.addEventListener("change", () => {
      preview.innerHTML = renderIcon(select.value);
      send(slideId, path, select.value);
    });
    setters.set(path, (v) => { select.value = v ?? ""; preview.innerHTML = renderIcon(v); });
    return field(humanize(path.split(".").pop()), h("div", { class: "row" }, preview, select), { id, path });
  }

  function linkControl(slot, value, path, slideId) {
    const link = typeof value === "string" ? { label: value, href: value } : { label: value?.label ?? "", href: value?.href ?? "" };
    const labelId = nextId();
    const label = h("input", { id: labelId, class: "input", value: link.label, placeholder: "Label", "aria-label": "Link label" });
    const href = h("input", { class: "input", value: link.href, placeholder: "https://…", "aria-label": "Link URL", type: "url" });
    const update = () => sendLater(slideId, path, { label: label.value, href: href.value });
    label.addEventListener("input", update);
    href.addEventListener("input", update);
    return field(humanize(path.split(".").pop()), h("div", { class: "stack" }, label, href), { id: labelId, path });
  }

  function itemTools(list, index, onChange) {
    const move = (delta) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      onChange(next);
    };
    return h("div", { class: "item-tools" },
      h("button", { type: "button", class: "icon-btn", title: "Move up", "aria-label": "Move up", disabled: index === 0, onClick: () => move(-1) }, icon("up", 14)),
      h("button", { type: "button", class: "icon-btn", title: "Move down", "aria-label": "Move down", disabled: index === list.length - 1, onClick: () => move(1) }, icon("down", 14)),
      h("button", { type: "button", class: "icon-btn danger", title: "Remove", "aria-label": "Remove item", onClick: () => onChange(list.filter((_, i) => i !== index)) }, icon("trash", 14)),
    );
  }

  function dragHandle(label) {
    return h("button", { type: "button", class: "icon-btn drag-handle", title: "Drag to reorder", "aria-label": `Drag to reorder: ${label}`, tabindex: "-1" }, icon("grip", 14));
  }

  function moveItem(slideId, path, from, to) {
    op("move_item", { id: slideId, path, from, to }, { label: "Reorder items" }).catch(() => {});
  }

  function imageSlotControl(slot, value, path, slideId) {
    return imageControl({
      value,
      label: humanize(path.split(".").pop()),
      path,
      required: slot.required,
      description: slot.description,
      onChange: (patch, opts = {}) => {
        const current = selectedSlide()?.data && path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), selectedSlide().data);
        // Patch individual fields of an existing image object; otherwise write the whole value.
        const set = !patch || opts.replace || !current || typeof current !== "object"
          ? { [path]: patch ? { alt: "", fit: "cover", focus: "50% 50%", ...(typeof current === "object" ? current : {}), ...patch } : "" }
          : Object.fromEntries(Object.entries(patch).map(([k, v]) => [`${path}.${k}`, v]));
        return opQuiet("update_slide", { id: slideId, set }, { label: !patch ? "Remove image" : opts.replace ? "Replace image" : "Edit image", coalesce: opts.coalesce ? `${slideId}:${opts.coalesce}` : undefined });
      },
    });
  }

  function listControl(slot, value, path, slideId) {
    const list = Array.isArray(value) ? value : [];
    const commit = (next) => op("update_slide", { id: slideId, set: { [path]: next } }, { label: "Edit list" }).catch(() => {});
    const rows = list.map((item, index) => {
      const input = h("textarea", { class: "input", rows: 1, value: item ?? "", "aria-label": `${humanize(path)} item ${index + 1}`, dataset: { path: `${path}.${index}` } });
      autosize(input);
      input.addEventListener("input", () => sendLater(slideId, `${path}.${index}`, input.value));
      input.addEventListener("focus", () => onFieldFocus?.(`${path}.${index}`));
      setters.set(`${path}.${index}`, (v) => { if (document.activeElement !== input) input.value = v ?? ""; });
      return h("li", { class: "list-row" }, dragHandle(`${humanize(path)} item ${index + 1}`), input, itemTools(list, index, commit));
    });
    const full = slot.max && list.length >= slot.max;
    const ol = h("ol", { class: "list-rows" }, rows);
    makeSortable(ol, (from, to) => moveItem(slideId, path, from, to));
    return h("div", { class: "field field-group", dataset: { path } },
      h("div", { class: "field-label" }, h("span", { class: "label" }, humanize(path.split(".").pop())), slot.max ? h("span", { class: `counter${list.length > slot.max ? " over" : ""}` }, `${list.length}/${slot.max}`) : null),
      ol,
      h("button", { type: "button", class: "btn btn-ghost btn-sm", disabled: full, onClick: () => commit([...list, ""]) }, icon("plus", 14), "Add item"),
      slot.description ? h("p", { class: "field-hint" }, slot.description) : null,
    );
  }

  function cardsControl(slot, value, path, slideId) {
    const list = Array.isArray(value) ? value : [];
    const commit = (next) => op("update_slide", { id: slideId, set: { [path]: next } }, { label: "Edit cards" }).catch(() => {});
    const cards = list.map((item, index) => {
      const fields = Object.entries(slot.fields || {}).map(([key, fieldSlot]) => control(fieldSlot, item?.[key], `${path}.${index}.${key}`, slideId));
      const summary = stripTags(String(item?.title ?? item?.label ?? "")) || `Item ${index + 1}`;
      return h("li", { class: "card-item" },
        h("div", { class: "card-head" }, dragHandle(`${summary}`), h("span", { class: "card-index" }, String(index + 1).padStart(2, "0")), h("span", { class: "card-title" }, summary), itemTools(list, index, commit)),
        h("div", { class: "card-fields" }, fields),
      );
    });
    const blank = Object.fromEntries(Object.entries(slot.fields || {}).map(([k, f]) => [k, f.type === "boolean" ? false : f.type === "list" || f.type === "cards" ? [] : ""]));
    const full = slot.max && list.length >= slot.max;
    const ol = h("ol", { class: "card-list" }, cards);
    makeSortable(ol, (from, to) => moveItem(slideId, path, from, to));
    return h("div", { class: "field field-group", dataset: { path } },
      h("div", { class: "field-label" }, h("span", { class: "label" }, humanize(path.split(".").pop())), slot.max ? h("span", { class: `counter${list.length > slot.max ? " over" : ""}` }, `${list.length}/${slot.max}`) : null),
      ol,
      h("button", { type: "button", class: "btn btn-ghost btn-sm", disabled: full, onClick: () => commit([...list, blank]) }, icon("plus", 14), "Add item"),
      slot.description ? h("p", { class: "field-hint" }, slot.description) : null,
    );
  }

  function control(slot, value, path, slideId) {
    switch (slot.type) {
      case "richtext": return textControl(slot, value, path, slideId, { richtext: true });
      case "boolean": return booleanControl(slot, value, path, slideId);
      case "icon": return iconControl(slot, value, path, slideId);
      case "link": return linkControl(slot, value, path, slideId);
      case "list": return listControl(slot, value, path, slideId);
      case "cards": return cardsControl(slot, value, path, slideId);
      case "image": return imageSlotControl(slot, value, path, slideId);
      default: return textControl(slot, value, path, slideId);
    }
  }

  // ------------------------------------------------------------ sections

  function section(title, ...children) {
    return h("section", { class: "insp-section" }, h("h3", { class: "insp-title" }, title), ...children);
  }

  async function changeTemplate(slide) {
    const name = await pickTemplate({ title: "Change template", current: slide.template, confirmLabel: "Apply template" });
    if (name && name !== slide.template) opQuiet("set_template", { id: slide.id, template: name });
  }

  function render() {
    setters.clear();
    const slide = selectedSlide();
    body.replaceChildren();
    if (!slide) {
      body.append(h("p", { class: "muted pad" }, "Select a slide to edit its content."));
      return;
    }
    const template = state.templates[slide.template];
    const overlayProps = overlayPanel(slide, setters);
    if (overlayProps) body.append(overlayProps);
    body.append(section("Template",
      h("div", { class: "template-current" },
        h("div", {}, h("strong", {}, template?.label || slide.template), h("p", { class: "muted small" }, template?.description || "This template is missing.")),
        h("button", { type: "button", class: "btn btn-sm", onClick: () => changeTemplate(slide), "data-testid": "change-template" }, icon("layout", 14), "Change"),
      ),
    ));
    if (template) {
      const issues = checkSlotLimits(template, slide.data);
      const unknown = Object.keys(slide.data || {}).filter((k) => !(k in template.slots));
      body.append(section("Content",
        issues.length || unknown.length
          ? h("ul", { class: "issues" }, [...issues.map((i) => h("li", {}, icon("alert", 14), i.message)), ...unknown.map((k) => h("li", {}, icon("alert", 14), `“${k}” is not used by this template`))])
          : null,
        slide.placeholders?.length
          ? h("p", { class: "muted small" }, "Fields marked “Sample” show the template's example text in the editor only; it is not published until you edit it.")
          : null,
        Object.entries(template.slots).map(([key, slot]) => control(slot, slide.data?.[key], key, slide.id)),
        slide.stash && Object.keys(slide.stash).length
          ? h("div", { class: "stash-note", "data-testid": "stash-note" },
            h("strong", {}, "Kept from a previous layout"),
            h("span", {}, `${Object.keys(slide.stash).join(", ")} — not shown by this template, restored if you switch back.`))
          : null,
      ));
      for (const key of slide.placeholders || []) {
        const label = body.querySelector(`.field[data-path="${CSS.escape(key)}"] > .field-label`);
        label?.append(h("span", { class: "badge badge-sample", title: "Template sample text, not published" }, "Sample"));
      }
    }
    if (slide.overlays?.length) {
      body.append(section("Overlays", layersSection(slide), h("p", { class: "muted small" }, "Free elements above the template. Use Insert above the slide to add more.")));
    }
    const notesId = nextId();
    const notes = h("textarea", { id: notesId, class: "input notes-input", rows: 5, value: slide.notes || "", placeholder: "What to say on this slide; sources for factual claims.", dataset: { path: "@notes" } });
    notes.addEventListener("input", debounce(() => opQuiet("update_slide", { id: slide.id, notes: notes.value }, { coalesce: `${slide.id}:@notes`, label: "Edit notes" }), 400));
    setters.set("@notes", (v) => { if (document.activeElement !== notes) notes.value = v ?? ""; });
    body.append(section("Speaker notes", h("label", { for: notesId, class: "sr-only" }, "Speaker notes"), notes));

    const navId = nextId();
    const footId = nextId();
    const navTitle = h("input", { id: navId, class: "input", value: slide.title || "", placeholder: "Defaults to the slide headline", dataset: { path: "@title" } });
    navTitle.addEventListener("input", debounce(() => opQuiet("update_slide", { id: slide.id, title: navTitle.value }, { coalesce: `${slide.id}:@title`, label: "Edit slide title" }), 400));
    const footer = h("input", { id: footId, class: "input", value: slide.footer || "", placeholder: state.deck.meta.footer || "Deck footer", dataset: { path: "@footer" } });
    footer.addEventListener("input", debounce(() => opQuiet("update_slide", { id: slide.id, footer: footer.value }, { coalesce: `${slide.id}:@footer`, label: "Edit footer" }), 400));
    const hidden = h("input", { type: "checkbox", class: "switch", id: nextId(), checked: slide.hidden });
    hidden.addEventListener("change", () => opQuiet("set_hidden", { id: slide.id, hidden: hidden.checked }, { label: hidden.checked ? "Hide slide" : "Show slide" }));
    body.append(section("Slide options",
      field("Navigation title", navTitle, { id: navId, hint: "Shown in the slide selector and presenter view." }),
      field("Footer override", footer, { id: footId, hint: "Rich text; leave empty to use the deck footer." }),
      h("div", { class: "field field-inline" }, hidden, h("label", { for: hidden.id }, "Hide this slide in the presentation")),
      h("p", { class: "muted small" }, `Slide id: ${slide.id}`),
    ));
  }

  function refreshValues(slide) {
    const get = (path) => path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), slide.data);
    for (const [path, set] of setters) {
      if (path === "@notes") set(slide.notes);
      else if (path.startsWith("@ov:")) {
        const overlay = slide.overlays?.find((o) => o.id === path.split(":")[1]);
        if (overlay) set(overlay);
      } else set(get(path));
    }
  }

  function update(info = {}) {
    const slide = selectedSlide();
    const key = slide ? structureKey(slide) : null;
    if (slide && key === renderedKey && !info.selection) {
      // Same structure: refresh values without stealing focus.
      refreshValues(slide);
      return;
    }
    const active = document.activeElement;
    const activePath = root.contains(active) ? active.dataset?.path : null;
    const selection = activePath && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = body.scrollTop;
    renderedKey = key;
    render();
    if (!info.selection) body.scrollTop = scroll;
    if (activePath && !info.selection) {
      const again = body.querySelector(`[data-path="${CSS.escape(activePath)}"]:is(input, textarea, select)`);
      if (again) {
        again.focus();
        if (selection && "setSelectionRange" in again) {
          try {
            again.setSelectionRange(...selection);
          } catch {
            /* not supported */
          }
        }
      }
    }
  }

  function revealField(path, { focusAlt = false } = {}) {
    if (path.startsWith("@overlay:")) {
      const id = path.slice("@overlay:".length);
      body.querySelector(`[data-path="@ov:${CSS.escape(id)}:text"]`)?.focus();
      return;
    }
    if (focusAlt) {
      // The inspector re-renders when the image arrives: focus its alt field then.
      const started = Date.now();
      const tryFocus = () => {
        const alt = body.querySelector(`[data-path="${CSS.escape(path)}.alt"]`);
        if (alt) alt.focus();
        else if (Date.now() - started < 2000) setTimeout(tryFocus, 100);
      };
      setTimeout(tryFocus, 50);
    }
    const candidates = [path, path.split(".").slice(0, -1).join("."), path.split(".")[0]];
    for (const candidate of candidates) {
      const el = body.querySelector(`.field[data-path="${CSS.escape(candidate)}"]`);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
        return;
      }
    }
  }

  return { root, update, revealField };
}
