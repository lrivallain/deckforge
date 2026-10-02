import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer } from "../../src/server/http.js";
import { DeckStore } from "../../src/server/store.js";
import { AgentController, historyFromEvents } from "../../src/server/agent.js";
import { mcpToolSpecs } from "../../src/server/deck-tools.js";
import { createDeckBackend, handleMessage } from "../../src/server/mcp.js";
import { cliCommands, findEditor, publishEditor, rememberedSession, sessionName, shellQuote } from "../../src/server/copilot-link.js";
import * as mockSdk from "../fixtures/mock-sdk.js";

const root = path.resolve(import.meta.dirname, "../..");
const cli = path.join(root, "bin/deckforge.js");

let dir;
const saved = {};
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-link-"));
  fs.mkdirSync(path.join(dir, "deck"));
  fs.copyFileSync(path.join(root, "examples/starter/deck.yaml"), path.join(dir, "deck/deck.yaml"));
  for (const key of ["DECKFORGE_CONFIG_DIR", "COPILOT_HOME"]) saved[key] = process.env[key];
  process.env.DECKFORGE_CONFIG_DIR = path.join(dir, "config");
  process.env.COPILOT_HOME = path.join(dir, "copilot");
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
const deckPath = () => path.join(dir, "deck/deck.yaml");
const readDeck = () => fs.readFileSync(deckPath(), "utf8");

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

/** Run `deckforge mcp` with JSON-RPC messages on stdin; resolves with the responses. */
function mcpSession(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "mcp", path.dirname(deckPath())], { env: { ...process.env, CI: "1" } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        resolve({ code, err, responses: out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) });
      } catch (e) {
        reject(new Error(`${e.message}\nstdout: ${out}\nstderr: ${err}`));
      }
    });
    child.stdin.end(messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
  });
}

describe("deckforge mcp (stdio)", () => {
  it("speaks MCP and edits deck.yaml when no editor is running", async () => {
    const { code, responses } = await mcpSession([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "update_slide", arguments: { id: "concept", set: { eyebrow: "From the CLI" } } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "remove_slide", arguments: { id: "missing" } } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_authoring_guide", arguments: {} } },
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "rm_rf", arguments: {} } },
      { jsonrpc: "2.0", id: 7, method: "nope" },
    ]);
    expect(code).toBe(0);
    const byId = Object.fromEntries(responses.map((r) => [r.id, r]));
    expect(responses.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(byId[1].result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "deckforge" } });
    const names = byId[2].result.tools.map((t) => t.name);
    expect(names).toEqual(mcpToolSpecs().map((t) => t.name));
    expect(names).toContain("get_authoring_guide");
    expect(byId[2].result.tools.find((t) => t.name === "get_deck").annotations.readOnlyHint).toBe(true);
    expect(byId[3].result.isError).toBe(false);
    expect(readDeck()).toContain("eyebrow: From the CLI");
    expect(fs.readFileSync(path.join(dir, "deck/deck.html"), "utf8")).toContain("From the CLI");
    expect(byId[4].result.isError).toBe(true);
    expect(byId[4].result.content[0].text).toMatch(/^Error: .*missing/);
    expect(byId[5].result.content[0].text).toContain("<design_rules>");
    expect(byId[5].result.content[0].text).toContain(deckPath());
    expect(byId[6].error.code).toBe(-32602);
    expect(byId[7].error.code).toBe(-32601);
  });

  it("negotiates the protocol version and ignores notifications", async () => {
    const backend = { call: async () => ({}) };
    expect((await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }, backend)).result.protocolVersion).toBe("2025-06-18");
    expect((await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }, backend)).result.protocolVersion).toBe("2024-11-05");
    expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/cancelled" }, backend)).toBeNull();
    expect((await handleMessage({ jsonrpc: "2.0", id: 2, method: "ping" }, backend)).result).toEqual({});
  });

  it("picks up edits made to deck.yaml between calls", async () => {
    const backend = createDeckBackend({ deckPath: deckPath() });
    try {
      await backend.call("get_deck");
      fs.writeFileSync(deckPath(), readDeck().replace("01 / Explain the shift", "Edited by hand"));
      const deck = await backend.call("get_deck");
      expect(deck.slides[0].data.eyebrow).toBe("Edited by hand");
    } finally {
      backend.close();
    }
  });
});

