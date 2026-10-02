// Regenerate the documentation screenshots from the example decks.
// Usage: npm run docs:screenshots   (node scripts/screenshots.js [--only editor,themes,…])
// Needs Playwright's Chromium (npx playwright install chromium). Copilot is
// mocked (scripts/docs-agent-mock.js): no network, no sign-in.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { parseDeckYaml, sampleData, stringifyDeck } from "../src/core/index.js";
import { loadTemplates, loadThemes } from "../src/server/registry.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin/deckforge.js");
const OUT = path.join(ROOT, "docs/public/screenshots");
const SKY = path.join(ROOT, "examples/aurora/assets/aurora-sky.svg");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
const wanted = (group) => !only || only.includes(group);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-shots-"));
// Never pick up the developer's own templates or themes (here and in the CLI children).
process.env.DECKFORGE_CONFIG_DIR = path.join(scratch, "config");
const env = { ...process.env, DECKFORGE_AGENT_MOCK: path.join(ROOT, "scripts/docs-agent-mock.js") };
const children = new Set();

function makeDeck(name, { example = "starter", edit } = {}) {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(ROOT, "examples", example);
  if (fs.existsSync(path.join(source, "assets"))) fs.cpSync(path.join(source, "assets"), path.join(dir, "assets"), { recursive: true });
  const data = parseDeckYaml(fs.readFileSync(path.join(source, "deck.yaml"), "utf8"));
  fs.writeFileSync(path.join(dir, "deck.yaml"), stringifyDeck(edit ? edit(data, dir) ?? data : data));
  execFileSync(process.execPath, [CLI, "build", dir], { env, stdio: "pipe" });
  return dir;
}

async function startEditor(dir) {
  const token = "docs";
  const child = spawn(process.execPath, [CLI, "edit", dir, "--port", "0", `--token=${token}`, "--no-open"], { env, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  let output = "";
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`editor did not start:\n${output}`)), 15000);
    const onData = (chunk) => {
      output += chunk;
      const match = /Editor: (http:\/\/127\.0\.0\.1:\d+)\/\?token=/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`editor exited (${code}):\n${output}`)));
  });
  return {
    url: `${origin}/?token=${token}`,
    async stop() {
      child.kill("SIGTERM");
      await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)));
      children.delete(child);
    },
  };
}

const saved = [];
async function save(target, name, options = {}) {
  const file = path.join(OUT, `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await target.screenshot({ path: file, ...options });
  saved.push(path.relative(ROOT, file));
}

const browser = await chromium.launch();
const newPage = (viewport, deviceScaleFactor = 1) => browser.newPage({ viewport, deviceScaleFactor, reducedMotion: "reduce", colorScheme: "light" });

/** Screenshot slide `n` (1-based) of a built deck, slide only. */
async function slideShots(dir, shots) {
  const page = await newPage({ width: 1280, height: 860 }, 0.75);
  for (const [n, name] of shots) {
    await page.goto(`file://${path.join(dir, "deck.html")}#${n}`);
    const slide = page.locator(".stage > .slide:not([hidden])");
    await slide.waitFor();
    await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode().catch(() => {}))]));
    await save(slide, name);
  }
  await page.close();
}

// Let previews render and images decode; drop transient toasts.
async function settle(page) {
  await page.waitForTimeout(400);
  for (const frame of page.frames()) {
    await frame.evaluate(() => Promise.all([...document.images].map((img) => img.decode().catch(() => {})))).catch(() => {});
  }
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
}

