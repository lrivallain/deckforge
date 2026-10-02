// Measure a built deck.html (laid out in a real browser) into a plain slide
// model for the PPTX writer: native shapes, text boxes with styled runs,
// images and vector (SVG) pictures, in 1280×720 reference px.
//
// It runs against any same-origin Document: the page itself (CLI, through
// Playwright) or a hidden iframe (editor). It never uses `instanceof` across
// frames and reads styles from the document's own window.

import {
  SLIDE_W,
  applyTextTransform,
  backgroundLayers,
  fontFamilies,
  gradientSvg,
  intersect,
  normalizeRuns,
  parseBoxShadow,
  parseColor,
  parseGradient,
  parseObjectPosition,
  pickFont,
  polygonSvg,
  rotateItems,
  rotationOf,
  whiteSpaceMode,
} from "./model.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Lays every slide out at 1280×720 in its final (static) state, like the layout check. */
export const STATIC_CSS = `
  html, body { background: transparent !important; }
  .stage { padding: 0 !important; display: block !important; height: auto !important; }
  .slide, .slide[hidden] { display: block !important; width: ${SLIDE_W}px !important; height: 720px !important; margin: 0 0 8px !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; flex: none !important; }
  .reveal, .df-overlay > * { animation: none !important; transition: none !important; opacity: 1 !important; }
  .reveal { transform: none !important; }
  .controls, .notes-panel { display: none !important; }
`;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META", "TITLE", "HEAD"]);
const REPLACED = new Set(["IMG", "SVG", "CANVAS", "VIDEO", "IFRAME", "OBJECT", "EMBED", "PICTURE", "AUDIO", "INPUT", "SELECT", "TEXTAREA", "BUTTON"]);
const PARAGRAPH_DISPLAYS = new Set(["block", "list-item", "flow-root", "table-caption"]);
const SVG_PROPS = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "opacity", "font-family", "font-size", "font-weight",
  "font-style", "text-anchor", "dominant-baseline", "letter-spacing",
];
const PPTX_IMAGE_TYPES = /^image\/(png|jpe?g|gif|svg\+xml)$/i;

/** Put the document in its final static 1280×720 state and wait for fonts and images. */
export async function prepareDocument(doc) {
  const win = doc.defaultView;
  doc.documentElement.classList.remove("presenting");
  doc.documentElement.classList.add("static");
  if (!doc.getElementById("df-export-static")) {
    const style = doc.createElement("style");
    style.id = "df-export-static";
    style.textContent = STATIC_CSS;
    doc.head.append(style);
  }
  for (const slide of doc.querySelectorAll("section.slide")) slide.classList.add("entered");
  for (const img of doc.images) img.loading = "eager";
  if (doc.fonts?.ready) await doc.fonts.ready;
  await Promise.all([...doc.images].map((img) => (img.complete ? null : new Promise((resolve) => {
    img.addEventListener("load", resolve, { once: true });
    img.addEventListener("error", resolve, { once: true });
    win.setTimeout(resolve, 5000);
  }))));
  // Reading geometry forces a synchronous layout. Do not wait for animation
  // frames: WebKit throttles them in off-screen iframes (~10 s per frame).
  void doc.body?.offsetHeight;
  await new Promise((resolve) => win.setTimeout(resolve, 30));
}

/**
 * Measure every slide of a prepared deck document.
 * @returns {Promise<{ title, lang, slides: object[], warnings: string[] }>}
 */
export async function measureDeck(doc) {
  const m = new Measurer(doc);
  const slides = [];
  const sections = [...doc.querySelectorAll("section.slide")];
  for (let i = 0; i < sections.length; i++) slides.push(m.measureSlide(sections[i], i));
  await Promise.all(m.pending);
  for (const slide of slides) slide.items = slide.items.filter((item) => item.kind !== "image" || item.data);
  const warnings = [...m.warnings];
  for (const [wanted, used] of m.substitutions) warnings.push(`Font "${wanted}" is not available in this browser: the PowerPoint file uses "${used}" (what the deck showed here).`);
  return {
    title: doc.title || "",
    lang: doc.documentElement.lang || "en",
    slides,
    warnings,
  };
}

