import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, resolveInside, protectDeckHtml } from "../../src/server/http.js";
import { DeckStore } from "../../src/server/store.js";
import { AgentController, cleanImproved, deckToolSpecs, MAX_IMPROVE_CHARS, MAX_THEME_PROMPT_CHARS, parseThemeReply, summarizeTurn } from "../../src/server/agent.js";
import { describeToolCall, mcpToolSpecs } from "../../src/server/deck-tools.js";
import { TOOL_LABELS } from "../../src/editor/tool-labels.js";
import { parseDeckYaml } from "../../src/core/index.js";
import { DOC_PATH, renderToolCatalogue, updateDoc } from "../../scripts/agent-tools-doc.js";
import { systemPrompt, themePrompt, themeSystemPrompt } from "../../src/server/prompt.js";
import { generateToken } from "../../src/server/token.js";
import { devCliArgs } from "../../scripts/dev-args.js";
import * as mockSdk from "../fixtures/mock-sdk.js";

const root = path.resolve(import.meta.dirname, "../..");
const cli = path.join(root, "bin/deckforge.js");

let dir;
function makeDeck() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-test-"));
  fs.copyFileSync(path.join(root, "examples/starter/deck.yaml"), path.join(dir, "deck.yaml"));
  return path.join(dir, "deck.yaml");
}
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await wait(20);
  }
  throw new Error("timeout");
}

describe("DeckStore", () => {
  let store;
  beforeEach(() => {
    store = new DeckStore({ deckPath: makeDeck() });
  });
  afterEach(() => store.close());

  it("applies ops, persists deck.yaml and rebuilds deck.html", async () => {
    store.apply("update_slide", { id: "concept", set: { eyebrow: "Changed" } });
    expect(fs.readFileSync(path.join(dir, "deck.yaml"), "utf8")).toContain("eyebrow: Changed");
    store.build();
    expect(fs.readFileSync(path.join(dir, "deck.html"), "utf8")).toContain("Changed");
    expect(fs.existsSync(path.join(dir, "deckforge/deckforge.viewer.js"))).toBe(true);
  });

  it("undoes and redoes, coalescing rapid typing", () => {
    store.apply("update_slide", { id: "concept", set: { eyebrow: "A" } }, { coalesce: "k" });
    store.apply("update_slide", { id: "concept", set: { eyebrow: "AB" } }, { coalesce: "k" });
    store.apply("set_hidden", { id: "zoom", hidden: true });
    expect(store.undoStack.length).toBe(2);
    store.undo();
    expect(store.deck.slides.find((s) => s.id === "zoom").hidden).toBe(false);
    store.undo();
    expect(store.deck.slides[0].data.eyebrow).toBe("01 / Explain the shift");
    store.redo();
    expect(store.deck.slides[0].data.eyebrow).toBe("AB");
    expect(store.canRedo ?? store.redoStack.length).toBeTruthy();
  });

  it("groups several ops into one undo entry", () => {
    store.beginGroup("Agent: test");
    store.apply("set_hidden", { id: "zoom", hidden: true }, { source: "agent" });
    store.apply("remove_slide", { id: "lifecycle" }, { source: "agent" });
    const changed = store.endGroup();
    expect(changed).toEqual(["zoom"]);
    expect(store.undoStack.length).toBe(1);
    expect(store.undoStack[0].label).toBe("Agent: test");
    store.undo();
    expect(store.deck.slides.length).toBe(4);
  });

  it("names template changes in the undo history and change events", () => {
    const events = [];
    store.on("change", (e) => events.push(e));
    store.apply("set_template", { id: "concept", template: "title" }, { label: "Change template" });
    expect(store.undoStack.at(-1).label).toBe("Slide 1: Concept map → Title");
    expect(events.at(-1)).toMatchObject({ op: "set_template", label: "Slide 1: Concept map → Title" });
  });

  it("refuses user edits while an agent turn is open", () => {
    store.beginGroup("Agent: busy", "agent");
    store.apply("set_hidden", { id: "zoom", hidden: true }, { source: "agent" });
    expect(() => store.apply("set_hidden", { id: "concept", hidden: true }, { source: "user" })).toThrow(/Copilot is applying changes/);
    expect(store.endGroup()).toEqual(["zoom"]);
    store.undo();
    expect(store.deck.slides.every((s) => !s.hidden)).toBe(true);
  });

  it("saves templates only inside the allowed folders", () => {
    const source = fs.readFileSync(path.join(root, "templates/quote.html"), "utf8").replace("name: quote", "name: my-quote");
    const result = store.saveTemplate("my-quote", source, "deck");
    expect(result.path).toBe(path.join(dir, "templates/my-quote.html"));
    expect(store.templates["my-quote"].scope).toBe("deck");
    expect(() => store.saveTemplate("../evil", source, "deck")).toThrow(/lowercase/);
    expect(() => store.saveTemplate("my-quote", source.replace("name: my-quote", "name: other"), "deck")).toThrow(/must match/);
    expect(() => store.saveTemplate("x", "x", "builtin")).toThrow();
  });

  it("saves themes only inside the allowed folders and rebuilds decks that use them", () => {
    const configHome = path.join(dir, "config");
    const saved = process.env.DECKFORGE_CONFIG_DIR;
    process.env.DECKFORGE_CONFIG_DIR = configHome;
    try {
      const source = fs.readFileSync(path.join(root, "themes/build.yaml"), "utf8").replace("name: build", "name: my-brand").replace('primary: "#0F6CBD"', 'primary: "#0B7368"');
      const events = [];
      store.on("change", (e) => events.push(e));
      const result = store.saveTheme("my-brand", source, "deck");
      expect(result).toMatchObject({ name: "my-brand", scope: "deck", path: path.join(dir, "themes/my-brand.yaml"), active: true, issues: [] });
      expect(store.themes["my-brand"]).toMatchObject({ scope: "deck", palette: { primary: "#0B7368" } });
      expect(events.at(-1)).toMatchObject({ op: "save_theme", changed: [] });
      expect(store.snapshot().themes.find((t) => t.name === "my-brand").source).toBe(source);

      // Used by the deck: every slide changes.
      store.apply("set_theme", { theme: "my-brand" });
      store.saveTheme("my-brand", source.replace('"#0B7368"', '"#095E55"'), "deck");
      expect(events.at(-1).changed).toEqual(store.deck.slides.map((s) => s.id));
      expect(store.build().ok).toBe(true);
      expect(fs.readFileSync(path.join(dir, "deck.html"), "utf8")).toContain("--df-primary: #095E55");

      // A deck theme shadows a user theme with the same name.
      const user = store.saveTheme("my-brand", source, "user");
      expect(user).toMatchObject({ path: path.join(configHome, "themes/my-brand.yaml"), active: false });
      expect(store.themes["my-brand"].scope).toBe("deck");

      const low = store.saveTheme("low-contrast", source.replace("name: build", "name: low-contrast").replace("name: my-brand", "name: low-contrast").replace('muted: "#53617A"', 'muted: "#BBBBBB"'), "user");
      expect(low.issues.map((i) => i.pair[0])).toContain("muted");

      expect(() => store.saveTheme("../evil", source, "deck")).toThrow(/lowercase/);
      expect(() => store.saveTheme("my-brand", source.replace("name: my-brand", "name: other"), "deck")).toThrow(/must match/);
      expect(() => store.saveTheme("my-brand", source.replace(/ {2}ink: .*\n/, ""), "deck")).toThrow(/Missing palette.ink/);
      expect(() => store.saveTheme("my-brand", "palette: [", "deck")).toThrow(/Invalid theme YAML/);
      expect(() => store.saveTheme("my-brand", source, "builtin")).toThrow(/Cannot write themes/);
      expect(fs.readFileSync(path.join(root, "themes/build.yaml"), "utf8")).toContain("name: build");
    } finally {
      if (saved === undefined) delete process.env.DECKFORGE_CONFIG_DIR;
      else process.env.DECKFORGE_CONFIG_DIR = saved;
    }
  });

  it("reloads external edits to deck.yaml as an undoable change", async () => {
    store.watch();
    const events = [];
    store.on("change", (e) => events.push(e));
    await wait(100);
    const file = path.join(dir, "deck.yaml");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Build Presentation - reusable style specimen", "Edited outside"));
    await until(() => events.some((e) => e.source === "disk"));
    expect(store.deck.meta.title).toBe("Edited outside");
    store.undo();
    expect(store.deck.meta.title).toBe("Build Presentation - reusable style specimen");
  });
});