describe("deckforge mcp through a running editor", () => {
  let app;
  afterEach(async () => {
    await app?.close();
    app = null;
  });
  const start = async () => {
    app = await startServer({ deckPath: deckPath(), mode: "edit", agentFactory: mockSdk, log: () => {} });
    return app;
  };

  it("publishes a private discovery record while the editor runs", async () => {
    await start();
    const record = findEditor(deckPath());
    expect(record).toMatchObject({ pid: process.pid, origin: app.origin, token: app.token, deck: deckPath() });
    const file = fs.readdirSync(path.join(dir, "config/editors")).map((f) => path.join(dir, "config/editors", f))[0];
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o077).toBe(0);
    await app.close();
    app = null;
    expect(findEditor(deckPath())).toBeNull();
  });

  it("applies tool calls live in the editor as one undo entry", async () => {
    await start();
    const changes = [];
    app.store.on("change", (c) => changes.push(c));
    const backend = createDeckBackend({ deckPath: deckPath() });
    await backend.call("update_slide", { id: "concept", set: { eyebrow: "Live 1" } });
    await backend.call("set_hidden", { id: "zoom", hidden: true });
    backend.close();
    expect(app.store.deck.slides.find((s) => s.id === "concept").data.eyebrow).toBe("Live 1");
    expect(changes.map((c) => c.source)).toEqual(["mcp", "mcp"]);
    expect(app.store.undoStack).toHaveLength(1);
    expect(app.store.undoStack[0]).toMatchObject({ source: "mcp", label: "Copilot CLI: update_slide" });
    app.store.undo();
    expect(app.store.deck.slides.find((s) => s.id === "zoom").hidden).toBe(false);
    expect(app.store.deck.slides.find((s) => s.id === "concept").data.eyebrow).toBe("01 / Explain the shift");
  });

  it("protects /api/tool and waits for the editor's own Copilot turn", async () => {
    await start();
    const post = (body, headers = {}) => fetch(`${app.origin}/api/tool`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    expect((await post({ name: "get_deck" })).status).toBe(401);
    const auth = { "X-Deckforge-Token": app.token };
    expect((await post({ name: "shell" }, auth)).status).toBe(404);
    const ok = await post({ name: "get_deck" }, auth);
    expect(ok.status).toBe(200);
    expect((await ok.json()).result.slides.length).toBeGreaterThan(3);
    app.store.beginGroup("Agent: test", "agent");
    const busy = await post({ name: "set_hidden", args: { id: "zoom", hidden: true } }, auth);
    expect(busy.status).toBe(409);
    app.store.endGroup();
    const backend = createDeckBackend({ deckPath: deckPath() });
    app.store.beginGroup("Agent: test", "agent");
    await expect(backend.call("set_hidden", { id: "zoom", hidden: true })).rejects.toThrow(/applying changes/);
    app.store.endGroup();
    backend.close();
  });

  it("does not edit the file when the editor may have received the call", async () => {
    const remove = publishEditor({ deckPath: deckPath(), origin: "http://127.0.0.1:9", token: "x" });
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const backend = createDeckBackend({ deckPath: deckPath(), fetchImpl: async () => { throw timeout; } });
    try {
      await expect(backend.call("update_slide", { id: "concept", set: { eyebrow: "Twice?" } })).rejects.toThrow(/did not answer/);
      expect(readDeck()).not.toContain("Twice?");
    } finally {
      backend.close();
      remove();
    }
  });

  it("falls back to the deck file when the recorded editor is gone", async () => {
    const net = await import("node:net");
    const port = await new Promise((resolve) => {
      const srv = net.createServer().listen(0, "127.0.0.1", () => {
        const free = srv.address().port;
        srv.close(() => resolve(free));
      });
    });
    const remove = publishEditor({ deckPath: deckPath(), origin: `http://127.0.0.1:${port}`, token: "x" });
    const logs = [];
    const backend = createDeckBackend({ deckPath: deckPath(), log: (m) => logs.push(m) });
    try {
      await backend.call("update_slide", { id: "concept", set: { eyebrow: "Offline" } });
      expect(readDeck()).toContain("eyebrow: Offline");
      expect(logs.join("\n")).toMatch(/unreachable/);
    } finally {
      backend.close();
      remove();
    }
  });
});