class Measurer {
  constructor(doc) {
    this.doc = doc;
    this.win = doc.defaultView;
    this.pending = [];
    this.warnings = new Set();
    this.substitutions = new Map();
    this.fontCache = new Map();
    this.canvas = doc.createElement("canvas");
  }

  cs(el, pseudo) {
    return this.win.getComputedStyle(el, pseudo);
  }

  warn(slide, message) {
    this.warnings.add(`Slide ${slide.index + 1}${slide.title ? ` (${slide.title})` : ""}: ${message}`);
  }

  // ------------------------------------------------------------- slides

  measureSlide(section, index) {
    const rect = section.getBoundingClientRect();
    const scale = rect.width / SLIDE_W || 1;
    const cs = this.cs(section);
    const slide = {
      index,
      id: section.dataset.slideId || `slide-${index + 1}`,
      title: section.dataset.title || "",
      background: parseColor(cs.backgroundColor),
      notes: this.notes(section),
      items: [],
    };
    const ctx = { slide, origin: rect, scale, opacity: 1, clip: { x: 0, y: 0, w: SLIDE_W, h: 720 }, link: null };
    if (slide.background && slide.background.alpha === 0) slide.background = null;
    // The slide's own background image or gradient (its border/shadow are frame chrome).
    this.paintBackgroundImages(cs, { x: 0, y: 0, w: SLIDE_W, h: 720 }, ctx, slide.items, 0);
    for (const child of section.children) {
      if (child.classList.contains("slide-notes")) continue;
      this.walk(child, ctx, slide.items);
    }
    return slide;
  }

  notes(section) {
    const aside = section.querySelector(":scope > .slide-notes");
    if (!aside) return "";
    const paragraphs = [...aside.querySelectorAll("p")];
    const text = (node) => [...node.childNodes].map((n) => (n.nodeType === 3 ? n.nodeValue : n.nodeName === "BR" ? "\n" : text(n))).join("");
    return (paragraphs.length ? paragraphs.map(text) : [text(aside)]).map((p) => p.trim()).filter(Boolean).join("\n\n");
  }

  rel(r, ctx) {
    return {
      x: (r.left - ctx.origin.left) / ctx.scale,
      y: (r.top - ctx.origin.top) / ctx.scale,
      w: r.width / ctx.scale,
      h: r.height / ctx.scale,
    };
  }

  // ------------------------------------------------------------- tree walk

  skip(el, cs) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return true;
    if (parseFloat(cs.opacity) === 0) return true;
    if (el.classList?.contains("sr-only") || /^inset\(50%/.test(cs.clipPath)) return true;
    return false;
  }

  walk(el, ctx, out) {
    const cs = this.cs(el);
    if (this.skip(el, cs)) return;
    const angle = rotationOf(cs.rotate, cs.transform);
    if (!angle) return this.walkInner(el, cs, ctx, out);
    // Measure unrotated, then turn every item around the element's centre.
    const saved = { rotate: el.style.getPropertyValue("rotate"), rotateP: el.style.getPropertyPriority("rotate"), transform: el.style.getPropertyValue("transform"), transformP: el.style.getPropertyPriority("transform") };
    el.style.setProperty("rotate", "none", "important");
    if (rotationOf("none", cs.transform)) el.style.setProperty("transform", "none", "important");
    const box = this.rel(el.getBoundingClientRect(), ctx);
    const sub = [];
    this.walkInner(el, this.cs(el), { ...ctx, clip: null }, sub);
    el.style.setProperty("rotate", saved.rotate, saved.rotateP);
    el.style.setProperty("transform", saved.transform, saved.transformP);
    out.push(...rotateItems(sub, box.x + box.w / 2, box.y + box.h / 2, angle));
  }

