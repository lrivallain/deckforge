#!/usr/bin/env node
// deckforge CLI: new | build | diff | export | templates | edit | serve | mcp | skill

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { VERSION } from "../src/core/render.js";
import { RUNTIME_MODES, stringifyDeck, normalizeDeck, parseDeckYaml } from "../src/core/deck.js";
import { diffDecks, formatDiff } from "../src/core/diff.js";
import { buildDeckFile } from "../src/server/build.js";
import { PACKAGE_ROOT, configDir, describeCatalog } from "../src/server/registry.js";
import { describeSlot } from "../src/server/prompt.js";
import { ICON_NAMES } from "../src/core/icons.js";
import { LEGACY_SKILL_NAME, copilotSkillsDir, installCopilotSkill } from "../src/server/skill.js";

const HELP = `deckforge ${VERSION} — themeable, template-driven HTML presentations

Usage
  deckforge new <dir> [--title "My talk"] [--theme build] [--example [<name>]]
  deckforge build <deck.yaml|dir> [--runtime local|cdn|inline] [--out deck.html] [--check-offline] [--strip-notes] [--json]
  deckforge diff <a.yaml|dir|-> <b.yaml|dir> [--json]
  deckforge export <deck.yaml|dir> [--out deck.pptx] [--json]
  deckforge templates [deck.yaml|dir] [--json]
  deckforge edit <deck.yaml|dir> [--port 0] [--token <t>] [--runtime …] [--no-open]
  deckforge serve <deck.yaml|dir> [--port 0] [--no-open]
  deckforge mcp [deck.yaml|dir]
  deckforge mcp --install [--force] [--dest <mcp-config.json>]
  deckforge skill install-copilot [--force] [--dest <skills dir>] [--replace-build-presentation]

Commands
  new        Create a deck folder with a deck.yaml (a title slide, or --example for a full deck:
             EXAMPLES)
  build      Render deck.yaml to a static deck.html next to it (--json: machine-readable report).
             --check-offline fails (exit 2) when the output loads anything over http(s), such as
             https:// images or the cdn runtime; inline decks also get a CSP that blocks the network.
             --strip-notes leaves the speaker notes out, for a copy to share
  diff       Per-slide summary of the changes between two deck.yaml files, for reviews
             ("-" reads the first one from stdin, e.g. git show main:deck.yaml | deckforge diff - deck.yaml)
  export     Export deck.yaml to an editable PowerPoint deck.pptx next to it (native text,
             shapes and pictures; needs Playwright: npm i -g playwright && npx playwright install chromium)
  templates  List the templates (with their slots), themes and icons a deck can use
  edit       Start the local editor (127.0.0.1 only, random port and per-run token)
  serve      Serve the built deck read-only, rebuilding and reloading on change
  mcp        Run a stdio MCP server with the deck tools for Copilot CLI / the Copilot app
             (without a deck: the deck.yaml of the Copilot session's folder). Changes go
             through a running "deckforge edit" of that deck when there is one.
             --install registers it for every Copilot session in
             $COPILOT_HOME/mcp-config.json (default ~/.copilot/mcp-config.json)
  skill      install-copilot: install the deckforge GitHub Copilot skill into
             $COPILOT_HOME/skills (default ~/.copilot/skills)

Runtime modes (how deck.html loads the viewer)
  local   copy deckforge/deckforge.viewer.{js,css} next to deck.html (default)
  cdn     reference https://cdn.jsdelivr.net/gh/lrivallain/deckforge@v${VERSION}/dist/
  inline  embed everything into one self-contained file

Images live in <deck>/assets/ (added from the editor). local copies the used
ones next to --out, inline embeds them as data URIs, cdn keeps relative paths.
\`build\` lists assets that no slide references (they are never deleted).

Templates/themes lookup: <deck>/templates|themes → ${path.join(configDir(), "templates|themes")} → built-ins
`;

const EXAMPLE_HELP = {
  starter: "diagram-led specimen",
  aurora: "dark theme, Essentials templates",
  "architecture-review": "architecture or design review",
  postmortem: "incident postmortem",
  assessment: "migration or cost assessment",
  "decision-record": "options → recommendation, ADR-style",
};

let jsonOutput = false;

