// deck → static HTML.

import { escapeAttr, escapeHtml, textToHtml } from "./html.js";
import { renderTemplate } from "./template.js";
import { publishedData, slideTitle } from "./deck.js";

export const VERSION = "0.1.0";
export const CDN_BASE = "https://cdn.jsdelivr.net/gh/lrivallain/deckforge";

export function cdnBase(version = VERSION) {
  return `${CDN_BASE}@v${version}/dist/`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function missingTemplate(name) {
  return {
    name: "missing",
    classes: [],
    scopedCss: "",
    slots: {},
    ast: null,
    render: () => `<div class="df-missing"><p class="eyebrow">Missing template</p><h1>Template “${escapeHtml(name)}” was not found</h1><p>Create it in templates/ or pick another template.</p></div>`,
  };
}

/** Render one slide <section>. */
export function renderSlide(deck, slide, { index, total, templates, edit = false, includePlaceholders = false }) {
  const template = templates[slide.template] || missingTemplate(slide.template);
  const titleId = `${slide.id}-title`;
  const title = slideTitle(slide, templates[slide.template]);
  const ctx = {
    edit,
    placeholders: new Set(includePlaceholders ? slide.placeholders || [] : []),
    slide: {
      id: slide.id,
      index: String(index),
      number: pad(index + 1),
      total: pad(total),
      titleId,
      title,
      footer: slide.footer ?? deck.meta.footer ?? "",
    },
    deck: {
      title: deck.meta.title,
      subtitle: deck.meta.subtitle ?? "",
      author: deck.meta.author ?? "",
      date: deck.meta.date ?? "",
      footer: deck.meta.footer ?? "",
      lang: deck.meta.lang,
    },
  };
  let inner;
  try {
    // Sample text is an editor-only placeholder: never publish it.
    inner = template.ast ? renderTemplate(template, includePlaceholders ? slide.data : publishedData(slide), ctx) : template.render();
  } catch (err) {
    inner = `<div class="df-missing"><p class="eyebrow">Render error</p><h1>${escapeHtml(err.message)}</h1></div>`;
  }
  const classes = ["slide", `df-t-${template.name}`, ...template.classes].join(" ");
  const labelled = inner.includes(`id="${titleId}"`) ? `aria-labelledby="${escapeAttr(titleId)}"` : `aria-label="${escapeAttr(title)}"`;
  const notes = slide.notes ? `\n  <aside class="slide-notes" hidden aria-label="Speaker notes">${slide.notes.split(/\n{2,}/).map((p) => `<p>${textToHtml(p.trim())}</p>`).join("")}</aside>` : "";
  return `<section class="${escapeAttr(classes)}" id="slide-${escapeAttr(slide.id)}" data-slide-id="${escapeAttr(slide.id)}" data-template="${escapeAttr(slide.template)}" data-title="${escapeAttr(title)}" ${labelled}>
  <div class="slide-inner">
${inner.trim()}
  </div>${notes}
</section>`;
}

export function visibleSlides(deck) {
  return deck.slides.filter((s) => !s.hidden);
}

export function collectTemplateCss(slides, templates) {
  const seen = new Set();
  const css = [];
  for (const slide of slides) {
    const template = templates[slide.template];
    if (!template || seen.has(template.name)) continue;
    seen.add(template.name);
    if (template.scopedCss) css.push(`/* template: ${template.name} */\n${template.scopedCss}`);
  }
  return css.join("\n");
}

const CONTROLS = `<nav class="controls" aria-label="Slide controls" hidden>
  <button id="df-previous" type="button" aria-label="Previous slide">Previous</button>
  <label class="sr-only" for="df-slide-select">Choose a slide</label>
  <select id="df-slide-select"></select>
  <button id="df-next" type="button" aria-label="Next slide">Next</button>
  <span class="controls-sep" aria-hidden="true"></span>
  <button id="df-static" type="button" aria-pressed="false" title="Disable animations (S)">Static</button>
  <button id="df-notes" type="button" aria-pressed="false" title="Show speaker notes (N)">Notes</button>
  <button id="df-presenter" type="button" title="Open presenter view (P)">Presenter</button>
  <button id="df-fullscreen" type="button" aria-pressed="false" title="Fullscreen (F)">Fullscreen</button>
  <span id="df-announcement" class="sr-only" role="status" aria-live="polite"></span>
</nav>`;

function safeInlineScript(js) {
  return String(js).replace(/<\/(script)/gi, "<\\/$1");
}

function safeInlineStyle(css) {
  return String(css).replace(/<\/(style)/gi, "<\\/$1");
}

/**
 * Render a complete static deck.html.
 * @param {object} deck normalized deck
 * @param {object} opts { templates, theme, runtime: local|cdn|inline, assets: {css, js}, assetBase, version }
 */
export function renderDeck(deck, opts) {
  const { templates, theme, runtime = "local", assets = {}, version = VERSION } = opts;
  const slides = visibleSlides(deck);
  const sections = slides.map((slide, index) => renderSlide(deck, slide, { index, total: slides.length, templates })).join("\n");
  let cssTag;
  let jsTag;
  if (runtime === "inline") {
    cssTag = `<style id="df-runtime">\n${safeInlineStyle(assets.css ?? "")}\n</style>`;
    jsTag = `<script data-df-runtime>\n${safeInlineScript(assets.js ?? "")}\n</script>`;
  } else {
    const base = runtime === "cdn" ? cdnBase(version) : opts.assetBase ?? "deckforge/";
    cssTag = `<link rel="stylesheet" href="${escapeAttr(base)}deckforge.viewer.css">`;
    jsTag = `<script src="${escapeAttr(base)}deckforge.viewer.js" defer></script>`;
  }
  const description = deck.meta.description || deck.meta.brief?.goal || "";
  return `<!doctype html>
<html lang="${escapeAttr(deck.meta.lang)}" data-theme="${escapeAttr(theme?.name ?? "")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="deckforge ${escapeAttr(version)}">
  <title>${escapeHtml(deck.meta.title)}</title>${description ? `\n  <meta name="description" content="${escapeAttr(description)}">` : ""}
  ${cssTag}
  <style id="df-theme">
${safeInlineStyle(theme?.css ?? "")}
  </style>
  <style id="df-templates">
${safeInlineStyle(collectTemplateCss(slides, templates))}
  </style>
</head>
<body>
  <noscript><p class="no-script">All slides are shown below. Use the browser's print command for a PDF.</p></noscript>
  <main class="stage" aria-label="${escapeAttr(deck.meta.title)}">
${sections}
  </main>
  ${CONTROLS}
  ${jsTag}
</body>
</html>
`;
}

/**
 * Render a standalone document showing one slide at its 1280×720 reference
 * size (used by the editor preview, thumbnails and the template editor).
 */
export function renderSlideDocument(deck, slide, { templates, theme, viewerCssHref, viewerCss, edit = false, index = 0, total = 1, extraHead = "" }) {
  const template = templates[slide.template];
  return `<!doctype html>
<html lang="${escapeAttr(deck.meta.lang)}" class="df-frame${edit ? " df-edit" : ""}">
<head>
  <meta charset="utf-8">
  ${viewerCss != null ? `<style>${safeInlineStyle(viewerCss)}</style>` : `<link rel="stylesheet" href="${escapeAttr(viewerCssHref)}">`}
  <style>${safeInlineStyle(theme?.css ?? "")}</style>
  <style>${safeInlineStyle(template?.scopedCss ?? "")}</style>
  ${extraHead}
</head>
<body>
${renderSlide(deck, slide, { index, total, templates, edit, includePlaceholders: true })}
</body>
</html>`;
}
