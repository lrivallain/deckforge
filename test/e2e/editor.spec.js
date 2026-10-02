import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startEditor, waitForFile } from "./helpers.js";

let editor;
test.beforeEach(async ({ page }) => {
  editor = await startEditor();
  await page.goto(editor.editorUrl);
  await expect(page.locator(".rail-item")).toHaveCount(4);
});
test.afterEach(async () => {
  await editor?.stop();
});

const stage = (page) => page.frameLocator("[data-testid=stage-frame]");
const railItem = (page, id) => page.locator(`.rail-item[data-id="${id}"]`);

test("loads the deck and requires the token", async ({ page, browser }) => {
  await expect(page.getByTestId("deck-title")).toHaveText("Build Presentation - reusable style specimen");
  await expect(page).toHaveURL(`${editor.origin}/`);
  await expect(stage(page).locator("h1")).toContainText("To a shared workflow.");
  const anonymous = await browser.newContext();
  const res = await (await anonymous.newPage()).goto(editor.origin);
  expect(res.status()).toBe(401);
  await anonymous.close();
});

test("inline editing on the slide saves deck.yaml and rebuilds deck.html", async ({ page }) => {
  const slot = stage(page).locator('df-slot[data-df-slot="lanes.1.title"]');
  await slot.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Publish");
  await page.keyboard.press("Enter");
  await waitForFile(editor.readYaml, (y) => y.includes("title: Publish"));
  await waitForFile(editor.readHtml, (h) => h.includes("<h3>Publish</h3>"));
  await expect(page.getByTestId("undo")).toBeEnabled();
  await expect(page.locator('.field[data-path="lanes.1.title"] textarea')).toHaveValue("Publish");
});

test("inspector fields update the preview, rail and file", async ({ page }) => {
  const eyebrow = page.locator('textarea[data-path="eyebrow"]');
  await eyebrow.fill("01 / A new angle");
  await expect(stage(page).locator(".eyebrow")).toHaveText("01 / A new angle");
  await waitForFile(editor.readYaml, (y) => y.includes("eyebrow: 01 / A new angle"));
  // Lists: add and remove a capability.
  const capabilities = page.locator('.field[data-path="capabilities"]');
  await expect(capabilities.locator(".counter")).toHaveText("4/4");
  await capabilities.locator(".list-row").first().getByRole("button", { name: "Remove item" }).click();
  await expect(stage(page).locator(".capability")).toHaveCount(3);
  // Notes.
  await page.locator(".notes-input").fill("Remember to breathe.");
  await waitForFile(editor.readYaml, (y) => y.includes("Remember to breathe."));
});

test("add, duplicate, hide, reorder and delete slides with undo", async ({ page }) => {
  await page.getByTestId("add-slide").click();
  await page.locator('.picker-card[data-template="quote"]').click();
  await page.getByRole("dialog").getByRole("button", { name: "Add slide" }).click();
  await expect(page.locator(".rail-item")).toHaveCount(5);
  await expect(page.locator(".rail-item").nth(1)).toHaveClass(/is-selected/);
  await expect(stage(page).locator("blockquote")).toBeVisible();

  await railItem(page, "zoom").click();
  await railItem(page, "zoom").getByRole("button", { name: "Duplicate slide" }).click();
  await expect(page.locator(".rail-item")).toHaveCount(6);
  await expect(railItem(page, "zoom-copy")).toHaveClass(/is-selected/);

  await railItem(page, "zoom-copy").getByRole("button", { name: "Hide slide" }).click();
  await expect(railItem(page, "zoom-copy")).toHaveClass(/is-hidden/);
  await waitForFile(editor.readHtml, (h) => h.includes('data-slide-id="zoom"') && !h.includes('data-slide-id="zoom-copy"'));

  // Keyboard reorder: move "lifecycle" up one position.
  await railItem(page, "lifecycle").click();
  await railItem(page, "lifecycle").press("Alt+ArrowUp");
  await waitForFile(editor.readYaml, (y) => y.indexOf("id: lifecycle") < y.indexOf("id: implementation"));

  // Drag and drop: drop "concept" on the lower half of "lifecycle".
  // (Playwright cannot synthesize HTML5 drag-and-drop in WebKit.)
  if (test.info().project.name === "chromium") {
    const target = railItem(page, "lifecycle");
    const box = await target.boundingBox();
    await railItem(page, "concept").dragTo(target, { targetPosition: { x: 60, y: box.height - 20 } });
    await waitForFile(editor.readYaml, (y) => y.indexOf("id: lifecycle") < y.indexOf("id: concept") && y.indexOf("id: concept") < y.indexOf("id: implementation"));
  }

  await railItem(page, "zoom").click();
  await railItem(page, "zoom").getByRole("button", { name: "Delete slide" }).click();
  await expect(railItem(page, "zoom")).toHaveCount(0);
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await expect(railItem(page, "zoom")).toHaveCount(1);

  await page.locator("body").click({ position: { x: 700, y: 30 } });
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await page.getByTestId("redo").click();
  await expect(page.getByTestId("redo")).toBeEnabled();
});