describe("HTTP server", () => {
  let app;
  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function start(opts = {}) {
    app = await startServer({ deckPath: makeDeck(), mode: "edit", agentFactory: mockSdk.createClient ? { createClient: mockSdk.createClient } : undefined, log: () => {}, ...opts });
    return app;
  }
  const req = (url, init = {}) => fetch(`${app.origin}${url}`, { redirect: "manual", ...init });
  const auth = (extra = {}) => ({ "x-deckforge-token": app.token, ...extra });

  it("binds to loopback and requires the token", async () => {
    await start();
    expect(app.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await req("/api/state")).status).toBe(401);
    expect((await req("/")).status).toBe(401);
    expect((await req("/?token=wrong")).status).toBe(401);
    const res = await req(`/?token=${app.token}`);
    expect(res.status).toBe(302);
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toMatch(new RegExp(`^df_token_${app.port}=.+; HttpOnly; SameSite=Lax; Path=/`));
    const page = await req("/", { headers: { cookie: cookie.split(";")[0] } });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(await page.text()).toContain("/assets/deckforge.editor.js");
  });

  it("keeps editors on different ports signed in with one shared cookie jar", async () => {
    // Browsers share 127.0.0.1 cookies across ports: each editor needs its own cookie name.
    const a = await start({ token: "token-a" });
    const second = await startServer({ deckPath: makeDeck(), mode: "edit", log: () => {}, token: "token-b" });
    try {
      const jar = new Map();
      const signIn = async (server) => {
        const res = await fetch(`${server.origin}/?token=${server.token}`, { redirect: "manual" });
        const [pair] = res.headers.get("set-cookie").split(";");
        const index = pair.indexOf("=");
        jar.set(pair.slice(0, index), pair.slice(index + 1));
      };
      const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const state = (server) => fetch(`${server.origin}/api/state`, { headers: { cookie: cookie() } });
      await signIn(a);
      await signIn(second);
      expect(jar.size).toBe(2);
      expect((await state(a)).status).toBe(200);
      expect((await state(second)).status).toBe(200);
      // Only the port's own cookie counts: another editor's token is refused.
      const foreign = await fetch(`${a.origin}/api/state`, { headers: { cookie: `df_token_${a.port}=token-b; df_token=token-a` } });
      expect(foreign.status).toBe(401);
    } finally {
      await second.close();
    }
  });

  it("rejects unexpected Host headers and cross-origin writes", async () => {
    await start();
    const http = await import("node:http");
    const status = await new Promise((resolve) => {
      http.get({ host: "127.0.0.1", port: app.port, path: "/api/state", headers: { host: "evil.example", "x-deckforge-token": app.token } }, (r) => resolve(r.statusCode));
    });
    expect(status).toBe(421);
    const res = await req("/api/op", { method: "POST", headers: auth({ "content-type": "application/json", origin: "https://evil.example" }), body: "{}" });
    expect(res.status).toBe(403);
    const plain = await req("/api/op", { method: "POST", headers: auth({ "content-type": "text/plain" }), body: "{}" });
    expect(plain.status).toBe(415);
  });

  it("applies ops and streams changes over SSE", async () => {
    await start();
    const events = await fetch(`${app.origin}/api/events`, { headers: auth() });
    const reader = events.body.getReader();
    const res = await req("/api/op", { method: "POST", headers: auth({ "content-type": "application/json" }), body: JSON.stringify({ name: "set_theme", args: { theme: "atelier" } }) });
    expect(res.status).toBe(200);
    let text = "";
    while (!text.includes("event: deck")) text += new TextDecoder().decode((await reader.read()).value);
    reader.cancel();
    expect(text).toContain('"theme":"atelier"');
    const bad = await req("/api/op", { method: "POST", headers: auth({ "content-type": "application/json" }), body: JSON.stringify({ name: "remove_slide", args: { id: "nope" } }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/No slide/);
  });

  it("serves the agent log with the token only, as a download on request", async () => {
    await start();
    expect((await req("/api/agent/log")).status).toBe(401);
    const res = await req("/api/agent/log?download=1", { headers: auth() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="deck.agent-log.json"');
    const body = await res.json();
    expect(body.deck.file).toBe("deck.yaml");
    expect(body.deck).not.toHaveProperty("path");
    expect(body.turns).toEqual([]);
    expect((await req("/api/agent/log", { headers: auth() })).headers.get("content-disposition")).toBeNull();
  });

  it("improves a text field over the API", async () => {
    await start();
    const post = (body, headers = {}) => req("/api/agent/improve", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    expect((await post({ text: "Hi" })).status).toBe(401);
    expect((await post({ text: "Hi" }, auth({ origin: "https://evil.example" }))).status).toBe(403);
    const ok = await post({ text: "Make it better", label: "Notes", slideId: "zoom" }, auth());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ text: "Improved: Make it better" });
    const empty = await post({ text: "" }, auth());
    expect(empty.status).toBe(400);
    expect(app.store.undoStack.length).toBe(0);
  });

  it("saves themes and generates palettes over the API", async () => {
    await start();
    const json = (body) => ({ method: "POST", headers: auth({ "content-type": "application/json" }), body: JSON.stringify(body) });
    const source = fs.readFileSync(path.join(root, "themes/build.yaml"), "utf8").replace("name: build", "name: api-theme");
    const put = await req("/api/themes/api-theme", { ...json({ source, scope: "deck" }), method: "PUT" });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ ok: true, name: "api-theme", scope: "deck", active: true });
    expect(fs.existsSync(path.join(dir, "themes/api-theme.yaml"))).toBe(true);
    const state = await (await req("/api/state", { headers: auth() })).json();
    expect(state.themes.find((t) => t.name === "api-theme")).toMatchObject({ scope: "deck", source });
    const bad = await req("/api/themes/api-theme", { ...json({ source: "name: api-theme\n", scope: "deck" }), method: "PUT" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Missing palette/);
    expect((await req("/api/themes/api-theme", { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);

    const generated = await req("/api/agent/theme", json({ prompt: "teal and coral, dark", current: { palette: { primary: "#0F6CBD" }, colorScheme: "light" } }));
    expect(generated.status).toBe(200);
    expect(await generated.json()).toMatchObject({ label: "Lagoon night", colorScheme: "dark", palette: { primary: "#2BB3A3" }, issues: [] });
    expect((await req("/api/agent/theme", json({ prompt: " " }))).status).toBe(400);
    expect((await req("/api/agent/theme", { ...json({ prompt: "x" }), headers: auth({ "content-type": "application/json", origin: "https://evil.example" }) })).status).toBe(403);
    // Nothing is applied to the deck.
    expect(app.store.undoStack.length).toBe(0);
  });

  it("serves the deck folder without path traversal or dot-files", async () => {
    await start();
    expect((await req("/deck/deck.html", { headers: auth() })).status).toBe(200);
    expect((await req("/deck/deckforge/deckforge.viewer.js", { headers: auth() })).status).toBe(200);
    expect((await req("/deck/..%2f..%2fetc%2fpasswd", { headers: auth() })).status).toBe(404);
    expect(resolveInside("/a/b", "../c")).toBe(path.resolve("/a/b/c"));
    expect(resolveInside("/a/b", "%2e%2e/%2e%2e/c")).toBe(path.resolve("/a/b/c"));
    expect(resolveInside("/a/b", ".git/config")).toBeNull();
    expect((await req("/assets/../package.json", { headers: auth() })).status).toBe(404);
  });

  it("saves an exported .pptx next to deck.yaml and serves it as a download", async () => {
    await start();
    const pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
    const post = (body, headers) => req("/api/export/pptx", { method: "POST", headers, body });
    expect((await post(zip, { "content-type": pptx })).status).toBe(401);
    expect((await post(zip, auth({ "content-type": pptx, origin: "https://evil.example" }))).status).toBe(403);
    expect((await post(zip, auth({ "content-type": "text/plain" }))).status).toBe(415);
    expect((await post(Buffer.from("<html>not a deck</html>".padEnd(64)), auth({ "content-type": pptx }))).status).toBe(400);
    const ok = await post(zip, auth({ "content-type": pptx }));
    expect(ok.status).toBe(201);
    const saved = await ok.json();
    expect(saved).toMatchObject({ ok: true, file: "deck.pptx", url: "/deck/deck.pptx", bytes: zip.length });
    expect(saved.path).toBe(path.join(dir, "deck.pptx"));
    expect(fs.readFileSync(saved.path).equals(zip)).toBe(true);
    const download = await req(saved.url, { headers: auth() });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe(pptx);
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="deck.pptx"');
    expect((await req("/assets/deckforge.export.js")).status).toBe(200);
  });

  it("serves the deck with a nonce CSP that only trusts the runtime", () => {
    const html = '<body><p><script data-df-runtime>evil()</script></p>\n<script data-df-runtime>\nruntime()\n</script>\n</body>';
    const { html: out, csp } = protectDeckHtml(html, "abc");
    expect(csp).toContain("script-src 'self' 'nonce-abc'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(out).toContain('<p><script data-df-runtime>evil()</script></p>');
    expect(out).toContain('<script data-df-runtime nonce="abc">\nruntime()');
    expect(out).toMatch(/<script nonce="abc">\(function\(\)\{try\{var es=new EventSource\("\/api\/events"\)/);
  });

  it("injects live reload into the served deck", async () => {
    await start();
    const html = await (await req("/deck/deck.html", { headers: auth() })).text();
    expect(html).toContain('new EventSource("/api/events")');
    expect(fs.readFileSync(path.join(dir, "deck.html"), "utf8")).not.toContain("EventSource");
  });

  it("marks the deck served by the editor so the viewer links back to it", async () => {
    expect(protectDeckHtml("<head></head><body></body>", "n").html).not.toContain("deckforge-editor");
    expect(protectDeckHtml("<head></head><body></body>", "n", { editorUrl: "/" }).html).toContain('<meta name="deckforge-editor" content="/"></head>');
    await start();
    const html = await (await req("/deck/deck.html", { headers: auth() })).text();
    expect(html).toContain('<meta name="deckforge-editor" content="/">');
    expect(fs.readFileSync(path.join(dir, "deck.html"), "utf8")).not.toContain("deckforge-editor");
  });

  it("serve mode is read-only and needs no token", async () => {
    await start({ mode: "serve" });
    expect((await req("/deck/deck.html")).status).toBe(200);
    expect(await (await req("/deck/deck.html")).text()).not.toContain("deckforge-editor");
    expect((await req("/api/op", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(404);
  });
});

describe("AgentController", () => {
  let store;
  let agent;
  beforeEach(() => {
    store = new DeckStore({ deckPath: makeDeck() });
  });
  afterEach(async () => {
    await agent?.dispose();
    store.close();
    delete process.env.DECKFORGE_MOCK_AUTH;
  });

  const collect = (controller) => {
    const events = [];
    controller.on("event", (e) => events.push(e));
    return events;
  };

  it("exposes only the deck tools and restricts the session to them", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    await agent.chat({ prompt: "Polish", scope: "slide", slideId: "zoom" });
    await until(() => events.find((e) => e.type === "done"));
    const config = globalThis.__deckforgeMockSession.config;
    expect(config.tools.map((t) => t.name)).toEqual(deckToolSpecs().map((t) => t.name));
    expect(config.availableTools).toEqual(deckToolSpecs().map((t) => `custom:${t.name}`));
    expect(config.onPermissionRequest({ kind: "shell", fullCommandText: "rm -rf /" }).kind).toBe("reject");
    expect(config.onPermissionRequest({ kind: "custom-tool", toolName: "update_slide" }).kind).toBe("approve-once");
    expect(config.systemMessage.content).toContain("<design_rules>");
    expect(config.systemMessage.content).toContain("audience: People preparing diagram-led talks");
  });

  it("applies a turn as one undo group and reports changed slides", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    await agent.chat({ prompt: "Polish", scope: "slide", slideId: "zoom" });
    const done = await until(() => events.find((e) => e.type === "done"));
    expect(done.changed).toEqual(["zoom"]);
    expect(store.deck.slides.find((s) => s.id === "zoom").data.eyebrow).toBe("Edited by Copilot");
    expect(store.undoStack.at(-1).label).toBe("Agent: Polish");
    expect(events.some((e) => e.type === "delta")).toBe(true);
    store.undo();
    expect(store.deck.slides.find((s) => s.id === "zoom").data.eyebrow).toBe("04 / Zoom into one step");
  });

  it("summarizes each turn and records its tool calls in the agent log", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    const calls = [
      { name: "get_deck", args: {} },
      { name: "update_slide", args: { id: "zoom", set: { eyebrow: "New", "cards.0.title": "One" }, notes: "Say it" } },
      { name: "update_slide", args: { id: "concept", set: { eyebrow: "x" } } },
    ];
    await agent.chat({ prompt: `#tools ${JSON.stringify(calls)}`, scope: "slide", slideId: "zoom" });
    const done = await until(() => events.find((e) => e.type === "done"));
    expect(done.summary).toEqual({ toolCalls: 3, failed: 1, slides: [{ id: "zoom", fields: ["eyebrow", "cards.0.title", "notes"] }], deck: [] });
    const [turn] = agent.agentLog().turns;
    expect(turn).toMatchObject({ turn: 1, scope: "slide", slideId: "zoom", changed: ["zoom"], error: null });
    expect(turn.prompt).toMatch(/^#tools/);
    expect(turn.calls.map((c) => [c.tool, c.ok])).toEqual([["get_deck", true], ["update_slide", true], ["update_slide", false]]);
    expect(turn.calls[2].error).toMatch(/Out of scope/);
    expect(turn.calls[1].args.set.eyebrow).toBe("New");

    // Tool calls outside a turn are refused and not logged.
    await globalThis.__deckforgeMockSession.config.tools.find((t) => t.name === "remove_slide").handler({ id: "zoom" });
    expect(agent.agentLog().turns).toHaveLength(1);
  });

  it("enforces the slide scope", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    const calls = [{ name: "update_slide", args: { id: "concept", set: { eyebrow: "x" } } }, { name: "remove_slide", args: { id: "zoom" } }];
    await agent.chat({ prompt: `#tools ${JSON.stringify(calls)}`, scope: "slide", slideId: "zoom" });
    await until(() => events.find((e) => e.type === "done"));
    const errors = events.filter((e) => e.type === "tool_error").map((e) => e.message);
    expect(errors[0]).toMatch(/Out of scope/);
    expect(errors[1]).toMatch(/not allowed/);
    expect(store.deck.slides.length).toBe(4);
    expect(store.undoStack.length).toBe(0);
  });

  it("allows whole-deck changes in deck scope", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    const calls = [{ name: "add_slide", args: { template: "resources", id: "links" } }, { name: "set_theme", args: { theme: "atelier" } }];
    await agent.chat({ prompt: `#tools ${JSON.stringify(calls)}`, scope: "deck" });
    await until(() => events.find((e) => e.type === "done"));
    expect(store.deck.slides.at(-1).id).toBe("links");
    expect(store.deck.meta.theme).toBe("atelier");
    expect(store.undoStack.length).toBe(1);
  });

  it("surfaces sign-in problems with a hint", async () => {
    process.env.DECKFORGE_MOCK_AUTH = "fail";
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    await agent.chat({ prompt: "Hi", scope: "deck" });
    const done = await until(() => events.find((e) => e.type === "done"));
    expect(done.error.auth).toBe(true);
    expect(agent.status().hint).toMatch(/gh auth login/);
  });

  it("reports session errors and closes the undo group", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    await agent.chat({ prompt: "#error boom", scope: "deck" });
    const done = await until(() => events.find((e) => e.type === "done"));
    expect(done.error.message).toBe("boom");
    expect(store.group).toBeNull();
  });

  it("rejects a second request while the session is still starting", async () => {
    let release;
    const slow = { createClient: async () => { await new Promise((r) => (release = r)); return mockSdk.createClient(); } };
    agent = new AgentController({ store, factory: slow });
    const events = collect(agent);
    await agent.chat({ prompt: "one", scope: "deck" });
    await expect(agent.chat({ prompt: "two", scope: "deck" })).rejects.toThrow(/still working/);
    release();
    await until(() => events.find((e) => e.type === "done"));
    expect(store.undoStack.length).toBe(0);
  });

  it("refuses tool calls outside of an active turn", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    await agent.chat({ prompt: "#tools []", scope: "deck" });
    await until(() => events.find((e) => e.type === "done"));
    const tool = globalThis.__deckforgeMockSession.config.tools.find((t) => t.name === "remove_slide");
    const result = await tool.handler({ id: "zoom" });
    expect(result.resultType).toBe("failure");
    expect(store.deck.slides.length).toBe(4);
  });

  it("improves one field with a tool-less one-shot session", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    const before = JSON.stringify(store.deck);
    const result = await agent.improve({ text: "Some  headline", label: "Headline", description: "Slide headline", max: 80, richtext: true, kind: "slide text", slideId: "zoom" });
    expect(result).toEqual({ text: "Improved: Some  headline" });
    const config = globalThis.__deckforgeMockImproveSession.config;
    expect(config.tools).toEqual([]);
    expect(config.availableTools).toEqual([]);
    expect(config.systemMessage.mode).toBe("replace");
    expect(config.systemMessage.content).toContain("audience: People preparing diagram-led talks");
    expect(config.onPermissionRequest({ kind: "shell" }).kind).toBe("reject");
    // The deck, the undo history, the chat and its session are untouched; the one-shot session is deleted.
    expect(JSON.stringify(store.deck)).toBe(before);
    expect(store.undoStack.length).toBe(0);
    expect(agent.session).toBeNull();
    expect(agent.history).toEqual([]);
    expect(events.filter((e) => e.type !== "status")).toEqual([]);
    expect(agent.client.deleted).toEqual([globalThis.__deckforgeMockImproveSession.sessionId]);
    expect(agent.improving).toBe(0);
  });

  it("generates a palette with a tool-less one-shot session", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const before = JSON.stringify(store.deck);
    const result = await agent.generateTheme({ prompt: "Fresh teal with a coral accent", current: { palette: { primary: "#0F6CBD", evil: "x", ink: { no: 1 } }, colorScheme: "light" } });
    expect(result).toMatchObject({ label: "Lagoon", description: "Teal and coral on calm neutrals.", colorScheme: "light", issues: [] });
    expect(Object.keys(result.palette)).toEqual(expect.arrayContaining(["bg", "paper", "ink", "primary", "accent-soft", "accent-text"]));
    const session = globalThis.__deckforgeMockImproveSession;
    expect(session.config.tools).toEqual([]);
    expect(session.config.systemMessage.content).toContain("deckforge theme designer");
    expect(session.config.systemMessage.content).toContain("audience: People preparing diagram-led talks");
    expect(JSON.stringify(store.deck)).toBe(before);
    expect(store.undoStack.length).toBe(0);
    expect(agent.client.deleted).toContain(session.sessionId);
    expect(agent.improving).toBe(0);

    await expect(agent.generateTheme({ prompt: "  " })).rejects.toThrow(/Describe the palette/);
    await expect(agent.generateTheme({ prompt: "x".repeat(MAX_THEME_PROMPT_CHARS + 1) })).rejects.toThrow(/too long/);
    await expect(agent.generateTheme({ prompt: "#error model down" })).rejects.toMatchObject({ message: "model down", status: 502 });
    await expect(agent.generateTheme({ prompt: "#raw I cannot do that" })).rejects.toMatchObject({ message: /no JSON object/, status: 502 });
    await expect(agent.generateTheme({ prompt: '#raw {"palette": {"bg": "#FFFFFF"}}' })).rejects.toThrow(/missing or non-hex paper/);
  });

  it("parses palette answers strictly", () => {
    const palette = Object.fromEntries(["bg", "paper", "line", "ink", "muted", "node", "primary", "primary-soft", "primary-line", "accent", "accent-soft", "accent-line"].map((k) => [k, k === "ink" ? "#111111" : "#f5f5f5"]));
    const reply = parseThemeReply(`Here you go:\n${JSON.stringify({ label: " Calm\n grey ", colorScheme: "night", palette: { ...palette, ok: "green", frame: "#ABCDEF", extra: "#000000" } })}\nEnjoy!`);
    expect(reply.label).toBe("Calm grey");
    expect(reply.colorScheme).toBe("light");
    expect(reply.palette.bg).toBe("#F5F5F5");
    expect(reply.palette.frame).toBe("#ABCDEF");
    expect(reply.palette).not.toHaveProperty("ok");
    expect(reply.palette).not.toHaveProperty("extra");
    // muted (#f5f5f5) is unreadable on paper.
    expect(reply.issues.map((i) => i.pair.join("/"))).toContain("muted/paper");
    expect(() => parseThemeReply("{not json}")).toThrow(/could not be parsed/);
    expect(() => parseThemeReply(JSON.stringify({ palette: { ...palette, ink: "rgb(0,0,0)" } }))).toThrow(/non-hex ink/);
    const prompt = themePrompt({ prompt: "Ocean", current: { palette: { primary: "#0F6CBD" }, colorScheme: "dark" } });
    expect(prompt).toContain("Theme request:\n<<<\nOcean\n>>>");
    expect(prompt).toContain('dark scheme');
    expect(prompt).toContain('{"primary":"#0F6CBD"}');
    expect(themePrompt({ prompt: "Ocean" })).not.toContain("Current palette");
    expect(themeSystemPrompt(store.deck.meta)).toMatch(/"accent-text":/);
  });

  it("validates improve requests and reports failures", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    await expect(agent.improve({ text: "   " })).rejects.toThrow(/empty/);
    await expect(agent.improve({ text: "x".repeat(MAX_IMPROVE_CHARS + 1) })).rejects.toThrow(/too long/);
    await expect(agent.improve({ text: "#error model down" })).rejects.toMatchObject({ message: "model down", status: 502 });
    expect(agent.improving).toBe(0);
  });

  it("reports sign-in problems when improving", async () => {
    process.env.DECKFORGE_MOCK_AUTH = "fail";
    agent = new AgentController({ store, factory: mockSdk });
    const err = await agent.improve({ text: "Hello" }).catch((e) => e);
    expect(err.status).toBe(503);
    expect(err.details).toMatchObject({ auth: true, hint: expect.stringMatching(/gh auth login/) });
  });

  it("limits concurrent improvements", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const slow = { createClient: async () => { await gate; return mockSdk.createClient(); } };
    agent = new AgentController({ store, factory: slow });
    const running = [1, 2, 3].map((n) => agent.improve({ text: `t${n}` }));
    await expect(agent.improve({ text: "t4" })).rejects.toMatchObject({ status: 429 });
    release();
    expect((await Promise.all(running)).map((r) => r.text)).toEqual(["Improved: t1", "Improved: t2", "Improved: t3"]);
  });

  it("cleans the wrappers models put around a rewrite", () => {
    expect(cleanImproved("```\nBetter text\n```")).toBe("Better text");
    expect(cleanImproved("“Better text”")).toBe("Better text");
    expect(cleanImproved('"Say "hi" now"')).toBe('"Say "hi" now"');
    expect(cleanImproved("<<<\nBetter\n>>>")).toBe("Better");
    expect(cleanImproved("  <strong>Keep</strong> tags ")).toBe("<strong>Keep</strong> tags");
  });

  it("builds a grounded system prompt", () => {
    const prompt = systemPrompt({ deck: store.deck, templates: store.templates });
    expect(prompt).toContain("concept-map:");
    expect(prompt).toContain("audiences (cards, max 3)");
    expect(prompt).toContain("Never invent facts");
  });
});

describe("access tokens", () => {
  it("never start with a dash", () => {
    for (let i = 0; i < 10000; i++) expect(generateToken(12)).not.toMatch(/^-/);
  });
  it("keep at least 96 bits of entropy", () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_-]{23}$/);
    expect(generateToken(16)).toHaveLength(22);
  });
  it("are passed to the dev server in --token=<t> form", () => {
    const args = devCliArgs({ mode: "edit", deckPath: "deck.yaml", port: 4370, token: "-NFv45AdyFre63PU" });
    expect(args).toContain("--token=-NFv45AdyFre63PU");
    expect(args).not.toContain("--token");
    expect(devCliArgs({ mode: "serve", deckPath: "deck.yaml", port: 4370, token: "x" }).some((a) => a.startsWith("--token"))).toBe(false);
  });
});

