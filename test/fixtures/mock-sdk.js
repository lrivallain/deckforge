// Mock of the @github/copilot-sdk client surface used by deckforge, for tests.
// Enable with DECKFORGE_AGENT_MOCK=test/fixtures/mock-sdk.js.
//
// Behaviour of session.send({ prompt }):
//   - a line "#tools <json array>" runs those tool calls in order
//     ([{ "name": "update_slide", "args": {...} }, …]);
//   - otherwise it reads the deck and, for a slide-scoped request, sets that
//     slide's eyebrow to "Edited by Copilot".
//   - "#error <message>" emits session.error instead.
// session.sendAndWait({ prompt }) (the one-shot "improve" rewrite) answers
// "Improved: <text between <<< and >>>" or throws on "#error <message>".
// DECKFORGE_MOCK_AUTH=fail makes getAuthStatus() report a signed-out user.
// Sessions keep their user/assistant messages: resumeSession(id) reattaches
// (with new tools) and getEvents() returns them; unknown ids throw.

let sessionCounter = 0;
const store = new Map(); // sessionId -> { events, name }
globalThis.__deckforgeMockSessions = store;

export function createClient() {
  const deleted = [];
  return {
    async getAuthStatus() {
      if (process.env.DECKFORGE_MOCK_AUTH === "fail") return { isAuthenticated: false, statusMessage: "No GitHub credentials found." };
      return { isAuthenticated: true, login: "mock-user", authType: "gh-cli" };
    },
    async createSession(config) {
      return makeSession(config, `mock-${++sessionCounter}`);
    },
    async resumeSession(id, config) {
      if (!store.has(id)) throw new Error(`Session not found: ${id}`);
      this.resumed = [...(this.resumed || []), id];
      return makeSession(config, id);
    },
    deleted,
    async deleteSession(id) {
      deleted.push(id);
      store.delete(id);
    },
    async stop() {
      return [];
    },
  };
}

function makeSession(config, sessionId) {
  if (!store.has(sessionId)) store.set(sessionId, { events: [], name: null });
  const record = store.get(sessionId);
  const handlers = new Set();
  const emit = (type, data = {}) => {
    if (type === "assistant.message") record.events.push({ type, data });
    for (const handler of handlers) handler({ type, data });
  };
  const tools = Object.fromEntries((config.tools || []).map((t) => [t.name, t]));
  const session = {
    sessionId,
    config,
    rpc: {
      name: {
        async set({ name }) {
          record.name = name;
        },
      },
    },
    async getEvents() {
      return [...record.events];
    },
    on(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async send({ prompt }) {
      record.events.push({ type: "user.message", data: { content: prompt } });
      setTimeout(async () => {
        const error = /^#error (.*)$/m.exec(prompt);
        if (error) {
          emit("session.error", { message: error[1], errorType: "test" });
          return;
        }
        const scripted = /^#tools (.*)$/m.exec(prompt);
        let calls;
        if (scripted) calls = JSON.parse(scripted[1]);
        else {
          const slideScope = /Scope: THIS SLIDE ONLY – id "([^"]+)"/.exec(prompt);
          calls = [{ name: "get_deck", args: {} }];
          if (slideScope) calls.push({ name: "update_slide", args: { id: slideScope[1], set: { eyebrow: "Edited by Copilot" } } });
        }
        emit("assistant.message_delta", { deltaContent: "Working on it. " });
        const results = [];
        for (const call of calls) {
          emit("tool.execution_start", { toolName: call.name });
          const tool = tools[call.name];
          const result = tool ? await tool.handler(call.args, { toolName: call.name }) : "unknown tool";
          results.push(result);
          emit("tool.execution_complete", { toolName: call.name });
        }
        const failures = results.filter((r) => typeof r === "object" && r?.resultType === "failure").map((r) => r.error);
        const text = failures.length ? `Some changes failed: ${failures.join("; ")}` : `Done: ran ${calls.map((c) => c.name).join(", ")}.`;
        emit("assistant.message_delta", { deltaContent: text });
        emit("assistant.message", { content: `Working on it. ${text}` });
        emit("session.idle", {});
      }, 30);
      return "mock-message-id";
    },
    async sendAndWait({ prompt }) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      const error = /^#error (.*)$/m.exec(prompt);
      if (error) throw new Error(error[1]);
      const text = /\n<<<\n([\s\S]*)\n>>>$/.exec(prompt)?.[1] ?? "";
      const content = `Improved: ${text}`;
      emit("assistant.message", { content });
      emit("session.idle", {});
      return { type: "assistant.message", data: { content } };
    },
    async abort() {
      emit("session.idle", {});
    },
    async disconnect() {},
  };
  // One-shot "improve" sessions have no tools: keep pointing at the chat session.
  if (config.tools?.length) globalThis.__deckforgeMockSession = session;
  else globalThis.__deckforgeMockImproveSession = session;
  return session;
}
