// Rasterise docs/public/logo.svg into favicons and render the social card.
// Usage: node scripts/icons.js   (needs Playwright's Chromium: npx playwright install chromium)
// Run `npm run docs:screenshots` first: the social card embeds screenshots/editor.png.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "docs/public");
const svg = fs.readFileSync(path.join(pub, "logo.svg"), "utf8");
const svgUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function renderIcon(size, { pad = 0, background = "transparent" } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - pad * 2;
  await page.setContent(
    `<html><body style="margin:0;background:${background}"><img src="${svgUri}" width="${inner}" height="${inner}" style="display:block;margin:${pad}px"></body></html>`,
  );
  await page.locator("img").evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: background === "transparent" });
}

/** ICO container with PNG-encoded images (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

const write = (name, buf) => {
  fs.writeFileSync(path.join(pub, name), buf);
  console.log(`docs/public/${name}  ${buf.length} B`);
};

const icoImages = [];
for (const size of [16, 32, 48]) icoImages.push({ size, png: await renderIcon(size) });
write("favicon.ico", ico(icoImages));
write("favicon-32.png", icoImages[1].png);
write("apple-touch-icon.png", await renderIcon(180, { pad: 18, background: "#FFFFFF" }));
write("icon-512.png", await renderIcon(512));

const shot = path.join(pub, "screenshots/editor.png");
if (fs.existsSync(shot)) {
  const shotUri = `data:image/png;base64,${fs.readFileSync(shot).toString("base64")}`;
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<html><head><style>
    body { margin:0; width:1200px; height:630px; overflow:hidden; font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      background: radial-gradient(circle at 85% 10%, #FFF4E4 0, transparent 40%), linear-gradient(135deg, #EAF3FC, #FFFFFF 60%); color:#16202F; }
    .text { position:absolute; left:72px; top:120px; width:480px; }
    .brand { display:flex; align-items:center; gap:20px; }
    .brand img { width:96px; height:96px; }
    h1 { font-size:76px; letter-spacing:-2px; margin:0; font-weight:800; }
    p { font-size:30px; line-height:1.35; color:#53617A; margin:36px 0 0; }
    p b { color:#0F6CBD; }
    .shot { position:absolute; left:600px; top:90px; width:720px; border-radius:14px; border:1px solid #BBD7F0;
      box-shadow:0 30px 60px -20px rgba(15,108,189,.35); }
  </style></head><body>
    <div class="text"><div class="brand"><img src="${svgUri}" alt=""><h1>deckforge</h1></div>
    <p>Presentations as <b>YAML</b>.<br>Themes, templates, a live editor and <b>GitHub Copilot</b>.</p></div>
    <img class="shot" src="${shotUri}" alt="">
  </body></html>`);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  write("og-image.png", await page.screenshot());
} else {
  console.warn("skipped og-image.png: run `npm run docs:screenshots` first");
}

await browser.close();
