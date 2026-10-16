// Deck settings dialog: metadata, brief (agent grounding) and runtime mode.

import { h, icon } from "./dom.js";
import { state } from "./state.js";
import { op } from "./actions.js";
import { aiImprove } from "./improve.js";

export function openSettings() {
  const meta = state.deck.meta;
  const brief = meta.brief || {};
  const fields = {};
  const input = (key, label, value, { type = "text", textarea = false, hint, placeholder, improve } = {}) => {
    const id = `set-${key}`;
    const el = textarea
      ? h("textarea", { id, class: "input", rows: 3, value: value ?? "", placeholder })
      : h("input", { id, class: "input", type, value: value ?? "", placeholder });
    fields[key] = el;
    const control = improve ? aiImprove(el, { key: `@settings:${key}`, context: () => ({ label, description: improve, kind: "deck brief" }) }) : el;
    return h("div", { class: "field" }, h("div", { class: "field-label" }, h("label", { for: id }, label)), control, hint ? h("p", { class: "field-hint" }, hint) : null);
  };
  const runtime = h("select", { id: "set-runtime", class: "input" },
    ["local", "cdn", "inline"].map((m) => h("option", { value: m, selected: (meta.runtime || "local") === m }, m)),
  );
  const sourcesOn = h("input", { type: "checkbox", class: "switch", id: "set-sources-on", checked: meta.sourcesSlide !== false });
  const sourcesTitle = h("input", { id: "set-sourcesSlide", class: "input", value: typeof meta.sourcesSlide === "string" ? meta.sourcesSlide : "", placeholder: "Sources", disabled: meta.sourcesSlide === false });
  sourcesOn.addEventListener("change", () => { sourcesTitle.disabled = !sourcesOn.checked; });
  const form = h("form", { class: "dialog-body settings-grid", onSubmit: (e) => { e.preventDefault(); save(); } },
    h("fieldset", {}, h("legend", {}, "Deck"),
      input("title", "Title", meta.title),
      input("subtitle", "Subtitle", meta.subtitle),
      input("author", "Author", meta.author),
      input("date", "Date", meta.date),
      input("footer", "Footer", meta.footer, { hint: "Rich text shown at the bottom of every slide." }),
      input("lang", "Language", meta.lang, { hint: "BCP 47 code, e.g. en, fr, en-GB." }),
      h("div", { class: "field" }, h("div", { class: "field-label" }, h("label", { for: "set-runtime" }, "Viewer runtime")), runtime,
        h("p", { class: "field-hint" }, "local: copy the viewer next to deck.html · cdn: load it from jsDelivr · inline: one self-contained file.")),
      h("div", { class: "field" },
        h("div", { class: "field field-inline" }, sourcesOn, h("label", { for: "set-sources-on" }, "Add a Sources slide at the end")),
        h("div", { class: "field-label" }, h("label", { for: "set-sourcesSlide" }, "Sources slide title")), sourcesTitle,
        h("p", { class: "field-hint" }, "Built from the sources listed on each slide. Leave the title empty for “Sources”.")),
    ),
    h("fieldset", {}, h("legend", {}, "Brief"), h("p", { class: "muted small" }, "Grounds the Copilot assistant: it designs for this audience and goal."),
      input("topic", "Topic", brief.topic),
      input("audience", "Audience", brief.audience),
      input("goal", "Goal", brief.goal, { textarea: true, improve: "What the audience should think or do after the talk." }),
      input("duration", "Duration", brief.duration, { placeholder: "e.g. 20 minutes" }),
      input("language", "Writing language", brief.language, { placeholder: "e.g. French", hint: "Language the assistant writes the slides in." }),
      input("notes", "Notes", brief.notes, { textarea: true, hint: "Anything else the assistant should know: tone, constraints, things to avoid." }),
      input("sources", "Sources", (brief.sources || []).join("\n"), { textarea: true, hint: "One per line. Only cite sources you are allowed to share." }),
    ),
  );
  const dialog = h("dialog", { class: "dialog settings", "aria-labelledby": "settings-title" },
    h("header", { class: "dialog-head" }, h("h2", { id: "settings-title" }, "Deck settings"),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onClick: () => close() }, icon("close"))),
    form,
    h("footer", { class: "dialog-foot" }, h("span", {}),
      h("div", { class: "row" }, h("button", { type: "button", class: "btn", onClick: () => close() }, "Cancel"), h("button", { type: "button", class: "btn btn-primary", onClick: () => save() }, "Save"))),
  );
  async function save() {
    const value = (k) => fields[k].value.trim();
    const next = {
      title: value("title") || meta.title,
      subtitle: value("subtitle"),
      author: value("author"),
      date: value("date"),
      footer: value("footer"),
      lang: value("lang") || "en",
      runtime: runtime.value,
      sourcesSlide: sourcesOn.checked ? sourcesTitle.value.trim() || null : false,
      brief: {
        topic: value("topic"),
        audience: value("audience"),
        goal: value("goal"),
        duration: value("duration"),
        language: value("language"),
        notes: value("notes"),
        sources: value("sources").split("\n").map((s) => s.trim()).filter(Boolean),
      },
    };
    try {
      await op("update_meta", { meta: next }, { label: "Edit deck settings" });
      close();
    } catch {
      /* toast shown */
    }
  }
  function close() {
    dialog.close();
    dialog.remove();
  }
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
  fields.title.focus();
}