  walkInner(el, cs, parentCtx, out) {
    const ctx = { ...parentCtx, opacity: parentCtx.opacity * parseFloat(cs.opacity || 1) };
    if (el.tagName === "A" && el.getAttribute("href")) ctx.link = linkTarget(el) ?? ctx.link;
    const box = this.rel(el.getBoundingClientRect(), ctx);
    const tag = el.tagName.toUpperCase();
    if (tag === "SVG") {
      if (box.w > 0 && box.h > 0) out.push(this.vector(el, box, ctx));
      return;
    }
    if (tag === "IMG") {
      this.image(el, cs, box, ctx, out);
      return;
    }
    if (REPLACED.has(tag)) {
      if (box.w > 0 && box.h > 0) this.warn(ctx.slide, `<${el.tagName.toLowerCase()}> elements are not exported.`);
      return;
    }
    this.paint(el, cs, box, ctx, out);
    this.pseudoBox(el, "::before", cs, box, ctx, out);
    if (this.isTextBlock(el, cs)) {
      const text = this.textBlock(el, cs, box, ctx);
      if (text) out.push(text);
    } else {
      let childCtx = ctx;
      let clipped = false;
      if (/(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY)) {
        const pad = this.paddingBox(box, cs);
        const clip = ctx.clip ? intersect(ctx.clip, pad) : pad;
        clipped = !clip || clip.w <= 0 || clip.h <= 0;
        childCtx = { ...ctx, clip };
      }
      for (const child of clipped ? [] : el.childNodes) {
        if (child.nodeType === 1) this.walk(child, childCtx, out);
        else if (child.nodeType === 3 && child.nodeValue.trim()) {
          const text = this.looseText(child, cs, ctx);
          if (text) out.push(text);
        }
      }
    }
    this.pseudoBox(el, "::after", cs, box, ctx, out);
  }

  paddingBox(box, cs) {
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;
    return { x: box.x + bl, y: box.y + bt, w: Math.max(0, box.w - bl - br), h: Math.max(0, box.h - bt - bb) };
  }

  contentBox(box, cs) {
    const p = this.paddingBox(box, cs);
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pt = parseFloat(cs.paddingTop) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const pb = parseFloat(cs.paddingBottom) || 0;
    return { x: p.x + pl, y: p.y + pt, w: Math.max(0, p.w - pl - pr), h: Math.max(0, p.h - pt - pb) };
  }

  // ------------------------------------------------------------- painted boxes

  isPainted(cs) {
    const bg = parseColor(cs.backgroundColor);
    if (bg && bg.alpha > 0) return true;
    if (backgroundLayers(cs.backgroundImage).length) return true;
    if (cs.boxShadow && cs.boxShadow !== "none") return true;
    return ["Top", "Right", "Bottom", "Left"].some((side) => this.border(cs, side));
  }

  border(cs, side) {
    const width = parseFloat(cs[`border${side}Width`]) || 0;
    const style = cs[`border${side}Style`];
    const color = parseColor(cs[`border${side}Color`]);
    if (width <= 0 || !color || color.alpha === 0 || style === "none" || style === "hidden") return null;
    return { width, style, hex: color.hex, alpha: color.alpha, dash: style === "dashed" ? "dash" : style === "dotted" ? "sysDot" : undefined };
  }

  radius(cs, box) {
    const raw = String(cs.borderTopLeftRadius || "0").split(/\s+/)[0];
    const corners = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
    if (raw.endsWith("%")) {
      const pct = parseFloat(raw);
      if (pct >= 50 && corners.every((c) => c === corners[0])) return { ellipse: true, px: Math.min(box.w, box.h) / 2 };
      return { ellipse: false, px: (pct / 100) * Math.min(box.w, box.h) };
    }
    const px = parseFloat(raw) || 0;
    return { ellipse: false, px: Math.min(px, Math.min(box.w, box.h) / 2) };
  }