test("changing template and theme", async ({ page }) => {
  await railItem(page, "lifecycle").click();
  await page.getByTestId("change-template").click();
  await page.locator('.picker-card[data-template="bullets"]').click();
  await page.getByRole("button", { name: "Apply template" }).click();
  await expect(stage(page).locator(".points")).toBeVisible();
  await expect(stage(page).locator("h1")).toContainText("Prepare. Review.");
  await waitForFile(editor.readYaml, (y) => y.includes("template: bullets"));

  await page.getByTestId("theme-select").selectOption("atelier");
  await waitForFile(editor.readYaml, (y) => y.includes("theme: atelier"));
  await waitForFile(editor.readHtml, (h) => h.includes('data-theme="atelier"'));
  const primary = await stage(page).locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--df-primary").trim());
  expect(primary.toUpperCase()).toBe("#0B6A66");
});

test("deck settings update meta and brief", async ({ page }) => {
  await page.getByTestId("open-settings").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Quarterly review");
  await dialog.getByLabel("Audience").fill("Leadership team");
  await dialog.getByLabel("Sources").fill("Q3 report\nCustomer survey");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("deck-title")).toHaveText("Quarterly review");
  const yaml = await waitForFile(editor.readYaml, (y) => y.includes("audience: Leadership team"));
  expect(yaml).toMatch(/sources:\n\s+- Q3 report\n\s+- Customer survey/);
});

test("template editor validates, previews and saves into the deck folder", async ({ page }) => {
  await page.getByTestId("open-template-editor").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "New" }).click();
  await page.getByTestId("te-name").fill("team-grid");
  await expect(page.frameLocator("[data-testid=te-frame]").locator(".card")).toHaveCount(3);
  await expect(page.getByTestId("te-issues")).toContainText("No problems found");

  // Unknown slot reference.
  await dialog.getByRole("tab", { name: "HTML" }).click();
  await page.locator("[data-testid=te-code] .cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  // insertText avoids CodeMirror's auto-closing of brackets and tags.
  await page.keyboard.insertText("\n<p>{{ghost}}</p>");
  await expect(page.getByTestId("te-issues")).toContainText('Unknown slot "ghost"');

  // Overflow detection at 1280×720.
  await page.keyboard.insertText('\n<div style="height:2000px;flex:none">tall</div>');
  await expect(page.getByTestId("te-issues")).toContainText("Overflow at 1280×720");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText('<h1 id="{{slide.titleId}}">{{title}}</h1><p>{{eyebrow}}</p>{{#each cards}}<p>{{title}}</p>{{/each}}');
  await expect(page.getByTestId("te-issues")).toContainText("No problems found");

  await page.getByTestId("te-save").click();
  await expect(page.locator(".toast-success")).toContainText("Saved team-grid");
  const file = path.join(editor.dir, "templates/team-grid.html");
  await waitForFile(() => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""), (s) => s.includes("name: team-grid"));
  await dialog.getByRole("button", { name: "Close template editor" }).click();

  await page.getByTestId("add-slide").click();
  await expect(page.locator('.picker-card[data-template="team-grid"]')).toBeVisible();
});

