// Slide model (see measure.js) → .pptx bytes, with PptxGenJS.
// Runs in the browser (editor, headless CLI page) and in Node (tests).

import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { placeImage, pxToIn, pxToPt, shadowOptions, svgDataUri, transparency } from "./model.js";

const ROUND_MARK = "df-round-";
const r2 = (n) => Math.round(n * 100) / 100;
const inch = (px) => Math.round(pxToIn(px) * 10000) / 10000;

/**
 * Write a measured deck as PowerPoint.
 * @param {{ slides: object[], title?: string, lang?: string }} model
 * @param {{ title?: string, author?: string }} meta
 * @returns {Promise<Uint8Array>}
 */
export async function writePptx(model, meta = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in = 1280 × 720 px at 96 dpi
  pptx.title = meta.title || model.title || "deckforge";
  if (meta.author) pptx.author = meta.author;
  pptx.company = "deckforge";
  const lang = pptxLang(model.lang);
  for (const slideModel of model.slides) {
    const slide = pptx.addSlide();
    const bg = slideModel.background;
    slide.background = bg ? { color: bg.hex, transparency: transparency(bg.alpha) } : { color: "FFFFFF" };
    for (const item of slideModel.items) addItem(pptx, slide, item, lang);
    if (slideModel.notes) slide.addNotes(slideModel.notes);
  }
  const raw = await pptx.write({ outputType: "uint8array" });
  return fixPackage(raw);
}

function addItem(pptx, slide, item, lang) {
  switch (item.kind) {
    case "shape":
      return addShape(pptx, slide, item);
    case "line":
      return addLine(pptx, slide, item);
    case "text":
      return addText(slide, item, lang);
    case "image":
      return addPicture(slide, item);
    case "vector":
      return slide.addImage({
        data: svgDataUri(item.svg),
        x: inch(item.x), y: inch(item.y), w: inch(item.w), h: inch(item.h),
        rotate: item.rotate || 0,
        altText: item.alt || "",
        objectName: item.name || "Graphic",
        ...(item.link ? { hyperlink: { url: item.link } } : {}),
      });
    default:
      return undefined;
  }
}

function addShape(pptx, slide, item) {
  const opts = { x: inch(item.x), y: inch(item.y), w: inch(item.w), h: inch(item.h) };
  if (item.fill) opts.fill = { color: item.fill.hex, transparency: transparency(item.fill.alpha) };
  if (item.line) {
    opts.line = { color: item.line.hex, width: r2(pxToPt(item.line.width)), transparency: transparency(item.line.alpha) };
    if (item.line.dash) opts.line.dashType = item.line.dash;
  }
  if (item.geom === "roundRect") opts.rectRadius = Math.min(pxToIn(item.radius), Math.min(opts.w, opts.h) / 2);
  if (item.rotate) opts.rotate = item.rotate;
  const shadow = shadowOptions(item.shadow);
  if (shadow) opts.shadow = shadow;
  const geom = { rect: pptx.ShapeType.rect, roundRect: pptx.ShapeType.roundRect, ellipse: pptx.ShapeType.ellipse }[item.geom] || pptx.ShapeType.rect;
  slide.addShape(geom, opts);
}

function addLine(pptx, slide, item) {
  const x = Math.min(item.x1, item.x2);
  const y = Math.min(item.y1, item.y2);
  const line = { color: item.hex, width: r2(pxToPt(item.width)), transparency: transparency(item.alpha) };
  if (item.dash) line.dashType = item.dash;
  slide.addShape(pptx.ShapeType.line, {
    x: inch(x), y: inch(y), w: inch(Math.abs(item.x2 - item.x1)), h: inch(Math.abs(item.y2 - item.y1)),
    // A line runs from the top-left to the bottom-right of its box unless flipped.
    flipH: (item.x2 < item.x1) !== (item.y2 < item.y1),
    line,
  });
}

function addText(slide, item, lang) {
  const runs = [];
  item.paragraphs.forEach((p, pi) => {
    p.runs.forEach((run, ri) => {
      const s = run.style;
      const o = {
        fontFace: s.font,
        fontSize: r2(pxToPt(s.size)),
        bold: s.bold,
        italic: s.italic,
        color: s.hex,
        align: p.align,
        lang,
      };
      if (s.alpha < 1) o.transparency = transparency(s.alpha);
      if (s.charSpacing) o.charSpacing = r2(pxToPt(s.charSpacing));
      if (s.underline) o.underline = { style: "sng" };
      if (s.strike) o.strike = "sngStrike";
      if (s.baseline === "super") o.superscript = true;
      if (s.baseline === "sub") o.subscript = true;
      if (s.link) o.hyperlink = { url: s.link };
      if (p.lineHeight) o.lineSpacing = r2(pxToPt(p.lineHeight));
      if (p.spaceBefore) o.paraSpaceBefore = r2(pxToPt(p.spaceBefore));
      if (p.spaceAfter) o.paraSpaceAfter = r2(pxToPt(p.spaceAfter));
      if (run.softBreak && ri > 0) o.softBreakBefore = true;
      if (ri === p.runs.length - 1 && pi < item.paragraphs.length - 1) o.breakLine = true;
      runs.push({ text: run.text, options: o });
    });
  });
  if (!runs.length) return;
  slide.addText(runs, {
    x: inch(item.x), y: inch(item.y), w: inch(Math.max(item.w, 1)), h: inch(Math.max(item.h, 1)),
    margin: 0,
    valign: "top",
    wrap: item.wrap !== false,
    fit: "none",
    rotate: item.rotate || 0,
    isTextBox: true,
  });
}

