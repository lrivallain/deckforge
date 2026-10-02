import { describe, expect, it } from "vitest";
import { analyzeTemplate, checkSlotLimits, joinTemplateSource, parseTemplate, renderTemplate, sampleData, TemplateError } from "../../src/core/template.js";

const SOURCE = `---
name: demo
label: Demo
description: A test template
class: extra
slots:
  title: { type: richtext, max: 10, required: true, sample: 'Hello <span class="blue">world</span>' }
  sub: { type: text, sample: "Line 1\\nLine <2>" }
  items: { type: list, max: 2, sample: [one, two, three] }
  cards:
    type: cards
    fields:
      icon: { type: icon }
      title: { type: text }
      on: { type: boolean }
    sample:
      - { icon: pen, title: A, on: true }
      - { icon: nope, title: "B & C" }
  link: { type: link, sample: { label: Docs, href: "https://example.com" } }
  bad: { type: link, sample: { label: Bad, href: "javascript:alert(1)" } }
---
<h1 id="{{slide.titleId}}" title="{{title}}">{{title}}</h1>
<p>{{sub}}</p>
<ul>{{#each items}}<li data-n="{{@number}}">{{this}}</li>{{/each}}</ul>
{{#each cards}}<div class="c{{#if on}} on{{/if}}">{{icon}}{{title}}{{#unless on}}off{{/unless}}</div>{{/each}}
{{#if missing}}never{{else}}fallback{{/if}}
{{link}} {{bad}}
{{> foot}}
<style scoped>
:scope h1 { color: red; }
</style>
`;

describe("parseTemplate", () => {
  const tpl = parseTemplate(SOURCE, { name: "demo" });
  it("reads front-matter, slots and scoped css", () => {
    expect(tpl.name).toBe("demo");
    expect(tpl.classes).toEqual(["extra"]);
    expect(Object.keys(tpl.slots)).toEqual(["title", "sub", "items", "cards", "link", "bad"]);
    expect(tpl.slots.items.of).toBe("text");
    expect(tpl.scopedCss).toBe(".df-t-demo h1 {color: red;}");
    expect(tpl.html).not.toContain("<style");
  });
  it("reports only the intentionally undeclared slot", () => {
    expect(tpl.issues).toEqual([{ level: "error", message: 'Unknown slot "missing"' }]);
  });
  it("rejects unknown slot types, reserved names and broken blocks", () => {
    expect(() => parseTemplate("---\nname: x\nslots: { a: { type: video } }\n---\n{{a}}")).toThrow(TemplateError);
    expect(() => parseTemplate("---\nname: x\nslots: { slide: text }\n---\n")).toThrow(/reserved/);
    expect(() => parseTemplate("---\nname: x\n---\n{{#each a}}")).toThrow(/Unclosed/);
    expect(() => parseTemplate("---\nname: x\n---\n{{/if}}")).toThrow(/Unexpected/);
    expect(() => parseTemplate("---\nname: Bad Name\n---\n")).toThrow(/name/);
    // An unquoted comma in a flow mapping silently truncates samples: flag it.
    expect(() => parseTemplate("---\nname: x\nslots: { a: { type: text, sample: one, two } }\n---\n{{a}}")).toThrow(/unknown property "two"/);
  });
  it("reports unknown and unused slots", () => {
    const t = parseTemplate("---\nname: x\nslots: { a: text, b: text }\n---\n{{a}} {{zzz}} {{slide.number}}");
    const issues = analyzeTemplate(t);
    expect(issues).toContainEqual({ level: "error", message: 'Unknown slot "zzz"' });
    expect(issues).toContainEqual({ level: "warning", message: 'Slot "b" is declared but never used' });
  });
  it("round-trips through joinTemplateSource", () => {
    const again = parseTemplate(joinTemplateSource({ frontMatter: "name: demo\nslots: { a: text }", html: "<p>{{a}}</p>", css: "p{x:y}" }));
    expect(again.scopedCss).toBe(".df-t-demo p {x:y}");
  });
});

describe("renderTemplate", () => {
  const tpl = parseTemplate(SOURCE, { name: "demo" });
  const html = renderTemplate(tpl, sampleData(tpl), { slide: { titleId: "s1-title", number: "01", total: "03", footer: "Foot <b>x</b>" } });
  it("sanitizes richtext in text and strips it in attributes", () => {
    expect(html).toContain('<h1 id="s1-title" title="Hello world">Hello <span class="blue">world</span></h1>');
  });
  it("escapes text and keeps newlines", () => {
    expect(html).toContain("<p>Line 1<br>Line &lt;2&gt;</p>");
  });
  it("iterates lists with @number", () => {
    expect(html).toContain('<li data-n="01">one</li><li data-n="02">two</li><li data-n="03">three</li>');
  });
  it("iterates cards with fields, icons, booleans and fallbacks", () => {
    expect(html).toMatch(/<div class="c on"><svg class="icon"[^>]*>.*<\/svg>A<\/div>/);
    expect(html).toContain('<div class="c">B &amp; Coff</div>');
    expect(html).toContain("fallback");
    expect(html).not.toContain("never");
  });
  it("renders safe links only", () => {
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Docs</a>');
    expect(html).toContain(" Bad");
    expect(html).not.toContain("javascript:");
  });
  it("renders the foot partial", () => {
    expect(html).toContain('<footer class="foot"><span>Foot <b>x</b></span><span class="num">01 / 03</span></footer>');
  });
  it("emits editable markers in edit mode", () => {
    const edit = renderTemplate(tpl, sampleData(tpl), { edit: true, slide: { titleId: "t" } });
    expect(edit).toContain('<df-slot class="df-slot" data-df-slot="title" data-df-type="richtext">');
    expect(edit).toContain('data-df-slot="cards.1.title" data-df-type="text">B &amp; C</df-slot>');
    expect(edit).toContain('data-df-slot="items.2"');
    expect(edit).toContain('title="Hello world"');
  });
  it("cannot be broken out of by attribute values", () => {
    const t = parseTemplate('---\nname: x\nslots: { a: text }\n---\n<p class="{{a}}">{{a}}</p>');
    const out = renderTemplate(t, { a: '"><script>alert(1)</script>' });
    expect(out).toBe('<p class="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
});

describe("checkSlotLimits", () => {
  const tpl = parseTemplate(SOURCE, { name: "demo" });
  it("flags long text, too many items and missing required slots", () => {
    const issues = checkSlotLimits(tpl, sampleData(tpl)).map((i) => i.message);
    expect(issues).toContain('"items" has 3 items (max 2)');
    expect(checkSlotLimits(tpl, { title: "" }).map((i) => i.message)).toContain('"title" is required');
    expect(checkSlotLimits(tpl, { title: "x".repeat(11) }).map((i) => i.message)).toContain('"title" is 11 characters (max 10)');
  });
});
