import { describe, expect, it } from "vitest";
import { escapeHtml, isSafeUrl, sanitizeRichText, stripTags, textToHtml } from "../../src/core/html.js";
import { scopeCss } from "../../src/core/css.js";
import { renderIcon, ICON_NAMES } from "../../src/core/icons.js";

describe("escaping", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
  it("turns newlines into <br>", () => {
    expect(textToHtml("a\n<b>")).toBe("a<br>&lt;b&gt;");
  });
  it("strips tags to plain text", () => {
    expect(stripTags('<span class="old">From</span><br>to &amp; <b>x</b>')).toBe("From to & x");
  });
});

describe("sanitizeRichText", () => {
  it("keeps allowed inline tags and classes", () => {
    expect(sanitizeRichText('<span class="old">From</span><span class="blue evil">To</span>')).toBe('<span class="old">From</span><span class="blue">To</span>');
  });
  it("removes scripts, styles and event handlers", () => {
    const out = sanitizeRichText('<b onclick="alert(1)">x</b><script>alert(1)</script><style>*{}</style><img src=x onerror=alert(1)>');
    expect(out).toBe("<b>x</b>");
  });
  it("drops javascript: and data: links", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeRichText('<a href="data:text/html,1">x</a>')).toBe("<a>x</a>");
    expect(sanitizeRichText('<a href=" JaVaScRiPt:alert(1)">x</a>')).toBe("<a>x</a>");
  });
  it("adds rel/target to external links", () => {
    expect(sanitizeRichText('<a href="https://example.com">x</a>')).toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>');
  });
  it("closes unbalanced tags and escapes stray brackets", () => {
    expect(sanitizeRichText("<strong>a < b")).toBe("<strong>a &lt; b</strong>");
    expect(sanitizeRichText("</em>text")).toBe("text");
  });
  it("converts contenteditable block wrappers to line breaks", () => {
    expect(sanitizeRichText("one<div>two</div>")).toBe("one<br>two");
  });
  it("does not let attribute quoting break out", () => {
    const out = sanitizeRichText('<span class="old" title="a&quot; onmouseover=&quot;x">t</span>');
    expect(out).not.toMatch(/onmouseover="/);
  });
  it("validates urls", () => {
    expect(isSafeUrl("https://a.b")).toBe(true);
    expect(isSafeUrl("mailto:a@b.c")).toBe(true);
    expect(isSafeUrl("#section")).toBe(true);
    expect(isSafeUrl("docs/page.html")).toBe(true);
    expect(isSafeUrl("//evil.com")).toBe(false);
    expect(isSafeUrl("vbscript:x")).toBe(false);
  });
});

describe("scopeCss", () => {
  it("prefixes selectors and handles :scope, @media and @keyframes", () => {
    const css = scopeCss(`
      /* comment */
      :scope .header { color: red; }
      .a, .b > p { margin: 0; }
      @media (max-width: 10px) { .c { color: blue; } }
      @keyframes spin { from { transform: none; } to { transform: rotate(1turn); } }
      :root { --x: 1; }
    `, ".df-t-x");
    expect(css).toContain(".df-t-x .header {color: red;}");
    expect(css).toContain(".df-t-x .a, .df-t-x .b > p {margin: 0;}");
    expect(css).toMatch(/@media \(max-width: 10px\)\{\n\.df-t-x \.c \{color: blue;\}\n\}/);
    expect(css).toContain("@keyframes spin{from { transform: none; } to { transform: rotate(1turn); }}");
    expect(css).toContain(":root {--x: 1;}");
    expect(css).not.toContain("comment");
  });
  it("keeps commas inside :is() together", () => {
    expect(scopeCss(":is(.a, .b) p { x: y }", ".s")).toBe(".s :is(.a, .b) p {x: y}");
  });
});

describe("icons", () => {
  it("renders known icons as decorative svg and ignores unknown ones", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(30);
    expect(renderIcon("pen")).toMatch(/^<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"/);
    expect(renderIcon("<script>")).toBe("");
  });
});