  paint(el, cs, box, ctx, out) {
    if (box.w <= 0 || box.h <= 0) return;
    const clip = String(cs.clipPath || "none");
    const bg = parseColor(cs.backgroundColor);
    const fill = bg && bg.alpha * ctx.opacity > 0 ? { hex: bg.hex, alpha: bg.alpha * ctx.opacity } : null;
    if (clip.startsWith("polygon(")) {
      // Arrowheads and other clipped shapes: a vector polygon.
      if (fill) {
        const svg = polygonSvg(clip, box.w, box.h, fill);
        if (svg) out.push({ kind: "vector", ...box, svg, name: "Shape" });
      }
      return;
    }
    if (clip !== "none") this.warn(ctx.slide, `clip-path "${clip.slice(0, 40)}" is ignored.`);
    const sides = ["Top", "Right", "Bottom", "Left"].map((side) => this.border(cs, side));
    const uniform = sides.every((s) => s && s.width === sides[0].width && s.style === sides[0].style && s.hex === sides[0].hex && s.alpha === sides[0].alpha) ? sides[0] : null;
    const radius = this.radius(cs, box);
    const shadow = parseBoxShadow(cs.boxShadow);
    const layers = backgroundLayers(cs.backgroundImage);
    const geom = radius.ellipse ? "ellipse" : radius.px > 0.5 ? "roundRect" : "rect";
    const line = uniform ? { hex: uniform.hex, alpha: uniform.alpha * ctx.opacity, width: uniform.width, dash: uniform.dash } : null;
    const inset = uniform ? uniform.width / 2 : 0;
    const shapeBox = { x: box.x + inset, y: box.y + inset, w: Math.max(0.5, box.w - 2 * inset), h: Math.max(0.5, box.h - 2 * inset) };
    const shape = (props) => ({ kind: "shape", geom, ...shapeBox, radius: Math.max(0, radius.px - inset), fill: null, line: null, ...props });
    if (layers.length) {
      if (fill || shadow) out.push(shape({ fill, shadow: shadow && { ...shadow, color: { ...shadow.color, alpha: shadow.color.alpha * ctx.opacity } } }));
      this.paintBackgroundImages(cs, box, ctx, out, radius.px);
      if (line) out.push(shape({ line }));
    } else if (fill || line) {
      out.push(shape({ fill, line, shadow: shadow && { ...shadow, color: { ...shadow.color, alpha: shadow.color.alpha * ctx.opacity } } }));
    }
    if (!uniform) {
      const [top, right, bottom, left] = sides;
      const lineItem = (s, x1, y1, x2, y2) => ({ kind: "line", x1, y1, x2, y2, hex: s.hex, alpha: s.alpha * ctx.opacity, width: s.width, dash: s.dash });
      if (top) out.push(lineItem(top, box.x, box.y + top.width / 2, box.x + box.w, box.y + top.width / 2));
      if (bottom) out.push(lineItem(bottom, box.x, box.y + box.h - bottom.width / 2, box.x + box.w, box.y + box.h - bottom.width / 2));
      if (left) out.push(lineItem(left, box.x + left.width / 2, box.y, box.x + left.width / 2, box.y + box.h));
      if (right) out.push(lineItem(right, box.x + box.w - right.width / 2, box.y, box.x + box.w - right.width / 2, box.y + box.h));
    }
  }

