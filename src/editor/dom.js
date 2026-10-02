// Tiny DOM helpers for the editor (no framework).

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "html") el.innerHTML = value;
    else if (value === true) el.setAttribute(key, "");
    else if (key in el && !key.includes("-") && key !== "list" && key !== "form") el[key] = value;
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

const ICON_PATHS = {
  plus: "M12 5v14M5 12h14",
  copy: "M8 8h11v11H8zM5 16V5h11",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  eyeOff: "M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.3 4M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.3-.5 4.6-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  play: "M7 4l13 8-13 8z",
  sparkles: "M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5",
  terminal: "M4 5h16v14H4zM7.5 9.5l3 2.5-3 2.5M13 15h4",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  close: "M6 6l12 12M18 6L6 18",
  cancel: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6M15 9l-6 6",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  send: "M4 12l16-8-6 16-2-7z",
  stop: "M7 7h10v10H7z",
  check: "M5 12.5l4.5 4.5L19 7",
  alert: "M12 3l9.5 17h-19zM12 10v4.5M12 17.5h.01",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  chevron: "M9 6l6 6-6 6",
  palette: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1-.8-1.3-.8-2.2 0-.9.7-1.3 1.6-1.3H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 12h.01M9.5 8h.01M14.5 8h.01",
  layout: "M4 4h16v16H4zM4 10h16M10 10v10",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  alignLeft: "M4 4v16M8 7h10v4H8zM8 14h6v4H8z",
  alignCenter: "M12 4v16M6 7h12v4H6zM8 14h8v4H8z",
  alignRight: "M20 4v16M6 7h10v4H6zM10 14h6v4h-6z",
  alignTop: "M4 4h16M7 8h4v10H7zM14 8h4v6h-4z",
  alignMiddle: "M4 12h16M7 6h4v12H7zM14 8h4v8h-4z",
  alignBottom: "M4 20h16M7 6h4v10H7zM14 10h4v6h-4z",
  distributeH: "M4 4v16M20 4v16M10 8h4v8h-4z",
  distributeV: "M4 4h16M4 20h16M8 10h8v4H8z",
  forward: "M9 9h11v11H9zM4 15V4h11",
  backward: "M4 4h11v11H4zM9 20h11V9",
};

export function icon(name, size = 18) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "ui-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICON_PATHS[name] || "");
  svg.append(path);
  return svg;
}

export function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

let toastHost;
export function toast(message, { action, onAction, kind = "info", timeout = 4000 } = {}) {
  if (!toastHost) toastHost = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
  // Modal dialogs live in the top layer: show toasts inside the open one.
  const host = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
  if (toastHost.parentNode !== host) host.append(toastHost);
  const node = h("div", { class: `toast toast-${kind}` }, h("span", {}, message));
  if (action) {
    node.append(h("button", { type: "button", class: "btn btn-link", onClick: () => { onAction?.(); node.remove(); } }, action));
  }
  toastHost.append(node);
  setTimeout(() => node.classList.add("leaving"), timeout);
  setTimeout(() => node.remove(), timeout + 300);
  return node;
}

/** Fit a 1280×720 iframe into its container by scaling. */
export function fitFrame(container, frame, { width = 1280, height = 720 } = {}) {
  const rect = container.getBoundingClientRect();
  const scale = Math.min(rect.width / width, rect.height / height);
  frame.style.transform = `scale(${scale})`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  return scale;
}

/**
 * Render an HTML document into a same-origin about:blank iframe.
 *
 * We write the document with document.open/write/close instead of `srcdoc`
 * or blob: URLs, which some WebKit hosts (e.g. Tauri WKWebView) never load.
 * When only the <body> changed we swap it in place to avoid flicker and keep
 * listeners. Re-inserting an iframe in the DOM resets it to an empty
 * about:blank document; that is detected and the frame is rewritten.
 */
export function writeFrame(frame, html) {
  const doc = frame.contentDocument;
  if (!doc) return false; // not attached yet; call again once in the DOM
  const headMatch = /<head>([\s\S]*?)<\/head>/.exec(html);
  const bodyMatch = /<body>([\s\S]*?)<\/body>/.exec(html);
  const head = headMatch ? headMatch[1] : "";
  const body = bodyMatch ? bodyMatch[1] : "";
  const sameDocument = frame._doc === doc && doc.body;
  if (sameDocument && frame._head === head && bodyMatch) {
    if (frame._body !== body) {
      doc.body.innerHTML = body;
      frame._body = body;
      frame.dispatchEvent(new CustomEvent("frame-updated"));
    }
    return true;
  }
  doc.open();
  doc.write(html);
  doc.close();
  // document.open() erases the document's event listeners but keeps the same
  // Document object: listeners must be re-attached per write (see wiredFor).
  frame._generation = (frame._generation || 0) + 1;
  frame._doc = frame.contentDocument;
  frame._head = head;
  frame._body = body;
  frame.dataset.ready = "1";
  frame.dispatchEvent(new CustomEvent("frame-updated"));
  return true;
}

/**
 * True the first time it is called for `key` since the frame's document was
 * (re)written: use it to attach document-level listeners exactly once.
 */
export function wiredFor(frame, key) {
  const doc = frame.contentDocument;
  if (!doc) return false;
  const marks = (doc.__dfWired ||= {});
  const generation = `${frame._generation || 0}`;
  if (marks[key] === generation) return false;
  marks[key] = generation;
  return true;
}

/** True when the frame still shows the document last written by writeFrame. */
export function frameIsCurrent(frame) {
  return Boolean(frame.contentDocument && frame._doc === frame.contentDocument && frame.contentDocument.body?.firstElementChild);
}
