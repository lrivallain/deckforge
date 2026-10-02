// The technical starter decks: built inline, they load nothing from the
// network, pass the layout check at 1280×720, and their charts measure
// within 1% of the figures in deck.yaml.

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import YAML from "yaml";
import { ROOT, tempDeck } from "./helpers.js";

const body = fs.readFileSync(path.join(ROOT, "skills/deckforge/scripts/layout-check.js"), "utf8");
const STARTERS = ["architecture-review", "postmortem", "assessment", "decision-record"];

for (const name of STARTERS) {
  test(`the ${name} starter is offline and fits 1280×720`, async ({ page }) => {
    const deck = tempDeck({ example: name, runtime: "inline" });
    try {
      const remote = [];
      page.on("request", (request) => {
        if (!/^(file|data|about):/.test(request.url())) remote.push(request.url());
      });
      const slides = YAML.parse(fs.readFileSync(deck.yaml, "utf8")).slides.filter((s) => !s.hidden);
      const hasSources = slides.some((s) => s.sources);
      await page.setViewportSize({ width: 900, height: 600 });
      await page.goto(`file://${deck.html}`);
      const report = await page.evaluate(`(async () => { ${body} })()`);
      expect(report).toMatchObject({ ok: true, checked: slides.length + (hasSources ? 1 : 0), problems: [] });
      expect(remote).toEqual([]);
      // Every slide, the generated Sources appendix included, passes axe.
      await page.goto(`file://${deck.html}#1`);
      await page.locator("#df-static").click();
      const total = await page.locator(".stage > .slide").count();
      for (let i = 0; i < total; i++) {
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`), `slide ${i + 1}`).toEqual([]);
        await page.keyboard.press("ArrowRight");
      }
    } finally {
      deck.cleanup();
    }
  });
}

const within1 = (actual, expected) => expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThan(1);
// The viewer presents one slide at a time: open the one to measure.
async function show(page, deck, id) {
  await page.goto(`file://${deck.html}#slide-${id}`);
  await expect(page.locator(`#slide-${id}`)).toBeVisible();
}
const dataOf = (deck, template) => YAML.parse(fs.readFileSync(deck.yaml, "utf8")).slides.filter((s) => s.template === template).map((s) => ({ id: s.id, ...s.data }));

test("chart templates measure within 1% of their values", async ({ page }) => {
  const decks = Object.fromEntries(["architecture-review", "assessment", "decision-record"].map((n) => [n, tempDeck({ example: n, runtime: "inline" })]));
  try {
    await page.setViewportSize({ width: 1400, height: 900 });

    // Horizontal and vertical bars: length / track content length = value / largest row total.
    for (const deck of [decks["architecture-review"], decks["decision-record"]]) {
      for (const slide of dataOf(deck, "bars")) {
        await show(page, deck, slide.id);
        const scale = Math.max(...slide.items.map((i) => (i.value || 0) + (i.projected || 0)));
        const measured = await page.$$eval(`#slide-${slide.id} .bar-row`, (rows, vertical) => rows.map((row) => {
          const track = row.querySelector(".track");
          const cs = getComputedStyle(track);
          const length = vertical
            ? track.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
            : track.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          return [...row.querySelectorAll(".bar")].map((bar) => ((vertical ? bar.getBoundingClientRect().height : bar.getBoundingClientRect().width) / length) * 100);
        }), Boolean(slide.vertical));
        expect(measured).toHaveLength(slide.items.length);
        expect(measured.flat().every((v) => v > 0)).toBe(true);
        slide.items.forEach((item, i) => {
          within1(measured[i][0], (item.value / scale) * 100);
          if (item.projected) within1(measured[i][1], (item.projected / scale) * 100);
        });
      }
    }

    const assessment = decks.assessment;

    // Donut: each arc covers value / total of the circumference, starting where the previous one ended.
    const [donut] = dataOf(assessment, "donut");
    await show(page, assessment, donut.id);
    const total = donut.items.reduce((a, i) => a + i.value, 0);
    const arcs = await page.$$eval(`#slide-${donut.id} circle.segment`, (circles) => circles.map((c) => {
      const circumference = c.getTotalLength();
      const [dash] = getComputedStyle(c).strokeDasharray.split(/[ ,]+/).map(parseFloat);
      return { share: (dash / circumference) * 100, start: (-parseFloat(getComputedStyle(c).strokeDashoffset) / circumference) * 100 };
    }));
    let start = 0;
    donut.items.forEach((item, i) => {
      within1(arcs[i].share, (item.value / total) * 100);
      within1(arcs[i].start, start);
      start += (item.value / total) * 100;
    });

    // Current vs target: both stacks on the scale of the larger total.
    const [compare] = dataOf(assessment, "compare-bars");
    await show(page, assessment, compare.id);
    const sum = (key) => compare.segments.reduce((a, s) => a + s[key], 0);
    const scale = Math.max(sum("current"), sum("target"));
    const rows = await page.$$eval(`#slide-${compare.id} .track`, (tracks) => tracks.map((track) => [...track.children].map((seg) => (seg.getBoundingClientRect().width / track.getBoundingClientRect().width) * 100)));
    compare.segments.forEach((segment, i) => {
      within1(rows[0][i], (segment.current / scale) * 100);
      within1(rows[1][i], (segment.target / scale) * 100);
    });

    // Table: the computed total row matches the column sums.
    const [table] = dataOf(assessment, "table");
    await show(page, assessment, table.id);
    const totals = await page.$$eval(`#slide-${table.id} tfoot td`, (cells) => cells.map((c) => Number(c.textContent.replace(/,/g, ""))));
    expect(totals).toEqual(["v1", "v2", "v3", "v4"].map((k) => Math.round(table.rows.reduce((a, r) => a + r[k], 0) * 1000) / 1000));
  } finally {
    for (const deck of Object.values(decks)) deck.cleanup();
  }
});
