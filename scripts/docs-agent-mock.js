// Scripted @github/copilot-sdk stand-in for `npm run docs:screenshots` (DECKFORGE_AGENT_MOCK).
// A slide-scoped request tightens the problem text and writes speaker notes,
// so the Copilot drawer screenshot shows a realistic, reproducible turn.
// A whole-deck request (the demo GIF) tightens three takeaways at a readable pace.
// A one-shot palette request (theme editor) answers a fixed forest/copper palette.

const PALETTE = {
  label: "Forest copper",
  description: "Deep forest green with a warm copper accent on soft neutrals.",
  colorScheme: "light",
  palette: {
    bg: "#EEF3EE", paper: "#FFFFFF", line: "#DCE6DC", ink: "#14261C", muted: "#4D6355", node: "#F6F9F6",
    primary: "#2F6B45", "primary-soft": "#E6F1E9", "primary-line": "#A9CDB4", "primary-text": "#2A6140",
    accent: "#B5651D", "accent-soft": "#FBEEE2", "accent-line": "#E8B98A", "accent-text": "#8F4A12",
    frame: "#FFF9F2", ok: "#1F8A55",
  },
};

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
        async sendAndWait({ prompt }) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          const text = /\n<<<\n([\s\S]*?)\n>>>/.exec(prompt)?.[1] ?? "";
          return { type: "assistant.message", data: { content: /^Theme request:/m.test(prompt) ? JSON.stringify(PALETTE) : text } };
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
