import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { CLI, ROOT, startEditor, tempDeck, waitForFile } from "./helpers.js";
import { parseDeckYaml, stringifyDeck } from "../../src/core/deck.js";
import { saveAsset } from "../../src/server/assets.js";

const PHOTO = path.join(ROOT, "test/fixtures/photo.png");
const DIAGRAM = path.join(ROOT, "test/fixtures/diagram.svg");

// Same host constraints as no-srcdoc.spec.js: previews must not rely on
// iframe srcdoc or blob: URLs (Tauri WKWebView never loads them).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", { configurable: true, get: () => "", set: () => {} });
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
      return createObjectURL.call(URL, obj).replace(/^blob:/, "blob-unsupported:");
    };
  });
});

const stage = (page) => page.frameLocator("[data-testid=stage-frame]");
/** Bounding box of a locator, waiting until it is attached and laid out. */
async function boxOf(locator) {
  let box = null;
  await expect.poll(async () => (box = await locator.boundingBox().catch(() => null))).not.toBeNull();
  return box;
}
const overlaysOf = (yaml, id) => parseDeckYaml(yaml).slides.find((s) => s.id === id)?.overlays || [];

test.describe("editor", () => {
  let editor;
  test.beforeEach(async ({ page }) => {
    editor = await startEditor();
    await page.goto(editor.editorUrl);
    await expect(page.locator(".rail-item")).toHaveCount(4);
  });
  test.afterEach(async () => {
    await editor?.stop();
  });

  test("uploads an image into a slot, asks for alt text, sets the focal point and undoes it", async ({ page }) => {
    await page.getByTestId("add-slide").click();
    await page.locator('.picker-card[data-template="image"]').click();
    await page.getByRole("dialog").getByRole("button", { name: "Add slide" }).click();
    await expect(stage(page).locator(".df-img-empty")).toBeVisible();

    await page.getByTestId("image-file").setInputFiles(PHOTO);
    const yaml = await waitForFile(editor.readYaml, (y) => /src: assets\/[0-9a-f]{12}\.png/.test(y));
    const src = /src: (assets\/[0-9a-f]{12}\.png)/.exec(yaml)[1];
    expect(fs.existsSync(path.join(editor.dir, src))).toBe(true);
    // The preview loads the asset from the server (same origin, /deck/assets/…).
    const img = stage(page).locator("img.df-img");
    await expect(img).toHaveAttribute("src", `/deck/${src}`);
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBe(320);
    await expect(page.getByTestId("image-thumb")).toBeVisible();

    // Alt text is required: warned until filled in.
    const alt = page.getByTestId("image-alt");
    await expect(alt).toHaveClass(/is-warn/);
    await alt.fill("Blue gradient with a pale sun over two hills");
    await expect(alt).not.toHaveClass(/is-warn/);
    await waitForFile(editor.readYaml, (y) => y.includes("alt: Blue gradient with a pale sun over two hills"));
    await expect(img).toHaveAttribute("alt", "Blue gradient with a pale sun over two hills");

    // Focal point: click the thumbnail.
    await page.getByTestId("image-thumb").scrollIntoViewIfNeeded();
    const thumb = await boxOf(page.getByTestId("image-thumb"));
    await page.mouse.click(thumb.x + thumb.width * 0.25, thumb.y + thumb.height * 0.75);
    await waitForFile(editor.readYaml, (y) => /focus: 2\d% 7\d%/.test(y));
    expect(editor.readYaml()).toContain("alt: Blue gradient with a pale sun over two hills");

    // One undo step reverts only the focal point.
    await page.getByTestId("undo").click();
    await waitForFile(editor.readYaml, (y) => y.includes("focus: 50% 50%") && y.includes("alt: Blue gradient"));

    await waitForFile(editor.readHtml, (h) => h.includes(`src="${src}"`) && h.includes('loading="lazy"'));
  });

  test("shows a thumbnail for an SVG that only has a viewBox", async ({ page }) => {
    await page.getByTestId("add-slide").click();
    await page.locator('.picker-card[data-template="image"]').click();
    await page.getByRole("dialog").getByRole("button", { name: "Add slide" }).click();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#0F6CBD"/></svg>';
    await page.getByTestId("image-file").setInputFiles({ name: "sky.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
    await waitForFile(editor.readYaml, (y) => /src: assets\/[0-9a-f]{12}\.svg/.test(y));
    const thumb = await boxOf(page.getByTestId("image-thumb"));
    expect(thumb.width).toBeGreaterThan(100);
    expect(Math.round(thumb.width / thumb.height)).toBe(2);
  });

  test("inserts, drags, resizes and nudges an overlay; every gesture is one undo step", async ({ page }) => {
    await page.getByTestId("insert-menu").click();
    await page.getByRole("menuitem", { name: /^Shape/ }).click();
    await waitForFile(editor.readYaml, (y) => y.includes("kind: shape"));
    const box = page.getByTestId("overlay-box");
    await expect(box).toBeVisible();
    await expect(stage(page).locator('.df-ov-shape[data-ov-id="shape-1"]')).toBeVisible();
    const start = overlaysOf(editor.readYaml(), "concept")[0];
    await expect(page.locator('input[data-path="@ov:shape-1:x"]')).toHaveValue(String(Math.round(start.x * 12.8 * 10) / 10));

    // Drag (snaps to the 8 px grid when no element edge is close).
    const b = await boxOf(box);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - 90, b.y + b.height / 2 - 70, { steps: 6 });
    await page.mouse.up();
    const moved = overlaysOf(await waitForFile(editor.readYaml, (y) => overlaysOf(y, "concept")[0]?.x !== start.x), "concept")[0];
    expect(moved.x).toBeLessThan(start.x);
    expect(moved.y).toBeLessThan(start.y);
    expect(moved.w).toBe(start.w);

    // Wait until the editor applied the move (the selection box is redrawn then).
    await expect(page.locator('input[data-path="@ov:shape-1:x"]')).toHaveValue(String(Math.round(moved.x * 12.8 * 10) / 10));

    // Resize from the east handle.
    const e = await boxOf(page.getByTestId("handle-e"));
    await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
    await page.mouse.down();
    await page.mouse.move(e.x + 60, e.y + e.height / 2, { steps: 5 });
    await page.mouse.up();
    const resized = overlaysOf(await waitForFile(editor.readYaml, (y) => overlaysOf(y, "concept")[0]?.w > start.w), "concept")[0];
    expect(resized.x).toBe(moved.x);

    // Keyboard nudge: 10 px with Shift.
    await page.keyboard.press("Shift+ArrowRight");
    await waitForFile(editor.readYaml, (y) => Math.abs(overlaysOf(y, "concept")[0]?.x - (moved.x + 0.78)) < 0.02);

    // Undo: nudge, resize, move, insert — one step each.
    await page.getByTestId("undo").click();
    await waitForFile(editor.readYaml, (y) => overlaysOf(y, "concept")[0]?.x === moved.x);
    await page.getByTestId("undo").click();
    await waitForFile(editor.readYaml, (y) => overlaysOf(y, "concept")[0]?.w === start.w);
    await page.getByTestId("undo").click();
    await waitForFile(editor.readYaml, (y) => overlaysOf(y, "concept")[0]?.x === start.x);
    await page.getByTestId("undo").click();
    await waitForFile(editor.readYaml, (y) => !y.includes("overlays:"));
    await expect(stage(page).locator(".df-ov")).toHaveCount(0);
  });

  test("inserts an image overlay with the file picker and selects it", async ({ page }) => {
    await page.getByTestId("insert-menu").click();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("menuitem", { name: /^Image/ }).click()]);
    await chooser.setFiles(DIAGRAM);
    const yaml = await waitForFile(editor.readYaml, (y) => y.includes("kind: image"));
    const overlay = overlaysOf(yaml, "concept")[0];
    expect(overlay.data.src).toMatch(/^assets\/[0-9a-f]{12}\.svg$/);
    // 240×160 keeps its aspect ratio on the 1280×720 slide.
    expect(Math.round(((overlay.w * 12.8) / (overlay.h * 7.2)) * 10) / 10).toBe(1.5);
    await expect(page.getByTestId("overlay-panel")).toBeVisible();
    await expect(page.getByTestId("overlay-issues")).toContainText("no alt text");
    const img = stage(page).locator(".df-ov-image img");
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
  });

  test("selects overlays by clicking them in the preview after switching slides", async ({ page }) => {
    // Another template rewrites the preview document (document.open drops its listeners).
    await page.locator('.rail-item[data-id="lifecycle"]').click();
    await expect(stage(page).locator("section.slide")).toHaveAttribute("data-template", "lifecycle");
    for (const kind of ["Text", "Callout"]) {
      await page.getByTestId("insert-menu").click();
      await page.getByRole("menuitem", { name: new RegExp(`^${kind}`) }).click();
      await expect(stage(page).locator(`.df-ov-${kind.toLowerCase()}`)).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("overlay-box")).toHaveCount(0);
    await page.locator('.rail-item[data-id="concept"]').click();
    await page.locator('.rail-item[data-id="lifecycle"]').click();
    await expect(stage(page).locator(".df-ov")).toHaveCount(2);

    // Both are centred: click corners that do not overlap.
    await stage(page).locator(".df-ov-text").click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("overlay-box")).toHaveCount(1);
    await expect(page.getByTestId("overlay-panel")).toContainText("Text overlay");
    const callout = await stage(page).locator(".df-ov-callout").boundingBox();
    await stage(page).locator(".df-ov-callout").click({ modifiers: ["Shift"], position: { x: callout.width - 4, y: 4 }, force: true });
    await expect(page.getByTestId("overlay-box")).toHaveCount(2);
    await expect(page.getByTestId("overlay-panel")).toContainText("2 overlays");
    // Duplicate and delete from the keyboard.
    await page.keyboard.press("ControlOrMeta+d");
    await waitForFile(editor.readYaml, (y) => overlaysOf(y, "lifecycle").length === 4);
    await page.keyboard.press("Delete");
    await waitForFile(editor.readYaml, (y) => overlaysOf(y, "lifecycle").length === 2);
    // Clicking the template deselects.
    await stage(page).locator("h1").click();
    await expect(page.getByTestId("overlay-box")).toHaveCount(0);
  });

  test("reorders cards on the slide and list items in the inspector", async ({ page }) => {
    // Preview: hover a card, drag its grip onto the last card.
    await stage(page).locator('df-slot[data-df-slot="audiences.0.title"]').hover();
    const grip = page.getByTestId("reorder-grip");
    await expect(grip).toBeVisible();
    const g = await boxOf(grip);
    const target = await stage(page).locator('df-slot[data-df-slot="audiences.2.title"]').boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 6 });
    await page.mouse.up();
    const titles = (y) => parseDeckYaml(y).slides[0].data.audiences.map((a) => a.title).join(",");
    await waitForFile(editor.readYaml, (y) => titles(y) === "Reviewers,Readers,Creators");
    await expect(stage(page).locator('df-slot[data-df-slot="audiences.2.title"]')).toHaveText("Creators");

    // Inspector: drag the last capability to the top.
    const rows = page.locator('.field[data-path="capabilities"] .list-row');
    await page.locator('.field[data-path="capabilities"]').scrollIntoViewIfNeeded();
    const handle = await boxOf(rows.nth(3).locator(".drag-handle"));
    const first = await rows.nth(0).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, first.y + 4, { steps: 6 });
    await page.mouse.up();
    const caps = (y) => parseDeckYaml(y).slides[0].data.capabilities.join(",");
    await waitForFile(editor.readYaml, (y) => caps(y) === "Permissions,Context,Tools,History");

    // One undo step per drag.
    await page.getByTestId("undo").click();
    await waitForFile(editor.readYaml, (y) => caps(y) === "Context,Tools,History,Permissions" && titles(y) === "Reviewers,Readers,Creators");
    await page.getByTestId("undo").click();
    await waitForFile(editor.readYaml, (y) => titles(y) === "Creators,Reviewers,Readers");
  });
});

