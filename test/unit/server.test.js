import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, resolveInside, protectDeckHtml } from "../../src/server/http.js";
import { DeckStore } from "../../src/server/store.js";
import { AgentController, deckToolSpecs } from "../../src/server/agent.js";
import { systemPrompt } from "../../src/server/prompt.js";
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
    expect(cookie).toMatch(new RegExp(`^df_token_${app.port}=.+; HttpOnly; SameSite=Strict; Path=/`));
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

  it("serve mode is read-only and needs no token", async () => {
    await start({ mode: "serve" });
    expect((await req("/deck/deck.html")).status).toBe(200);
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

  it("builds a grounded system prompt", () => {
    const prompt = systemPrompt({ deck: store.deck, templates: store.templates });
    expect(prompt).toContain("concept-map:");
    expect(prompt).toContain("audiences (cards, max 3)");
    expect(prompt).toContain("Never invent facts");
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
  it("refuses non-loopback hosts", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-cli-"));
    expect(() => execFileSync(process.execPath, [cli, "serve", path.join(root, "examples/starter"), "--host", "0.0.0.0"], { env, stdio: "pipe" })).toThrow(/loopback/);
  });
});
