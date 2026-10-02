// Offline technical decks: number slots and data-driven charts, the chart and
// technical templates, sources, offline checks, notes stripping and diffs.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { chartStats, checkSlotLimits, formatNumber, parseTemplate, renderTemplate, sampleData } from "../../src/core/template.js";
import { normalizeDeck, parseDeckYaml, stringifyDeck, validateDeck } from "../../src/core/deck.js";
import { renderDeck } from "../../src/core/render.js";
import { findExternalReferences, OFFLINE_CSP } from "../../src/core/offline.js";
import { diffDecks, formatDiff } from "../../src/core/diff.js";
import { applyOp } from "../../src/core/ops.js";
import { loadTemplates, loadThemes } from "../../src/server/registry.js";
import { buildDeckObject } from "../../src/server/build.js";

const root = path.resolve(import.meta.dirname, "../..");
const cli = path.join(root, "bin/deckforge.js");
const env = { ...process.env, DECKFORGE_CONFIG_DIR: path.join(os.tmpdir(), "deckforge-test-no-config"), CI: "1" };
const { templates } = loadTemplates(null);
const { themes } = loadThemes(null);
const ctx = { slide: { title: "T", titleId: "t" }, deck: { lang: "en" } };

let dir;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});
const tmp = () => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-tech-")));

const CHART = parseTemplate(`---
name: chart
slots:
  items: { type: cards, fields: { label: text, value: number, extra: number } }
  stack: { type: cards, scale: total, fields: { label: text, a: number, b: number } }
---
{{#each items}}<i data-pct="{{@pct.value}}" data-extra="{{@pct.extra}}" data-share="{{@share.value}}" data-start="{{@start.value}}">{{label}}={{value}} {{@percent.value}}%</i>{{/each}}
{{#each stack}}<b data-a="{{@pct.a}}" data-b="{{@pct.b}}"></b>{{/each}}
sum={{items.@sum.value}} max={{items.@max.value}} min={{items.@min.value}} avg={{items.@avg.value}} n={{items.@count}}
{{#if items.@sum.extra}}has-extra{{/if}}`);

const attrs = (html, name) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => Number(m[1]));

describe("number slots and chart values", () => {
  it("formats numbers for the deck language, without float noise", () => {
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
    expect(formatNumber(0.1 + 0.2, "en")).toBe("0.3");
    expect(formatNumber(1234.5, "fr").replace(/\s/g, " ")).toBe("1 234,5");
    expect(formatNumber(3, "not a locale!")).toBe("3");
  });

  it("computes bar sizes, shares and totals from the values", () => {
    const html = renderTemplate(CHART, { items: [{ label: "a", value: 30, extra: 10 }, { label: "b", value: "20" }, { label: "c", value: 0.5 }, { label: "d", value: -4 }] }, ctx);
    // @pct: % of the largest row total (value + extra = 40).
    expect(attrs(html, "data-pct")).toEqual([75, 50, 1.25, 0]);
    expect(attrs(html, "data-extra")).toEqual([25, 0, 0, 0]);
    // @share/@start: % of the field total (negative values count as 0).
    expect(attrs(html, "data-share")).toEqual([59.406, 39.604, 0.99, 0]);
    expect(attrs(html, "data-start")).toEqual([0, 59.406, 99.01, 100]);
    expect(html).toContain("a=30 59%");
    expect(html).toContain("c=0.5 1%");
    expect(html).toContain("sum=46.5 max=30 min=-4 avg=11.625 n=4");
    expect(html).toContain("has-extra");
  });

  it("puts several number fields on one scale with scale: total", () => {
    const html = renderTemplate(CHART, { stack: [{ a: 30, b: 10 }, { a: 20, b: 10 }] }, ctx);
    expect(attrs(html, "data-a")).toEqual([60, 40]);
    expect(attrs(html, "data-b")).toEqual([20, 20]);
    expect(chartStats([], CHART.slots.stack)).toEqual([]);
  });

  it("never edits numbers inline and never fails on bad values", () => {
    const html = renderTemplate(CHART, { items: [{ label: "a", value: "n/a" }] }, { ...ctx, edit: true });
    expect(html).toContain("=n/a");
    expect(html).not.toContain('data-df-slot="items.0.value"');
    expect(html).toContain('data-df-slot="items.0.label"');
    expect(attrs(html, "data-pct")).toEqual([0]);
  });

  it("warns about non-numeric values and unknown card fields (an unquoted comma)", () => {
    const issues = checkSlotLimits(CHART, { items: [{ label: "a", value: "lots" }, { label: "b", value: 2, "c, d": null }] });
    expect(issues.map((i) => i.message)).toEqual([
      '"items.0.value" must be a number (got "lots")',
      '"items.1" has an unknown field "c, d" (quote values that contain commas)',
    ]);
    expect(() => parseTemplate("---\nname: x\nslots:\n  a: { type: cards, scale: weird }\n---\n{{#each a}}{{/each}}")).toThrow(/scale must be one of max, total/);
    expect(() => parseTemplate("---\nname: x\nslots:\n  a: { type: text, scale: total }\n---\n{{a}}")).toThrow(/scale only applies to cards/);
  });

  it("keeps numbers as real content when switching templates", () => {
    const deck = normalizeDeck({ meta: { title: "T" }, slides: [{ id: "a", template: "bars", data: { title: "Hi", items: [{ label: "x", value: 3 }] } }] });
    const { deck: next } = applyOp(deck, "set_template", { id: "a", template: "donut" }, { templates });
    expect(next.slides[0].data.items).toEqual([{ label: "x", value: 3 }]);
    expect(next.slides[0].placeholders || []).not.toContain("items");
  });
});