describe("CLI", () => {
  const env = { ...process.env, DECKFORGE_CONFIG_DIR: path.join(os.tmpdir(), "deckforge-test-no-config"), CI: "1" };
  it("creates and builds decks in every runtime mode", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-cli-"));
    const target = path.join(dir, "talk");
    const out = execFileSync(process.execPath, [cli, "new", target, "--title", "My talk"], { env, encoding: "utf8" });
    expect(out).toContain("Created");
    expect(fs.readFileSync(path.join(target, "deck.yaml"), "utf8")).toContain("title: My talk");
    expect(fs.existsSync(path.join(target, "deck.html"))).toBe(true);
    execFileSync(process.execPath, [cli, "build", target, "--runtime", "inline", "--out", path.join(dir, "single.html")], { env });
    const single = fs.readFileSync(path.join(dir, "single.html"), "utf8");
    expect(single).not.toMatch(/(src|href)="(https?:)?\/\//);
    execFileSync(process.execPath, [cli, "build", path.join(target, "deck.yaml"), "--runtime", "cdn"], { env });
    expect(fs.readFileSync(path.join(target, "deck.html"), "utf8")).toContain("cdn.jsdelivr.net/gh/lrivallain/deckforge@v");
    expect(() => execFileSync(process.execPath, [cli, "build", target, "--runtime", "bogus"], { env, stdio: "pipe" })).toThrow();
    expect(execFileSync(process.execPath, [cli, "--version"], { env, encoding: "utf8" }).trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("lists export in the help and refuses to export a deck with errors", () => {
    expect(execFileSync(process.execPath, [cli, "--help"], { env, encoding: "utf8" })).toContain("deckforge export <deck.yaml|dir> [--out deck.pptx] [--json]");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-cli-"));
    fs.writeFileSync(path.join(dir, "deck.yaml"), "meta:\n  title: Broken\nslides:\n  - id: a\n    template: nope\n");
    const result = spawnSync(process.execPath, [cli, "export", dir, "--json"], { env, encoding: "utf8" });
    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(false);
    expect(report.outPath).toBeNull();
    expect(report.issues).toContainEqual(expect.objectContaining({ level: "error", message: 'Unknown template "nope"' }));
    expect(fs.existsSync(path.join(dir, "deck.pptx"))).toBe(false);
  });
  it("creates decks from the bundled examples", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-cli-"));
    const aurora = path.join(dir, "aurora");
    execFileSync(process.execPath, [cli, "new", aurora, "--example", "aurora"], { env });
    expect(fs.readFileSync(path.join(aurora, "deck.yaml"), "utf8")).toBe(fs.readFileSync(path.join(root, "examples/aurora/deck.yaml"), "utf8"));
    expect(fs.existsSync(path.join(aurora, "assets/aurora-sky.svg"))).toBe(true);
    expect(fs.readFileSync(path.join(aurora, "deck.html"), "utf8")).toContain('data-theme="aurora"');
    const starter = path.join(dir, "starter");
    execFileSync(process.execPath, [cli, "new", starter, "--example"], { env });
    expect(fs.readFileSync(path.join(starter, "deck.yaml"), "utf8")).toBe(fs.readFileSync(path.join(root, "examples/starter/deck.yaml"), "utf8"));
    const agentNative = path.join(dir, "agent-native");
    execFileSync(process.execPath, [cli, "new", agentNative, "--example", "agent-native"], { env });
    expect(fs.readFileSync(path.join(agentNative, "deck.yaml"), "utf8")).toBe(fs.readFileSync(path.join(root, "examples/agent-native/deck.yaml"), "utf8"));
    const before = path.join(dir, "before");
    execFileSync(process.execPath, [cli, "new", "--example", before], { env });
    expect(fs.readFileSync(path.join(before, "deck.yaml"), "utf8")).toContain("theme: build");
    expect(() => execFileSync(process.execPath, [cli, "new", path.join(dir, "x"), "--example=nope"], { env, stdio: "pipe" })).toThrow(/unknown example "nope"/);
  });
  it("keeps the skill-built example deck valid, with an up-to-date validation report", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-cli-"));
    const report = JSON.parse(execFileSync(process.execPath, [cli, "build", path.join(root, "examples/agent-native"), "--json", "--out", path.join(dir, "deck.html")], { env, encoding: "utf8" }));
    expect(report).toMatchObject({ ok: true, issues: [], loadErrors: [] });
    const deck = parseDeckYaml(fs.readFileSync(path.join(root, "examples/agent-native/deck.yaml"), "utf8"));
    expect(deck.meta.brief).toMatchObject({ topic: expect.any(String), audience: expect.any(String), goal: expect.any(String) });
    const saved = JSON.parse(fs.readFileSync(path.join(root, "examples/agent-native/validation.json"), "utf8"));
    expect(saved).toMatchObject({ ok: true, build: { ok: true, slides: report.slides, issues: [] }, layout: { ok: true, checked: report.visibleSlides, problems: [] } });
  });
  it("accepts a --token=<t> value that starts with a dash", async () => {
    const deckPath = makeDeck();
    const child = spawn(process.execPath, [cli, "edit", deckPath, "--port", "0", "--token=-abc", "--no-open"], { env, stdio: ["ignore", "pipe", "pipe"] });
    try {
      let output = "";
      const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`editor did not start:\n${output}`)), 10000);
        const onData = (chunk) => {
          output += chunk;
          const match = output.match(/Editor: (\S+)/);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.once("exit", (code) => reject(new Error(`editor exited (${code}):\n${output}`)));
      });
      expect(new URL(url).searchParams.get("token")).toBe("-abc");
      const res = await fetch(url, { redirect: "manual" });
      expect(res.status).toBe(302);
      const page = await fetch(new URL("/", url), { headers: { cookie: res.headers.get("set-cookie").split(";")[0] } });
      expect(page.status).toBe(200);
    } finally {
      child.kill("SIGTERM");
    }
  });
  it("refuses non-loopback hosts", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-cli-"));
    expect(() => execFileSync(process.execPath, [cli, "serve", path.join(root, "examples/starter"), "--host", "0.0.0.0"], { env, stdio: "pipe" })).toThrow(/loopback/);
  });
  it("lists the catalogue with deck-local templates", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-cli-"));
    fs.mkdirSync(path.join(dir, "templates"));
    fs.writeFileSync(path.join(dir, "templates/metric.html"), "---\nname: metric\ndescription: One number.\nslots:\n  value: { type: text, max: 8, required: true }\n---\n<p>{{value}}</p>\n");
    fs.writeFileSync(path.join(dir, "templates/broken.html"), "---\nname: other\n---\n<p></p>\n");
    const json = JSON.parse(execFileSync(process.execPath, [cli, "templates", dir, "--json"], { env, encoding: "utf8" }));
    const byName = Object.fromEntries(json.templates.map((t) => [t.name, t]));
    expect(byName["concept-map"].scope).toBe("builtin");
    expect(byName["concept-map"].slots.audiences).toMatchObject({ type: "cards", max: 3 });
    expect(byName.metric).toMatchObject({ scope: "deck", description: "One number.", slots: { value: { type: "text", max: 8, required: true } } });
    expect(json.themes.map((t) => t.name)).toEqual(expect.arrayContaining(["build", "atelier"]));
    expect(json.icons).toContain("rocket");
    expect(json.loadErrors).toEqual([expect.objectContaining({ message: expect.stringContaining("does not match") })]);
    const text = execFileSync(process.execPath, [cli, "templates", dir], { env, encoding: "utf8", stdio: "pipe" });
    expect(text).toContain("- metric [content, deck]: One number.");
    expect(text).toContain("value (text, max 8, required)");
  });
  it("reports build results as JSON", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-cli-"));
    fs.copyFileSync(path.join(root, "examples/starter/deck.yaml"), path.join(dir, "deck.yaml"));
    const ok = JSON.parse(execFileSync(process.execPath, [cli, "build", dir, "--json"], { env, encoding: "utf8" }));
    expect(ok).toMatchObject({ ok: true, runtime: "local", slides: 4, visibleSlides: 4, issues: [], outPath: path.join(dir, "deck.html") });
    fs.writeFileSync(path.join(dir, "deck.yaml"), "meta: { title: T }\nslides:\n  - { id: a, template: nope }\n  - { id: b, template: bullets, data: { title: Hi, bogus: 1 } }\n");
    const bad = spawnSync(process.execPath, [cli, "build", dir, "--json"], { env, encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toBe("");
    const report = JSON.parse(bad.stdout);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "error", slide: "a", message: expect.stringContaining("Unknown template") }),
      expect.objectContaining({ level: "warning", slide: "b", message: expect.stringContaining("bogus") }),
    ]));
    const missing = spawnSync(process.execPath, [cli, "build", path.join(dir, "nope"), "--json"], { env, encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).error).toContain("does not exist");
  });
});