describe("Copilot session handoff", () => {
  let store;
  let agent;
  beforeEach(() => {
    store = new DeckStore({ deckPath: deckPath() });
  });
  afterEach(async () => {
    await agent?.dispose();
    store.close();
  });
  const collect = (controller) => {
    const events = [];
    controller.on("event", (e) => events.push(e));
    return events;
  };
  const turn = async (controller, events, prompt = "Polish", scope = "slide") => {
    const before = events.filter((e) => e.type === "done").length;
    await controller.chat({ prompt, scope, slideId: "zoom" });
    return until(() => events.filter((e) => e.type === "done").length > before && events.filter((e) => e.type === "done").at(-1));
  };

  it("names, exposes and remembers the chat session", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    await turn(agent, events);
    const id = agent.status().sessionId;
    expect(id).toMatch(/^mock-/);
    expect(agent.status()).toMatchObject({ connected: true, handedOff: false });
    expect(globalThis.__deckforgeMockSessions.get(id).name).toBe(sessionName(store.deck.meta.title));
    expect(rememberedSession(deckPath())).toBe(id);
    expect(events.some((e) => e.type === "link" && e.sessionId === id)).toBe(true);
  });

  it("hands the session over and resumes it with its history", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    await turn(agent, events);
    const id = agent.sessionId;
    const info = await agent.handoff();
    expect(info).toMatchObject({ sessionId: id, handedOff: true });
    expect(info.command).toContain(`copilot --resume ${id} -C `);
    expect(info.command).toContain("--allow-tool deckforge");
    expect(info.commandNew).not.toContain("--resume");
    const config = JSON.parse(fs.readFileSync(info.mcpConfig, "utf8"));
    expect(config.mcpServers.deckforge).toMatchObject({ type: "local", command: process.execPath, args: [cli, "mcp", deckPath()] });
    expect(info.command).toContain(`@${info.mcpConfig}`);
    expect(agent.status()).toMatchObject({ connected: false, handedOff: true });

    // Meanwhile the conversation continues in Copilot CLI.
    globalThis.__deckforgeMockSessions.get(id).events.push({ type: "user.message", data: { content: "From the CLI" } }, { type: "assistant.message", data: { content: "Done in the CLI" } });
    await turn(agent, events, "Back in the editor");
    expect(agent.client.resumed).toEqual([id]);
    expect(agent.status()).toMatchObject({ sessionId: id, connected: true, handedOff: false });
    const texts = agent.history.map((m) => `${m.role}:${m.text}`);
    expect(texts.slice(0, 4)).toEqual(["user:Polish", "assistant:Working on it. Done: ran get_deck, update_slide.", "user:From the CLI", "assistant:Done in the CLI"]);
    expect(texts).toContain("user:Back in the editor");
    expect(events.some((e) => e.type === "history")).toBe(true);
  });

  it("refuses to take the session back while Copilot CLI holds it", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    await turn(agent, events);
    await agent.handoff();
    const stateDir = path.join(dir, "copilot/session-state", agent.sessionId);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, `inuse.${process.ppid}.lock`), "");
    const done = await turn(agent, events, "Again");
    expect(done.error.message).toMatch(/open in Copilot CLI/);
    expect(agent.status().connected).toBe(false);
    fs.rmSync(path.join(stateDir, `inuse.${process.ppid}.lock`));
    expect((await turn(agent, events, "Now")).error).toBeNull();
  });

  it("resumes the remembered session in a new editor, and forgets it on reset", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    await turn(agent, events);
    const id = agent.sessionId;
    await agent.dispose();
    agent = new AgentController({ store, factory: mockSdk });
    expect(agent.status()).toMatchObject({ sessionId: id, connected: false });
    const status = await agent.connect();
    expect(status.connected).toBe(true);
    expect(agent.client.resumed).toEqual([id]);
    expect(status.history.map((m) => m.role)).toEqual(["user", "assistant"]);
    await agent.reset();
    expect(agent.status().sessionId).toBeNull();
    expect(rememberedSession(deckPath())).toBeNull();
  });

  it("starts a new session when the remembered one is gone", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    agent.setSessionId("mock-deleted");
    await agent.connect();
    expect(agent.sessionId).not.toBe("mock-deleted");
    expect(agent.status().connected).toBe(true);
  });

  it("keeps a reset that happens while the remembered session is resuming", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    const events = collect(agent);
    await turn(agent, events);
    await agent.dispose();
    const slow = {
      async createClient() {
        const client = mockSdk.createClient();
        const resume = client.resumeSession.bind(client);
        client.resumeSession = async (...args) => {
          await wait(150);
          return resume(...args);
        };
        return client;
      },
    };
    agent = new AgentController({ store, factory: slow });
    const connecting = agent.connect();
    await wait(30);
    await agent.reset();
    await connecting;
    expect(agent.status()).toMatchObject({ sessionId: null, connected: false, history: [] });
    expect(rememberedSession(deckPath())).toBeNull();
  });

  it("refuses the handoff while Copilot is working", async () => {
    agent = new AgentController({ store, factory: mockSdk });
    await agent.chat({ prompt: "Polish", scope: "slide", slideId: "zoom" });
    await expect(agent.handoff()).rejects.toThrow(/still working/);
    await until(() => agent.state === "idle" && !agent.turn);
  });
});

