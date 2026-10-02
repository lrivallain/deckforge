// Links between the editor and Copilot outside it (Copilot CLI / app):
// - a discovery record per running `deckforge edit`, so `deckforge mcp` can
//   route deck tool calls through the live editor;
// - the last chat session per deck, so the editor resumes its conversation;
// - the MCP config and commands to continue a conversation in Copilot CLI.
// Everything lives in the deckforge config folder, never in the deck folder.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configDir, PACKAGE_ROOT } from "./registry.js";
import { writeFileAtomic } from "./fs-util.js";

export const MCP_SERVER_NAME = "deckforge";
export const CLI_BIN = path.join(PACKAGE_ROOT, "bin/deckforge.js");

export const deckKey = (deckPath) => crypto.createHash("sha256").update(path.resolve(deckPath)).digest("hex").slice(0, 16);

function writePrivate(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileAtomic(file, content);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort (Windows) */
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

// --- editor discovery -------------------------------------------------------

const editorFile = (deckPath) => path.join(configDir(), "editors", `${deckKey(deckPath)}.json`);

/** Record a running editor (origin + token, private file). Returns a remover. */
export function publishEditor({ deckPath, origin, token }) {
  const file = editorFile(deckPath);
  const record = { pid: process.pid, origin, token, deck: path.resolve(deckPath), startedAt: new Date().toISOString() };
  try {
    writePrivate(file, JSON.stringify(record, null, 2));
  } catch {
    return () => {};
  }
  return () => {
    const current = readJson(file);
    if (current?.pid === record.pid && current.origin === origin) fs.rmSync(file, { force: true });
  };
}

/** The editor currently running for this deck, if its process is alive. */
export function findEditor(deckPath) {
  const record = readJson(editorFile(deckPath));
  if (!record || record.deck !== path.resolve(deckPath) || !pidAlive(record.pid)) return null;
  if (typeof record.origin !== "string" || typeof record.token !== "string") return null;
  return record;
}

// --- chat session memory ----------------------------------------------------

const sessionsFile = () => path.join(configDir(), "sessions.json");

export function rememberedSession(deckPath) {
  const id = readJson(sessionsFile())?.[path.resolve(deckPath)]?.sessionId;
  return typeof id === "string" && id ? id : null;
}

export function rememberSession(deckPath, sessionId) {
  const all = readJson(sessionsFile()) || {};
  const key = path.resolve(deckPath);
  if (sessionId) all[key] = { sessionId, updatedAt: new Date().toISOString() };
  else delete all[key];
  try {
    writePrivate(sessionsFile(), JSON.stringify(all, null, 2));
  } catch {
    /* the conversation simply will not be resumed */
  }
}

/** Friendly session name: 1–100 chars, no control characters or double quotes. */
export function sessionName(title) {
  // eslint-disable-next-line no-control-regex
  const clean = String(title || "").replace(/[\u0000-\u001f\u007f"]+/g, " ").replace(/\s+/g, " ").trim();
  return `deckforge · ${clean || "deck"}`.slice(0, 100).trim();
}

// --- Copilot CLI ------------------------------------------------------------

export function copilotHome() {
  return process.env.COPILOT_HOME ? path.resolve(process.env.COPILOT_HOME) : path.join(os.homedir(), ".copilot");
}

/**
 * Live processes holding a Copilot session open (from the runtime's
 * session-state/<id>/inuse.<pid>.lock files). Best effort: [] when unknown.
 */
export function sessionHolders(sessionId) {
  if (!/^[\w-]+$/.test(String(sessionId || ""))) return [];
  let files;
  try {
    files = fs.readdirSync(path.join(copilotHome(), "session-state", sessionId));
  } catch {
    return [];
  }
  return files
    .map((f) => /^inuse\.(\d+)\.lock$/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number)
    .filter((pid) => pid !== process.pid && pidAlive(pid));
}

/** MCP server entry that starts `deckforge mcp <deck>` with this Node and package. */
export function mcpServerConfig(deckPath) {
  return { mcpServers: { [MCP_SERVER_NAME]: { type: "local", command: process.execPath, args: [CLI_BIN, "mcp", path.resolve(deckPath)], tools: ["*"] } } };
}

/** Write the MCP config for a deck (for `copilot --additional-mcp-config @file`). */
export function writeMcpConfig(deckPath) {
  const file = path.join(configDir(), "mcp", `${deckKey(deckPath)}.json`);
  writePrivate(file, JSON.stringify(mcpServerConfig(deckPath), null, 2));
  return file;
}

export function shellQuote(arg, platform = process.platform) {
  const s = String(arg);
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  if (platform === "win32") return `"${s.replace(/"/g, '\\"')}"`;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Commands to continue a conversation (or start one) in Copilot CLI with the deck tools. */
export function cliCommands({ deckPath, sessionId, mcpConfigPath, platform = process.platform }) {
  const q = (a) => shellQuote(a, platform);
  const common = ["-C", q(path.dirname(path.resolve(deckPath))), "--additional-mcp-config", q(`@${mcpConfigPath}`), "--allow-tool", MCP_SERVER_NAME];
  return {
    resume: sessionId ? ["copilot", "--resume", q(sessionId), ...common].join(" ") : null,
    fresh: ["copilot", ...common].join(" "),
  };
}
