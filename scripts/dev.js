// Development preview: rebuild dist/ on change and run `deckforge edit` on a
// scratch copy of the example deck, restarting when server code changes.
// Usage: node scripts/dev.js [--port 4370]

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portIndex = process.argv.indexOf("--port");
const port = portIndex > -1 ? process.argv[portIndex + 1] : "4370";
const work = path.join(root, ".demo", "preview");
const tokenFile = path.join(root, ".demo", "preview-token");

if (!fs.existsSync(path.join(work, "deck.yaml"))) {
  fs.mkdirSync(work, { recursive: true });
  fs.copyFileSync(path.join(root, "examples/starter/deck.yaml"), path.join(work, "deck.yaml"));
}
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(12).toString("base64url"));
const token = fs.readFileSync(tokenFile, "utf8").trim();

const children = [];
const run = (args) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, CI: "" } });
  children.push(child);
  return child;
};

run(["scripts/build.js", "--watch"]);
// Give esbuild a moment to produce dist/ before the server starts.
setTimeout(() => {
  run([
    "--watch-path=src", "--watch-path=bin", "--watch-path=dist",
    "bin/deckforge.js", "edit", work + "/deck.yaml", "--port", port, "--token", token, "--no-open",
  ]);
}, 800);

const stop = () => {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
