import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("hands the conversation to Copilot CLI or the app, shows its changes live and takes it back (mocked SDK)", async ({ page }) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-e2e-copilot-"));
  const opened = path.join(home, "opened.txt");
  const editor = await startEditor({ env: { COPILOT_HOME: home, DECKFORGE_OPEN_LOG: opened } });
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

    // Copilot app: the deep link, and the global deck tools.
    await dialog.getByTestId("open-app").click();
    await expect(page.locator(".toast").filter({ hasText: "Confirm in the Copilot app" })).toBeVisible();
    await expect.poll(() => (fs.existsSync(opened) ? fs.readFileSync(opened, "utf8") : "")).toMatch(/^ghapp:\/\/sessions\/mock-\d+\n$/);
    await dialog.getByTestId("install-tools").click();
    await expect(dialog.getByTestId("handoff-tools")).toContainText("Deck tools are available in every Copilot session");
    expect(JSON.parse(fs.readFileSync(path.join(home, "mcp-config.json"), "utf8")).mcpServers.deckforge.args.at(-1)).toBe("mcp");

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("chat-link")).toContainText("Continued outside the editor");

    // Copilot CLI edits the deck through `deckforge mcp`: the editor follows live.
    const [result] = await mcp(editor.dir, [{ id: 1, method: "tools/call", params: { name: "update_slide", arguments: { id: "zoom", set: { eyebrow: "Edited from the CLI" } } } }]);
    expect(result.result.isError).toBe(false);
    await expect(stage(page).locator(".eyebrow").first()).toHaveText("Edited from the CLI");
    await expect(railItem(page, "zoom")).toHaveClass(/is-changed/);
    await expect(page.locator(".toast").filter({ hasText: "Copilot is editing this deck from outside the editor" })).toBeVisible();
    await waitForFile(editor.readYaml, (y) => y.includes("eyebrow: Edited from the CLI"));

    // Sending a message here takes the conversation back.
    await page.getByTestId("chat-input").fill("Polish it again");
    await page.getByTestId("chat-send").click();
    await expect(page.locator(".msg-assistant").last()).toContainText("Done: ran get_deck, update_slide");
    await expect(page.getByTestId("chat-link")).not.toContainText("Continued outside the editor");
    await expect(page.locator(".msg-user")).toHaveText(["Polish this slide", "Polish it again"]);
  } finally {
    await editor.stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