  /** Gradients become vector pictures; url() images become pictures (cover/contain/stretch). */
  paintBackgroundImages(cs, box, ctx, out, radius) {
    const layers = backgroundLayers(cs.backgroundImage);
    // CSS paints the first layer on top.
    for (const layer of [...layers].reverse()) {
      if (/gradient\(/.test(layer)) {
        const gradient = parseGradient(layer, box.w, box.h);
        if (!gradient) {
          this.warn(ctx.slide, `a background "${layer.slice(0, 40)}…" is not supported and was left out.`);
          continue;
        }
        if (ctx.opacity < 1) for (const s of gradient.stops) s.alpha *= ctx.opacity;
        out.push({ kind: "vector", ...box, svg: gradientSvg(gradient, box.w, box.h, radius), name: "Gradient" });
        continue;
      }
      const url = /^url\(["']?(.*?)["']?\)$/.exec(layer)?.[1];
      if (!url) continue;
      const size = String(cs.backgroundSize || "auto");
      const fit = size.startsWith("cover") ? "cover" : size.startsWith("contain") ? "contain" : "fill";
      const item = { kind: "image", ...box, fit, position: parseObjectPosition(cs.backgroundPosition), clip: ctx.clip, radius, alt: "", link: ctx.link, opacity: ctx.opacity };
      out.push(item);
      this.loadImage(item, new URL(url, this.doc.baseURI).href, null, ctx);
    }
  }

  /** Absolutely positioned ::before/::after boxes (bullets, quote marks, scrims). */
  pseudoBox(el, which, cs, box, ctx, out) {
    const pcs = this.cs(el, which);
    const content = pcs.content;
    if (!content || content === "none" || content === "normal" || pcs.display === "none") return;
    if (pcs.position !== "absolute" && pcs.position !== "fixed") return; // inline pseudos are text runs
    const pad = this.paddingBox(box, cs);
    const num = (v) => (v === "auto" ? null : parseFloat(v));
    const [left, right, top, bottom] = [num(pcs.left), num(pcs.right), num(pcs.top), num(pcs.bottom)];
    let w = num(pcs.width);
    let h = num(pcs.height);
    if (!Number.isFinite(w)) w = left !== null && right !== null ? pad.w - left - right : 0;
    if (!Number.isFinite(h)) h = top !== null && bottom !== null ? pad.h - top - bottom : 0;
    const ml = parseFloat(pcs.marginLeft) || 0;
    const mt = parseFloat(pcs.marginTop) || 0;
    const x = left !== null ? pad.x + left + ml : right !== null ? pad.x + pad.w - right - w : pad.x;
    const y = top !== null ? pad.y + top + mt : bottom !== null ? pad.y + pad.h - bottom - h : pad.y;
    const pbox = { x, y, w, h };
    this.paint(el, pcs, pbox, ctx, out);
    const text = stringContent(content);
    if (text) {
      const style = this.runStyle(pcs, ctx);
      const size = parseFloat(pcs.fontSize) || 16;
      const lh = parseFloat(pcs.lineHeight) || size * 1.2;
      const tbox = { x, y, w: w || size * 0.7 * [...text].length, h: h || lh };
      out.push({ kind: "text", ...tbox, wrap: false, paragraphs: [{ align: alignOf(pcs), lineHeight: parseFloat(pcs.lineHeight) || null, runs: [{ text: applyTextTransform(text, pcs.textTransform), style }] }] });
    }
  }

  // ------------------------------------------------------------- pictures

  vector(svg, box, ctx) {
    const clone = svg.cloneNode(true);
    const src = [svg, ...svg.querySelectorAll("*")];
    const dst = [clone, ...clone.querySelectorAll("*")];
    for (let i = 0; i < src.length; i++) {
      const cs = this.cs(src[i]);
      dst[i].setAttribute("style", SVG_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";"));
      dst[i].removeAttribute("class");
    }
    if (ctx.opacity < 1) clone.style.setProperty("opacity", String(ctx.opacity * (parseFloat(this.cs(svg).opacity) || 1)));
    clone.setAttribute("xmlns", SVG_NS);
    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${box.w} ${box.h}`);
    // A larger intrinsic size gives PowerPoint a sharp PNG fallback.
    const k = Math.max(2, Math.min(8, 256 / Math.max(box.w, box.h)));
    clone.setAttribute("width", String(Math.round(box.w * k)));
    clone.setAttribute("height", String(Math.round(box.h * k)));
    const label = svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent || "";
    return { kind: "vector", ...box, svg: new this.win.XMLSerializer().serializeToString(clone), alt: label, name: "Icon", link: ctx.link };
  }

  image(img, cs, box, ctx, out) {
    if (box.w <= 0 || box.h <= 0) return;
    const src = img.currentSrc || img.src;
    if (!src) return;
    const radius = this.radius(cs, box).px || this.clipRadius(img, ctx);
    const item = {
      kind: "image",
      ...box,
      fit: cs.objectFit || "fill",
      position: parseObjectPosition(cs.objectPosition),
      clip: ctx.clip,
      radius,
      alt: img.getAttribute("alt") || "",
      link: ctx.link,
      opacity: ctx.opacity,
      natural: img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null,
    };
    out.push(item);
    this.loadImage(item, src, img, ctx);
  }

  /** Rounded corners of the nearest clipping ancestor whose box matches the image (e.g. .media frames). */
  clipRadius(img, ctx) {
    const r = img.getBoundingClientRect();
    for (let node = img.parentElement; node && !node.matches("section.slide"); node = node.parentElement) {
      const cs = this.cs(node);
      if (!/(hidden|clip)/.test(cs.overflowX + cs.overflowY)) continue;
      const nr = node.getBoundingClientRect();
      if (Math.abs(nr.left - r.left) > 3 * ctx.scale || Math.abs(nr.top - r.top) > 3 * ctx.scale || Math.abs(nr.width - r.width) > 6 * ctx.scale) return 0;
      return this.radius(cs, this.rel(nr, ctx)).px;
    }
    return 0;
  }

  loadImage(item, src, img, ctx) {
    this.pending.push((async () => {
      try {
        const loaded = await this.imageData(src, img);
        item.data = loaded.data;
        item.natural = item.natural || loaded.natural;
      } catch (err) {
        this.warn(ctx.slide, `image ${shortSrc(src)} could not be read (${err.message}) and was left out.`);
      }
    })());
  }

  async imageData(src, img) {
    let blob = null;
    try {
      const res = await this.win.fetch(src);
      if (res.ok) blob = await res.blob();
    } catch {
      /* file:// or opaque origins: fall back to the decoded image below */
    }
    const type = blob?.type || /^data:([^;,]+)/.exec(src)?.[1] || "";
    if (blob && /^image\/svg\+xml/i.test(type)) {
      const svg = sizedSvg(await blob.text(), img, this.win);
      return { data: `data:image/svg+xml;base64,${utf8Base64(svg, this.win)}`, natural: null };
    }
    if (blob && PPTX_IMAGE_TYPES.test(type)) {
      const data = await readAsDataUrl(blob, this.win);
      const natural = img?.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : await naturalSize(data, this.win);
      return { data: data.replace(/^data:image\/jpg/i, "data:image/jpeg"), natural };
    }
    // WebP, AVIF, BMP…: PowerPoint may not read them, so re-encode as PNG.
    const source = img?.complete && img.naturalWidth ? img : await loadImageElement(blob ? await readAsDataUrl(blob, this.win) : src, this.win);
    const canvas = this.doc.createElement("canvas");
    canvas.width = source.naturalWidth;
    canvas.height = source.naturalHeight;
    canvas.getContext("2d").drawImage(source, 0, 0);
    return { data: canvas.toDataURL("image/png"), natural: { w: source.naturalWidth, h: source.naturalHeight } };
  }

  // ------------------------------------------------------------- text

  /** An element whose whole content is flowing text (inline runs and plain paragraphs). */
  isTextBlock(el, cs) {
    if (/flex|grid|table/.test(cs.display) && cs.display !== "table-cell") return false;
    if (!el.textContent.trim()) return false;
    for (const d of el.querySelectorAll("*")) {
      const dcs = this.cs(d);
      if (dcs.display === "none") continue;
      if (REPLACED.has(d.tagName.toUpperCase()) || d.namespaceURI === SVG_NS) return false;
      if (/flex|grid|table/.test(dcs.display)) return false;
      if (dcs.position === "absolute" || dcs.position === "fixed" || dcs.float !== "none") return false;
      if (this.isPainted(dcs) || rotationOf(dcs.rotate, dcs.transform)) return false;
      if (d.classList.contains("sr-only")) return false;
      for (const which of ["::before", "::after"]) {
        const pcs = this.cs(d, which);
        if (pcs.content && pcs.content !== "none" && pcs.content !== "normal" && (pcs.position === "absolute" || this.isPainted(pcs))) return false;
      }
    }
    return true;
  }

  textBlock(el, cs, box, ctx) {
    const paragraphs = [];
    let current = null;
    const ensure = (pcs) => {
      if (!current) current = { align: alignOf(pcs), lineHeight: lineHeightOf(pcs), spaceBefore: 0, spaceAfter: 0, runs: [] };
      return current;
    };
    const flush = () => {
      if (!current) return;
      current.runs = normalizeRuns(current.runs);
      if (current.runs.length) paragraphs.push(current);
      current = null;
    };
    const pushText = (text, ecs, rctx, blockCs) => {
      const mode = whiteSpaceMode(ecs.whiteSpace);
      const style = this.runStyle(ecs, rctx);
      const transformed = applyTextTransform(text, ecs.textTransform);
      const parts = mode.keepNewlines ? transformed.split("\n") : [transformed];
      parts.forEach((part, i) => {
        ensure(blockCs).runs.push({ text: part, style, softBreak: i > 0, collapse: mode.collapseSpaces });
      });
    };
    const pseudoRun = (node, which, ecs, rctx, blockCs) => {
      const pcs = this.cs(node, which);
      const text = stringContent(pcs.content);
      if (text && pcs.display !== "none" && pcs.position !== "absolute") pushText(text, pcs, rctx, blockCs);
    };
    const visit = (node, ecs, rctx, blockCs) => {
      pseudoRun(node, "::before", ecs, rctx, blockCs);
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          pushText(child.nodeValue, ecs, rctx, blockCs);
          continue;
        }
        if (child.nodeType !== 1) continue;
        const ccs = this.cs(child);
        if (this.skip(child, ccs)) continue;
        if (child.tagName === "BR") {
          ensure(blockCs).runs.push({ text: "", style: this.runStyle(ecs, rctx), softBreak: true });
          continue;
        }
        const cctx = child.tagName === "A" && child.getAttribute("href") ? { ...rctx, link: linkTarget(child) ?? rctx.link } : rctx;
        const opacityCtx = { ...cctx, opacity: cctx.opacity * parseFloat(ccs.opacity || 1) };
        if (PARAGRAPH_DISPLAYS.has(ccs.display)) {
          flush();
          ensure(ccs).spaceBefore = parseFloat(ccs.marginTop) || 0;
          visit(child, ccs, opacityCtx, ccs);
          const last = current || paragraphs[paragraphs.length - 1];
          if (last) last.spaceAfter = parseFloat(ccs.marginBottom) || 0;
          flush();
        } else visit(child, ccs, opacityCtx, blockCs);
      }
      pseudoRun(node, "::after", ecs, rctx, blockCs);
    };
    visit(el, cs, ctx, cs);
    flush();
    if (!paragraphs.length) return null;
    return this.textItem(el, cs, box, paragraphs, ctx);
  }

  /** A text node directly inside a flex/grid container (an anonymous box). */
  looseText(node, parentCs, ctx) {
    const range = this.doc.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return null;
    const mode = whiteSpaceMode(parentCs.whiteSpace);
    const runs = normalizeRuns([{ text: applyTextTransform(node.nodeValue, parentCs.textTransform), style: this.runStyle(parentCs, ctx), collapse: mode.collapseSpaces }]);
    if (!runs.length) return null;
    const box = this.rel(unionRect(rects), ctx);
    return this.finishText(box, [{ align: alignOf(parentCs), lineHeight: lineHeightOf(parentCs), spaceBefore: 0, spaceAfter: 0, runs }], lineCount(rects));
  }

  /** Line-box fragments of the text itself (element boxes would span several lines). */
  textRects(el) {
    const rects = [];
    const walker = this.doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    const range = this.doc.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue.trim()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) rects.push(r);
    }
    return rects;
  }

  textItem(el, cs, box, paragraphs, ctx) {
    const rects = this.textRects(el);
    let area = this.contentBox(box, cs);
    if (rects.length) {
      // Overflowing text (nowrap, negative margins) still belongs to the box.
      const u = this.rel(unionRect(rects), ctx);
      const x = Math.min(area.x, u.x);
      const y = Math.min(area.y, u.y);
      area = { x, y, w: Math.max(area.x + area.w, u.x + u.w) - x, h: Math.max(area.y + area.h, u.y + u.h) - y };
    }
    return this.finishText(area, paragraphs, lineCount(rects));
  }

  finishText(area, paragraphs, lines) {
    const breaks = paragraphs.reduce((n, p) => n + p.runs.filter((r) => r.softBreak).length, 0);
    // Every paragraph on one line: keep it on one line in PowerPoint too, whatever its font metrics.
    const wrap = lines > paragraphs.length + breaks;
    let { x, w } = area;
    if (wrap) {
      // A little slack so a font that sets slightly wider does not wrap earlier.
      const extra = Math.max(2, w * 0.02);
      const align = paragraphs[0].align;
      if (align === "center") x -= extra / 2;
      else if (align === "right") x -= extra;
      w += extra;
    }
    return { kind: "text", x, y: area.y, w, h: area.h, wrap, paragraphs };
  }

  runStyle(cs, ctx) {
    const color = parseColor(cs.color) || { hex: "000000", alpha: 1 };
    const weight = parseInt(cs.fontWeight, 10) || (cs.fontWeight === "bold" ? 700 : 400);
    const deco = String(cs.textDecorationLine || cs.textDecoration || "");
    const style = {
      font: this.font(cs.fontFamily, cs),
      size: parseFloat(cs.fontSize) || 16,
      bold: weight >= 600,
      italic: /italic|oblique/.test(cs.fontStyle),
      underline: /underline/.test(deco),
      strike: /line-through/.test(deco),
      hex: color.hex,
      alpha: color.alpha * ctx.opacity,
      charSpacing: cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) || 0,
    };
    if (ctx.link) style.link = ctx.link;
    if (cs.verticalAlign === "super") style.baseline = "super";
    else if (cs.verticalAlign === "sub") style.baseline = "sub";
    return style;
  }

  font(value, cs) {
    const key = `${value}|${cs.fontWeight}|${cs.fontStyle}`;
    if (this.fontCache.has(key)) return this.fontCache.get(key);
    const font = pickFont(value, (family) => this.fontAvailable(family, cs));
    const wanted = fontFamilies(value)[0];
    if (wanted && wanted !== font && !/^(sans-serif|serif|monospace|system-ui)$/i.test(wanted)) this.substitutions.set(wanted, font);
    this.fontCache.set(key, font);
    return font;
  }

  /** A web font is available once one of its faces loaded; a system font when it changes text metrics. */
  fontAvailable(family, cs) {
    const faces = [...(this.doc.fonts || [])].filter((f) => f.family.replace(/^["']|["']$/g, "") === family);
    if (faces.length) return faces.some((f) => f.status === "loaded");
    const ctx2d = this.canvas.getContext("2d");
    const sample = "mmmmmmmmmmlli WQ@#0Oo";
    return ["monospace", "serif", "sans-serif"].some((generic) => {
      ctx2d.font = `${cs.fontStyle} ${cs.fontWeight} 72px ${generic}`;
      const base = ctx2d.measureText(sample).width;
      ctx2d.font = `${cs.fontStyle} ${cs.fontWeight} 72px "${family}", ${generic}`;
      return ctx2d.measureText(sample).width !== base;
    });
  }
}

// ------------------------------------------------------------- utilities

function alignOf(cs) {
  const a = cs.textAlign;
  const rtl = cs.direction === "rtl";
  if (a === "center" || a === "-webkit-center") return "center";
  if (a === "right" || (a === "end" && !rtl) || (a === "start" && rtl)) return "right";
  if (a === "justify") return "justify";
  return "left";
}

function lineHeightOf(cs) {
  const lh = parseFloat(cs.lineHeight);
  return Number.isFinite(lh) ? lh : null;
}

function stringContent(content) {
  const m = /^(["'])(.*)\1$/s.exec(String(content ?? "").trim());
  return m ? m[2].replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(.)/g, "$1") : "";
}

function linkTarget(a) {
  const href = a.href || "";
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

function unionRect(rects) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return { left, top, width: right - left, height: bottom - top };
}

/** Number of visual lines in a set of line-box fragments (fragments that overlap vertically share a line). */
function lineCount(rects) {
  const lines = [];
  for (const r of [...rects].sort((a, b) => a.top - b.top)) {
    const mid = r.top + r.height / 2;
    const line = lines.find((l) => mid >= l.top && mid <= l.bottom);
    if (line) {
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else lines.push({ top: r.top, bottom: r.bottom });
  }
  return lines.length;
}

function shortSrc(src) {
  return src.startsWith("data:") ? "(embedded)" : src.split("/").pop().split("?")[0];
}

function readAsDataUrl(blob, win) {
  return new Promise((resolve, reject) => {
    const reader = new win.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src, win) {
  return new Promise((resolve, reject) => {
    const img = new win.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("cannot decode"));
    img.src = src;
  });
}

async function naturalSize(src, win) {
  try {
    const img = await loadImageElement(src, win);
    return { w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  }
}

function utf8Base64(text, win) {
  const bytes = new win.TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return win.btoa(binary);
}

/** Give an SVG file an explicit size so PowerPoint (and its PNG fallback) can render it. */
function sizedSvg(text, img, win) {
  try {
    const doc = new win.DOMParser().parseFromString(text, "image/svg+xml");
    const svg = doc.documentElement;
    if (svg.nodeName !== "svg" || doc.querySelector("parsererror")) return text;
    for (const s of svg.querySelectorAll("script, foreignObject")) s.remove();
    const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    const w = parseFloat(svg.getAttribute("width")) || vb[2] || img?.naturalWidth || 300;
    const h = parseFloat(svg.getAttribute("height")) || vb[3] || img?.naturalHeight || 150;
    if (!svg.getAttribute("viewBox")) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    return new win.XMLSerializer().serializeToString(svg);
  } catch {
    return text;
  }
}