test.describe("viewer", () => {
  const decks = {};
  test.beforeAll(() => {
    for (const runtime of ["local", "inline"]) {
      const deck = tempDeck({ runtime });
      const photo = saveAsset(deck.dir, fs.readFileSync(PHOTO)).path;
      const diagram = saveAsset(deck.dir, fs.readFileSync(DIAGRAM)).path;
      const data = parseDeckYaml(fs.readFileSync(deck.yaml, "utf8"));
      // Images on the last slides, so printing must load slides never shown.
      data.slides.push({ id: "pic", template: "image-text", hidden: false, notes: "", data: {
        image: { src: photo, alt: "Gradient photo", fit: "cover", focus: "50% 50%" }, title: "A picture", points: ["One"],
      } });
      data.slides.at(-1).overlays = [
        { id: "callout-1", kind: "callout", x: 60, y: 70, w: 25, h: 12, z: 1, data: { text: "Look here", tone: "accent", align: "left" } },
        { id: "image-1", kind: "image", x: 5, y: 5, w: 15, h: 15, z: 2, data: { src: diagram, alt: "Diagram", fit: "contain", focus: "50% 50%" } },
      ];
      fs.writeFileSync(deck.yaml, stringifyDeck(data));
      execFileSync(process.execPath, [CLI, "build", deck.dir, "--runtime", runtime], { stdio: "pipe" });
      decks[runtime] = { ...deck, photo };
    }
  });
  test.afterAll(() => Object.values(decks).forEach((d) => d.cleanup()));

  for (const runtime of ["local", "inline"]) {
    test(`${runtime}: renders images and overlays and prints them without visiting the slides`, async ({ page }) => {
      const deck = decks[runtime];
      const requests = [];
      page.on("request", (r) => requests.push(r.url()));
      await page.goto(`file://${deck.html}#1`);
      await expect(page.locator(".controls")).toBeVisible();
      const images = page.locator(".stage img");
      await expect(images).toHaveCount(2);
      if (runtime === "inline") {
        for (const src of await images.evaluateAll((els) => els.map((el) => el.getAttribute("src")))) expect(src).toMatch(/^data:image\/(png|svg\+xml);base64,/);
      } else expect(await images.first().getAttribute("src")).toBe(deck.photo);
      expect(requests.filter((u) => !u.startsWith("file://") && !u.startsWith("data:"))).toEqual([]);

      // Print straight from slide 1: every image is loaded, every overlay laid out.
      await page.emulateMedia({ media: "print" });
      await expect.poll(() => images.evaluateAll((els) => els.every((el) => el.complete && el.naturalWidth > 0))).toBe(true);
      const last = page.locator('.slide[data-slide-id="pic"]');
      await expect(last).toBeVisible();
      await expect(last.locator(".df-overlay .df-ov-callout")).toHaveText("Look here");
      const box = await last.locator(".df-ov-callout").boundingBox();
      const slide = await last.boundingBox();
      expect(Math.round(((box.x - slide.x) / slide.width) * 100)).toBe(60);
      if (test.info().project.name === "chromium") {
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length).toBe(5);
        expect((pdf.toString("latin1").match(/\/Subtype\s*\/Image/g) || []).length).toBeGreaterThan(0);
      }

      // Presenting: overlays reveal after the template elements.
      await page.emulateMedia({ media: "screen" });
      await page.keyboard.press("End");
      const delays = await last.locator(".reveal").evaluateAll((els) => els.map((el) => parseFloat(el.style.getPropertyValue("--delay"))));
      const overlayDelays = delays.slice(-2);
      expect(Math.min(...overlayDelays)).toBeGreaterThan(Math.max(...delays.slice(0, -2)));
    });
  }
});
