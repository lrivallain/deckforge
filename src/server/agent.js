// Embedded Copilot agent (via @github/copilot-sdk). The agent can only use
// the deck tools (deck-tools.js); every turn is one undo group.

import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { OpError } from "../core/ops.js";
import { improvePrompt, improveSystemPrompt, systemPrompt } from "./prompt.js";
import { SLIDE_SCOPED_OPS, deckToolHandlers, deckToolSpecs } from "./deck-tools.js";
import { cliCommands, mcpServerConfig, rememberedSession, rememberSession, sessionHolders, sessionName, writeMcpConfig } from "./copilot-link.js";

export { deckToolSpecs };

// The scope context the editor prepends to every chat message.
const SCOPE_PREFIX = /^\[Scope:[^\n]*\](?:\nCurrent slide data: [^\n]*)?\n\n/;

/** Chat history (user/assistant texts) rebuilt from a resumed session's events. */
export function historyFromEvents(events = []) {
  const out = [];
  for (const event of events) {
    const text = event?.data?.content;
    if (typeof text !== "string" || !text.trim()) continue;
    if (event.type === "user.message") out.push({ role: "user", text: text.replace(SCOPE_PREFIX, "") });
    else if (event.type === "assistant.message") out.push({ role: "assistant", text });
  }
  return out.slice(-200);
}

const TURN_TIMEOUT_MS = 5 * 60 * 1000;
const IMPROVE_TIMEOUT_MS = 90 * 1000;
export const MAX_IMPROVE_CHARS = 8000;
const MAX_IMPROVE_CONCURRENCY = 3;
export const AUTH_HINT = "Sign in with `gh auth login` (GitHub CLI) or `copilot` → `/login` (Copilot CLI), then retry. A GitHub Copilot subscription is required.";

async function quietly(fn) {
  try {
    await fn();
  } catch {
    /* ignore */
  }
}

const isAuthError = (err) => Boolean(err?.auth) || /auth|login|token|credential|unauthori[sz]ed|401|not signed/i.test(err?.message || "");