test("Copilot edits the selected slide as one undoable turn (mocked SDK)", async ({ page }) => {
  await railItem(page, "zoom").click();
  await page.getByTestId("toggle-chat").click();
  await expect(page.getByRole("button", { name: "This slide", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("chat-input").fill("Polish this slide");
  await page.getByTestId("chat-send").click();
  await expect(page.locator(".msg-assistant").last()).toContainText("Done: ran get_deck, update_slide");
  await expect(page.locator(".tool-chip").filter({ hasText: "Updated slide" })).toBeVisible();
  await expect(railItem(page, "zoom")).toHaveClass(/is-changed/);
  await expect(stage(page).locator(".eyebrow").first()).toHaveText("Edited by Copilot");
  await waitForFile(editor.readYaml, (y) => y.includes("eyebrow: Edited by Copilot"));

  await page.getByTestId("undo-agent").click();
  await expect(stage(page).locator(".eyebrow").first()).toHaveText("04 / Zoom into one step");
  await waitForFile(editor.readYaml, (y) => !y.includes("Edited by Copilot"));
});

test("Copilot whole-deck scope can restructure the deck (mocked SDK)", async ({ page }) => {
  await page.getByTestId("toggle-chat").click();
  await page.getByRole("button", { name: "Whole deck", exact: true }).click();
  const calls = [
    { name: "add_slide", args: { template: "resources", id: "links", data: { title: "Read more" } } },
    { name: "set_hidden", args: { id: "implementation", hidden: true } },
  ];
  await page.getByTestId("chat-input").fill(`#tools ${JSON.stringify(calls)}`);
  await page.keyboard.press("Enter");
  await expect(railItem(page, "links")).toBeVisible();
  await expect(railItem(page, "implementation")).toHaveClass(/is-hidden/);
  await expect(page.locator(".msg-actions")).toContainText("2 slides changed");
  await page.getByTestId("undo").click();
  await expect(railItem(page, "links")).toHaveCount(0);
  await expect(railItem(page, "implementation")).not.toHaveClass(/is-hidden/);
});

test("Copilot improves a text field and the change can be cancelled (mocked SDK)", async ({ page }) => {
  const eyebrow = page.locator('textarea[data-path="eyebrow"]');
  const button = page.locator('.field[data-path="eyebrow"]').getByTestId("ai-improve");
  const original = await eyebrow.inputValue();
  await expect(button).toHaveAttribute("aria-label", "Improve with Copilot");
  await button.click();
  await expect(eyebrow).toHaveValue(`Improved: ${original}`);
  await expect(stage(page).locator(".eyebrow")).toHaveText(`Improved: ${original}`);
  await waitForFile(editor.readYaml, (y) => y.includes("Improved: "));
  await expect(button).toHaveAttribute("data-state", "revert");
  await expect(button).toHaveAttribute("aria-label", /restore the previous text/);

  await button.click();
  await expect(eyebrow).toHaveValue(original);
  await waitForFile(editor.readYaml, (y) => !y.includes("Improved: "));
  await expect(button).toHaveAttribute("data-state", "improve");

  // Typing after an improvement drops the revert offer.
  await button.click();
  await expect(button).toHaveAttribute("data-state", "revert");
  await eyebrow.press("End");
  await eyebrow.pressSequentially("!");
  await expect(button).toHaveAttribute("data-state", "improve");
  // Empty fields have nothing to improve.
  await eyebrow.fill("");
  await expect(button).toBeDisabled();

  // Notes, list items and the deck goal get the button too; the chat input does not.
  await expect(page.locator(".ai-field:has(.notes-input) [data-testid=ai-improve]")).toBeVisible();
  await page.getByTestId("toggle-chat").click();
  await expect(page.locator(".ai-field:has([data-testid=chat-input])")).toHaveCount(0);
});

test("editor has no serious accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => ["serious", "critical"].includes(v.impact));
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
});

test("the served deck works under its CSP and blocks injected scripts", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Simulate a sanitizer bypass by tampering with the generated file.
  fs.writeFileSync(editor.html, editor.readHtml().replace("</main>", '<img src="x" onerror="window.__pwned=1"><script>window.__pwned=2</script></main>'));
  await page.goto(`${editor.origin}/deck/deck.html`);
  await expect(page.locator(".controls")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/#2$/);
  await page.keyboard.press("n");
  await expect(page.locator(".notes-panel")).toContainText("Same geometry");
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("the served viewer links back to the editor on the current slide", async ({ page }) => {
  await page.goto(`${editor.origin}/deck/deck.html#2`);
  const edit = page.locator("#df-edit");
  await expect(edit).toHaveAttribute("href", "/#slide-implementation");
  await page.keyboard.press("ArrowRight");
  await expect(edit).toHaveAttribute("href", "/#slide-lifecycle");
  await edit.click();
  await expect(page).toHaveURL(`${editor.origin}/`);
  await expect(railItem(page, "lifecycle")).toHaveAttribute("aria-current", "true");
  await page.goto(`${editor.origin}/deck/deck.html#4`);
  await page.keyboard.press("e");
  await expect(page).toHaveURL(`${editor.origin}/`);
  await expect(railItem(page, "zoom")).toHaveAttribute("aria-current", "true");
});
test("template switches are labelled, reversible and keep content", async ({ page }) => {
  await railItem(page, "concept").click();
  await page.getByTestId("change-template").click();
  await page.locator('.picker-card[data-template="title"]').click();
  await page.getByRole("button", { name: "Apply template" }).click();
  await expect(page.locator(".toast")).toContainText("Slide 1: Concept map → Title");
  await expect(page.getByTestId("undo")).toHaveAttribute("title", /Undo Slide 1: Concept map → Title/);
  // Navigation title follows the headline; samples are placeholders.
  await expect(railItem(page, "concept").locator(".rail-title")).toHaveText("From isolated tasks. To a shared workflow.");
  await expect(stage(page).locator('df-slot[data-df-slot="presenter"]')).toHaveAttribute("data-df-placeholder", "");
  await expect(page.locator('.field[data-path="presenter"] .badge-sample')).toBeVisible();
  await expect(page.getByTestId("stash-note")).toContainText("audiences");
  const html = await waitForFile(editor.readHtml, (h) => h.includes('data-template="title"'));
  expect(html).not.toContain("Presenter name");
  expect(html).toContain('data-title="From isolated tasks. To a shared workflow."');

  // Switch back: the original concept map content comes back.
  await page.getByTestId("change-template").click();
  await page.locator('.picker-card[data-template="concept-map"]').click();
  await page.getByRole("button", { name: "Apply template" }).click();
  await expect(stage(page).locator(".lane h3").first()).toHaveText("Prepare");
  await expect(stage(page).locator(".capability")).toHaveCount(4);
  await expect(page.getByTestId("stash-note")).toHaveCount(0);
  await waitForFile(editor.readYaml, (y) => !y.includes("stash:") && y.includes("- Permissions"));
});

test("Copilot template changes are announced (mocked SDK)", async ({ page }) => {
  await page.getByTestId("toggle-chat").click();
  await page.getByRole("button", { name: "Whole deck", exact: true }).click();
  await page.getByTestId("chat-input").fill(`#tools ${JSON.stringify([{ name: "set_template", args: { id: "zoom", template: "bullets" } }])}`);
  await page.keyboard.press("Enter");
  await expect(page.locator(".tool-chip")).toContainText("Changed template · Slide 4: Problem → response → Key points");
  await expect(page.locator(".toast")).toContainText("Copilot changed the layout · Slide 4: Problem → response → Key points");
  // The custom navigation title is kept, so the rail also names the new layout.
  await expect(railItem(page, "zoom").locator(".rail-title")).toHaveText("Problem to response");
  await expect(railItem(page, "zoom").locator(".rail-layout")).toHaveText("Key points");
});