function fail(message) {
  if (jsonOutput) console.log(JSON.stringify({ error: message }, null, 2));
  else console.error(`deckforge: ${message}`);
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

// `--example` takes an optional example name: bare `--example` means "starter".
// Only consume the next token when it names a bundled example, so
// `new my-talk --example` and `new --example my-talk` keep working.
const EXAMPLES_DIR = path.join(PACKAGE_ROOT, "examples");
const exampleNames = () => {
  try {
    return fs.readdirSync(EXAMPLES_DIR).filter((name) => fs.existsSync(path.join(EXAMPLES_DIR, name, "deck.yaml"))).sort();
  } catch {
    return [];
  }
};
const argv = [];
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg !== "--example") {
    argv.push(arg);
    continue;
  }
  const next = process.argv[i + 1];
  if (next && !next.startsWith("-") && exampleNames().includes(next)) {
    argv.push(`--example=${next}`);
    i++;
  } else argv.push("--example=starter");
}

const { values, positionals } = parseArgs({
  args: argv,
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
    example: { type: "string" },
    force: { type: "boolean" },
    json: { type: "boolean" },
    dest: { type: "string" },
    "replace-build-presentation": { type: "boolean" },
    install: { type: "boolean" },
    "check-offline": { type: "boolean" },
    "strip-notes": { type: "boolean" },
  },
});