const CHART_TEMPLATES = ["bars", "donut", "compare-bars", "kpis", "table"];
const TECH_TEMPLATES = ["timeline", "options-matrix", "risk-register", "decision", "funnel", "checklist", "sources"];

describe("chart and technical templates", () => {
  it("load cleanly and render their samples", () => {
    for (const name of [...CHART_TEMPLATES, ...TECH_TEMPLATES]) {
      const template = templates[name];
      expect(template, name).toBeTruthy();
      expect(template.issues, name).toEqual([]);
      expect(checkSlotLimits(template, sampleData(template)), name).toEqual([]);
      expect(renderTemplate(template, sampleData(template), ctx), name).toContain('id="t"');
    }
  });

  it("sizes bars from the values (within 1%)", () => {
    const items = [{ label: "A", value: 412 }, { label: "B", value: 37.5, projected: 12.5 }, { label: "C", value: 3 }];
    const html = renderTemplate(templates.bars, { title: "x", items }, ctx);
    const sizes = [...html.matchAll(/class="bar( projected)?"[^>]*style="--size: ([\d.]+)%"/g)].map((m) => Number(m[2]));
    expect(sizes).toHaveLength(4);
    const expected = [412 / 412, 37.5 / 412, 12.5 / 412, 3 / 412].map((v) => v * 100);
    sizes.forEach((size, i) => expect(Math.abs(size - expected[i])).toBeLessThan(1));
    expect(html).toMatch(/<table class="sr-only">[\s\S]*<th scope="row">A<\/th><td>412 <\/td>/);
    expect(html).toContain('role="img" aria-label="T: A 412 ; B 37.5  (+12.5 ); C 3 "');
  });

  it("draws donut segments from the values (within 1%)", () => {
    const values = [504, 216, 168, 114, 48];
    const html = renderTemplate(templates.donut, { title: "x", items: values.map((value, i) => ({ label: `S${i}`, value })) }, ctx);
    const total = values.reduce((a, b) => a + b, 0);
    const dash = [...html.matchAll(/stroke-dasharray="([\d.]+) 100" stroke-dashoffset="-([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    let start = 0;
    dash.forEach(([length, offset], i) => {
      expect(Math.abs(length - (values[i] / total) * 100)).toBeLessThan(1);
      expect(Math.abs(offset - start)).toBeLessThan(1);
      start += (values[i] / total) * 100;
    });
    expect(html).toContain("<strong>1,050</strong>");
    expect(html).toContain("<td>48 </td><td>4.6%</td>");
  });

  it("puts current and target on one scale and totals the table", () => {
    const compare = renderTemplate(templates["compare-bars"], { title: "x", segments: [{ label: "a", current: 60, target: 30 }, { label: "b", current: 40, target: 20 }] }, ctx);
    expect([...compare.matchAll(/--size: ([\d.]+)%/g)].map((m) => Number(m[1]))).toEqual([60, 40, 30, 20]);
    const table = renderTemplate(templates.table, { title: "x", col1: "A", col2: "B", totalLabel: "Total", rows: [{ label: "r1", v1: 1.1, v2: 10 }, { label: "r2", v1: 2.2, v2: 1000 }] }, ctx);
    expect(table).toContain('<td class="num">3.3</td><td class="num">1,010</td>');
    expect(table).not.toContain("v3");
  });
});

const DECK = `meta: { title: Sources, theme: build }
slides:
  - id: one
    template: bars
    data: { title: Cost, items: [{ label: a, value: 1 }] }
    sources:
      - Internal export
      - { label: Price list, href: "https://example.com/prices" }
    notes: Say this.
  - id: two
    template: statement
    title: Hello
    data: { text: Hello }
    sources: https://example.com/report
`;

describe("sources", () => {
  it("are kept in deck.yaml", () => {
    const deck = parseDeckYaml(DECK);
    expect(deck.slides[0].sources).toEqual(["Internal export", { label: "Price list", href: "https://example.com/prices" }]);
    expect(deck.slides[1].sources).toEqual(["https://example.com/report"]);
    expect(parseDeckYaml(stringifyDeck(deck))).toEqual(deck);
    expect(() => parseDeckYaml("slides:\n  - { id: a, template: x, sources: [[1]] }")).toThrow(/Slide a: Each source/);
  });

  it("are listed in the notes and on a generated appendix slide", () => {
    const deck = parseDeckYaml(DECK);
    const html = renderDeck(deck, { templates, theme: themes.build });
    expect(html).toContain('<p class="notes-sources">Sources: Internal export; Price list (https://example.com/prices)</p>');
    const appendix = html.slice(html.indexOf('id="slide-sources"'));
    expect(appendix).toContain('data-template="sources"');
    expect(appendix).toContain('<span class="num">01</span><span class="where">Cost</span><span class="what">Internal export</span>');
    expect(appendix).toContain('<span class="num"></span><span class="where"></span><span class="what"><a href="https://example.com/prices"');
    expect(appendix).toContain('<span class="num">02</span><span class="where">Hello</span>');
    expect(appendix).toContain("03 / 03");
    expect(html).toContain("/* template: sources */");
  });

  it("can be renamed or turned off, and notes stripped", () => {
    const renamed = renderDeck(parseDeckYaml(DECK.replace("theme: build", "theme: build, sourcesSlide: Références")), { templates, theme: themes.build });
    expect(renamed).toContain(">Références</h1>");
    const off = renderDeck(parseDeckYaml(DECK.replace("theme: build", "theme: build, sourcesSlide: false")), { templates, theme: themes.build });
    expect(off).not.toContain('data-template="sources"');
    const stripped = renderDeck(parseDeckYaml(DECK), { templates, theme: themes.build, stripNotes: true });
    expect(stripped).not.toContain("slide-notes");
    expect(stripped).not.toContain("Say this.");
    expect(stripped).toContain('data-template="sources"');
  });
});

describe("offline checks", () => {
  it("finds every network resource but not links or namespaces", () => {
    const html = `<svg xmlns="http://www.w3.org/2000/svg"></svg><a href="https://a.example">a</a>
<img src="https://cdn.example/i.png" srcset="x.png 1x, //b.example/x.png 2x"><link rel="stylesheet" href="https://f.example/x.css">
<script src="https://cdn.example/v.js"></script><script>const u = "https://inside.script";</script>
<style>@import "https://f.example/i.css"; .x { background: url(https://bg.example/x.png) }</style>
<div style="background-image: url(&quot;https://s.example/x.png&quot;)"></div><img src="data:image/png;base64,AAAA"><img src="assets/a.png">`;
    expect(findExternalReferences(html)).toEqual([
      { url: "https://bg.example/x.png", where: "<style>" },
      { url: "https://f.example/i.css", where: "<style>" },
      { url: "https://cdn.example/i.png", where: "<img src>" },
      { url: "//b.example/x.png", where: "<img srcset>" },
      { url: "https://f.example/x.css", where: "<link href>" },
      { url: "https://cdn.example/v.js", where: "<script src>" },
      { url: "https://s.example/x.png", where: "<div style>" },
    ]);
    expect(OFFLINE_CSP).toContain("default-src 'none'");
  });

  it("deckforge build --check-offline fails on the cdn runtime and https images", () => {
    const deckDir = tmp();
    fs.writeFileSync(path.join(deckDir, "deck.yaml"), `meta: { title: T }
slides:
  - id: a
    template: image
    data: { title: Picture, image: { src: "https://example.com/p.png", alt: A picture } }
`);
    const cdn = spawnSync(process.execPath, [cli, "build", deckDir, "--runtime", "cdn", "--check-offline", "--json"], { env, encoding: "utf8" });
    expect(cdn.status).toBe(2);
    const report = JSON.parse(cdn.stdout);
    expect(report.offline.ok).toBe(false);
    expect(report.offline.external.map((r) => r.url)).toEqual(expect.arrayContaining(["https://example.com/p.png", expect.stringContaining("cdn.jsdelivr.net")]));
    const inline = spawnSync(process.execPath, [cli, "build", deckDir, "--runtime", "inline", "--check-offline"], { env, encoding: "utf8" });
    expect(inline.status).toBe(2);
    expect(inline.stderr).toContain("Not offline: <img src> loads https://example.com/p.png");
    const plain = spawnSync(process.execPath, [cli, "build", deckDir, "--runtime", "inline"], { env, encoding: "utf8" });
    expect(plain.status).toBe(0);
    expect(fs.readFileSync(path.join(deckDir, "deck.html"), "utf8")).not.toContain("Content-Security-Policy");
  });

  it("embeds a theme's own font files in inline decks, and flags remote fonts", () => {
    const deckDir = tmp();
    fs.mkdirSync(path.join(deckDir, "themes"));
    fs.mkdirSync(path.join(deckDir, "fonts"));
    fs.writeFileSync(path.join(deckDir, "fonts/brand-700.woff2"), Buffer.from("wOF2-test-font"));
    const theme = (url) => `name: brand
label: Brand
palette: { bg: "#ffffff", paper: "#ffffff", line: "#eeeeee", ink: "#111111", muted: "#555555", node: "#fafafa", primary: "#0066cc", primary-soft: "#eef4ff", primary-line: "#ccddff", accent: "#cc6600", accent-soft: "#fff4e4", accent-line: "#f0c078" }
fonts:
  heading:
    family: Brand Sans
    faces:
      - { weight: 700, url: ${url} }
`;
    fs.writeFileSync(path.join(deckDir, "themes/brand.yaml"), theme("fonts/brand-700.woff2"));
    fs.writeFileSync(path.join(deckDir, "deck.yaml"), "meta: { title: T, theme: brand }\nslides:\n  - { id: a, template: statement, data: { text: Hi } }\n");
    const ok = spawnSync(process.execPath, [cli, "build", deckDir, "--runtime", "inline", "--check-offline"], { env, encoding: "utf8" });
    expect(ok.status, ok.stderr).toBe(0);
    const html = fs.readFileSync(path.join(deckDir, "deck.html"), "utf8");
    expect(html).toContain(`url("data:font/woff2;base64,${Buffer.from("wOF2-test-font").toString("base64")}") format("woff2")`);
    const local = spawnSync(process.execPath, [cli, "build", deckDir, "--runtime", "local"], { env, encoding: "utf8" });
    expect(local.status).toBe(0);
    expect(fs.readFileSync(path.join(deckDir, "deck.html"), "utf8")).toContain('url("fonts/brand-700.woff2")');
    fs.writeFileSync(path.join(deckDir, "themes/brand.yaml"), theme("https://fonts.example/brand.woff2"));
    const remote = spawnSync(process.execPath, [cli, "build", deckDir, "--runtime", "inline", "--check-offline"], { env, encoding: "utf8" });
    expect(remote.status).toBe(2);
    expect(remote.stderr).toContain("Not offline: <style> loads https://fonts.example/brand.woff2");
  });

  it("passes on every bundled example built inline, with a CSP and without notes on request", () => {
    for (const name of fs.readdirSync(path.join(root, "examples"))) {
      const sourceDir = path.join(root, "examples", name);
      const deck = parseDeckYaml(fs.readFileSync(path.join(sourceDir, "deck.yaml"), "utf8"));
      const result = buildDeckObject(deck, { deckDir: sourceDir, outPath: "unused.html", runtime: "inline", templates, themes, write: false, checkOffline: true, stripNotes: true });
      expect(result.external, name).toEqual([]);
      expect(result.html, name).toContain(`<meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP.replace(/'/g, "&#39;")}">`);
      expect(result.html, name).not.toContain('class="slide-notes"');
    }
  });
});

const STARTERS = ["architecture-review", "postmortem", "assessment", "decision-record"];

describe("starter decks", () => {
  it("validate with no warnings and default to the inline runtime", () => {
    for (const name of STARTERS) {
      const sourceDir = path.join(root, "examples", name);
      const deck = parseDeckYaml(fs.readFileSync(path.join(sourceDir, "deck.yaml"), "utf8"));
      expect(deck.meta.runtime, name).toBe("inline");
      const result = buildDeckObject(deck, { deckDir: sourceDir, outPath: "unused.html", templates, themes, write: false });
      expect(result.issues, name).toEqual([]);
      expect(validateDeck(deck, { templates, themes }), name).toEqual([]);
    }
  });

  it("are created with deckforge new --example and listed in the help", () => {
    const help = execFileSync(process.execPath, [cli, "--help"], { env, encoding: "utf8" });
    for (const name of STARTERS) expect(help).toContain(`"${name}"`);
    const target = path.join(tmp(), "pm");
    execFileSync(process.execPath, [cli, "new", target, "--example", "postmortem"], { env });
    expect(fs.readFileSync(path.join(target, "deck.yaml"), "utf8")).toBe(fs.readFileSync(path.join(root, "examples/postmortem/deck.yaml"), "utf8"));
    const built = fs.readFileSync(path.join(target, "deck.html"), "utf8");
    expect(built).toContain("<script data-df-runtime>");
    expect(fs.existsSync(path.join(target, "deckforge"))).toBe(false);
  });
});

describe("deckforge diff", () => {
  const before = parseDeckYaml(`meta: { title: A }
slides:
  - { id: one, template: bars, data: { title: X, items: [{ label: a, value: 1 }] } }
  - { id: two, template: statement, data: { text: Two } }
  - { id: three, template: statement, data: { text: Three } }
  - { id: gone, template: statement, data: { text: Gone } }
`);
  const after = parseDeckYaml(`meta: { title: B }
slides:
  - { id: three, template: statement, data: { text: Three } }
  - { id: one, template: bars, data: { title: X, items: [{ label: a, value: 2 }, { label: b, value: 1 }] }, notes: New }
  - { id: two, template: points, data: { text: Two, title: T } }
  - { id: new, template: statement, data: { text: New } }
`);

  it("summarises the changes per slide", () => {
    const diff = diffDecks(before, after);
    expect(diff.meta).toEqual(["title"]);
    expect(diff.summary).toEqual({ added: 1, removed: 1, changed: 2, moved: 1, unchanged: 0 });
    expect(diff.slides.map((s) => [s.id, s.status])).toEqual([["three", "moved"], ["one", "changed"], ["two", "changed"], ["new", "added"], ["gone", "removed"]]);
    expect(diff.slides[1].changes).toEqual(["notes", "items (1 → 2 items)"]);
    expect(diff.slides[2].changes).toEqual(["template (statement → points)", "title (added)"]);
    expect(formatDiff(diff, { from: "a.yaml", to: "b.yaml" })).toBe(`deckforge diff a.yaml → b.yaml
  meta: title
↕ three [statement] moved 3 → 1
~ one [bars]: notes, items (1 → 2 items)
~ two [points]: template (statement → points), title (added)
+ new [statement] added at 4
- gone [statement] removed (was 4)
  1 added, 1 removed, 2 changed, 1 moved, 0 unchanged`);
    expect(formatDiff(diffDecks(before, before))).toContain("no changes");
  });

  it("runs from the CLI, reading the first deck from stdin", () => {
    const base = tmp();
    fs.writeFileSync(path.join(base, "deck.yaml"), stringifyDeck(after));
    const result = spawnSync(process.execPath, [cli, "diff", "-", base, "--json"], { env, encoding: "utf8", input: stringifyDeck(before) });
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.from).toBe("stdin");
    expect(report.summary.added).toBe(1);
    const usage = spawnSync(process.execPath, [cli, "diff", base], { env, encoding: "utf8" });
    expect(usage.status).toBe(1);
    expect(usage.stderr).toContain("usage: deckforge diff");
  });
});
