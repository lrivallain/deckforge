// Local HTTP server for `deckforge edit` and `deckforge serve`.
// Binds 127.0.0.1 only. Edit mode requires a per-run token (cookie after the
// first visit with ?token=…), checks Host/Origin headers and only writes
// inside the deck directory and ~/.config/deckforge/, plus the deckforge entry
// of ~/.copilot/mcp-config.json when the user asks for the deck tools there.

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DIST_DIR } from "./registry.js";
import { DeckStore } from "./store.js";
import { AgentController } from "./agent.js";
import { deckToolHandlers, mcpToolSpecs } from "./deck-tools.js";
import { globalMcpStatus, installGlobalMcp, publishEditor } from "./copilot-link.js";
import { OpError } from "../core/ops.js";
import { editorPage } from "./editor-page.js";
import { AssetError, listAssets, MAX_ASSET_BYTES, saveAsset } from "./assets.js";
import { escapeHtml } from "../core/html.js";
import { generateToken } from "./token.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};
const ASSETS = new Set(["deckforge.viewer.js", "deckforge.viewer.css", "deckforge.editor.js", "deckforge.editor.css", "deckforge.icon.svg"]);
const MAX_BODY = 2 * 1024 * 1024;
// Raw image bytes, or base64 inside JSON (4/3 larger plus the data: prefix).
const MAX_ASSET_JSON = Math.ceil((MAX_ASSET_BYTES * 4) / 3) + 4096;
// Uploaded SVG is only meant for <img>; opened directly it must stay inert.
const SVG_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

const EDITOR_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // https: lets previews show images whose src the user typed as a URL.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' about: blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const LIVE_RELOAD = (eventsPath, nonce) => `<script nonce="${nonce}">(function(){try{var es=new EventSource(${JSON.stringify(eventsPath)});es.addEventListener("built",function(){location.reload();});}catch(e){}})();</script>`;

/**
 * Defense in depth for the generated deck served next to the editor API:
 * only the deckforge runtime may run scripts (no inline handlers or injected
 * <script>), so a content-sanitizer bypass cannot drive the API.
 */
export function protectDeckHtml(html, nonce, { editorUrl } = {}) {
  const marker = "<script data-df-runtime>";
  const index = html.lastIndexOf(marker);
  let out = index === -1 ? html : `${html.slice(0, index)}<script data-df-runtime nonce="${nonce}">${html.slice(index + marker.length)}`;
  if (editorUrl) {
    // Tells the viewer an editor is available (adds an Edit link to its controls).
    const meta = `<meta name="deckforge-editor" content="${escapeHtml(editorUrl)}">`;
    const headEnd = out.toLowerCase().indexOf("</head>");
    out = headEnd === -1 ? meta + out : out.slice(0, headEnd) + meta + out.slice(headEnd);
  }
  const bodyEnd = out.toLowerCase().lastIndexOf("</body>");
  out = bodyEnd === -1 ? out + LIVE_RELOAD("/api/events", nonce) : out.slice(0, bodyEnd) + LIVE_RELOAD("/api/events", nonce) + out.slice(bodyEnd);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: https:",
    "font-src 'self' data: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
  return { html: out, csp };
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" || Buffer.isBuffer(body) ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...headers,
  });
  res.end(payload);
}

function readRaw(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        // Drain the rest so the 413 response can still be delivered.
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

async function readBody(req, limit = MAX_BODY) {
  const raw = await readRaw(req, limit);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

/** Image bytes from an upload: raw body (image/*, octet-stream) or JSON {data: base64 | data URL}. */
async function readUpload(req) {
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (type === "application/json") {
    const body = await readBody(req, MAX_ASSET_JSON);
    const data = String(body?.data ?? "");
    const base64 = data.startsWith("data:") ? /^data:[\w/+.-]*;base64,(.*)$/s.exec(data)?.[1] : data;
    if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new AssetError("Expected base64 image data in \"data\"");
    return Buffer.from(base64, "base64");
  }
  if (type.startsWith("image/") || type === "application/octet-stream") return readRaw(req, MAX_ASSET_BYTES);
  throw new AssetError("Upload an image (raw image/* body or JSON {data})", 415);
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ""));
  const bb = Buffer.from(String(b ?? ""));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Resolve a request path inside root; returns null on traversal. */
export function resolveInside(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const resolved = path.resolve(root, "." + path.posix.normalize("/" + decoded));
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) return null;
  // Do not serve dot-files (e.g. .git, .env).
  if (path.relative(rootResolved, resolved).split(path.sep).some((part) => part.startsWith("."))) return null;
  return resolved;
}

