// PowerPoint export: the CLI (headless Chromium) and the editor's button.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { expect, test } from "@playwright/test";
import { CLI, startEditor, tempDeck } from "./helpers.js";

async function readPptx(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  const slides = await Promise.all(slideNames.map((n) => zip.file(n).async("string")));
  const notes = await Promise.all(Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).map((n) => zip.file(n).async("string")));
  const media = Object.keys(zip.files).filter((n) => n.startsWith("ppt/media/"));
  return { zip, slides, notes, media };
}

const texts = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);

function expectValidParagraphs(xml) {
  for (const [, inner] of xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) expect((inner.match(/<a:pPr\b/g) || []).length).toBeLessThanOrEqual(1);
}

test.describe("CLI export", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "the CLI drives Chromium itself");

  test("exports the starter deck as native, editable slides", async () => {
    const deck = tempDeck();
    try {
      const report = JSON.parse(execFileSync(process.execPath, [CLI, "export", deck.dir, "--json"], { encoding: "utf8" }));
      expect(report.ok).toBe(true);
      expect(report.outPath).toBe(path.join(deck.dir, "deck.pptx"));
      expect(report.slides).toBe(4);
      const { slides, notes, media } = await readPptx(report.outPath);
      expect(slides).toHaveLength(4);
      for (const xml of slides) expectValidParagraphs(xml);
      // The headline is one text box with two styled paragraphs.
      const title = slides[0].match(/<p:txBody>(?:(?!<\/p:txBody>)[\s\S])*To a shared workflow\.[\s\S]*?<\/p:txBody>/)[0];
      expect(texts(title)).toEqual(expect.arrayContaining(["From isolated tasks.", "To a shared workflow."]));
      expect(title).toContain('val="0F6CBD"');
      // Cards are rounded rectangles, icons are SVG pictures, the footer link is a hyperlink.
      expect(slides[0]).toContain('prst="roundRect"');
      expect(slides[0]).toContain("asvg:svgBlip");
      expect(media.some((m) => m.endsWith(".svg"))).toBe(true);
      // Text that wraps over several lines in the browser wraps in PowerPoint; one-line labels do not.
      const bodyOf = (xml, text) => xml.match(new RegExp(`<p:txBody><a:bodyPr wrap="(\\w+)"(?:(?!</p:txBody>)[\\s\\S])*${text}`))[1];
      expect(bodyOf(slides[3], "The message is difficult to review")).toBe("square");
      expect(bodyOf(slides[3], "Review / focus")).toBe("none");
      expect(texts(slides[3])).toContain("REFERENCE DECK");
      expect(slides[3]).toContain("<a:hlinkClick");
      expect(notes.join("\n")).toContain("Start with the audience, not the tools.");
    } finally {
      deck.cleanup();
    }
  });

  test("exports images, gradients and overlays of the aurora deck", async () => {
    const deck = tempDeck({ example: "aurora" });
    try {
      const out = path.join(deck.dir, "out", "talk.pptx");
      execFileSync(process.execPath, [CLI, "export", deck.yaml, "--out", out], { stdio: "pipe" });
      const { slides, media } = await readPptx(out);
      expect(slides).toHaveLength(9);
      expect(slides.filter((xml) => xml.includes("<p:pic>")).length).toBeGreaterThan(0);
      expect(media.length).toBeGreaterThan(2);
      expect(texts(slides.join("")).join(" ")).toContain("Thank");
      for (const xml of slides) expectValidParagraphs(xml);
    } finally {
      deck.cleanup();
    }
  });
});

test.describe("editor export", () => {
  let editor;
  test.beforeEach(async () => {
    editor = await startEditor();
  });
  test.afterEach(async () => {
    await editor.stop();
  });

  test("exports to PowerPoint, saves next to deck.yaml and downloads", async ({ page }) => {
    const yaml = editor.readYaml();
    await page.goto(editor.editorUrl);
    const button = page.getByTestId("export-pptx");
    await expect(button).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    expect(download.suggestedFilename()).toBe("deck.pptx");
    await expect(page.locator(".toast", { hasText: "Exported deck.pptx (4 slides)" })).toBeVisible();
    await expect(page.locator("iframe.export-frame")).toHaveCount(0);
    const file = path.join(editor.dir, "deck.pptx");
    expect(fs.existsSync(file)).toBe(true);
    const { slides, notes } = await readPptx(file);
    expect(slides).toHaveLength(4);
    expect(texts(slides[0])).toContain("To a shared workflow.");
    expect(notes.join("\n")).toContain("Start with the audience");
    // Exporting never edits the deck.
    expect(editor.readYaml()).toBe(yaml);
  });
});
