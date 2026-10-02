// Scripted @github/copilot-sdk stand-in for `npm run docs:screenshots` (DECKFORGE_AGENT_MOCK).
// A slide-scoped request tightens the problem text and writes speaker notes,
// so the Copilot drawer screenshot shows a realistic, reproducible turn.

const REPLY =
  'Tightened the problem text and added speaker notes that walk through the four responses, ending on the amber review gate.';

export function createClient() {
  return {
    async getAuthStatus() {
      return { isAuthenticated: true, login: "octocat", authType: "gh-cli" };
    },
    async createSession(config) {
      const handlers = new Set();
      const emit = (type, data = {}) => handlers.forEach((handler) => handler({ type, data }));
      const tools = Object.fromEntries((config.tools || []).map((t) => [t.name, t]));
      const run = async (name, args) => {
        emit("tool.execution_start", { toolName: name });
        await tools[name]?.handler(args, { toolName: name });
        emit("tool.execution_complete", { toolName: name });
      };
      return {
        on(handler) {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
        async send({ prompt }) {
          setTimeout(async () => {
            const id = /Scope: THIS SLIDE ONLY – id "([^"]+)"/.exec(prompt)?.[1];
            await run("get_deck", {});
            if (id) {
              await run("update_slide", {
                id,
                set: { problemText: "Purpose, evidence and decision are scattered across the draft." },
                notes: "Start with the pain: nobody can review a scattered draft. Walk the four responses left to right, then stop on the amber card: the review gate is the decision.",
              });
            }
            emit("assistant.message_delta", { deltaContent: REPLY });
            emit("assistant.message", { content: REPLY });
            emit("session.idle", {});
          }, 30);
          return "docs-message-id";
        },
        async abort() {
          emit("session.idle", {});
        },
        async disconnect() {},
      };
    },
    async stop() {
      return [];
    },
  };
}
