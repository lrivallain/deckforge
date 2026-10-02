import { spawn } from "node:child_process";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { CLI, startEditor, waitForFile } from "./helpers.js";

const stage = (page) => page.frameLocator("[data-testid=stage-frame]");
const railItem = (page, id) => page.locator(`.rail-item[data-id="${id}"]`);

/** One `deckforge mcp` run: send JSON-RPC messages, collect the responses. */
function mcp(deckDir, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, "mcp", deckDir], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", () => resolve(out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))));
    child.stdin.end(messages.map((m) => JSON.stringify({ jsonrpc: "2.0", ...m })).join("\n") + "\n");
  });
}

test("hands the conversation to Copilot CLI, shows its changes live and takes it back (mocked SDK)", async ({ page }) => {
  const editor = await startEditor();
  try {
    await page.goto(editor.editorUrl);
    await railItem(page, "zoom").click();
    await page.getByTestId("toggle-chat").click();
    await page.getByTestId("chat-input").fill("Polish this slide");
    await page.getByTestId("chat-send").click();
    await expect(page.locator(".msg-assistant").last()).toContainText("Done: ran get_deck, update_slide");
    await expect(page.getByTestId("chat-link")).toContainText("Session mock-");

    await page.getByTestId("continue-cli").click();
    const dialog = page.getByTestId("handoff-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("handoff-command")).toContainText(/copilot --resume mock-\d+ -C .* --additional-mcp-config @.*\.json --allow-tool deckforge/);
    const axe = await new AxeBuilder({ page }).include("[data-testid=handoff-dialog]").analyze();
    expect(axe.violations).toEqual([]);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("chat-link")).toContainText("Continued in Copilot CLI");

    // Copilot CLI edits the deck through `deckforge mcp`: the editor follows live.
    const [result] = await mcp(editor.dir, [{ id: 1, method: "tools/call", params: { name: "update_slide", arguments: { id: "zoom", set: { eyebrow: "Edited from the CLI" } } } }]);
    expect(result.result.isError).toBe(false);
    await expect(stage(page).locator(".eyebrow").first()).toHaveText("Edited from the CLI");
    await expect(railItem(page, "zoom")).toHaveClass(/is-changed/);
    await expect(page.locator(".toast")).toContainText("Copilot CLI is editing this deck");
    await waitForFile(editor.readYaml, (y) => y.includes("eyebrow: Edited from the CLI"));

    // Sending a message here takes the conversation back.
    await page.getByTestId("chat-input").fill("Polish it again");
    await page.getByTestId("chat-send").click();
    await expect(page.locator(".msg-assistant").last()).toContainText("Done: ran get_deck, update_slide");
    await expect(page.getByTestId("chat-link")).not.toContainText("Continued in Copilot CLI");
    await expect(page.locator(".msg-user")).toHaveText(["Polish this slide", "Polish it again"]);
  } finally {
    await editor.stop();
  }
});
