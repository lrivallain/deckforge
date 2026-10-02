// `deckforge mcp [deck]`: a stdio MCP server exposing the deck tools to
// Copilot CLI / the Copilot app (newline-delimited JSON-RPC 2.0).
// Without a deck it uses the deck.yaml of its working directory, which Copilot
// sets to the session's folder, so one global registration serves every deck.
// Each call goes through the running `deckforge edit` for this deck when there
// is one (live preview, undo), otherwise it edits deck.yaml directly.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { VERSION } from "../core/render.js";
import { DeckStore } from "./store.js";
import { MUTATING_TOOLS, deckToolHandlers, mcpToolSpecs } from "./deck-tools.js";
import { canonicalDeck, findEditor } from "./copilot-link.js";

// Newer revisions only add optional features on top of these tools.
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const READ_ONLY = new Set(["get_authoring_guide", "get_deck", "list_templates", "list_themes", "list_assets"]);
const MUTATING = new Set(MUTATING_TOOLS);
const PROXY_TIMEOUT_MS = 30000;
const NOT_REACHED = new Set(["ECONNREFUSED", "EADDRNOTAVAIL", "ENOTFOUND", "EHOSTUNREACH"]);

const INSTRUCTIONS = "Tools to edit one deckforge presentation (the deck.yaml of this session's folder). Call get_authoring_guide once, then get_deck, before editing. Always edit the deck through these tools rather than writing deck.yaml or deck.html.";

class Unreachable extends Error {}

/** The deck of a folder (deck.yaml), or an error that tells the model what to do. */
export function deckInFolder(dir) {
  const file = path.join(dir, "deck.yaml");
  if (fs.existsSync(file)) return canonicalDeck(file);
  throw new Error(`There is no deckforge deck (deck.yaml) in ${dir}, the folder of this Copilot session. Start Copilot in a deck folder, or create one with \`deckforge new <dir>\`.`);
}

/**
 * Deck tools backed by the running editor, or by the deck file itself.
 * Without deckPath the deck is looked up in cwd() on every call.
 */
export function createDeckBackend({ deckPath: fixedDeck, cwd = () => process.cwd(), log = () => {}, fetchImpl = globalThis.fetch }) {
  let store = null;
  let handlers = null;
  let deckPath = null;

  function local() {
    if (store && store.deckPath !== deckPath) {
      store.close();
      store = null;
    }
    if (!store) {
      store = new DeckStore({ deckPath, log });
      handlers = deckToolHandlers(store, { guide: true, applyOptions: (name) => ({ source: "mcp", label: `Copilot (outside the editor): ${name}` }) });
    } else {
      // Pick up edits made meanwhile (editor, git, text editor).
      const source = fs.readFileSync(store.deckPath, "utf8");
      if (source !== store.lastWritten) store.loadDeck();
      store.loadRegistry();
    }
    return { store, handlers };
  }

  async function viaEditor(editor, name, args) {
    let res;
    try {
      res = await fetchImpl(`${editor.origin}/api/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Deckforge-Token": editor.token },
        body: JSON.stringify({ name, args }),
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });
    } catch (err) {
      // Fall back to the file only when the request cannot have reached the editor:
      // after a timeout or a reset it may still apply the change.
      if (NOT_REACHED.has(err.cause?.code ?? err.code)) throw new Unreachable(err.message);
      throw new Error(`The deckforge editor did not answer (${err.message}). Check the deck with get_deck before retrying.`, { cause: err });
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 421) throw new Unreachable(`editor refused the request (${res.status})`);
    if (!res.ok) throw new Error(data.error || `The deckforge editor answered ${res.status}`);
    return data.result;
  }

  return {
    async call(name, args = {}) {
      deckPath = fixedDeck ? canonicalDeck(fixedDeck) : deckInFolder(cwd());
      const editor = findEditor(deckPath);
      if (editor) {
        try {
          return await viaEditor(editor, name, args);
        } catch (err) {
          if (!(err instanceof Unreachable)) throw err;
          log(`editor at ${editor.origin} unreachable (${err.message}); editing ${deckPath} directly`);
        }
      }
      const { store: s, handlers: h } = local();
      const result = await h[name](args);
      if (MUTATING.has(name)) s.build();
      return result;
    },
    close() {
      store?.close();
    },
  };
}

function toolList() {
  return mcpToolSpecs().map((t) => ({
    name: t.name,
    // Copilot defers MCP tools on resume and finds them by searching: keep "deckforge" searchable.
    description: `deckforge: ${t.description}`,
    inputSchema: t.parameters,
    annotations: { readOnlyHint: READ_ONLY.has(t.name), destructiveHint: t.name === "remove_slide" || t.name === "remove_overlay", openWorldHint: false },
  }));
}

/** Handle one JSON-RPC message; returns the response, or null for notifications. */
export async function handleMessage(message, backend) {
  const { id, method, params } = message || {};
  const isRequest = id !== undefined && id !== null;
  const reply = (result) => (isRequest ? { jsonrpc: "2.0", id, result } : null);
  const fail = (code, msg) => (isRequest ? { jsonrpc: "2.0", id, error: { code, message: msg } } : null);
  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "deckforge", title: "deckforge", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: toolList() });
    case "tools/call": {
      const name = params?.name;
      if (!toolList().some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      const args = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
      try {
        const result = await backend.call(name, args);
        const text = name === "get_authoring_guide" && typeof result?.guide === "string" ? result.guide : JSON.stringify(result);
        return reply({ content: [{ type: "text", text }], isError: false });
      } catch (err) {
        return reply({ content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });
      }
    }
    default:
      if (typeof method === "string" && method.startsWith("notifications/")) return null;
      return fail(-32601, `Method not found: ${method}`);
  }
}

/** Serve MCP over stdio until the input closes. */
export async function runMcpServer({ deckPath = null, input = process.stdin, output = process.stdout, log = (msg) => process.stderr.write(`[deckforge mcp] ${msg}\n`) }) {
  const backend = createDeckBackend({ deckPath, log });
  const write = (msg) => output.write(`${JSON.stringify(msg)}\n`);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  // Answer in order: a tool call must not overtake the previous one.
  let queue = Promise.resolve();
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    queue = queue.then(async () => {
      const response = await handleMessage(message, backend).catch((err) => ({ jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32603, message: err.message } }));
      if (response) write(response);
    });
  });
  await new Promise((resolve) => rl.once("close", resolve));
  await queue;
  backend.close();
}
