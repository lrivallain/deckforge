import { test, expect } from "@playwright/test";
import { startEditor, waitForFile } from "./helpers.js";

// Some WebKit hosts (e.g. Tauri's WKWebView) never load iframe `srcdoc` or blob:
// iframe URLs. Simulate that and check every preview surface still renders.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", { configurable: true, get: () => "", set: () => {} });
    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
      const url = createObjectURL.call(URL, obj);
      return url.replace(/^blob:/, "blob-unsupported:");
    };
  });
});

let editor;
test.afterEach(async () => {
  await editor?.stop();
});

const slideIn = (page, selector) => page.frameLocator(selector).locator("section.slide");

test("previews render without srcdoc support", async ({ page }) => {
  editor = await startEditor();
  await page.goto(editor.editorUrl);
  await expect(page.locator(".rail-item")).toHaveCount(4);

  // Stage and every rail thumbnail contain a rendered slide.
  await expect(slideIn(page, "[data-testid=stage-frame]")).toHaveCount(1);
  await expect(page.frameLocator("[data-testid=stage-frame]").locator("h1")).toContainText("To a shared workflow.");
  for (const id of ["concept", "implementation", "lifecycle", "zoom"]) {
    await expect(slideIn(page, `.rail-item[data-id="${id}"] iframe`), id).toHaveCount(1);
  }
  // Styles apply (inline viewer + theme CSS under the editor CSP).
  const width = await page.frameLocator("[data-testid=stage-frame]").locator("section.slide").evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBe(1280);

  // Inline editing still works through contentDocument.
  const slot = page.frameLocator("[data-testid=stage-frame]").locator('df-slot[data-df-slot="lanes.0.title"]');
  await slot.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Draft");
  await page.keyboard.press("Enter");
  await waitForFile(editor.readYaml, (y) => y.includes("title: Draft"));

  // Reordering moves rail items: their thumbnails must be re-rendered.
  await page.locator('.rail-item[data-id="zoom"]').click();
  await page.locator('.rail-item[data-id="zoom"]').press("Alt+ArrowUp");
  await waitForFile(editor.readYaml, (y) => y.indexOf("id: zoom") < y.indexOf("id: lifecycle"));
  for (const id of ["concept", "implementation", "lifecycle", "zoom"]) {
    await expect(slideIn(page, `.rail-item[data-id="${id}"] iframe`), id).toHaveCount(1);
  }

  // Template picker thumbnails.
  await page.getByTestId("add-slide").click();
  await expect(slideIn(page, '.picker-card[data-template="quote"] iframe')).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Template editor preview.
  await page.getByTestId("open-template-editor").click();
  await expect(slideIn(page, "[data-testid=te-frame]")).toHaveCount(1);
  await expect(page.getByTestId("te-issues")).not.toContainText("Overflow");
  await page.getByRole("button", { name: "Close template editor" }).click();

  // Theme editor sample slides.
  await page.getByTestId("open-theme-editor").click();
  for (const n of [0, 1, 2]) await expect(slideIn(page, `[data-testid=th-frame] >> nth=${n}`), `theme preview ${n}`).toHaveCount(1);
});