const [command, target] = positionals;
jsonOutput = Boolean(values.json);
if (values.version) {
  console.log(VERSION);
  process.exit(0);
}
if (values.help || !command) {
  const examples = exampleNames().map((name) => `"${name}"${name === "starter" ? " (default)" : ""}${EXAMPLE_HELP[name] ? `: ${EXAMPLE_HELP[name]}` : ""}`);
  console.log(HELP.replace("EXAMPLES", examples.join(",\n             ")));
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
      const available = exampleNames();
      if (!available.includes(values.example)) fail(`unknown example "${values.example}" (available: ${available.join(", ")})`);
      yaml = fs.readFileSync(path.join(EXAMPLES_DIR, values.example, "deck.yaml"), "utf8");
      const assets = path.join(EXAMPLES_DIR, values.example, "assets");
      if (fs.existsSync(assets)) fs.cpSync(assets, path.join(dir, "assets"), { recursive: true, force: Boolean(values.force) });
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
      const result = buildDeckFile(file, { runtime: values.runtime, out: values.out, checkOffline: values["check-offline"], stripNotes: values["strip-notes"] });
      const errors = result.issues.some((i) => i.level === "error");
      if (jsonOutput) {
        console.log(JSON.stringify({
          ok: !errors,
          deck: file,
          outPath: result.outPath,
          runtime: result.runtime,
          slides: result.deck.slides.length,
          visibleSlides: result.deck.slides.filter((s) => !s.hidden).length,
          issues: result.issues,
          loadErrors: result.loadErrors.map(({ path: p, message }) => ({ path: p, message })),
          assets: result.assets,
          ...(result.external ? { offline: { ok: !result.external.length, external: result.external } } : {}),
        }, null, 2));
        if (errors) process.exitCode = 2;
        break;
      }
      printIssues(result.issues, result.loadErrors);
      console.log(`Built ${path.relative(process.cwd(), result.outPath)} (${result.runtime} runtime, ${result.deck.slides.filter((s) => !s.hidden).length} slides${values["strip-notes"] ? ", no speaker notes" : ""})`);
      if (result.external) {
        if (result.external.length) console.error(`Not offline: ${result.external.length} network reference${result.external.length > 1 ? "s" : ""} (see above).`);
        else console.log(`Offline check passed: no network references${result.runtime === "inline" ? "; a CSP blocks the network" : ""}.`);
      }
      if (errors) process.exitCode = 2;
    } catch (err) {
      fail(err.message);
    }
    break;
  }
  case "diff": {
    const second = positionals[2];
    if (!target || !second) fail("usage: deckforge diff <a.yaml|dir|-> <b.yaml|dir>");
    const read = (arg) => {
      if (arg === "-") return { label: "stdin", yaml: fs.readFileSync(0, "utf8") };
      const file = resolveDeck(arg);
      return { label: path.relative(process.cwd(), file) || file, yaml: fs.readFileSync(file, "utf8") };
    };
    try {
      const a = read(target);
      const b = read(second);
      const diff = diffDecks(parseDeckYaml(a.yaml), parseDeckYaml(b.yaml));
      if (jsonOutput) console.log(JSON.stringify({ from: a.label, to: b.label, ...diff }, null, 2));
      else console.log(formatDiff(diff, { from: a.label, to: b.label }));
    } catch (err) {
      fail(err.message);
    }
    break;
  }
  case "export": {
    const file = resolveDeck(target);
    const { exportPptxFile } = await import("../src/server/export.js");
    try {
      const result = await exportPptxFile(file, { out: values.out });
      const errors = result.issues.some((i) => i.level === "error");
      if (jsonOutput) {
        console.log(JSON.stringify({
          ok: !errors,
          deck: file,
          outPath: result.outPath,
          slides: result.slides,
          warnings: result.warnings,
          issues: result.issues,
          loadErrors: result.loadErrors.map(({ path: p, message }) => ({ path: p, message })),
        }, null, 2));
        if (errors) process.exitCode = 2;
        break;
      }
      printIssues(result.issues.filter((i) => i.level !== "info"), result.loadErrors);
      if (errors) {
        console.error("Not exported: fix the errors above first.");
        process.exitCode = 2;
        break;
      }
      for (const w of result.warnings) console.error(`  ! ${w}`);
      console.log(`Exported ${path.relative(process.cwd(), result.outPath)} (${result.slides} slides)`);
    } catch (err) {
      fail(err.message);
    }
    break;
  }
  case "templates": {
    let deckDir = path.resolve(target || ".");
    if (!fs.existsSync(deckDir)) fail(`${deckDir} does not exist`);
    if (fs.statSync(deckDir).isFile()) deckDir = path.dirname(deckDir);
    const catalog = describeCatalog(deckDir);
    if (jsonOutput) {
      console.log(JSON.stringify({ deckDir, ...catalog, icons: ICON_NAMES }, null, 2));
      break;
    }
    printIssues([], catalog.loadErrors);
    console.log("Templates (deck, then user, then built-in; the first name found wins)");
    for (const t of catalog.templates) {
      console.log(`- ${t.name} [${t.category}${t.scope === "builtin" ? "" : `, ${t.scope}`}]: ${t.description}`);
      console.log(`  slots: ${Object.entries(t.slots).map(([k, s]) => describeSlot(k, s)).join("; ")}`);
    }
    console.log(`\nThemes: ${catalog.themes.map((t) => (t.scope === "builtin" ? t.name : `${t.name} (${t.scope})`)).join(", ")}`);
    console.log(`Icons: ${ICON_NAMES.join(" ")}`);
    break;
  }
  case "skill": {
    if (target !== "install-copilot") fail(`unknown skill action "${target ?? ""}" (expected: deckforge skill install-copilot)`);
    try {
      const skillsDir = values.dest ? path.resolve(values.dest) : copilotSkillsDir();
      const result = installCopilotSkill({ skillsDir, force: values.force, replaceLegacy: values["replace-build-presentation"], version: VERSION });
      console.log(`${result.upgraded ? "Updated" : "Installed"} the deckforge Copilot skill in ${result.target}`);
      if (result.legacyRemoved) console.log(`Removed the ${LEGACY_SKILL_NAME} skill it replaces (${result.legacy})`);
      else if (result.legacy) {
        console.log(`\nNote: ${result.legacy} is still installed. The deckforge skill replaces it;`);
        console.log("remove it, or re-run with --replace-build-presentation, so both do not answer the same prompts.");
      }
      console.log("\nStart a new Copilot session to load it (check with /skills).");
    } catch (err) {
      fail(err.message);
    }
    break;
  }
  case "mcp": {
    if (values.install) {
      const { installGlobalMcp, mcpConfigFile } = await import("../src/server/copilot-link.js");
      try {
        const result = installGlobalMcp({ file: values.dest ? path.resolve(values.dest) : mcpConfigFile(), force: values.force });
        console.log(`${result.updated ? "Updated" : "Added"} the deckforge MCP server in ${result.file}`);
        console.log("Copilot sessions (CLI and app) started in a deck folder now have the deck tools.");
        console.log("Start a new Copilot session to load it (check with /mcp).");
      } catch (err) {
        fail(err.message);
      }
      break;
    }
    // stdout carries the MCP protocol: never print anything else to it.
    const file = target ? resolveDeck(target) : null;
    const { runMcpServer } = await import("../src/server/mcp.js");
    await runMcpServer({ deckPath: file });
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
