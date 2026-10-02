// Regenerate the validation report of an example deck, as the deckforge Copilot skill checks it:
// `deckforge build --json`, then skills/deckforge/scripts/layout-check.js on every slide at 1280×720.
// Usage: node scripts/validate-example.js [examples/agent-native]   (writes <dir>/validation.json)
// Needs Playwright's Chromium (npx playwright install chromium).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.resolve(process.argv[2] || path.join(ROOT, "examples/agent-native"));
const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");

const run = spawnSync(process.execPath, [path.join(ROOT, "bin/deckforge.js"), "build", dir, "--json"], { encoding: "utf8" });
const build = JSON.parse(run.stdout);
if (!build.outPath) {
  console.error(run.stdout || run.stderr);
  process.exit(1);
}

const check = fs.readFileSync(path.join(ROOT, "skills/deckforge/scripts/layout-check.js"), "utf8");
const browser = await chromium.launch();
let layout;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(pathToFileURL(build.outPath).href);
  layout = await page.evaluate(`(async () => { ${check} })()`);
} finally {
  await browser.close();
}
delete layout.note;

const report = {
  deck: rel(build.deck),
  commands: [`deckforge build ${rel(dir)} --json`, "skills/deckforge/scripts/layout-check.js on deck.html at 1280×720 (Chromium)"],
  ok: build.ok && build.issues.length === 0 && layout.ok,
  build: { ok: build.ok, slides: build.slides, visibleSlides: build.visibleSlides, issues: build.issues, loadErrors: build.loadErrors, assets: build.assets },
  layout,
};
const out = path.join(dir, "validation.json");
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${rel(out)}: ${report.ok ? "ok" : "problems found"} (${build.slides} slides, ${build.issues.length} build issues, ${layout.problems.length} layout problems)`);
process.exit(report.ok ? 0 : 1);
