import { test, expect } from "@playwright/test";
import { startEditor } from "./helpers.js";

test("explains how to sign in when Copilot is unavailable (mocked SDK)", async ({ page }) => {
  const editor = await startEditor({ env: { DECKFORGE_MOCK_AUTH: "fail" } });
  try {
    await page.goto(editor.editorUrl);
    await page.getByTestId("toggle-chat").click();
    await page.getByTestId("chat-input").fill("Hello");
    await page.getByTestId("chat-send").click();
    const alert = page.locator(".msg-error");
    await expect(alert).toContainText("Copilot is not available");
    await expect(alert).toContainText("Not signed in to GitHub Copilot");
    await expect(alert.locator("pre")).toHaveText("gh auth login");
  } finally {
    await editor.stop();
  }
});
