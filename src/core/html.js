// HTML escaping and a small allow-list sanitizer for "richtext" slots.
// Works in Node and in the browser (no DOM dependency).

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export const escapeAttr = escapeHtml;

/** Plain text with newlines turned into <br>. */
export function textToHtml(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

const ALLOWED_TAGS = new Set([
  "b", "strong", "i", "em", "u", "s", "del", "ins", "mark", "small", "sub", "sup",
  "code", "kbd", "br", "span", "a", "abbr",
]);
const VOID_TAGS = new Set(["br"]);
export const RICHTEXT_CLASSES = [
  "old", "muted", "primary", "accent", "blue", "amber", "ok", "mono", "nowrap",
];
const ALLOWED_CLASSES = new Set(RICHTEXT_CLASSES);
const DROP_WITH_CONTENT = new Set(["script", "style", "template", "iframe", "noscript", "textarea", "title", "object"]);

export function isSafeUrl(href) {
  const value = String(href ?? "").trim();
  if (!value) return false;
  if (/^(https?:|mailto:)/i.test(value)) return true;
  if (/^#[\w-]*$/.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) return false;
  return /^[\w./-][\w./%?=&#~+-]*$/.test(value);
}

export function decodeEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, "\u00a0")
    .replace(/&middot;/g, "\u00b7").replace(/&rarr;/g, "\u2192").replace(/&larr;/g, "\u2190")
    .replace(/&mdash;/g, "\u2014").replace(/&ndash;/g, "\u2013").replace(/&hellip;/g, "\u2026")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(n) {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

function parseAttributes(source) {
  const attrs = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(source))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function cleanAttributes(tag, attrs) {
  const out = [];
  if (attrs.class) {
    const classes = attrs.class.split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c));
    if (classes.length) out.push(`class="${escapeAttr(classes.join(" "))}"`);
  }
  if (attrs.title && (tag === "abbr" || tag === "span")) out.push(`title="${escapeAttr(attrs.title)}"`);
  if (tag === "a" && attrs.href && isSafeUrl(attrs.href)) {
    const href = attrs.href.trim();
    out.push(`href="${escapeAttr(href)}"`);
    if (!href.startsWith("#")) out.push('target="_blank" rel="noopener noreferrer"');
  }
  if (attrs.lang && /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(attrs.lang)) out.push(`lang="${attrs.lang}"`);
  return out.length ? " " + out.join(" ") : "";
}

function escapeText(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Sanitize a fragment of inline rich text. Only a small set of inline tags and
 * classes survives; other tags are dropped (keeping their text), dangerous
 * elements are removed with their content. Output is always well-nested.
 */
export function sanitizeRichText(input) {
  const source = String(input ?? "");
  const out = [];
  const stack = [];
  const re = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|<|>|[^<>]+/g;
  let m;
  while ((m = re.exec(source))) {
    const token = m[0];
    if (token.startsWith("<!--")) continue;
    if (m[2]) {
      const tag = m[2].toLowerCase();
      const closing = m[1] === "/";
      if (DROP_WITH_CONTENT.has(tag)) {
        if (!closing) {
          const end = source.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
          if (end === -1) break;
          const close = source.indexOf(">", end);
          re.lastIndex = close === -1 ? source.length : close + 1;
        }
        continue;
      }
      if (tag === "div" || tag === "p") {
        // contenteditable artefacts: treat block boundaries as line breaks.
        if (closing || out.length) out.push("<br>");
        continue;
      }
      if (!ALLOWED_TAGS.has(tag)) continue;
      if (closing) {
        const index = stack.lastIndexOf(tag);
        if (index === -1) continue;
        while (stack.length > index) out.push(`</${stack.pop()}>`);
        continue;
      }
      out.push(`<${tag}${cleanAttributes(tag, parseAttributes(m[3] || ""))}>`);
      if (!VOID_TAGS.has(tag)) stack.push(tag);
      continue;
    }
    if (token === "<") out.push("&lt;");
    else if (token === ">") out.push("&gt;");
    else out.push(escapeText(decodeEntities(token)));
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join("").replace(/^(<br>)+|(<br>)+$/g, "").replace(/(<br>){3,}/g, "<br><br>");
}

/** Strip all tags and return plain text. */
export function stripTags(input) {
  return decodeEntities(String(input ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}