/** Strip what models wrap around a "text only" answer: code fences, quotes, a leading label. */
export function cleanImproved(answer) {
  let text = String(answer ?? "").trim();
  const fence = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fence) text = fence[1].trim();
  text = text.replace(/^<<<\s*\n?|\n?\s*>>>$/g, "").trim();
  const quoted = /^(["“«'])([\s\S]*)(["”»'])$/.exec(text);
  if (quoted && !quoted[2].includes(quoted[1])) text = quoted[2].trim();
  return text;
}

export class AgentController extends EventEmitter {
  constructor({ store, factory, log = () => {}, remember = true }) {
    super();
    this.store = store;
    this.factory = factory || defaultFactory();
    this.log = log;
    this.remember = remember;
    this.state = "idle";
    this.error = null;
    this.client = null;
    this.session = null;
    // Last conversation for this deck: resumed on the next message.
    this.sessionId = remember ? rememberedSession(store.deckPath) : null;
    this.handedOff = false;
    this.turn = null;
    this.history = [];
    this.improving = 0;
  }

  status() {
    return {
      state: this.state,
      error: this.error,
      history: this.history.slice(-50),
      hint: this.error?.auth ? AUTH_HINT : null,
      sessionId: this.sessionId,
      connected: Boolean(this.session),
      handedOff: this.handedOff,
    };
  }

  setSessionId(id) {
    this.sessionId = id || null;
    if (this.remember) rememberSession(this.store.deckPath, this.sessionId);
  }

  emitLink() {
    this.emit("event", { type: "link", sessionId: this.sessionId, connected: Boolean(this.session), handedOff: this.handedOff });
  }

  setState(state, error = null) {
    this.state = state;
    this.error = error;
    this.emit("event", { type: "status", state, error });
  }

  record(entry) {
    this.history.push({ ...entry, at: Date.now() });
    if (this.history.length > 200) this.history.shift();
  }

  buildTools() {
    const handlers = deckToolHandlers(this.store, {
      deckScope: () => (this.turn?.scope === "slide" ? { scope: "this slide", slideId: this.turn.slideId } : { scope: "whole deck" }),
      guard: (name, args) => {
        if (!this.turn || !this.store.group) throw new OpError("No active request: changes are only accepted while answering the user.");
        if (this.turn.scope === "slide") {
          if (!SLIDE_SCOPED_OPS.has(name)) throw new OpError(`"${name}" is not allowed: the user limited this request to one slide (${this.turn.slideId}).`);
          if (args.id !== this.turn.slideId) throw new OpError(`Out of scope: only slide "${this.turn.slideId}" may be modified in this request.`);
        }
      },
      applyOptions: () => ({ source: "agent" }),
      onApplied: ({ name, args, result }) => this.emit("event", { type: "tool", name, args, result }),
    });

    return deckToolSpecs().map((spec) => ({
      ...spec,
      skipPermission: true,
      defer: "never",
      handler: async (args) => {
        try {
          const result = await handlers[spec.name](args || {});
          return JSON.stringify(result);
        } catch (err) {
          this.emit("event", { type: "tool_error", name: spec.name, message: err.message });
          return { textResultForLlm: `Error: ${err.message}`, resultType: "failure", error: err.message };
        }
      },
    }));
  }

  ensureSession() {
    if (this.session) return Promise.resolve(this.session);
    // Memoize the in-flight start so concurrent callers share one client.
    this.starting ??= this.startSession().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** One SDK client serves the chat session and the one-shot "improve" sessions. */
  ensureClient() {
    if (this.client) return Promise.resolve(this.client);
    this.clientStarting ??= this.startClient().finally(() => {
      this.clientStarting = null;
    });
    return this.clientStarting;
  }

  async startClient() {
    const client = await this.factory.createClient({ cwd: this.store.deckDir });
    if (typeof client.getAuthStatus === "function") {
      const auth = await client.getAuthStatus().catch(() => null);
      if (auth && auth.isAuthenticated === false) {
        try {
          await client.stop?.();
        } catch {
          /* ignore */
        }
        throw Object.assign(new Error(`Not signed in to GitHub Copilot. ${auth.statusMessage || ""}`.trim()), { auth: true });
      }
    }
    this.client = client;
    return client;
  }

  sessionConfig() {
    const tools = this.buildTools();
    const names = new Set(tools.map((t) => t.name));
    return {
      model: process.env.DECKFORGE_MODEL || undefined,
      streaming: true,
      tools,
      availableTools: [...names].map((n) => `custom:${n}`),
      workingDirectory: this.store.deckDir,
      systemMessage: {
        mode: "customize",
        sections: {
          identity: { action: "replace", content: "You are the deckforge presentation assistant." },
          code_change_rules: { action: "remove" },
        },
        content: systemPrompt({ deck: this.store.deck, templates: this.store.templates }),
      },
      onPermissionRequest: (request) =>
        request.kind === "custom-tool" && names.has(request.toolName)
          ? { kind: "approve-once" }
          : { kind: "reject", feedback: "deckforge only allows the deck tools." },
    };
  }

  /** Resume the remembered conversation; null when it no longer exists. */
  async resumeRemembered(config) {
    const id = this.sessionId;
    if (!id || typeof this.client.resumeSession !== "function") return null;
    const holders = sessionHolders(id);
    if (holders.length) {
      throw new OpError(`This conversation is open in Copilot CLI (process ${holders.join(", ")}). Exit it there (or start a new conversation here), then send your message again.`);
    }
    let session;
    try {
      session = await this.client.resumeSession(id, config);
    } catch (err) {
      if (isAuthError(err)) throw err;
      this.log(`could not resume Copilot session ${id}: ${err.message}`);
      return null;
    }
    const events = await session.getEvents?.().catch(() => null);
    if (events) {
      // Keep the message that triggered the resume (recorded before it).
      const pending = this.pending && this.history.at(-1)?.role === "user" ? this.history.at(-1) : null;
      this.history = historyFromEvents(events).map((m) => ({ ...m, at: Date.now() }));
      if (pending) this.history.push(pending);
      this.emit("event", { type: "history", history: this.history.slice(-50) });
    }
    return session;
  }

  async startSession() {
    this.setState("starting");
    try {
      await this.ensureClient();
      const config = this.sessionConfig();
      let session = await this.resumeRemembered(config);
      if (!session) {
        session = await this.client.createSession(config);
        await quietly(() => session.rpc?.name?.set?.({ name: sessionName(this.store.deck.meta?.title) }));
      }
      this.session = session;
      this.session.on((event) => this.onSessionEvent(event));
      this.handedOff = false;
      if (session.sessionId && session.sessionId !== this.sessionId) this.setSessionId(session.sessionId);
      this.setState("idle");
      this.emitLink();
      return this.session;
    } catch (err) {
      const auth = isAuthError(err);
      this.session = null;
      // Keep the client while improvements are still using it.
      if (!this.improving) await this.disposeClient();
      this.setState("error", { message: err.message, auth });
      throw err;
    }
  }

  /**
   * Rewrite one text field with Copilot and return the new text. Uses a
   * short-lived session without tools: it never touches the deck, the undo
   * history or the chat conversation; the editor applies the result.
   */
  async improve({ text, label, description, max, richtext = false, kind, slideId } = {}) {
    text = String(text ?? "");
    if (!text.trim()) throw new OpError("Nothing to improve: the field is empty");
    if (text.length > MAX_IMPROVE_CHARS) throw new OpError(`The text is too long to improve (over ${MAX_IMPROVE_CHARS} characters)`);
    if (this.improving >= MAX_IMPROVE_CONCURRENCY) throw Object.assign(new OpError("Copilot is already improving other fields. Try again in a moment."), { status: 429 });
    const slide = slideId ? this.store.deck.slides.find((s) => s.id === slideId) : null;
    const maxLength = Number.isFinite(Number(max)) && Number(max) > 0 ? Math.floor(Number(max)) : null;
    this.improving += 1;
    let client;
    let session;
    try {
      client = await this.ensureClient();
      session = await client.createSession({
        model: process.env.DECKFORGE_MODEL || undefined,
        tools: [],
        availableTools: [],
        workingDirectory: this.store.deckDir,
        systemMessage: { mode: "replace", content: improveSystemPrompt(this.store.deck.meta) },
        onPermissionRequest: () => ({ kind: "reject", feedback: "Reply with the rewritten text only; no tools are available." }),
      });
      const prompt = improvePrompt({ text, label: String(label || "").slice(0, 120), description: String(description || "").slice(0, 500), max: maxLength, richtext: Boolean(richtext), kind: String(kind || "").slice(0, 40), slide });
      let reply;
      try {
        reply = await session.sendAndWait({ prompt }, IMPROVE_TIMEOUT_MS);
      } catch (err) {
        await quietly(() => session.abort?.());
        if (/timeout|timed out/i.test(err.message)) throw new Error("Copilot took too long to answer", { cause: err });
        throw err;
      }
      const improved = cleanImproved(reply?.data?.content);
      if (!improved) throw new Error("Copilot returned an empty answer");
      return { text: improved };
    } catch (err) {
      if (err.name === "OpError" || err.status) throw err;
      const auth = isAuthError(err);
      throw Object.assign(new Error(err.message), { status: auth ? 503 : 502, details: auth ? { auth: true, hint: AUTH_HINT } : undefined });
    } finally {
      this.improving -= 1;
      if (session) {
        const id = session.sessionId;
        await quietly(() => session.disconnect?.());
        // One-shot sessions are not worth keeping on disk.
        if (id) await quietly(() => client?.deleteSession?.(id));
      }
    }
  }

  onSessionEvent(event) {
    const turn = this.turn;
    switch (event.type) {
      case "assistant.message_delta":
        if (turn) turn.text += event.data?.deltaContent ?? "";
        this.emit("event", { type: "delta", text: event.data?.deltaContent ?? "" });
        break;
      case "assistant.message":
        if (turn && event.data?.content) turn.final = event.data.content;
        this.emit("event", { type: "message", text: event.data?.content ?? "" });
        break;
      case "tool.execution_start":
        this.emit("event", { type: "tool_start", name: event.data?.toolName });
        break;
      case "session.error":
        this.finishTurn({ message: event.data?.message || "The agent failed", auth: /auth|login|401|token/i.test(event.data?.message || "") });
        break;
      case "session.idle":
        this.finishTurn();
        break;
      default:
        break;
    }
  }

  finishTurn(error = null, expected = this.turn) {
    const turn = this.turn;
    if (!turn || turn !== expected) return;
    clearTimeout(turn.timer);
    this.turn = null;
    const changed = this.store.endGroup();
    const text = turn.final || turn.text;
    if (text) this.record({ role: "assistant", text });
    if (error) this.record({ role: "error", text: error.message });
    this.emit("event", { type: "done", changed, error, text });
    this.setState(error ? "error" : "idle", error);
  }

  async chat({ prompt, scope = "deck", slideId = null }) {
    prompt = String(prompt || "").trim();
    if (!prompt) throw new OpError("Empty prompt");
    if (this.turn || this.pending) throw new OpError("The agent is still working on the previous request");
    if (scope === "slide" && !this.store.deck.slides.some((s) => s.id === slideId)) throw new OpError("Select a slide first");
    this.record({ role: "user", text: prompt, scope, slideId });
    this.pending = true;
    // Run asynchronously; progress is streamed as events.
    (async () => {
      try {
        await this.ensureSession();
      } catch (err) {
        this.pending = false;
        this.emit("event", { type: "done", changed: [], error: { message: err.message, auth: Boolean(this.error?.auth) }, text: "" });
        this.record({ role: "error", text: err.message });
        return;
      }
      this.pending = false;
      const turn = { scope, slideId, text: "", final: "" };
      turn.timer = setTimeout(() => {
        if (this.turn === turn) this.abort("timeout");
      }, TURN_TIMEOUT_MS);
      this.turn = turn;
      this.store.beginGroup(`Agent: ${prompt.slice(0, 48)}`, "agent");
      this.setState("busy");
      this.emit("event", { type: "start", scope, slideId });
      const slide = scope === "slide" ? this.store.deck.slides.find((s) => s.id === slideId) : null;
      const context = slide
        ? `[Scope: THIS SLIDE ONLY – id "${slide.id}", template "${slide.template}". Do not modify other slides.]\nCurrent slide data: ${JSON.stringify({ data: slide.data, notes: slide.notes })}`
        : "[Scope: whole deck]";
      try {
        await this.session.send({ prompt: `${context}\n\n${prompt}` });
      } catch (err) {
        this.finishTurn({ message: err.message, auth: /auth|login|401|token/i.test(err.message) }, turn);
      }
    })();
  }

  async abort(reason = "aborted") {
    if (!this.turn) return false;
    try {
      await this.session?.abort?.();
    } catch {
      /* ignore */
    }
    this.finishTurn(reason === "timeout" ? { message: "The agent timed out" } : null);
    return true;
  }

  async reset() {
    // Let an in-flight start (e.g. the resume on drawer open) settle first, or
    // it would bring the discarded conversation back once it completes.
    if (this.starting) await this.starting.catch(() => {});
    await this.abort();
    try {
      await this.session?.disconnect?.();
    } catch {
      /* ignore */
    }
    this.session = null;
    this.history = [];
    this.handedOff = false;
    this.setSessionId(null);
    this.setState("idle");
    this.emitLink();
    return true;
  }

  /** Resume the remembered conversation now (e.g. when the chat opens) to show its history. */
  async connect() {
    if (this.session || !this.sessionId || this.handedOff) return this.status();
    await this.ensureSession();
    return this.status();
  }

  /**
   * Hand the conversation over to Copilot CLI: detach the editor from the
   * session (a session must only be open in one runtime) and return the
   * commands that continue it with the deck tools (`deckforge mcp`).
   */
  async handoff() {
    if (this.turn || this.pending || this.starting) throw new OpError("Copilot is still working. Wait for it to finish or press Stop, then continue in Copilot CLI.");
    if (this.session) {
      await quietly(() => this.session.disconnect?.());
      this.session = null;
    }
    if (this.sessionId) this.handedOff = true;
    const mcpConfig = writeMcpConfig(this.store.deckPath);
    const commands = cliCommands({ deckPath: this.store.deckPath, sessionId: this.sessionId, mcpConfigPath: mcpConfig });
    this.emitLink();
    return { sessionId: this.sessionId, handedOff: this.handedOff, mcpConfig, mcpServer: mcpServerConfig(this.store.deckPath), command: commands.resume, commandNew: commands.fresh };
  }

  async disposeClient() {
    try {
      await this.client?.stop?.();
    } catch {
      /* ignore */
    }
    this.client = null;
  }

  async dispose() {
    await this.abort();
    try {
      await this.session?.disconnect?.();
    } catch {
      /* ignore */
    }
    this.session = null;
    await this.disposeClient();
  }
}

/** Default factory: real SDK, or a mock module when DECKFORGE_AGENT_MOCK is set (tests). */
export function defaultFactory() {
  return {
    async createClient({ cwd }) {
      if (process.env.DECKFORGE_AGENT_MOCK) {
        const mod = await import(pathToFileURL(path.resolve(process.env.DECKFORGE_AGENT_MOCK)).href);
        return mod.createClient({ cwd });
      }
      let sdk;
      try {
        sdk = await import("@github/copilot-sdk");
      } catch (err) {
        throw new Error(`The Copilot SDK is not installed (${err.message}). It is an optional dependency: install it with "npm install @github/copilot-sdk" next to deckforge.`, { cause: err });
      }
      const client = new sdk.CopilotClient({ workingDirectory: cwd, logLevel: "error", useLoggedInUser: true });
      await client.start();
      return client;
    },
  };
}
