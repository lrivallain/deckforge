#!/usr/bin/env node
// deckforge CLI: new | build | edit | serve

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { VERSION } from "../src/core/render.js";
import { RUNTIME_MODES, stringifyDeck, normalizeDeck } from "../src/core/deck.js";
import { buildDeckFile } from "../src/server/build.js";
import { PACKAGE_ROOT, configDir } from "../src/server/registry.js";

const HELP = `deckforge ${VERSION} — themeable, template-driven HTML presentations

Usage
  deckforge new <dir> [--title "My talk"] [--theme build] [--example]
  deckforge build <deck.yaml|dir> [--runtime local|cdn|inline] [--out deck.html]
  deckforge edit <deck.yaml|dir> [--port 0] [--token <t>] [--runtime …] [--no-open]
  deckforge serve <deck.yaml|dir> [--port 0] [--no-open]

Commands
  new     Create a deck folder with a deck.yaml (a title slide, or --example for the full specimen)
  build   Render deck.yaml to a static deck.html next to it
  edit    Start the local editor (127.0.0.1 only, random port and per-run token)
  serve   Serve the built deck read-only, rebuilding and reloading on change

Runtime modes (how deck.html loads the viewer)
  local   copy deckforge/deckforge.viewer.{js,css} next to deck.html (default)
  cdn     reference https://cdn.jsdelivr.net/gh/lrivallain/deckforge@v${VERSION}/dist/
  inline  embed everything into one self-contained file

Images live in <deck>/assets/ (added from the editor). local copies the used
ones next to --out, inline embeds them as data URIs, cdn keeps relative paths.
\`build\` lists assets that no slide references (they are never deleted).

Templates/themes lookup: <deck>/templates|themes → ${path.join(configDir(), "templates|themes")} → built-ins
`;

function fail(message) {
  console.error(`deckforge: ${message}`);
  process.exit(1);
}

function resolveDeck(target) {
  if (!target) fail("missing <deck.yaml> argument (see deckforge --help)");
  let file = path.resolve(target);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "deck.yaml");
  if (!fs.existsSync(file)) fail(`${file} does not exist`);
  return file;
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best effort */
  }
}

function printIssues(issues = [], loadErrors = []) {
  for (const e of loadErrors) console.error(`  ! ${e.path}: ${e.message}`);
  for (const i of issues) console.error(`  ${i.level === "error" ? "✗" : i.level === "info" ? "·" : "!"} ${i.slide ? `[${i.slide}] ` : ""}${i.message}`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
    runtime: { type: "string" },
    out: { type: "string", short: "o" },
    port: { type: "string", short: "p" },
    host: { type: "string" },
    token: { type: "string" },
    open: { type: "boolean", default: true },
    "no-open": { type: "boolean" },
    title: { type: "string" },
    theme: { type: "string" },
    example: { type: "boolean" },
    force: { type: "boolean" },
  },
});

const [command, target] = positionals;
if (values.version) {
  console.log(VERSION);
  process.exit(0);
}
if (values.help || !command) {
  console.log(HELP);
  process.exit(command || values.help ? 0 : 1);
}
if (values.runtime && !RUNTIME_MODES.includes(values.runtime)) fail(`--runtime must be one of ${RUNTIME_MODES.join(", ")}`);
const shouldOpen = values.open && !values["no-open"] && !process.env.CI;
const port = values.port ? Number(values.port) : 0;
if (!Number.isInteger(port) || port < 0 || port > 65535) fail("--port must be an integer between 0 and 65535");
const host = values.host || "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(host)) fail("--host must be a loopback address (127.0.0.1, localhost or ::1)");

switch (command) {
  case "new": {
    if (!target) fail("missing <dir>");
    const dir = path.resolve(target);
    const file = path.join(dir, "deck.yaml");
    if (fs.existsSync(file) && !values.force) fail(`${file} already exists (use --force to overwrite)`);
    fs.mkdirSync(dir, { recursive: true });
    let yaml;
    if (values.example) {
      yaml = fs.readFileSync(path.join(PACKAGE_ROOT, "examples/starter/deck.yaml"), "utf8");
    } else {
      const title = values.title || path.basename(dir);
      yaml = stringifyDeck(normalizeDeck({
        meta: { title, lang: "en", theme: values.theme || "build", footer: title, brief: { topic: "", audience: "", goal: "", duration: "" } },
        slides: [{ id: "title", template: "title", data: { eyebrow: "", title, subtitle: "", presenter: "", details: "" } }],
      }));
    }
    fs.writeFileSync(file, yaml);
    const result = buildDeckFile(file, { runtime: values.runtime });
    console.log(`Created ${path.relative(process.cwd(), file) || file}`);
    console.log(`Built   ${path.relative(process.cwd(), result.outPath)}`);
    console.log(`\nNext: deckforge edit ${path.relative(process.cwd(), dir) || "."}`);
    break;
  }
  case "build": {
    const file = resolveDeck(target);
    try {
      const result = buildDeckFile(file, { runtime: values.runtime, out: values.out });
      printIssues(result.issues, result.loadErrors);
      console.log(`Built ${path.relative(process.cwd(), result.outPath)} (${result.runtime} runtime, ${result.deck.slides.filter((s) => !s.hidden).length} slides)`);
      if (result.issues.some((i) => i.level === "error")) process.exitCode = 2;
    } catch (err) {
      fail(err.message);
    }
    break;
  }
  case "edit":
  case "serve": {
    const file = resolveDeck(target);
    const { startServer } = await import("../src/server/http.js");
    let app;
    try {
      app = await startServer({ deckPath: file, mode: command, port, host, token: values.token, runtime: values.runtime });
    } catch (err) {
      fail(err.code === "EADDRINUSE" ? `port ${port} is already in use` : err.message);
    }
    const url = command === "edit" ? app.editorUrl : app.viewerUrl;
    console.log(`deckforge ${command} — ${path.relative(process.cwd(), file) || file}`);
    if (command === "edit") {
      console.log(`  Editor: ${app.editorUrl}`);
      console.log(`  Viewer: ${app.viewerUrl}`);
      console.log("  The URL contains a per-run access token; do not share it.");
    } else console.log(`  Viewer: ${app.viewerUrl}`);
    console.log("  Press Ctrl+C to stop.");
    if (shouldOpen) openBrowser(url);
    const stop = async () => {
      await app.close().catch(() => {});
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    break;
  }
  default:
    fail(`unknown command "${command}" (see deckforge --help)`);
}
