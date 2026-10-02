import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAssetPath, isSafeImageSrc, normalizeImage, renderImage, imageIssues } from "../../src/core/image.js";
import { normalizeOverlay, overlayIssues, renderOverlays } from "../../src/core/overlay.js";
import { applyOp, OpError } from "../../src/core/ops.js";
import { normalizeDeck, parseDeckYaml, stringifyDeck, validateDeck } from "../../src/core/deck.js";
import { parseTemplate, renderTemplate } from "../../src/core/template.js";
import { renderDeck, renderSlideDocument } from "../../src/core/render.js";
import { assetReport, checkSvg, detectImageType, imageSize, listAssets, resolveAsset, saveAsset, validateImage } from "../../src/server/assets.js";
import { buildDeckFile } from "../../src/server/build.js";
import { DeckStore } from "../../src/server/store.js";
import { startServer } from "../../src/server/http.js";
import { AgentController } from "../../src/server/agent.js";
import { loadTemplates, loadThemes } from "../../src/server/registry.js";
import * as mockSdk from "../fixtures/mock-sdk.js";

const root = path.resolve(import.meta.dirname, "../..");
const PNG = fs.readFileSync(path.join(root, "test/fixtures/photo.png"));
const SVG = fs.readFileSync(path.join(root, "test/fixtures/diagram.svg"));
const { templates } = loadTemplates(null);
const { themes } = loadThemes(null);

let dir;
function makeDeck() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-media-"));
  fs.copyFileSync(path.join(root, "examples/starter/deck.yaml"), path.join(dir, "deck.yaml"));
  return path.join(dir, "deck.yaml");
}
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("image values", () => {
  it("accepts only assets/ files and https URLs", () => {
    expect(isAssetPath("assets/0123456789ab.png")).toBe(true);
    for (const bad of ["assets/../deck.yaml", "../assets/a.png", "/assets/a.png", "assets/a/b.png", "assets/.x.png", "assets/a.png.html", "assets\\a.png", "assets/a.exe"]) {
      expect(isAssetPath(bad), bad).toBe(false);
      expect(isSafeImageSrc(bad), bad).toBe(false);
    }
    expect(isSafeImageSrc("https://example.com/a.png")).toBe(true);
    for (const bad of ["http://example.com/a.png", "javascript:alert(1)", "data:image/svg+xml,<svg>", "//evil.com/a.png", "https://user:pw@example.com/a.png", "file:///etc/passwd"]) {
      expect(isSafeImageSrc(bad), bad).toBe(false);
    }
  });

  it("normalizes fit and focus", () => {
    expect(normalizeImage("assets/0123456789ab.png")).toEqual({ src: "assets/0123456789ab.png", alt: "", fit: "cover", focus: "50% 50%" });
    expect(normalizeImage({ src: "x", fit: "stretch", focus: "250% -3%" })).toMatchObject({ fit: "cover", focus: "50% 50%" });
    expect(normalizeImage({ src: "x", fit: "contain", focus: "120% 7.5%" })).toMatchObject({ fit: "contain", focus: "100% 7.5%" });
    expect(normalizeImage({})).toBeNull();
  });

  it("renders a lazy <img> with escaped alt, fit and focus", () => {
    const html = renderImage({ src: "assets/0123456789ab.png", alt: 'A "quoted" <b>alt</b>', fit: "contain", focus: "10% 90%" }, { assetUrl: (s) => `/deck/${s}` });
    expect(html).toContain('src="/deck/assets/0123456789ab.png"');
    expect(html).toContain('alt="A &quot;quoted&quot; &lt;b&gt;alt&lt;/b&gt;"');
    expect(html).toContain('loading="lazy" decoding="async"');
    expect(html).toContain("object-fit: contain; object-position: 10% 90%");
    expect(renderImage({ src: "javascript:alert(1)", alt: "x" })).toBe("");
    expect(renderImage({ src: "assets/0123456789ab.svg", alt: "" })).not.toMatch(/<svg/);
  });

  it("flags missing alt text and network images", () => {
    expect(imageIssues({ src: "assets/0123456789ab.png", alt: "" }, "img").map((i) => i.message)).toEqual(["img: image has no alt text"]);
    const remote = imageIssues({ src: "https://cdn.example.com/a.png", alt: "A" }, "img");
    expect(remote).toEqual([{ level: "warning", message: "img: image loads from the network (cdn.example.com)" }]);
    expect(imageIssues({ src: "ftp://x/a.png", alt: "A" }, "img")[0].level).toBe("error");
  });

  it("renders image slots, with an editor-only drop target when empty", () => {
    const template = parseTemplate("---\nname: pic\nslots:\n  image: { type: image }\n---\n<figure>{{image}}</figure>");
    const value = { src: "assets/0123456789ab.png", alt: "Chart" };
    expect(renderTemplate(template, { image: value }, {})).toContain('<img class="df-img" src="assets/0123456789ab.png" alt="Chart"');
    expect(renderTemplate(template, { image: value }, { edit: true })).toContain('data-df-image="image"');
    expect(renderTemplate(template, { image: "" }, {})).toBe("<figure></figure>");
    expect(renderTemplate(template, { image: "" }, { edit: true })).toContain('<df-image class="df-img-empty" data-df-image="image">');
  });

  it("keeps the starter templates unchanged when the new image slots are empty", () => {
    const deck = parseDeckYaml(fs.readFileSync(path.join(root, "examples/starter/deck.yaml"), "utf8"));
    for (const slide of deck.slides) expect(renderDeck({ ...deck, slides: [slide] }, { templates, theme: themes.build })).not.toContain("<img");
    const title = normalizeDeck({ meta: { title: "T" }, slides: [{ id: "t", template: "title", data: { title: "Hello" } }] });
    expect(renderDeck(title, { templates, theme: themes.build })).toContain('<div class="motif" aria-hidden="true">');
  });

  it("points editor previews at /deck/assets/", () => {
    const deck = normalizeDeck({ meta: { title: "T" }, slides: [{ id: "a", template: "image", data: { image: { src: "assets/0123456789ab.png", alt: "x" } } }] });
    const html = renderSlideDocument(deck, deck.slides[0], { templates, theme: themes.build, viewerCss: "", edit: true, assetBase: "/deck/" });
    expect(html).toContain('src="/deck/assets/0123456789ab.png"');
  });
});