function addPicture(slide, item) {
  if (!item.data) return;
  const box = { x: item.x, y: item.y, w: item.w, h: item.h };
  const placed = placeImage(box, item.natural, item.fit, item.position, item.rotate ? null : item.clip);
  if (!placed) return;
  const { drawn, visible } = placed;
  const cropped = Math.abs(visible.x - drawn.x) > 0.5 || Math.abs(visible.y - drawn.y) > 0.5 || Math.abs(visible.w - drawn.w) > 0.5 || Math.abs(visible.h - drawn.h) > 0.5;
  const opts = {
    data: item.data,
    x: inch(visible.x),
    y: inch(visible.y),
    w: inch(drawn.w),
    h: inch(drawn.h),
    altText: item.alt || "",
    rotate: item.rotate || 0,
  };
  if (cropped) opts.sizing = { type: "crop", x: inch(visible.x - drawn.x), y: inch(visible.y - drawn.y), w: inch(visible.w), h: inch(visible.h) };
  if (item.opacity < 1) opts.transparency = transparency(item.opacity);
  if (item.link) opts.hyperlink = { url: item.link };
  if (item.radius > 0.5) {
    // Picture geometry is always a rectangle in PptxGenJS: mark it and round it in fixPackage().
    const adj = Math.min(50000, Math.round((item.radius / Math.min(visible.w, visible.h)) * 100000));
    opts.objectName = `${ROUND_MARK}${adj}`;
  }
  slide.addImage(opts);
}

/** "en" → "en-US": PowerPoint expects a region for proofing languages. */
export function pptxLang(lang) {
  const v = String(lang || "en").trim();
  if (v.includes("-")) return v;
  const regions = { en: "US", fr: "FR", de: "DE", es: "ES", it: "IT", pt: "PT", nl: "NL", ja: "JP", zh: "CN", ko: "KR", sv: "SE", da: "DK", nb: "NO", fi: "FI", pl: "PL" };
  return regions[v.toLowerCase()] ? `${v.toLowerCase()}-${regions[v.toLowerCase()]}` : v;
}

/**
 * Repair and finish the package written by PptxGenJS:
 * - keep a single <a:pPr> per paragraph (PptxGenJS writes one per run,
 *   which is invalid OOXML and makes PowerPoint offer to repair the file);
 * - give an explicit "no line" to shapes without an outline;
 * - round the corners of marked pictures.
 */
export async function fixPackage(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  for (const name of slides) {
    const xml = await zip.file(name).async("string");
    zip.file(name, fixSlideXml(xml));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

export function fixSlideXml(xml) {
  let out = xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_, inner) => {
    let seen = false;
    let fixed = inner.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (pPr) => {
      if (seen) return "";
      seen = true;
      return pPr;
    });
    // The end-of-paragraph mark takes the size of the paragraph's last run
    // (PptxGenJS uses the first run of the text box), else it can make the last line taller.
    const runs = [...fixed.matchAll(/<a:rPr\b[^>]*?\blang="([^"]+)"[^>]*?\bsz="(\d+)"/g)];
    const last = runs[runs.length - 1];
    if (last) fixed = fixed.replace(/<a:endParaRPr lang="[^"]*"(?: sz="\d+")?/, `<a:endParaRPr lang="${last[1]}" sz="${last[2]}"`);
    return `<a:p>${fixed}</a:p>`;
  });
  out = out.replace(/<a:ln>\s*<\/a:ln>/g, "<a:ln><a:noFill/></a:ln>");
  out = out.replace(/<p:pic>([\s\S]*?)<\/p:pic>/g, (pic, inner) => {
    const mark = new RegExp(`name="${ROUND_MARK}(\\d+)"`).exec(inner);
    if (!mark) return pic;
    const fixed = inner
      .replace(mark[0], 'name="Picture"')
      .replace(/<a:prstGeom prst="rect"><a:avLst\/><\/a:prstGeom>/, `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${mark[1]}"/></a:avLst></a:prstGeom>`);
    return `<p:pic>${fixed}</p:pic>`;
  });
  return out;
}
