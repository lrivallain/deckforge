// Template picker dialog with live thumbnails (sample data, current theme).

import { h, icon, writeFrame } from "./dom.js";
import { currentTheme, slideDocument, state } from "./state.js";
import { sampleData } from "../core/template.js";

const CATEGORY_LABELS = { structure: "Structure", diagram: "Diagrams", content: "Content", media: "Images" };

export function pickTemplate({ title = "Choose a template", current = null, confirmLabel = "Use template" } = {}) {
  return new Promise((resolve) => {
    let chosen = current;
    const grid = h("div", { class: "picker-grid" });
    const confirm = h("button", { type: "button", class: "btn btn-primary", disabled: !chosen, onClick: () => close(chosen) }, confirmLabel);
    const dialog = h("dialog", { class: "dialog picker", "aria-labelledby": "picker-title" },
      h("header", { class: "dialog-head" },
        h("h2", { id: "picker-title" }, title),
        h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onClick: () => close(null) }, icon("close")),
      ),
      grid,
      h("footer", { class: "dialog-foot" },
        h("span", { class: "muted" }, "Previews use each template's sample content and the current theme."),
        h("div", { class: "row" }, h("button", { type: "button", class: "btn", onClick: () => close(null) }, "Cancel"), confirm),
      ),
    );
    const groups = {};
    for (const entry of state.templateList) {
      const template = state.templates[entry.name];
      const key = template.category || "content";
      (groups[key] ||= []).push(template);
    }
    const deck = { meta: { ...state.deck.meta }, slides: [] };
    for (const key of ["structure", "diagram", "content", "media", ...Object.keys(groups)]) {
      const list = groups[key];
      if (!list) continue;
      delete groups[key];
      grid.append(h("h3", { class: "picker-group" }, CATEGORY_LABELS[key] || key));
      for (const template of list) {
        const frame = h("iframe", { class: "thumb-frame", tabindex: "-1", "aria-hidden": "true", loading: "lazy" });
        const card = h("button", {
          type: "button",
          class: `picker-card${template.name === chosen ? " is-selected" : ""}`,
          "aria-pressed": template.name === chosen ? "true" : "false",
          dataset: { template: template.name },
          onClick: () => {
            chosen = template.name;
            for (const el of grid.querySelectorAll(".picker-card")) {
              el.classList.toggle("is-selected", el === card);
              el.setAttribute("aria-pressed", el === card ? "true" : "false");
            }
            confirm.disabled = false;
          },
          onDblclick: () => close(template.name),
        },
          h("span", { class: "thumb" }, frame),
          h("span", { class: "picker-label" }, template.label, template.scope !== "builtin" ? h("span", { class: "badge" }, template.scope) : null),
          h("span", { class: "picker-desc" }, template.description),
        );
        grid.append(card);
        const slide = { id: `preview-${template.name}`, template: template.name, data: sampleData(template), notes: "", hidden: false };
        requestAnimationFrame(() => writeFrame(frame, slideDocument(slide, { deck: { ...deck, slides: [slide] }, theme: currentTheme() })));
      }
    }
    function close(value) {
      dialog.close();
      dialog.remove();
      resolve(value);
    }
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    document.body.append(dialog);
    dialog.showModal();
    (grid.querySelector(".is-selected") || grid.querySelector(".picker-card"))?.focus();
  });
}
