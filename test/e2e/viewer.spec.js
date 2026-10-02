import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { tempDeck } from "./helpers.js";

let local;
let inline;
test.beforeAll(() => {
  local = tempDeck({ runtime: "local" });
  inline = tempDeck({ runtime: "inline" });
});
test.afterAll(() => {
  local?.cleanup();
  inline?.cleanup();
});

const url = (deck, hash = "") => `file://${deck.html}${hash}`;

for (const mode of ["local", "inline"]) {
  test(`${mode} runtime makes zero network requests`, async ({ page }) => {
    const deck = mode === "local" ? local : inline;
    const requests = [];
    page.on("request", (r) => requests.push(r.url()));
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url(deck));
    await expect(page.locator(".controls")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    expect(requests.filter((u) => !u.startsWith("file://") && !u.startsWith("data:"))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("keyboard, buttons, select and hash navigation", async ({ page }) => {
  await page.goto(url(local));
  const visible = page.locator(".stage > .slide:not([hidden])");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveAttribute("data-slide-id", "concept");
  await expect(page.locator("#df-previous")).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/#2$/);
  await expect(visible).toHaveAttribute("data-slide-id", "implementation");
  await page.keyboard.press("End");
  await expect(page).toHaveURL(/#4$/);
  await expect(page.locator("#df-next")).toBeDisabled();
  await page.keyboard.press("PageUp");
  await expect(page).toHaveURL(/#3$/);
  await page.keyboard.press("Home");
  await expect(page).toHaveURL(/#1$/);
  await page.keyboard.press("Control+ArrowRight");
  await expect(page).toHaveURL(/#1$/);
  await page.locator("#df-next").click();
  await expect(page).toHaveURL(/#2$/);
  await page.locator("#df-slide-select").selectOption("2");
  await expect(visible).toHaveAttribute("data-slide-id", "lifecycle");
  await expect(page.locator("#df-announcement")).toHaveText("Slide 3 of 4: Lifecycle");
  await page.goto(url(local, "#4"));
  await expect(visible).toHaveAttribute("data-slide-id", "zoom");
  await page.goto(url(local, "#99"));
  await expect(visible).toHaveAttribute("data-slide-id", "concept");
  await page.goto(url(local, "#slide-lifecycle"));
  await expect(visible).toHaveAttribute("data-slide-id", "lifecycle");
});

test("static mode and reduced motion show final state immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(url(local));
  const opacity = await page.locator(".stage > .slide:not([hidden]) .reveal").first().evaluate((el) => getComputedStyle(el).opacity);
  expect(opacity).toBe("1");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator("#df-static").click();
  await expect(page.locator("#df-static")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveClass(/static/);
  await page.keyboard.press("ArrowRight");
  const animation = await page.locator(".stage > .slide:not([hidden]) .reveal").last().evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe("none");
});

test("reveals are staggered in reading order", async ({ page }) => {
  await page.goto(url(local));
  const delays = await page.locator(".stage > .slide:not([hidden]) .reveal").evaluateAll((els) => els.map((el) => el.style.getPropertyValue("--delay")));
  expect(delays.slice(0, 3)).toEqual(["0.00s", "0.15s", "0.30s"]);
});

test("readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(url(local));
  await expect(page.locator(".stage > .slide")).toHaveCount(4);
  for (const slide of await page.locator(".stage > .slide").all()) await expect(slide).toBeVisible();
  await expect(page.locator(".controls")).toBeHidden();
  await expect(page.locator(".slide-notes").first()).toBeHidden();
  await expect(page.getByText("Prepare. Review.")).toBeVisible();
  await context.close();
});

test("prints every slide on its own page without chrome", async ({ page }) => {
  await page.goto(url(local, "#2"));
  await page.emulateMedia({ media: "print" });
  for (const slide of await page.locator(".stage > .slide").all()) await expect(slide).toBeVisible();
  await expect(page.locator(".controls")).toBeHidden();
  test.skip(test.info().project.name !== "chromium", "page.pdf() is Chromium-only");
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  expect(pages).toBe(4);
});

test("speaker notes panel and presenter window", async ({ page }) => {
  await page.goto(url(local));
  await page.keyboard.press("n");
  await expect(page.locator("#df-notes")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".notes-panel")).toContainText("Start with the audience");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".notes-panel")).toContainText("Same geometry as the previous slide");
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.locator("#df-presenter").click()]);
  await expect(popup.locator("#p-title")).toHaveText("2 / 4 — Implementation map");
  await expect(popup.locator("#p-notes")).toContainText("Same geometry");
  await expect(popup.locator("#p-next")).toHaveText("Next: Lifecycle");
  await popup.locator("#p-next-btn").click();
  await expect(page).toHaveURL(/#3$/);
  await expect(popup.locator("#p-title")).toContainText("3 / 4");
});

test("viewer has no detectable accessibility violations", async ({ page }) => {
  await page.goto(url(local));
  await page.locator("#df-static").click();
  for (let i = 0; i < 4; i++) {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`), `slide ${i + 1}`).toEqual([]);
    await page.keyboard.press("ArrowRight");
  }
  // Every slide is labelled by its visible headline.
  for (const slide of await page.locator(".stage > .slide").all()) {
    const labelledBy = await slide.getAttribute("aria-labelledby");
    expect(await page.locator(`#${labelledBy}`).count()).toBe(1);
  }
});

test("matches build-presentation starter.html pixel for pixel (when available)", async ({ browser }) => {
  const starter = path.join(os.homedir(), ".copilot/skills/build-presentation/assets/starter.html");
  test.skip(!fs.existsSync(starter), "starter.html reference not installed");
  test.skip(test.info().project.name !== "chromium", "pixel comparison runs once, in Chromium");
  const context = await browser.newContext({ viewport: { width: 1320, height: 800 }, reducedMotion: "reduce" });
  const a = await context.newPage();
  const b = await context.newPage();
  for (const n of [1, 2, 3, 4]) {
    await a.goto(url(local, `#${n}`));
    await b.goto(`file://${starter}#${n}`);
    const [shotA, shotB] = await Promise.all([a.locator(".slide:not([hidden])").screenshot(), b.locator(".slide:not([hidden])").screenshot()]);
    const diff = await a.evaluate(async ([x, y]) => {
      const load = (src) => new Promise((res) => { const img = new Image(); img.onload = () => res(img); img.src = src; });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const canvas = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0); return ctx.getImageData(0, 0, img.width, img.height).data; };
      if (ia.width !== ib.width || ia.height !== ib.height) return 1;
      const da = canvas(ia); const db = canvas(ib);
      let different = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) different++;
      return different / (da.length / 4);
    }, [`data:image/png;base64,${shotA.toString("base64")}`, `data:image/png;base64,${shotB.toString("base64")}`]);
    expect(diff, `slide ${n} differs from starter.html`).toBeLessThan(0.02);
  }
  await context.close();
});
