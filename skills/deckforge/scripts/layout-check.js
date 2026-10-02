// deckforge layout check. This file is a function BODY, not a module. Run it inside
// a built deck.html page, for example with the browser canvas "evaluate_javascript"
// action, or with Playwright: page.evaluate(`(async () => { ${body} })()`).
// It lays out every slide at the 1280×720 reference size in its final (static)
// state. It returns JSON listing elements outside their slide, clipped text boxes,
// overlays covering template text (`covering`) or sitting on the painted box around
// a text, such as a bar, pill or card (`overlapping`), and broken images. It changes the page's
// layout, so reload the page afterwards.

const W = 1280;
const H = 720;
const TOLERANCE = 1;
const style = document.createElement("style");
style.textContent = `
  .stage { padding: 0 !important; display: block !important; height: auto !important; }
  .slide, .slide[hidden] { display: block !important; width: ${W}px !important; height: ${H}px !important; margin: 0 0 8px !important; border: 0 !important; flex: none !important; }
  .reveal, .df-overlay > * { animation: none !important; transition: none !important; opacity: 1 !important; }
  .reveal { transform: none !important; }
`;
document.documentElement.classList.remove("presenting");
document.documentElement.classList.add("static");
document.head.append(style);
for (const img of document.images) img.loading = "eager";
if (document.fonts?.ready) await document.fonts.ready;
await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((resolve) => { img.onload = img.onerror = resolve; setTimeout(resolve, 3000); }))));
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const describe = (el) => {
  const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  return `<${el.tagName.toLowerCase()}${cls}>${text ? ` "${text.slice(0, 50)}${text.length > 50 ? "…" : ""}"` : ""}`;
};
const ownTextRects = (el) => {
  const rects = [];
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    rects.push(...range.getClientRects());
  }
  return rects;
};
const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
const outsideOf = (r, box) => r.left < box.left - TOLERANCE || r.top < box.top - TOLERANCE || r.right > box.right + TOLERANCE || r.bottom > box.bottom + TOLERANCE;
const painted = (cs) => !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
// The visible box around a text: its nearest painted container (a bar, pill or card)
// smaller than a quarter of the slide, else the text element itself.
const visualBox = (el, stop) => {
  for (let node = el; node && node !== stop; node = node.parentElement) {
    const r = node.getBoundingClientRect();
    if (r.width * r.height > (W * H) / 4) break;
    if (painted(getComputedStyle(node))) return { element: node, rect: r };
  }
  return { element: el, rect: el.getBoundingClientRect() };
};

const slides = [];
for (const slide of document.querySelectorAll("section.slide")) {
  const box = slide.getBoundingClientRect();
  const inner = slide.querySelector(".slide-inner");
  const outside = [];
  const clipped = [];
  const textRects = [];
  for (const el of inner ? inner.querySelectorAll("*") : []) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || el.closest(".sr-only")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (outsideOf(r, box)) outside.push({ element: describe(el), right: Math.round(r.right - box.right), bottom: Math.round(r.bottom - box.bottom) });
    const clips = /(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY) || cs.textOverflow === "ellipsis";
    if (clips && el.textContent.trim() && (el.scrollHeight > el.clientHeight + TOLERANCE || el.scrollWidth > el.clientWidth + TOLERANCE)) {
      clipped.push({ element: describe(el), hiddenHeight: el.scrollHeight - el.clientHeight, hiddenWidth: el.scrollWidth - el.clientWidth });
    }
    for (const rect of ownTextRects(el)) textRects.push({ element: el, rect });
  }
  const covering = [];
  const overlapping = [];
  for (const ov of slide.querySelectorAll(".df-overlay > [data-ov-id]")) {
    // Unrotated box, as stored in deck.yaml (x, y, w, h).
    const left = box.left + ov.offsetLeft;
    const top = box.top + ov.offsetTop;
    const b = { left, top, right: left + ov.offsetWidth, bottom: top + ov.offsetHeight };
    const hit = textRects.find(({ rect }) => overlap(b, rect));
    if (hit) covering.push({ overlay: ov.dataset.ovId, covers: describe(hit.element) });
    else {
      // No glyph is hidden, but the overlay sits on the box around a text (a bar, pill, label or card).
      const near = textRects.map(({ element }) => visualBox(element, inner)).find(({ rect }) => overlap(b, rect));
      if (near) overlapping.push({ overlay: ov.dataset.ovId, overlaps: describe(near.element) });
    }
    if (outsideOf(b, box)) outside.push({ element: `overlay ${ov.dataset.ovId}`, right: Math.round(b.right - box.right), bottom: Math.round(b.bottom - box.bottom) });
  }
  const brokenImages = [...slide.querySelectorAll("img")].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.getAttribute("src"));
  slides.push({
    id: slide.dataset.slideId,
    template: slide.dataset.template,
    size: `${Math.round(box.width)}×${Math.round(box.height)}`,
    ok: !outside.length && !clipped.length && !covering.length && !overlapping.length && !brokenImages.length,
    outside,
    clipped,
    covering,
    overlapping,
    brokenImages,
  });
}
return { ok: slides.every((s) => s.ok), checked: slides.length, problems: slides.filter((s) => !s.ok), note: "The page layout was changed for measuring: reload it before presenting." };
