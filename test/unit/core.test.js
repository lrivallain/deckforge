import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTheme, ThemeError } from "../../src/core/theme.js";
import { normalizeDeck, parseDeckYaml, stringifyDeck, validateDeck, DeckError } from "../../src/core/deck.js";
import { applyOp, OpError } from "../../src/core/ops.js";
import { renderDeck, renderSlideDocument, VERSION, cdnBase } from "../../src/core/render.js";
import { loadTemplates, loadThemes } from "../../src/server/registry.js";
import { sampleData } from "../../src/core/template.js";

const root = path.resolve(import.meta.dirname, "../..");
const { templates, errors: templateErrors } = loadTemplates(null);
const { themes, errors: themeErrors } = loadThemes(null);

describe("built-in themes", () => {
  it("load without errors", () => {
    expect(themeErrors).toEqual([]);
    expect(Object.keys(themes).sort()).toEqual(["atelier", "aurora", "azure", "build"]);
  });
  const luminance = (hex) => {
    const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((c) => {
      const v = parseInt(c, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const expectReadableText = (p) => {
    for (const key of ["ink", "muted", "primary-text", "accent-text"]) {
      for (const surface of ["paper", "node", "primary-soft", "accent-soft"]) {
        expect(contrast(p[key], p[surface]), `${key} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  };
  it("aurora is a dark theme whose text colours reach 4.5:1 on its slides", () => {
    const theme = themes.aurora;
    expect(theme.colorScheme).toBe("dark");
    expect(theme.css).toContain("color-scheme: dark;");
    expect(theme.css).not.toMatch(/url\(/);
    expectReadableText(theme.palette);
  });
  it("azure uses the Azure brand tokens and readable text colours", () => {
    const theme = themes.azure;
    expect(theme.colorScheme).toBe("light");
    // azure.microsoft.com root tokens and gradient, the Azure blue and the architecture-icon purple.
    expect(theme.palette).toMatchObject({
      primary: "#0078D4", "primary-text": "#004275", ink: "#0E1726", accent: "#773ADC", "accent-line": "#B796F9",
    });
    expect(theme.css).toContain("--df-chrome: linear-gradient(120deg, #EDE8F6 0%, #F4FAFD 45%, #DCEEF8 100%);");
    expect(theme.css).toContain('--df-font-heading: "Segoe UI Variable Display", "Segoe UI"');
    expect(theme.css).toContain('--df-font-mono: "Cascadia Code"');
    expect(theme.css).not.toMatch(/url\(/);
    expectReadableText(theme.palette);
    // Large accent text (headline emphasis) needs 3:1.
    expect(contrast(theme.palette.accent, theme.palette.paper)).toBeGreaterThanOrEqual(3);
  });
  it("build theme reproduces the build-presentation tokens exactly", () => {
    const p = themes.build.palette;
    expect(p).toMatchObject({
      bg: "#EDF1F7", paper: "#FFFFFF", line: "#E2E8F2", ink: "#16202F", muted: "#53617A", node: "#F7F9FC",
      primary: "#0F6CBD", "primary-soft": "#EAF3FC", "primary-line": "#BBD7F0",
      accent: "#C2620A", "accent-soft": "#FFF4E4", "accent-line": "#F0C078", ok: "#1F9D6B",
    });
    const css = themes.build.css;
    expect(css).toContain('--df-font-heading: "Bricolage Grotesque", "Trebuchet MS", "Segoe UI", sans-serif;');
    expect(css).toContain('--df-font-body: "Instrument Sans", "Segoe UI", Arial, sans-serif;');
    expect(css).toContain('--df-font-mono: "IBM Plex Mono", Consolas, monospace;');
    expect(css).toContain('src: local("Bricolage Grotesque ExtraBold Regular"), local("BricolageGrotesqueExtraBold-Regular")');
    expect(css).not.toMatch(/url\(/);
  });
  it("rejects CSS injection and missing tokens", () => {
    const base = fs.readFileSync(path.join(root, "themes/build.yaml"), "utf8");
    expect(() => parseTheme(base.replace('primary: "#0F6CBD"', 'primary: "red; } body { display: none"'))).toThrow(ThemeError);
    expect(() => parseTheme("name: x\npalette: { bg: '#fff' }")).toThrow(/Missing palette/);
    expect(() => parseTheme(base.replace("family: Bricolage Grotesque", 'family: "x\\"; } *{"'))).toThrow(ThemeError);
    // A YAML comment can cut a gradient short and leave an unclosed parenthesis.
    expect(() => parseTheme(base.replace('bg: "#EDF1F7"', "chrome: linear-gradient(90deg, #EDE8F6 0%, #FFF 100%)\n  bg: \"#EDF1F7\""))).toThrow(/Invalid CSS value for "palette.chrome"/);
    expect(parseTheme(base.replace('bg: "#EDF1F7"', 'chrome: "linear-gradient(90deg, #EDE8F6 0%, #FFF 100%)"\n  bg: "#EDF1F7"')).css).toContain("--df-chrome: linear-gradient(90deg, #EDE8F6 0%, #FFF 100%);");
  });
  it("supports font urls", () => {
    const base = fs.readFileSync(path.join(root, "themes/atelier.yaml"), "utf8");
    const theme = parseTheme(base.replace("    family: Avenir Next\n", "    family: Avenir Next\n    faces:\n      - weight: 400\n        url: fonts/avenir.woff2\n"));
    expect(theme.css).toContain('src: url("fonts/avenir.woff2") format("woff2")');
  });
});

describe("built-in templates", () => {
  it("all parse without errors and render their sample data", () => {
    expect(templateErrors).toEqual([]);
    expect(Object.keys(templates).sort()).toEqual([
      "agenda", "bars", "bullets", "checklist", "closing", "compare-bars", "concept-map", "cover", "decision", "donut", "funnel",
      "image", "image-text", "implementation-map", "kpis", "lifecycle", "metric", "options-matrix", "points", "quote", "resources",
      "risk-register", "section", "sources", "split", "statement", "table", "timeline", "title", "two-column", "visual", "zoom",
    ]);
    for (const template of Object.values(templates)) {
      expect(template.issues.filter((i) => i.level === "error"), template.name).toEqual([]);
      expect(template.issues, template.name).toEqual([]);
      const deck = normalizeDeck({ meta: { title: "T" }, slides: [{ id: "a", template: template.name, data: sampleData(template) }] });
      const html = renderDeck(deck, { templates, theme: themes.build });
      expect(html).toContain(`class="slide df-t-${template.name}`);
      expect(validateDeck(deck, { templates, themes }).filter((i) => i.level === "error")).toEqual([]);
    }
  });
  it("essentials templates are grouped and the aurora example uses all of them without issues", () => {
    const essentials = Object.values(templates).filter((t) => t.category === "essentials").map((t) => t.name).sort();
    expect(essentials).toEqual(["agenda", "closing", "cover", "metric", "points", "split", "statement", "visual"]);
    const deck = parseDeckYaml(fs.readFileSync(path.join(root, "examples/aurora/deck.yaml"), "utf8"));
    expect(deck.meta.theme).toBe("aurora");
    for (const name of essentials) expect(deck.slides.some((s) => s.template === name), name).toBe(true);
    expect(validateDeck(deck, { templates, themes }).filter((i) => i.level !== "info")).toEqual([]);
  });
});

describe("deck schema", () => {
  it("normalizes ids, defaults and brief", () => {
    const deck = normalizeDeck({
      meta: { title: "X", brief: { topic: "t", sources: "one" } },
      slides: [{ template: "title" }, { id: "a", template: "title" }, { id: "a", template: "bullets" }, { id: "1bad", template: "quote" }],
    });
    expect(deck.meta).toMatchObject({ title: "X", lang: "en", theme: "build", brief: { topic: "t", sources: ["one"] } });
    expect(deck.slides.map((s) => s.id)).toEqual(["title", "a", "a-2", "s-1bad"]);
  });
  it("rejects invalid structures", () => {
    expect(() => normalizeDeck([])).toThrow(DeckError);
    expect(() => normalizeDeck({ slides: [{ id: "x" }] })).toThrow(/no template/);
    expect(() => normalizeDeck({ meta: { lang: "en<script>" } })).toThrow(/lang/);
    expect(() => normalizeDeck({ meta: { runtime: "web" } })).toThrow(/runtime/);
    expect(() => parseDeckYaml("meta: [")).toThrow(/Invalid deck YAML/);
  });
  it("round-trips through YAML", () => {
    const source = fs.readFileSync(path.join(root, "examples/starter/deck.yaml"), "utf8");
    const deck = parseDeckYaml(source);
    expect(parseDeckYaml(stringifyDeck(deck))).toEqual(deck);
  });
  it("validates slots against templates", () => {
    const deck = normalizeDeck({ meta: { theme: "nope" }, slides: [{ id: "a", template: "missing" }, { id: "b", template: "quote", data: { quote: "x", extra: 1 } }] });
    const messages = validateDeck(deck, { templates, themes }).map((i) => i.message);
    expect(messages).toContain('Unknown theme "nope"');
    expect(messages).toContain('Unknown template "missing"');
    expect(messages).toContain('Slot "extra" is not defined by template "quote"');
  });
  it("example deck has no validation issues", () => {
    const deck = parseDeckYaml(fs.readFileSync(path.join(root, "examples/starter/deck.yaml"), "utf8"));
    expect(validateDeck(deck, { templates, themes })).toEqual([]);
  });
});

describe("ops", () => {
  const ctx = { templates, themes };
  const base = normalizeDeck({ meta: { title: "D" }, slides: [{ id: "a", template: "title", data: { title: "A" } }, { id: "b", template: "quote", data: { quote: "Q" } }] });

  it("never mutate their input", () => {
    const frozen = structuredClone(base);
    applyOp(base, "update_slide", { id: "a", set: { title: "Z" } }, ctx);
    applyOp(base, "remove_slide", { id: "a" }, ctx);
    expect(base).toEqual(frozen);
  });
  it("update_slide merges data, sets paths and deletes with null", () => {
    let { deck } = applyOp(base, "update_slide", { id: "a", data: { subtitle: "S" }, notes: "N" }, ctx);
    expect(deck.slides[0]).toMatchObject({ data: { title: "A", subtitle: "S" }, notes: "N" });
    ({ deck } = applyOp(deck, "update_slide", { id: "a", set: { "cards.1.title": "x" } }, ctx));
    expect(deck.slides[0].data.cards).toEqual([undefined, { title: "x" }]);
    ({ deck } = applyOp(deck, "update_slide", { id: "a", data: { subtitle: null } }, ctx));
    expect(deck.slides[0].data).not.toHaveProperty("subtitle");
  });
  it("add/duplicate/move/remove/hide slides", () => {
    let { deck, result } = applyOp(base, "add_slide", { template: "bullets", after: "a" }, ctx);
    expect(deck.slides.map((s) => s.id)).toEqual(["a", result.id, "b"]);
    expect(deck.slides[1].data.points.length).toBe(3);
    ({ deck } = applyOp(deck, "duplicate_slide", { id: "a" }, ctx));
    expect(deck.slides.map((s) => s.id)).toEqual(["a", "a-copy", result.id, "b"]);
    ({ deck } = applyOp(deck, "move_slide", { id: "b", index: 0 }, ctx));
    expect(deck.slides[0].id).toBe("b");
    ({ deck } = applyOp(deck, "move_slide", { id: "b", after: "a" }, ctx));
    expect(deck.slides.map((s) => s.id).slice(0, 2)).toEqual(["a", "b"]);
    ({ deck } = applyOp(deck, "set_hidden", { id: "b", hidden: true }, ctx));
    expect(deck.slides[1].hidden).toBe(true);
    ({ deck } = applyOp(deck, "remove_slide", { id: "b" }, ctx));
    expect(deck.slides.find((s) => s.id === "b")).toBeUndefined();
  });
  it("set_template keeps compatible data", () => {
    const { deck } = applyOp(base, "set_template", { id: "a", template: "section" }, ctx);
    expect(deck.slides[0]).toMatchObject({ template: "section", data: { title: "A", number: "02" } });
  });
  it("reject prototype-polluting paths and keys", () => {
    for (const path of ["__proto__.polluted", "constructor.prototype.polluted", "cards.0.__proto__.x", "a b"]) {
      expect(() => applyOp(base, "update_slide", { id: "a", set: { [path]: "x" } }, ctx), path).toThrow(OpError);
    }
    expect(() => applyOp(base, "update_slide", { id: "a", data: JSON.parse('{"__proto__": {"polluted": 1}}') }, ctx)).toThrow(OpError);
    expect(() => applyOp(base, "update_slide", { id: "a", set: { cards: JSON.parse('[{"__proto__": {"x": 1}}]') } }, ctx)).toThrow(OpError);
    expect(() => applyOp(base, "add_slide", { template: "quote", data: JSON.parse('{"constructor": {"prototype": {"x": 1}}}') }, ctx)).toThrow(OpError);
    expect({}.polluted).toBeUndefined();
    const { deck } = applyOp(base, "update_meta", { meta: { brief: JSON.parse('{"__proto__": {"x": 1}, "goal": "G"}') } }, ctx);
    expect(Object.keys(deck.meta.brief)).toEqual(["goal"]);
  });
  it("set_theme and update_meta validate their input", () => {
    expect(applyOp(base, "set_theme", { theme: "atelier" }, ctx).deck.meta.theme).toBe("atelier");
    expect(() => applyOp(base, "set_theme", { theme: "nope" }, ctx)).toThrow(OpError);
    const { deck } = applyOp(base, "update_meta", { meta: { footer: "F", brief: { goal: "G", sources: "s" } } }, ctx);
    expect(deck.meta).toMatchObject({ footer: "F", brief: { goal: "G", sources: ["s"] } });
    expect(() => applyOp(base, "update_meta", { meta: { theme: "x" } }, ctx)).toThrow(/set_theme/);
    expect(() => applyOp(base, "update_meta", { meta: { evil: 1 } }, ctx)).toThrow(/Unknown meta/);
    expect(() => applyOp(base, "nope", {}, ctx)).toThrow(/Unknown operation/);
    expect(() => applyOp(base, "update_slide", { id: "zz" }, ctx)).toThrow(/No slide/);
    expect(() => applyOp(base, "add_slide", { template: "zz" }, ctx)).toThrow(/Unknown template/);
  });
});

describe("template switches", () => {
  const ctx = { templates, themes };
  const example = () => parseDeckYaml(fs.readFileSync(path.join(root, "examples/starter/deck.yaml"), "utf8"));

  it("round-trips concept-map → title → concept-map without losing content", () => {
    const original = example();
    const toTitle = applyOp(original, "set_template", { id: "concept", template: "title" }, ctx);
    const slide = toTitle.deck.slides[0];
    expect(slide.data.title).toBe(original.slides[0].data.title);
    expect(Object.keys(slide.stash)).toEqual(["audiences", "boundary", "boundaryNote", "lanes", "capabilitiesLabel", "capabilities", "takeawayLabel", "takeaway"]);
    expect(slide.placeholders).toEqual(["presenter", "details"]);
    // Persisted through deck.yaml.
    const reloaded = parseDeckYaml(stringifyDeck(toTitle.deck));
    expect(reloaded.slides[0].stash).toEqual(slide.stash);
    expect(reloaded.slides[0].placeholders).toEqual(["presenter", "details"]);
    const back = applyOp(reloaded, "set_template", { id: "concept", template: "concept-map" }, ctx).deck.slides[0];
    expect(back.data).toEqual(original.slides[0].data);
    expect(back.stash).toBeUndefined();
    expect(back.placeholders).toBeUndefined();
  });

  it("keeps edits made on the intermediate template", () => {
    let { deck } = applyOp(example(), "set_template", { id: "concept", template: "title" }, ctx);
    ({ deck } = applyOp(deck, "update_slide", { id: "concept", set: { title: "New headline", presenter: "Ada" } }, ctx));
    expect(deck.slides[0].placeholders).toEqual(["details"]);
    ({ deck } = applyOp(deck, "set_template", { id: "concept", template: "concept-map" }, ctx));
    expect(deck.slides[0].data.title).toBe("New headline");
    expect(deck.slides[0].data.lanes[0].title).toBe("Prepare");
    expect(deck.slides[0].stash).toEqual({ presenter: "Ada" });
    ({ deck } = applyOp(deck, "set_template", { id: "concept", template: "title" }, ctx));
    expect(deck.slides[0].data.presenter).toBe("Ada");
  });

  it("clears a navigation title that only named the old layout and labels the change", () => {
    const { deck, result } = applyOp(example(), "set_template", { id: "concept", template: "title" }, ctx);
    expect(deck.slides[0].title).toBeUndefined();
    expect(result.label).toBe("Slide 1: Concept map → Title");
    const kept = applyOp(example(), "set_template", { id: "zoom", template: "bullets" }, ctx);
    expect(kept.deck.slides[3].title).toBe("Problem to response");
  });

  it("never publishes sample placeholders and flags required ones", () => {
    let { deck } = applyOp(example(), "set_template", { id: "concept", template: "title" }, ctx);
    let html = renderDeck(deck, { templates, theme: themes.build });
    expect(html).not.toContain("Presenter name");
    expect(html).not.toContain("Event or date");
    expect(html).toContain('data-title="From isolated tasks. To a shared workflow."');
    ({ deck } = applyOp(deck, "add_slide", { template: "quote", id: "q" }, ctx));
    expect(deck.slides.at(-1).placeholders).toEqual(["eyebrow", "quote", "author", "role"]);
    html = renderDeck(deck, { templates, theme: themes.build });
    expect(html).not.toContain("The best review");
    expect(validateDeck(deck, { templates, themes })).toContainEqual({ level: "warning", slide: "q", slot: "quote", message: '"quote" still shows sample text (not published)' });
    ({ deck } = applyOp(deck, "add_slide", { template: "quote", id: "q2", data: { quote: "Real words." } }, ctx));
    expect(deck.slides.at(-1).placeholders).toEqual(["eyebrow", "author", "role"]);
    // The editor preview still shows samples, marked as placeholders.
    const preview = renderSlideDocument(deck, deck.slides.at(-2), { templates, theme: themes.build, viewerCssHref: "x.css", edit: true });
    expect(preview).toMatch(/data-df-slot="quote" data-df-type="richtext" data-df-placeholder>The best review/);
  });
});

describe("renderDeck", () => {
  const deck = normalizeDeck({
    meta: { title: "R & D", lang: "fr", footer: "F" },
    slides: [
      { id: "one", template: "title", data: { title: "Hello" }, notes: "Say hi.\n\nThen <go>." },
      { id: "two", template: "quote", hidden: true, data: { quote: "Q" } },
      { id: "three", template: "bullets", data: { title: "Points", points: ["a"] } },
    ],
  });
  it("renders visible slides with numbering, titles and notes", () => {
    const html = renderDeck(deck, { templates, theme: themes.build });
    expect(html).toContain('<html lang="fr" data-theme="build">');
    expect(html).toContain("<title>R &amp; D</title>");
    expect(html).not.toContain('data-slide-id="two"');
    expect(html).toContain('data-slide-id="three"');
    expect(html).toContain('<span class="num">02 / 02</span>');
    expect(html).toContain('aria-labelledby="one-title"');
    expect(html).toContain('<aside class="slide-notes" hidden aria-label="Speaker notes"><p>Say hi.</p><p>Then &lt;go&gt;.</p></aside>');
    expect(html).toContain('<nav class="controls" aria-label="Slide controls" hidden>');
  });
  it("supports the local, cdn and inline runtime modes", () => {
    const local = renderDeck(deck, { templates, theme: themes.build, runtime: "local" });
    expect(local).toContain('<link rel="stylesheet" href="deckforge/deckforge.viewer.css">');
    expect(local).toContain('<script src="deckforge/deckforge.viewer.js" defer></script>');
    const cdn = renderDeck(deck, { templates, theme: themes.build, runtime: "cdn" });
    expect(cdn).toContain(`href="${cdnBase()}deckforge.viewer.css"`);
    expect(cdnBase()).toBe(`https://cdn.jsdelivr.net/gh/lrivallain/deckforge@v${VERSION}/dist/`);
    const inline = renderDeck(deck, { templates, theme: themes.build, runtime: "inline", assets: { css: "x{}", js: "var a='</script>';" } });
    expect(inline).toContain("<style id=\"df-runtime\">\nx{}");
    expect(inline).toContain("var a='<\\/script>';");
    expect(inline).not.toMatch(/(src|href)="https?:/);
  });
  it("includes only CSS of templates in use", () => {
    const html = renderDeck(deck, { templates, theme: themes.build });
    expect(html).toContain("/* template: title */");
    expect(html).not.toContain("/* template: quote */");
    expect(html).not.toContain("/* template: lifecycle */");
  });
  it("shows a placeholder for missing templates", () => {
    const broken = normalizeDeck({ slides: [{ id: "x", template: "ghost" }] });
    expect(renderDeck(broken, { templates, theme: themes.build })).toContain("Template “ghost” was not found");
  });
  it("VERSION matches package.json", () => {
    expect(VERSION).toBe(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version);
  });
});