describe("asset validation", () => {
  it("detects types from magic bytes, not names", () => {
    expect(detectImageType(PNG)).toBe("png");
    expect(detectImageType(SVG)).toBe("svg");
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("jpg");
    expect(detectImageType(Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"))).toBe("gif");
    expect(detectImageType(Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1"))).toBe("webp");
    expect(detectImageType(Buffer.from("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(detectImageType(Buffer.from("%PDF-1.7"))).toBeNull();
  });

  it("rejects spoofed and active files", () => {
    expect(() => validateImage(Buffer.from("<html><body onload=alert(1)>"))).toThrow(/Unsupported file/);
    expect(() => validateImage(Buffer.from("\x89PNX\r\n\x1a\n", "latin1"))).toThrow(/Unsupported/);
    expect(() => validateImage(Buffer.alloc(0))).toThrow(/Empty/);
    expect(() => validateImage(Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]))).toThrow(/10 MB/);
    for (const svg of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect/>',
    ]) expect(() => checkSvg(Buffer.from(svg)), svg).toThrow();
    expect(() => validateImage(SVG)).not.toThrow();
  });

  it("reads intrinsic sizes", () => {
    expect(imageSize(PNG)).toEqual({ width: 320, height: 200 });
    expect(imageSize(SVG)).toEqual({ width: 240, height: 160 });
  });

  it("stores content-addressed files and never escapes assets/", () => {
    makeDeck();
    const saved = saveAsset(dir, PNG);
    expect(saved.path).toMatch(/^assets\/[0-9a-f]{12}\.png$/);
    expect(saveAsset(dir, PNG).path).toBe(saved.path);
    expect(saveAsset(dir, SVG).path).toMatch(/\.svg$/);
    expect(listAssets(dir).map((a) => a.path).sort()).toEqual([saved.path, saveAsset(dir, SVG).path].sort());
    expect(resolveAsset(dir, saved.path)).toBe(fs.realpathSync(path.join(dir, saved.path)));
    expect(resolveAsset(dir, "assets/../deck.yaml")).toBeNull();
    // A symlink inside assets/ pointing outside is refused.
    fs.writeFileSync(path.join(dir, "secret.png"), PNG);
    fs.symlinkSync(path.join(dir, "secret.png"), path.join(dir, "assets/aaaaaaaaaaaa.png"));
    expect(resolveAsset(dir, "assets/aaaaaaaaaaaa.png")).toBeNull();
  });
});

describe("build with assets", () => {
  it("embeds images as data URIs (inline), copies them (local --out) and reports unused/missing ones", () => {
    const deckPath = makeDeck();
    const used = saveAsset(dir, PNG).path;
    const unused = saveAsset(dir, SVG).path;
    const deck = parseDeckYaml(fs.readFileSync(deckPath, "utf8"));
    deck.slides.push({ id: "pic", template: "image", hidden: false, notes: "", data: { image: { src: used, alt: "Photo" } } });
    deck.slides[0].overlays = [normalizeOverlay({ id: "gone", kind: "image", x: 1, y: 1, w: 10, h: 10, data: { src: "assets/ffffffffffff.png", alt: "x" } })];
    fs.writeFileSync(deckPath, stringifyDeck(deck));

    const inline = buildDeckFile(deckPath, { runtime: "inline" });
    expect(inline.html).toMatch(/<img class="df-img" src="data:image\/png;base64,iVBOR/);
    expect(inline.html).not.toContain(`src="${used}"`);
    const messages = inline.issues.map((i) => `${i.level}: ${i.message}`);
    expect(messages).toContain(`info: Unused asset ${unused} (not referenced by any slide; delete it by hand if no longer needed)`);
    expect(messages).toContain("warning: Image assets/ffffffffffff.png was not found in the deck folder");
    expect(fs.existsSync(path.join(dir, unused))).toBe(true);

    const out = path.join(dir, "site/index.html");
    fs.mkdirSync(path.dirname(out));
    const local = buildDeckFile(deckPath, { runtime: "local", out });
    expect(local.html).toContain(`src="${used}"`);
    expect(fs.existsSync(path.join(dir, "site", used))).toBe(true);
    expect(fs.existsSync(path.join(dir, "site", unused))).toBe(false);

    const cdn = buildDeckFile(deckPath, { runtime: "cdn" });
    expect(cdn.html).toContain(`src="${used}"`);
    expect(assetReport(deck, templates, dir)).toEqual({ used: [used], missing: ["assets/ffffffffffff.png"], unused: [unused] });
  });
});

describe("overlays", () => {
  const base = () => normalizeDeck({ meta: { title: "T" }, slides: [{ id: "a", template: "bullets", data: { title: "Hi" } }, { id: "b", template: "quote" }] });

  it("normalizes geometry, ids and theme tokens", () => {
    const o = normalizeOverlay({ kind: "text", x: "10", y: 5, w: 30, h: 10, data: { text: "<script>x</script><b>Hi</b>", color: "#ff0000", style: "heading", font: "Comic Sans" } }, ["text-1"]);
    expect(o).toEqual({ id: "text-2", kind: "text", x: 10, y: 5, w: 30, h: 10, z: 1, data: { text: "<b>Hi</b>", style: "heading", align: "left", color: "ink" } });
    expect(() => normalizeOverlay({ kind: "video" })).toThrow(/Unknown overlay kind/);
    expect(() => normalizeOverlay({ kind: "shape", x: "left" })).toThrow(/number/);
    expect(() => normalizeDeck({ meta: { title: "T" }, slides: [{ id: "a", template: "quote", overlays: [{ kind: "nope" }] }] })).toThrow(/Slide a: Unknown overlay kind/);
  });

  it("round-trips through YAML", () => {
    let { deck } = applyOp(base(), "add_overlay", { id: "a", overlay: { kind: "arrow", x: 10, y: 20, w: 15, h: 5, rotate: 30, order: 1, data: { color: "accent" } } });
    const again = parseDeckYaml(stringifyDeck(deck));
    expect(again.slides[0].overlays).toEqual(deck.slides[0].overlays);
  });

  it("renders a positioned layer revealed after the template unless ordered", () => {
    const { deck } = applyOp(base(), "add_overlay", { id: "a", overlays: [
      { kind: "shape", x: 10, y: 10, w: 20, h: 20 },
      { kind: "callout", x: 50, y: 50, w: 20, h: 10, rotate: 15, order: 0, data: { text: "Note" } },
    ] });
    const html = renderDeck(deck, { templates, theme: themes.build });
    expect(html).toContain('<div class="df-overlay"><div class="df-ov df-ov-shape reveal df-shape-rounded df-fill-primary df-stroke-primary" data-ov-id="shape-1" style="left: 10%; top: 10%; width: 20%; height: 20%; z-index: 1" aria-hidden="true"></div>');
    expect(html).toContain('data-ov-id="callout-1" style="left: 50%; top: 50%; width: 20%; height: 10%; z-index: 2; rotate: 15deg" data-df-order="0"><div class="df-ov-callout-inner">Note</div>');
    expect(html.indexOf("df-overlay")).toBeGreaterThan(html.indexOf("slide-inner"));
    expect(renderOverlays({ overlays: [] })).toBe("");
  });

  it("adds, updates (several at once) and removes overlays", () => {
    let { deck, result } = applyOp(base(), "add_overlay", { id: "a", overlays: [{ kind: "text", x: 0, y: 0, w: 10, h: 10 }, { kind: "text", x: 0, y: 0, w: 10, h: 10 }] });
    expect(result.overlayIds).toEqual(["text-1", "text-2"]);
    expect(deck.slides[0].overlays.map((o) => o.z)).toEqual([1, 2]);
    ({ deck } = applyOp(deck, "update_overlay", { id: "a", updates: [{ overlayId: "text-1", props: { x: 40, data: { text: "Moved" } } }, { overlayId: "text-2", props: { rotate: 0, order: 2 } }] }));
    expect(deck.slides[0].overlays[0]).toMatchObject({ x: 40, data: { text: "Moved", style: "body" } });
    expect(deck.slides[0].overlays[1].order).toBe(2);
    ({ deck } = applyOp(deck, "update_overlay", { id: "a", overlayId: "text-2", props: { order: null } }));
    expect(deck.slides[0].overlays[1].order).toBeUndefined();
    expect(() => applyOp(deck, "update_overlay", { id: "a", overlayId: "text-1", props: { kind: "image" } })).toThrow(/Unknown overlay property/);
    expect(() => applyOp(deck, "update_overlay", { id: "a", overlayId: "nope", props: { x: 1 } })).toThrow(OpError);
    expect(() => applyOp(deck, "update_overlay", { id: "a", overlayId: "text-1", props: { data: JSON.parse('{"__proto__": {"polluted": true}}') } })).toThrow(/Invalid slot key/);
    expect({}.polluted).toBeUndefined();
    ({ deck } = applyOp(deck, "remove_overlay", { id: "a", overlayIds: ["text-1", "text-2"] }));
    expect(deck.slides[0].overlays).toBeUndefined();
  });

  it("warns about overlays outside the slide and empty or undescribed content", () => {
    const { deck } = applyOp(base(), "add_overlay", { id: "a", overlays: [
      { kind: "shape", x: 90, y: 10, w: 20, h: 10 },
      { kind: "image", x: 0, y: 0, w: 10, h: 10, data: { src: "assets/0123456789ab.png" } },
      { kind: "text", x: 0, y: 0, w: 10, h: 10, data: { text: " " } },
    ] });
    const messages = overlayIssues(deck.slides[0]).map((i) => i.message);
    expect(messages).toEqual(['Overlay "shape-1" extends beyond the slide', 'Overlay "image-1": image has no alt text', 'Overlay "text-1" is empty']);
    expect(validateDeck(deck, { templates, themes }).filter((i) => i.slide === "a" && i.overlay)).toHaveLength(3);
  });
});

describe("item and image ops", () => {
  const deck = () => parseDeckYaml(fs.readFileSync(path.join(root, "examples/starter/deck.yaml"), "utf8"));

  it("moves list and card items", () => {
    const { deck: next } = applyOp(deck(), "move_item", { id: "concept", path: "audiences", from: 0, to: 2 });
    expect(next.slides[0].data.audiences.map((a) => a.title)).toEqual(["Reviewers", "Readers", "Creators"]);
    const { deck: caps } = applyOp(deck(), "move_item", { id: "concept", path: "capabilities", from: 3, to: 0 });
    expect(caps.slides[0].data.capabilities[0]).toBe("Permissions");
    expect(() => applyOp(deck(), "move_item", { id: "concept", path: "title", from: 0, to: 1 })).toThrow(/not a list/);
    expect(() => applyOp(deck(), "move_item", { id: "concept", path: "audiences", from: 0, to: 9 })).toThrow(/Invalid move/);
    expect(() => applyOp(deck(), "move_item", { id: "concept", path: "__proto__", from: 0, to: 1 })).toThrow(/Invalid slot key/);
  });

  it("sets images in the first image slot or a named one", () => {
    let d = normalizeDeck({ meta: { title: "T" }, slides: [{ id: "t", template: "two-column" }, { id: "q", template: "quote" }] });
    const ctx = { templates };
    ({ deck: d } = applyOp(d, "set_image", { id: "t", path: "assets/0123456789ab.png", alt: "Left", fit: "contain" }, ctx));
    expect(d.slides[0].data.leftMedia).toEqual({ src: "assets/0123456789ab.png", alt: "Left", fit: "contain", focus: "50% 50%" });
    ({ deck: d } = applyOp(d, "set_image", { id: "t", slot: "rightMedia", path: "assets/0123456789ab.png", alt: "Right" }, ctx));
    expect(d.slides[0].data.rightMedia.alt).toBe("Right");
    expect(() => applyOp(d, "set_image", { id: "q", path: "assets/0123456789ab.png", alt: "x" }, ctx)).toThrow(/no image slot/);
    expect(() => applyOp(d, "set_image", { id: "t", path: "../deck.yaml", alt: "x" }, ctx)).toThrow(/Unsupported image source/);
  });
});

describe("DeckStore overlay undo", () => {
  let store;
  beforeEach(() => {
    store = new DeckStore({ deckPath: makeDeck() });
  });
  afterEach(() => store.close());

  it("makes every gesture one undo step", () => {
    store.apply("add_overlay", { id: "concept", overlay: { kind: "shape", x: 10, y: 10, w: 10, h: 10 } }, { label: "Insert shape" });
    store.apply("update_overlay", { id: "concept", updates: [{ overlayId: "shape-1", props: { x: 20, y: 30 } }] }, { label: "Move overlay" });
    store.apply("update_overlay", { id: "concept", overlayId: "shape-1", props: { w: 25, h: 15 } }, { label: "Resize overlay" });
    expect(store.undoStack.map((e) => e.label).slice(-3)).toEqual(["Insert shape", "Move overlay", "Resize overlay"]);
    store.undo();
    expect(store.deck.slides[0].overlays[0]).toMatchObject({ x: 20, y: 30, w: 10, h: 10 });
    store.undo();
    expect(store.deck.slides[0].overlays[0]).toMatchObject({ x: 10, y: 10 });
    store.undo();
    expect(store.deck.slides[0].overlays).toBeUndefined();
    expect(fs.readFileSync(store.deckPath, "utf8")).not.toContain("overlays:");
  });

  it("coalesces keyboard nudges", () => {
    store.apply("add_overlay", { id: "concept", overlay: { kind: "shape", x: 10, y: 10, w: 10, h: 10 } });
    for (let i = 1; i <= 3; i++) store.apply("update_overlay", { id: "concept", overlayId: "shape-1", props: { x: 10 + i } }, { coalesce: "nudge" });
    expect(store.undoStack.length).toBe(2);
    store.undo();
    expect(store.deck.slides[0].overlays[0].x).toBe(10);
  });
});

describe("asset HTTP API", () => {
  let app;
  beforeEach(async () => {
    app = await startServer({ deckPath: makeDeck(), port: 0, token: "tok", log: () => {} });
  });
  afterEach(async () => app.close());
  const req = (p, init = {}) => fetch(`${app.origin}${p}`, { ...init, headers: { "X-Deckforge-Token": "tok", ...init.headers } });

  it("uploads raw or JSON images and lists them", async () => {
    const raw = await req("/api/assets", { method: "POST", headers: { "Content-Type": "image/png" }, body: PNG });
    expect(raw.status).toBe(201);
    const saved = await raw.json();
    expect(saved).toMatchObject({ ok: true, path: expect.stringMatching(/^assets\/[0-9a-f]{12}\.png$/), mime: "image/png", width: 320, height: 200 });
    const json = await req("/api/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: `data:image/svg+xml;base64,${SVG.toString("base64")}` }) });
    expect((await json.json()).path).toMatch(/\.svg$/);
    const list = await (await req("/api/assets")).json();
    expect(list.assets).toHaveLength(2);
  });

  it("refuses missing tokens, cross-origin posts, wrong types, spoofed bytes and huge bodies", async () => {
    const anon = await fetch(`${app.origin}/api/assets`, { method: "POST", headers: { "Content-Type": "image/png" }, body: PNG });
    expect(anon.status).toBe(401);
    const cross = await req("/api/assets", { method: "POST", headers: { "Content-Type": "image/png", Origin: "https://evil.example" }, body: PNG });
    expect(cross.status).toBe(403);
    const text = await req("/api/assets", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hello" });
    expect(text.status).toBe(415);
    const spoof = await req("/api/assets", { method: "POST", headers: { "Content-Type": "image/png" }, body: "<html><script>alert(1)</script></html>" });
    expect(spoof.status).toBe(415);
    const huge = await req("/api/assets", { method: "POST", headers: { "Content-Type": "image/png" }, body: Buffer.alloc(11 * 1024 * 1024) });
    expect(huge.status).toBe(413);
    expect(fs.existsSync(path.join(dir, "assets")) ? fs.readdirSync(path.join(dir, "assets")) : []).toEqual([]);
  });

  it("serves assets with nosniff and SVG with a sandbox CSP", async () => {
    const svg = saveAsset(dir, SVG).path;
    const png = saveAsset(dir, PNG).path;
    const resSvg = await req(`/deck/${svg}`);
    expect(resSvg.headers.get("content-type")).toBe("image/svg+xml");
    expect(resSvg.headers.get("x-content-type-options")).toBe("nosniff");
    expect(resSvg.headers.get("content-security-policy")).toMatch(/^sandbox; default-src 'none'/);
    const resPng = await req(`/deck/${png}`);
    expect(resPng.headers.get("content-type")).toBe("image/png");
    expect(resPng.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await req("/deck/assets/..%2f..%2f..%2fetc%2fpasswd")).status).toBe(404);
  });
});

describe("Copilot image and overlay tools", () => {
  let store;
  let agent;
  beforeEach(async () => {
    store = new DeckStore({ deckPath: makeDeck() });
    agent = new AgentController({ store, factory: { createClient: mockSdk.createClient } });
  });
  afterEach(async () => {
    await agent.dispose();
    store.close();
  });
  const run = async (calls, scope = "deck", slideId = null) => {
    const done = new Promise((resolve) => agent.on("event", (e) => e.type === "done" && resolve(e)));
    await agent.chat({ prompt: `#tools ${JSON.stringify(calls)}`, scope, slideId });
    return done;
  };

  it("only uses files already in assets/ and respects the slide scope", async () => {
    const asset = saveAsset(dir, PNG).path;
    const errors = [];
    agent.on("event", (e) => e.type === "tool_error" && errors.push(e.message));
    await run([
      { name: "list_assets", args: {} },
      { name: "add_slide", args: { template: "image", id: "pic", data: { image: { src: "https://example.com/x.png", alt: "x" } } } },
      { name: "add_slide", args: { template: "image", id: "pic" } },
      { name: "set_image", args: { id: "pic", path: "assets/ffffffffffff.png", alt: "Missing" } },
      { name: "set_image", args: { id: "pic", path: asset, alt: "A test photo" } },
      { name: "add_overlay", args: { id: "pic", kind: "image", x: 1, y: 1, w: 10, h: 10, data: { src: "https://example.com/y.png", alt: "y" } } },
      { name: "add_overlay", args: { id: "pic", kind: "arrow", x: 10, y: 10, w: 20, h: 5, rotate: 45, data: { color: "accent" } } },
      { name: "update_overlay", args: { id: "pic", overlayId: "arrow-1", x: 30 } },
    ]);
    expect(errors).toEqual([
      expect.stringMatching(/"https:\/\/example.com\/x.png" is not a file in assets\//),
      expect.stringMatching(/"assets\/ffffffffffff.png" is not a file in assets\//),
      expect.stringMatching(/"https:\/\/example.com\/y.png" is not a file in assets\//),
    ]);
    const pic = store.deck.slides.find((s) => s.id === "pic");
    expect(pic.data.image).toEqual({ src: asset, alt: "A test photo", fit: "cover", focus: "50% 50%" });
    expect(pic.overlays).toEqual([expect.objectContaining({ id: "arrow-1", x: 30, rotate: 45, data: expect.objectContaining({ color: "accent" }) })]);

    errors.length = 0;
    await run([
      { name: "add_overlay", args: { id: "zoom", kind: "shape", x: 1, y: 1, w: 5, h: 5 } },
      { name: "remove_overlay", args: { id: "pic", overlayId: "arrow-1" } },
    ], "slide", "pic");
    expect(errors).toEqual([expect.stringMatching(/Out of scope/)]);
    expect(store.deck.slides.find((s) => s.id === "pic").overlays).toBeUndefined();
  });
});
