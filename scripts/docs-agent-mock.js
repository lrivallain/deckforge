// Scripted @github/copilot-sdk stand-in for `npm run docs:screenshots` (DECKFORGE_AGENT_MOCK).
// A slide-scoped request tightens the problem text and writes speaker notes,
// so the Copilot drawer screenshot shows a realistic, reproducible turn.
// A whole-deck request (the demo GIF) tightens three takeaways at a readable pace.

const REPLY =
  'Tightened the problem text and added speaker notes that walk through the four responses, ending on the amber review gate.';
const DECK_REPLY =
  "Shortened the takeaways of the concept map, implementation map and lifecycle so each one states a single idea, and added a speaker note for each.";
const DECK_EDITS = [
  ["concept", "One map: people, flow and shared capabilities.", "Pause on the map. Let the audience find themselves in it before you name any tool."],
  ["implementation", "Same map, real component names.", "Point out that nothing moved: only the labels changed."],
  ["lifecycle", "Who acts, what changes, where feedback returns.", "Walk left to right, then trace the feedback arrow back to Prepare."],
];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
            if (!id && /^\[Scope: whole deck\]/.test(prompt)) {
              await pause(700);
              for (const [slide, takeaway, notes] of DECK_EDITS) {
                await run("update_slide", { id: slide, data: { takeaway }, notes });
                await pause(900);
              }
              for (const word of DECK_REPLY.split(/(?<= )/)) {
                emit("assistant.message_delta", { deltaContent: word });
                await pause(25);
              }
              emit("assistant.message", { content: DECK_REPLY });
              emit("session.idle", {});
              return;
            }
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
