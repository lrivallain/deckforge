// HTTP + SSE client for the deckforge editor server.

async function request(method, url, body, { signal } = {}) {
  const res = await fetch(url, {
    method,
    signal,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const err = new Error(data.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.details = data.details;
    throw err;
  }
  return data;
}

async function upload(file) {
  const res = await fetch("/api/assets", {
    method: "POST",
    headers: { "Content-Type": file.type && file.type.startsWith("image/") ? file.type : "application/octet-stream" },
    body: file,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Save exported .pptx bytes next to deck.yaml; returns { path, file, url }. */
async function savePptx(bytes) {
  const res = await fetch("/api/export/pptx", {
    method: "POST",
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
    body: bytes,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  upload,
  savePptx,
  build: () => request("POST", "/api/build", {}),
  assets: () => request("GET", "/api/assets"),
  state: () => request("GET", "/api/state"),
  op: (name, args, opts = {}) => request("POST", "/api/op", { name, args, ...opts }),
  undo: () => request("POST", "/api/undo", {}),
  redo: () => request("POST", "/api/redo", {}),
  saveTemplate: (name, source, scope) => request("PUT", `/api/templates/${encodeURIComponent(name)}`, { source, scope }),
  agent: (prompt, scope, slideId) => request("POST", "/api/agent", { prompt, scope, slideId }),
  agentAbort: () => request("POST", "/api/agent/abort", {}),
  agentReset: () => request("POST", "/api/agent/reset", {}),
  agentStatus: () => request("GET", "/api/agent"),
  agentConnect: () => request("POST", "/api/agent/connect", {}),
  agentHandoff: () => request("POST", "/api/agent/handoff", {}),
  agentOpenApp: () => request("POST", "/api/agent/open-app", {}),
  installCopilotTools: () => request("POST", "/api/copilot/install-tools", {}),
  improve: (payload, { signal } = {}) => request("POST", "/api/agent/improve", payload, { signal }),
};

export function connectEvents(handlers) {
  let source;
  let retry = 500;
  const open = () => {
    source = new EventSource("/api/events");
    source.addEventListener("hello", () => {
      retry = 500;
      handlers.open?.();
    });
    for (const name of ["deck", "built", "agent", "warning"]) {
      source.addEventListener(name, (event) => {
        try {
          handlers[name]?.(JSON.parse(event.data));
        } catch (err) {
          console.error(err);
        }
      });
    }
    source.onerror = () => {
      handlers.error?.();
      source.close();
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 8000);
    };
  };
  open();
  return () => source?.close();
}