describe("Agent change summary", () => {
  it("describes the slots and fields each tool call touches", () => {
    expect(describeToolCall("update_slide", { id: "a", data: { title: "T" }, set: { "cards.1.text": "x" }, notes: "n", title: "Nav", footer: "" })).toEqual({ slideId: "a", fields: ["title", "cards.1.text", "notes", "nav title", "footer"] });
    expect(describeToolCall("add_slide", { template: "points", data: { items: [] } }, { id: "new-1" })).toEqual({ slideId: "new-1", fields: ["template", "items"] });
    expect(describeToolCall("set_template", { id: "a", template: "split" })).toEqual({ slideId: "a", fields: ["template"] });
    expect(describeToolCall("set_image", { id: "a", path: "assets/x.png", alt: "x" }, { id: "a", slot: "visual" })).toEqual({ slideId: "a", fields: ["visual"] });
    expect(describeToolCall("add_overlay", { id: "a", kind: "arrow" }, { id: "a", overlayIds: ["o1"] })).toEqual({ slideId: "a", fields: ["overlay o1"] });
    expect(describeToolCall("remove_overlay", { id: "a", overlayId: "o2" })).toEqual({ slideId: "a", fields: ["overlay o2"] });
    expect(describeToolCall("remove_slide", { id: "a" }, { removed: "a" })).toEqual({ slideId: "a", fields: ["removed"] });
    expect(describeToolCall("set_theme", { theme: "aurora" })).toEqual({ slideId: null, fields: ["theme"] });
    expect(describeToolCall("update_meta", { meta: { brief: {}, title: "T" } })).toEqual({ slideId: null, fields: ["meta.brief", "meta.title"] });
    expect(describeToolCall("get_deck", {})).toEqual({ slideId: null, fields: [] });
  });

  it("merges a turn's successful changes per slide and keeps deck-level fields apart", () => {
    const summary = summarizeTurn([
      { tool: "get_deck", ok: true, slideId: null, fields: [] },
      { tool: "update_slide", ok: true, slideId: "a", fields: ["title"] },
      { tool: "set_hidden", ok: true, slideId: "b", fields: ["hidden"] },
      { tool: "update_slide", ok: true, slideId: "a", fields: ["title", "notes"] },
      { tool: "remove_slide", ok: false, slideId: "c", fields: ["removed"] },
      { tool: "set_theme", ok: true, slideId: null, fields: ["theme"] },
    ]);
    expect(summary).toEqual({ toolCalls: 6, failed: 1, slides: [{ id: "a", fields: ["title", "notes"] }, { id: "b", fields: ["hidden"] }], deck: ["theme"] });
  });

  it("has a drawer label for every deck tool", () => {
    for (const { name } of deckToolSpecs()) expect(TOOL_LABELS[name], name).toBeTruthy();
  });
});

describe("Agent model docs", () => {
  it("keeps the generated tool catalogue in sync with the tool specs (npm run docs:tools)", () => {
    const source = fs.readFileSync(DOC_PATH, "utf8");
    expect(updateDoc(source)).toBe(source);
  });

  it("documents every tool and parameter", () => {
    const catalogue = renderToolCatalogue();
    for (const spec of mcpToolSpecs()) {
      expect(catalogue).toContain(`### \`${spec.name}\``);
      for (const param of Object.keys(spec.parameters.properties || {})) expect(catalogue, `${spec.name}.${param}`).toContain(`| \`${param}\` |`);
    }
  });
});
