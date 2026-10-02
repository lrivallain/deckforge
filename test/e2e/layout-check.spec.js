// The Copilot skill's in-page layout check (skills/deckforge/scripts/layout-check.js)
// on real deckforge output: clean on the starter, precise on a broken deck.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { CLI, ROOT, tempDeck } from "./helpers.js";

const body = fs.readFileSync(path.join(ROOT, "skills/deckforge/scripts/layout-check.js"), "utf8");
const check = (page) => page.evaluate(`(async () => { ${body} })()`);

test("the starter deck passes the layout check at 1280×720", async ({ page }) => {
  const deck = tempDeck();
  try {
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto(`file://${deck.html}`);
    const report = await check(page);
    expect(report).toMatchObject({ ok: true, checked: 4, problems: [] });
  } finally {
    deck.cleanup();
  }
});

test("the example deck built by the skill passes the layout check", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto(`file://${path.join(ROOT, "examples/agent-native/deck.html")}`);
  const report = await check(page);
  expect(report).toMatchObject({ ok: true, checked: 8, problems: [] });
});

test("the layout check reports covering, overlapping and out-of-bounds overlays", async ({ page }) => {
  const deck = tempDeck();
  try {
    fs.writeFileSync(deck.yaml, `meta: { title: T, theme: build }
slides:
  - id: one
    template: bullets
    data: { title: A headline, points: [One, Two], takeaway: A short takeaway }
    overlays:
      - { id: cov, kind: callout, x: 3, y: 8, w: 40, h: 10, z: 1, data: { text: Covering } }
      - { id: out, kind: shape, x: 90, y: 2, w: 20, h: 4, z: 2, data: { shape: rounded } }
      - { id: bar, kind: callout, x: 70, y: 84, w: 20, h: 6, z: 3, data: { text: On the bar } }
  - id: two
    template: section
    data: { number: "02", title: Clean }
`);
    execFileSync(process.execPath, [CLI, "build", deck.dir], { stdio: "pipe" });
    await page.goto(`file://${deck.html}`);
    const report = await check(page);
    expect(report.ok).toBe(false);
    expect(report.checked).toBe(2);
    expect(report.problems.map((p) => p.id)).toEqual(["one"]);
    const [one] = report.problems;
    expect(one.size).toBe("1280×720");
    expect(one.covering).toEqual([expect.objectContaining({ overlay: "cov", covers: expect.stringContaining("A headline") })]);
    expect(one.outside).toEqual([expect.objectContaining({ element: "overlay out", right: 128 })]);
    expect(one.overlapping).toEqual([expect.objectContaining({ overlay: "bar", overlaps: expect.stringContaining("A short takeaway") })]);
  } finally {
    deck.cleanup();
  }
});