describe("handoff helpers", () => {
  it("rebuilds the chat history without the editor's scope prefix", () => {
    const history = historyFromEvents([
      { type: "user.message", data: { content: '[Scope: THIS SLIDE ONLY – id "a", template "b". Do not modify other slides.]\nCurrent slide data: {"data":{}}\n\nTighten it' } },
      { type: "assistant.message", data: { content: "" } },
      { type: "tool.execution_start", data: {} },
      { type: "assistant.message", data: { content: "Done" } },
      { type: "user.message", data: { content: "[Scope: whole deck]\n\nAdd a slide" } },
    ]);
    expect(history).toEqual([{ role: "user", text: "Tighten it" }, { role: "assistant", text: "Done" }, { role: "user", text: "Add a slide" }]);
  });

  it("quotes commands for POSIX shells and Windows", () => {
    expect(shellQuote("/a/b.json")).toBe("/a/b.json");
    expect(shellQuote("/My Decks/it's", "darwin")).toBe(`'/My Decks/it'\\''s'`);
    expect(shellQuote("C:\\My Decks", "win32")).toBe('"C:\\My Decks"');
    const { resume, fresh } = cliCommands({ deckPath: "/My Decks/talk/deck.yaml", sessionId: "abc-1", mcpConfigPath: "/cfg/x.json", platform: "linux" });
    expect(resume).toBe("copilot --resume abc-1 -C '/My Decks/talk' --additional-mcp-config @/cfg/x.json --allow-tool deckforge");
    expect(fresh).toBe("copilot -C '/My Decks/talk' --additional-mcp-config @/cfg/x.json --allow-tool deckforge");
  });

  it("builds valid session names", () => {
    expect(sessionName('My "big" talk\n')).toBe("deckforge · My big talk");
    expect(sessionName("")).toBe("deckforge · deck");
    expect(sessionName("x".repeat(200)).length).toBeLessThanOrEqual(100);
  });
});
