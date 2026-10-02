// Shared e2e helpers: temporary decks and a `deckforge edit` server process.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const CLI = path.join(ROOT, "bin/deckforge.js");

export function tempDeck({ runtime = "local", example = "starter", theme = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckforge-e2e-"));
  const source = path.join(ROOT, "examples", example);
  let yaml = fs.readFileSync(path.join(source, "deck.yaml"), "utf8");
  if (theme) yaml = yaml.replace(/^ {2}theme: .*$/m, `  theme: ${theme}`);
  fs.writeFileSync(path.join(dir, "deck.yaml"), yaml);
  if (fs.existsSync(path.join(source, "assets"))) fs.cpSync(path.join(source, "assets"), path.join(dir, "assets"), { recursive: true });
  execFileSync(process.execPath, [CLI, "build", dir, "--runtime", runtime], { stdio: "pipe" });
  return { dir, yaml: path.join(dir, "deck.yaml"), html: path.join(dir, "deck.html"), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export async function startEditor({ env = {} } = {}) {
  const deck = tempDeck();
  const token = `e2e${Math.random().toString(36).slice(2)}`;
  const child = spawn(process.execPath, [CLI, "edit", deck.dir, "--port", "0", "--token", token, "--no-open"], {
    env: { ...process.env, DECKFORGE_AGENT_MOCK: path.join(ROOT, "test/fixtures/mock-sdk.js"), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`editor did not start:\n${output}`)), 15000);
    const onData = (chunk) => {
      output += chunk;
      const match = /Editor: (http:\/\/127\.0\.0\.1:\d+)\/\?token=/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`editor exited (${code}):\n${output}`)));
  });
  return {
    ...deck,
    origin: url,
    token,
    editorUrl: `${url}/?token=${token}`,
    readYaml: () => fs.readFileSync(deck.yaml, "utf8"),
    readHtml: () => fs.readFileSync(deck.html, "utf8"),
    async stop() {
      child.kill("SIGTERM");
      await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)));
      deck.cleanup();
    },
  };
}

export async function waitForFile(read, predicate, timeout = 5000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = read();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`file condition not met; last content:\n${String(last).slice(0, 2000)}`);
}