async function editorShots() {
  const starter = makeDeck("editor-starter");
  const editor = await startEditor(starter);
  const page = await newPage({ width: 1440, height: 900 });
  try {
    await page.goto(editor.url);
    await page.locator(".rail-item").first().waitFor();
    await page.locator('.rail-item[data-id="lifecycle"]').click();
    await settle(page);
    await save(page, "editor");

    await page.getByTestId("add-slide").click();
    await page.locator(".picker-card").first().waitFor();
    await settle(page);
    await save(page, "picker");
    await page.keyboard.press("Escape");

    await page.getByTestId("open-template-editor").click();
    await page.getByRole("dialog").getByRole("button", { name: "New" }).click();
    await page.getByTestId("te-name").fill("team-grid");
    await page.getByTestId("te-issues").getByText("No problems found").waitFor();
    await settle(page);
    await save(page, "template-editor");
    await page.getByRole("dialog").getByRole("button", { name: "Close template editor" }).click();

    await page.getByTestId("open-theme-editor").click();
    await page.getByTestId("th-prompt").fill("Calm forest greens with a warm copper accent, for a sustainability report");
    await page.getByTestId("th-generate").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=th-label]")?.value === "Forest copper");
    await page.getByTestId("th-name").fill("forest-copper");
    await page.getByTestId("th-issues").getByText("No problems found").waitFor();
    await settle(page);
    await save(page, "theme-editor");
    await page.getByRole("dialog").getByRole("button", { name: "Close theme editor" }).click();

    await page.locator('.rail-item[data-id="zoom"]').click();
    await page.getByTestId("toggle-chat").click();
    await page.getByTestId("chat-input").fill("Write concise speaker notes for this slide and tighten the problem text.");
    await page.getByTestId("chat-send").click();
    await page.locator(".msg-assistant").last().getByText("Tightened").waitFor();
    await page.mouse.move(700, 880);
    await settle(page);
    await save(page, "copilot");
  } finally {
    await page.close();
    await editor.stop();
  }

  const aurora = makeDeck("editor-aurora", {
    example: "aurora",
    edit(deck) {
      deck.slides.find((s) => s.id === "results").overlays = [
        { id: "note", kind: "callout", x: 34, y: 66.5, w: 26, h: 11, z: 2, data: { text: "<strong>Measured</strong> over two quarters", tone: "accent", align: "left" } },
        { id: "arrow", kind: "arrow", x: 21.5, y: 63, w: 12, h: 6, z: 1, rotate: 20, data: { color: "accent", head: "start", weight: "regular", line: "solid" } },
      ];
    },
  });
  const editor2 = await startEditor(aurora);
  const page2 = await newPage({ width: 1440, height: 900 });
  try {
    await page2.goto(editor2.url);
    await page2.locator('.rail-item[data-id="results"]').click();
    const frame = page2.frameLocator("[data-testid=stage-frame]");
    await frame.locator(".df-ov-callout").click({ position: { x: 6, y: 6 } });
    await page2.getByTestId("overlay-panel").waitFor();
    await settle(page2);
    await save(page2, "editor-overlays");

    await page2.keyboard.press("Escape");
    await page2.locator('.rail-item[data-id="interlude"]').click();
    await page2.getByText("Alt text").first().waitFor();
    await settle(page2);
    await save(page2, "editor-image");
  } finally {
    await page2.close();
    await editor2.stop();
  }
}

async function viewerShots() {
  const dir = makeDeck("viewer");
  const page = await newPage({ width: 1440, height: 900 });
  await page.goto(`file://${path.join(dir, "deck.html")}#1`);
  await page.locator(".controls").waitFor();
  await page.locator("#df-notes").click();
  await page.locator(".notes-panel").waitFor();
  await save(page, "viewer-notes");
  await page.close();

  const aurora = makeDeck("viewer-aurora", { example: "aurora" });
  await slideShots(aurora, [[1, "aurora-cover"]]);
}

async function themeShots() {
  for (const theme of Object.keys(loadThemes(scratch).themes).sort()) {
    const dir = makeDeck(`theme-${theme}`, {
      example: "aurora",
      edit(deck) {
        deck.meta.theme = theme;
      },
    });
    await slideShots(dir, [[1, `themes/${theme}`], [6, `themes/${theme}-metric`]]);
  }
}

async function templateShots() {
  const { templates } = loadTemplates(scratch);
  const names = Object.keys(templates).sort();
  const dir = makeDeck("templates", {
    edit(deck, deckDir) {
      fs.mkdirSync(path.join(deckDir, "assets"), { recursive: true });
      fs.copyFileSync(SKY, path.join(deckDir, "assets/aurora-sky.svg"));
      deck.meta.theme = "build";
      deck.slides = names.map((name) => {
        const data = sampleData(templates[name]);
        for (const [key, slot] of Object.entries(templates[name].slots)) {
          if (slot.type === "image") data[key] = { src: "assets/aurora-sky.svg", alt: "Abstract night sky", fit: "cover", focus: "50% 40%" };
        }
        return { id: name, template: name, title: templates[name].label || name, data };
      });
    },
  });
  await slideShots(dir, names.map((name, i) => [i + 1, `templates/${name}`]));
}

try {
  fs.mkdirSync(OUT, { recursive: true });
  if (wanted("editor")) await editorShots();
  if (wanted("viewer")) await viewerShots();
  if (wanted("themes")) await themeShots();
  if (wanted("templates")) await templateShots();
  for (const file of saved) console.log(file);
} finally {
  await browser.close();
  for (const child of children) child.kill("SIGTERM");
  fs.rmSync(scratch, { recursive: true, force: true });
}
