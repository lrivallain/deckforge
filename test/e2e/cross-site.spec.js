import { test, expect } from "@playwright/test";
import { startEditor } from "./helpers.js";

let editor;
test.beforeEach(async () => {
  editor = await startEditor();
});
test.afterEach(async () => {
  await editor?.stop();
});

// Hosts like the GitHub Copilot app's webview start navigations from another
// site (tauri://localhost). The token cookie must survive that redirect.
test("opens the editor from a cross-site top-level navigation", async ({ page }) => {
  const elsewhere = "http://deckforge-elsewhere.test/";
  await page.route(elsewhere, (route) =>
    route.fulfill({ contentType: "text/html", body: `<a id="open" href="${editor.editorUrl}">Open the editor</a>` }),
  );
  await page.goto(elsewhere);
  await page.click("#open");
  await expect(page).toHaveURL(`${editor.origin}/`);
  await expect(page.locator(".rail-item")).toHaveCount(4);
});