export async function startServer({
  deckPath,
  mode = "edit",
  port = 0,
  host = "127.0.0.1",
  token = generateToken(),
  runtime,
  agentFactory,
  log = (msg) => console.error(`[deckforge] ${msg}`),
} = {}) {
  const store = new DeckStore({ deckPath, runtime, log });
  store.build();
  store.watch();
  const agent = mode === "edit" ? new AgentController({ store, factory: agentFactory, log }) : null;
  const clients = new Set();
  const requireAuth = mode === "edit";
  let actualPort = port;

  const broadcast = (event, data) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(frame);
  };
  store.on("change", (info) => broadcast("deck", { ...info, state: store.lightSnapshot() }));
  store.on("built", (info) => broadcast("built", info));
  store.on("warning", (info) => broadcast("warning", info));
  agent?.on("event", (event) => broadcast("agent", event));

  // Deck tools for `deckforge mcp` (Copilot CLI / app) routed through this editor:
  // consecutive calls coalesce into one undo entry.
  const MCP_TOOLS = new Set(mcpToolSpecs().map((t) => t.name));
  const mcpTools = deckToolHandlers(store, {
    guide: true,
    guard: () => {
      if (store.group) throw Object.assign(new OpError("The editor's Copilot chat is applying changes. Retry when it has finished."), { status: 409 });
    },
    applyOptions: (name) => ({ source: "mcp", label: `Copilot (outside the editor): ${name}`, coalesce: "mcp", coalesceMs: 30000 }),
  });

  // Cookies are shared by every port of 127.0.0.1: name the token per port so
  // several editors can run side by side without overwriting each other.
  const cookieName = () => `df_token_${actualPort}`;
  const allowedHosts = () => new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`]);

  function authorized(req) {
    if (!requireAuth) return true;
    const header = req.headers["x-deckforge-token"];
    if (header && safeEqual(header, token)) return true;
    return safeEqual(parseCookies(req.headers.cookie)[cookieName()], token);
  }

  function serveFile(res, file, { deckPage = false, deckAsset = false } = {}) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return send(res, 404, "Not found");
    }
    if (stat.isDirectory()) return send(res, 404, "Not found");
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    let body = fs.readFileSync(file);
    const headers = { "Content-Type": type };
    if (ext === ".svg") headers["Content-Security-Policy"] = SVG_CSP;
    if (deckAsset) headers["Cache-Control"] = "private, max-age=3600";
    if (deckPage && type.startsWith("text/html")) {
      const protectedPage = protectDeckHtml(body.toString("utf8"), crypto.randomBytes(16).toString("base64"), { editorUrl: mode === "edit" ? "/" : undefined });
      body = protectedPage.html;
      headers["Content-Security-Policy"] = protectedPage.csp;
    }
    send(res, 200, body, headers);
  }

  async function handleApi(req, res, url) {
    const route = url.pathname.slice("/api".length);
    if (req.method === "GET" && route === "/state") return send(res, 200, { ...store.snapshot(), agent: agent?.status() });
    if (req.method === "GET" && route === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write(`event: hello\ndata: ${JSON.stringify({ version: store.version })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }
    if (mode !== "edit") return send(res, 404, { error: "Not found" });
    if (req.method !== "GET") {
      const origin = req.headers.origin;
      if (origin && !allowedHosts().has(origin.replace(/^https?:\/\//, ""))) return send(res, 403, { error: "Cross-origin request refused" });
      if (req.method === "POST" && route === "/assets") {
        if (store.group) return send(res, 409, { error: "Copilot is applying changes. Wait for it to finish, then add the image again." });
        const buf = await readUpload(req);
        return send(res, 201, { ok: true, ...saveAsset(store.deckDir, buf) });
      }
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) return send(res, 415, { error: "Use application/json" });
    }
    if (req.method === "GET" && route === "/assets") return send(res, 200, { assets: listAssets(store.deckDir) });
    const body = req.method === "GET" ? {} : await readBody(req);
    if (req.method === "POST" && route === "/op") {
      const result = store.apply(body.name, body.args, { source: "user", label: body.label, coalesce: body.coalesce });
      return send(res, 200, { ok: true, result, version: store.version });
    }
    if (req.method === "POST" && route === "/tool") {
      const name = String(body.name ?? "");
      if (!MCP_TOOLS.has(name)) return send(res, 404, { error: `Unknown tool "${name}"` });
      const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args : {};
      return send(res, 200, { ok: true, result: await mcpTools[name](args) });
    }
    if (req.method === "POST" && route === "/undo") return send(res, 200, { ok: store.undo(), version: store.version });
    if (req.method === "POST" && route === "/redo") return send(res, 200, { ok: store.redo(), version: store.version });
    if (req.method === "POST" && route === "/build") return send(res, 200, store.build());
    const tpl = /^\/templates\/([a-z0-9][a-z0-9-]*)$/.exec(route);
    if (req.method === "PUT" && tpl) {
      const scope = body.scope === "user" ? "user" : "deck";
      return send(res, 200, { ok: true, ...store.saveTemplate(tpl[1], String(body.source ?? ""), scope) });
    }
    if (req.method === "POST" && route === "/agent") {
      await agent.chat({ prompt: String(body.prompt ?? ""), scope: body.scope === "slide" ? "slide" : "deck", slideId: body.slideId ?? null });
      return send(res, 202, { ok: true });
    }
    if (req.method === "POST" && route === "/agent/abort") return send(res, 200, { ok: await agent.abort() });
    if (req.method === "POST" && route === "/agent/improve") {
      const { text, label, description, max, richtext, kind, slideId } = body || {};
      return send(res, 200, await agent.improve({ text, label, description, max, richtext, kind, slideId }));
    }
    if (req.method === "POST" && route === "/agent/reset") return send(res, 200, { ok: await agent.reset() });
    if (req.method === "POST" && route === "/agent/connect") {
      try {
        return send(res, 200, await agent.connect());
      } catch (err) {
        const auth = Boolean(agent.error?.auth);
        return send(res, err.name === "OpError" ? 409 : auth ? 503 : 502, { error: err.message, details: auth ? { auth, hint: agent.status().hint } : undefined });
      }
    }
    if (req.method === "POST" && route === "/agent/handoff") return send(res, 200, await agent.handoff());
    if (req.method === "POST" && route === "/agent/open-app") return send(res, 200, await agent.openInApp());
    if (req.method === "POST" && route === "/copilot/install-tools") return send(res, 200, { ok: true, ...installGlobalMcp(), status: globalMcpStatus() });
    if (req.method === "GET" && route === "/agent") return send(res, 200, agent.status());
    return send(res, 404, { error: "Not found" });
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowedHosts().has(String(req.headers.host || ""))) return send(res, 421, "Unexpected Host header");
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (requireAuth && req.method === "GET" && url.searchParams.has("token")) {
        if (!safeEqual(url.searchParams.get("token"), token)) return send(res, 401, "Invalid token");
        url.searchParams.delete("token");
        const location = url.pathname + (url.search || "") + (url.hash || "");
        // Lax, not Strict: hosts such as the GitHub Copilot app's webview open the
        // URL from another site, and a Strict cookie would be dropped on this
        // redirect. Writes stay guarded by the Origin check and JSON-only bodies.
        res.writeHead(302, {
          "Set-Cookie": `${cookieName()}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`,
          Location: location,
          "Cache-Control": "no-store",
        });
        return res.end();
      }
      if (url.pathname.startsWith("/assets/")) {
        const name = url.pathname.slice("/assets/".length);
        if (!ASSETS.has(name)) return send(res, 404, "Not found");
        return serveFile(res, path.join(DIST_DIR, name));
      }
      if (!authorized(req)) {
        return send(res, 401, mode === "edit" ? "deckforge: open the URL printed by `deckforge edit` (it contains the access token)." : "Unauthorized");
      }
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
      if (mode === "edit" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return send(res, 200, editorPage({ title: store.deck.meta.title }), { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": EDITOR_CSP });
      }
      if (url.pathname === "/" || url.pathname === "/deck" || url.pathname === "/deck/") {
        res.writeHead(302, { Location: `/deck/${path.basename(store.outPath)}` });
        return res.end();
      }
      if (url.pathname.startsWith("/deck/")) {
        const file = resolveInside(store.deckDir, url.pathname.slice("/deck/".length));
        if (!file) return send(res, 404, "Not found");
        const deckAsset = path.dirname(file) === path.join(store.deckDir, "assets");
        return serveFile(res, file, { deckPage: file === store.outPath, deckAsset });
      }
      return send(res, 404, "Not found");
    } catch (err) {
      const status = err.status || (["OpError", "TemplateError", "DeckError", "AssetError"].includes(err.name) ? 400 : 500);
      if (status === 500) log(err.stack || err.message);
      if (!res.headersSent) send(res, status, { error: err.message, details: err.details });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  actualPort = server.address().port;
  const origin = `http://${host}:${actualPort}`;
  // Let `deckforge mcp` find this editor (private file in the config folder).
  const unpublish = mode === "edit" ? publishEditor({ deckPath: store.deckPath, origin: `http://${host.includes(":") ? `[${host}]` : host}:${actualPort}`, token }) : () => {};
  const close = async () => {
    unpublish();
    for (const res of clients) res.end();
    clients.clear();
    store.close();
    await agent?.dispose();
    await new Promise((resolve) => {
      server.close(resolve);
      // Do not wait for browsers' keep-alive or in-flight image requests.
      server.closeAllConnections?.();
    });
  };
  return {
    server,
    store,
    agent,
    port: actualPort,
    origin,
    token,
    editorUrl: mode === "edit" ? `${origin}/?token=${token}` : null,
    viewerUrl: mode === "edit" ? `${origin}/deck/${path.basename(store.outPath)}?token=${token}` : `${origin}/deck/${path.basename(store.outPath)}`,
    close,
  };
}
