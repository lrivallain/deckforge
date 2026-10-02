import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  applyTextTransform,
  fontFamilies,
  gradientSvg,
  normalizeRuns,
  parseBoxShadow,
  parseColor,
  parseGradient,
  parseObjectPosition,
  pickFont,
  placeImage,
  polygonSvg,
  rotateItems,
  rotationOf,
  shadowOptions,
  transparency,
  whiteSpaceMode,
} from "../../src/export/model.js";
import { fixSlideXml, pptxLang, writePptx } from "../../src/export/pptx.js";
import { ExportError, launchChromium, looksLikePptx, pptxPathFor } from "../../src/server/export.js";

const root = path.resolve(import.meta.dirname, "../..");
const photo = `data:image/png;base64,${fs.readFileSync(path.join(root, "test/fixtures/photo.png")).toString("base64")}`;

describe("export model helpers", () => {
  it("parses computed colours", () => {
    expect(parseColor("rgb(15, 108, 189)")).toEqual({ hex: "0F6CBD", alpha: 1 });
    expect(parseColor("rgba(22, 32, 47, 0.1)")).toEqual({ hex: "16202F", alpha: 0.1 });
    expect(parseColor("rgb(255 0 0 / 50%)")).toEqual({ hex: "FF0000", alpha: 0.5 });
    expect(parseColor("#abc")).toEqual({ hex: "AABBCC", alpha: 1 });
    expect(parseColor("transparent").alpha).toBe(0);
    expect(parseColor("color(srgb 1 0 0)")).toBeNull();
    expect(transparency(0.25)).toBe(75);
  });

  it("picks the first available font and maps generic families", () => {
    expect(fontFamilies('"Bricolage Grotesque", "Trebuchet MS", sans-serif')).toEqual(["Bricolage Grotesque", "Trebuchet MS", "sans-serif"]);
    expect(pickFont('"Brand", "Trebuchet MS", sans-serif', (f) => f === "Trebuchet MS")).toBe("Trebuchet MS");
    expect(pickFont('"Brand", sans-serif', () => false)).toBe("Arial");
    expect(pickFont("monospace")).toBe("Courier New");
  });

  it("collapses white space like CSS and merges same-style runs", () => {
    const a = { bold: false };
    const b = { bold: true };
    const runs = normalizeRuns([
      { text: "  Hello\n   ", style: a },
      { text: " big ", style: b },
      { text: "world  ", style: a },
      { text: "", style: a, softBreak: true },
      { text: "  next line ", style: a },
    ]);
    expect(runs.map((r) => [r.text, r.softBreak || false])).toEqual([["Hello ", false], ["big ", false], ["world", false], [" next line".trim(), true]]);
    expect(normalizeRuns([{ text: "a  b", style: a, collapse: false }])[0].text).toBe("a  b");
    expect(whiteSpaceMode("pre-line")).toEqual({ keepNewlines: true, collapseSpaces: true });
  });

  it("applies text-transform", () => {
    expect(applyTextTransform("one owner", "uppercase")).toBe("ONE OWNER");
    expect(applyTextTransform("one owner", "capitalize")).toBe("One Owner");
  });

  it("parses gradients and fades to transparent without going grey", () => {
    const g = parseGradient("linear-gradient(to top, rgb(255, 255, 255) 0%, rgba(0, 0, 0, 0) 55%)", 100, 50);
    expect(g.angle).toBe(0);
    expect(g.stops).toEqual([{ offset: 0, hex: "FFFFFF", alpha: 1 }, { offset: 0.55, hex: "FFFFFF", alpha: 0 }]);
    const spread = parseGradient("linear-gradient(120deg, rgb(1, 2, 3), rgb(4, 5, 6), rgb(7, 8, 9))", 100, 100);
    expect(spread.angle).toBe(120);
    expect(spread.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
    expect(parseGradient("radial-gradient(circle, rgb(0, 0, 0), rgb(255, 255, 255))", 10, 10).type).toBe("radial");
    expect(parseGradient("repeating-linear-gradient(red, blue)", 10, 10)).toBeNull();
    expect(parseGradient("repeating-radial-gradient(rgb(0, 0, 0) 0px, rgb(1, 1, 1) 4px)", 10, 10)).toBeNull();
    // Hatching: one 9px period repeated along a 100px line.
    const hatch = parseGradient("repeating-linear-gradient(90deg, rgb(15, 108, 189) 0px, rgb(15, 108, 189) 3px, rgb(234, 243, 252) 3px, rgb(234, 243, 252) 9px)", 100, 20);
    expect(hatch).toMatchObject({ type: "linear", angle: 90, period: 0.09 });
    expect(hatch.stops.map((s) => s.offset)).toEqual([0, 0.3333, 0.3333, 1]);
    expect(gradientSvg(hatch, 100, 20)).toContain('x1="0" y1="10" x2="9" y2="10" spreadMethod="repeat"');
    const svg = gradientSvg(g, 100, 50, 8);
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain('x1="50" y1="50" x2="50" y2="0"');
    expect(svg).toContain('rx="8"');
  });

  it("draws clip-path polygons as SVG", () => {
    const svg = polygonSvg("polygon(0px 0px, 100% 50%, 0px 100%)", 20, 10, { hex: "0F6CBD", alpha: 1 });
    expect(svg).toContain('points="0,0 20,5 0,10"');
    expect(polygonSvg("circle(50%)", 10, 10, { hex: "000000", alpha: 1 })).toBeNull();
  });

  it("maps box-shadow to a PowerPoint outer shadow", () => {
    const shadow = parseBoxShadow("rgba(15, 23, 42, 0.16) 0px 12.8px 38.4px 0px");
    expect(shadow).toMatchObject({ x: 0, y: 12.8, blur: 38.4 });
    expect(shadowOptions(shadow)).toMatchObject({ type: "outer", angle: 90, offset: 9.6, blur: 28.8, color: "0F172A", opacity: 0.16 });
    expect(parseBoxShadow("rgb(0, 0, 0) 0px 0px 0px 2px inset")).toBeNull();
  });

  it("places object-fit images and crops them to their box and clip", () => {
    const box = { x: 0, y: 0, w: 200, h: 100 };
    const cover = placeImage(box, { w: 100, h: 100 }, "cover");
    expect(cover.drawn).toEqual({ x: 0, y: -50, w: 200, h: 200 });
    expect(cover.visible).toEqual(box);
    const contain = placeImage(box, { w: 100, h: 100 }, "contain", parseObjectPosition("left top"));
    expect(contain.drawn).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    const clipped = placeImage(box, null, "fill", [0.5, 0.5], { x: 50, y: 0, w: 500, h: 500 });
    expect(clipped.visible).toEqual({ x: 50, y: 0, w: 150, h: 100 });
    expect(placeImage(box, null, "fill", [0.5, 0.5], { x: 300, y: 0, w: 10, h: 10 })).toBeNull();
  });

  it("rotates overlay items around the overlay centre", () => {
    expect(rotationOf("30deg", "none")).toBe(30);
    expect(rotationOf("none", "matrix(1, 0, 0, 1, 0, -10)")).toBe(0);
    expect(Math.round(rotationOf("none", "matrix(0, 1, -1, 0, 0, 0)"))).toBe(90);
    const [item] = rotateItems([{ kind: "shape", x: 0, y: 0, w: 20, h: 10 }], 50, 50, 90);
    expect(item.rotate).toBe(90);
    expect(Math.round(item.x + item.w / 2)).toBe(95);
    expect(Math.round(item.y + item.h / 2)).toBe(10);
  });
});

describe("PPTX writer", () => {
  const style = { font: "Arial", size: 32, bold: true, italic: false, underline: false, strike: false, hex: "16202F", alpha: 1, charSpacing: -1 };
  const model = {
    title: "Test deck",
    lang: "fr",
    slides: [
      {
        background: { hex: "FFFFFF", alpha: 1 },
        notes: "Speaker notes.\n\nSecond paragraph.",
        items: [
          { kind: "shape", geom: "roundRect", x: 50, y: 50, w: 300, h: 100, radius: 10, fill: { hex: "EAF3FC", alpha: 1 }, line: { hex: "BBD7F0", alpha: 1, width: 1 } },
          { kind: "line", x1: 50, y1: 200, x2: 350, y2: 200, hex: "E2E8F2", alpha: 1, width: 1 },
          {
            kind: "text", x: 60, y: 60, w: 280, h: 80, wrap: true,
            paragraphs: [
              { align: "left", lineHeight: 40, spaceBefore: 0, spaceAfter: 4, runs: [{ text: "Ship less. ", style }, { text: "Ship better.", style: { ...style, hex: "0F6CBD" } }] },
              { align: "left", lineHeight: null, runs: [{ text: "Docs", style: { ...style, bold: false, size: 16, underline: true, link: "https://example.com/" } }, { text: "next", style: { ...style, bold: false, size: 16 }, softBreak: true }] },
            ],
          },
          { kind: "image", x: 400, y: 50, w: 200, h: 100, fit: "cover", position: [0.5, 0.5], clip: null, radius: 12, alt: "A photo", natural: { w: 100, h: 100 }, data: photo, opacity: 1 },
        ],
      },
      { background: null, notes: "", items: [] },
    ],
  };

  it("writes native slides, notes and links as valid OOXML", async () => {
    const bytes = await writePptx(model, { title: "Test deck", author: "Me" });
    expect(looksLikePptx(Buffer.from(bytes))).toBe(true);
    const zip = await JSZip.loadAsync(bytes);
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides).toHaveLength(2);
    const xml = await zip.file("ppt/slides/slide1.xml").async("string");
    expect(xml).toContain("<a:t>Ship less. </a:t>");
    expect(xml).toContain('prst="roundRect"');
    expect(xml).toContain('lang="fr-FR"');
    expect(xml).toContain("<a:br/>");
    expect(xml).toContain('typeface="Arial"');
    expect(xml).toContain('sz="2400"'); // 32 px = 24 pt
    expect(xml).toContain('<a:lnSpc><a:spcPts val="3000"/></a:lnSpc>'); // 40 px line height = 30 pt
    // One paragraph-properties element per paragraph (PptxGenJS writes one per run).
    for (const [, inner] of xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) expect((inner.match(/<a:pPr\b/g) || []).length).toBeLessThanOrEqual(1);
    // Rounded, cropped picture.
    expect(xml).toMatch(/<p:pic>[\s\S]*<a:srcRect [^>]*t="2(?:4999|5000)"[\s\S]*prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 12000"\/>/);
    expect(xml).not.toContain("df-round-");
    expect(xml).not.toMatch(/<a:ln>\s*<\/a:ln>/);
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels").async("string");
    expect(rels).toContain('Target="https://example.com/"');
    const notes = await zip.file("ppt/notesSlides/notesSlide1.xml").async("string");
    expect(notes).toContain("Speaker notes.");
    const core = await zip.file("docProps/core.xml").async("string");
    expect(core).toContain("Test deck");
  });

  it("repairs duplicate paragraph properties and empty outlines", () => {
    const xml = '<a:p><a:pPr algn="l"><a:buNone/></a:pPr><a:r><a:rPr lang="fr-FR" sz="1200"/><a:t>a</a:t></a:r><a:pPr indent="0"/><a:r><a:t>b</a:t></a:r><a:endParaRPr lang="en-US" sz="2400" dirty="0"/></a:p><a:ln></a:ln>';
    expect(fixSlideXml(xml)).toBe('<a:p><a:pPr algn="l"><a:buNone/></a:pPr><a:r><a:rPr lang="fr-FR" sz="1200"/><a:t>a</a:t></a:r><a:r><a:t>b</a:t></a:r><a:endParaRPr lang="fr-FR" sz="1200" dirty="0"/></a:p><a:ln><a:noFill/></a:ln>');
    expect(pptxLang("en")).toBe("en-US");
    expect(pptxLang("pt-BR")).toBe("pt-BR");
  });
});

describe("CLI export driver", () => {
  it("names the .pptx after deck.yaml and recognizes ZIP packages", () => {
    expect(pptxPathFor("/a/b/deck.yaml")).toBe(path.join("/a/b", "deck.pptx"));
    expect(pptxPathFor("/a/talk.yml")).toBe(path.join("/a", "talk.pptx"));
    expect(looksLikePptx(Buffer.from("PK\u0003\u0004" + "x".repeat(30), "latin1"))).toBe(true);
    expect(looksLikePptx(Buffer.from("<html>" + "x".repeat(30)))).toBe(false);
  });

  it("explains how to install Playwright when it is missing", async () => {
    const importer = () => Promise.reject(new Error("Cannot find package"));
    await expect(launchChromium({ importer })).rejects.toBeInstanceOf(ExportError);
    await expect(launchChromium({ importer })).rejects.toThrow(/npx playwright install chromium/);
  });

  it("falls back to an installed Chrome when Playwright's Chromium is missing", async () => {
    const calls = [];
    const chromium = { launch: async (opts) => { calls.push(opts.channel ?? "bundled"); if (!opts.channel) throw new Error("Executable doesn't exist"); return { channel: opts.channel }; } };
    const browser = await launchChromium({ importer: async () => ({ chromium }) });
    expect(browser.channel).toBe("chrome");
    expect(calls).toEqual(["bundled", "chrome"]);
  });
});
