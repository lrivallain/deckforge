// Offline guarantees for built decks: find every reference that would make a
// browser fetch something from the network, and the CSP that forbids it.

// Attributes that load a resource (hyperlinks on <a>/<area> only navigate on click).
const RESOURCE_ATTRS = new Set(["src", "srcset", "poster", "data", "href", "xlink:href", "action", "formaction", "background", "ping", "manifest", "codebase", "archive", "cite", "longdesc", "lowsrc", "dynsrc"]);
const NAVIGATION_TAGS = new Set(["a", "area"]);
const REMOTE_RE = /(?:^|[\s,;=(])((?:https?:)?\/\/[^\s"'<>),;]+)/gi;

/** Content-Security-Policy of an offline (inline runtime) deck: nothing may be fetched. */
export const OFFLINE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function remoteUrls(value) {
  return [...String(value).matchAll(REMOTE_RE)].map((m) => m[1]);
}

/**
 * List the http(s) and protocol-relative resources an HTML page would load:
 * scripts, stylesheets, images, media, frames, CSS url() and @import.
 * XML namespaces and plain <a href> links are not resources and are ignored.
 * @returns {{ url: string, where: string }[]}
 */
export function findExternalReferences(html) {
  const found = [];
  const seen = new Set();
  const add = (url, where) => {
    const key = `${where}\u0000${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ url, where });
  };
  const source = String(html ?? "");
  const scanCss = (css, where) => {
    for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) for (const url of remoteUrls(m[2].trim())) add(url, where);
    for (const m of css.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)/gi)) for (const url of remoteUrls(m[2])) add(url, where);
  };
  // Scripts are opaque here: only their src attribute (checked below) loads anything.
  const withoutScripts = source.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, "$1</script>");
  for (const m of withoutScripts.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) scanCss(m[1], "<style>");
  const markup = withoutScripts.replace(/(<style\b[^>]*>)[\s\S]*?<\/style>/gi, "$1</style>");
  for (const tag of markup.matchAll(/<([a-zA-Z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const name = tag[1].toLowerCase();
    const attrs = [...tag[2].matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)].map((a) => [a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? ""]);
    for (const [attr, raw] of attrs) {
      const value = raw.replace(/&quot;/g, "\"").replace(/&#0*39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&#0*58;|&colon;/gi, ":").replace(/&#x0*2f;|&sol;/gi, "/");
      if (attr === "style") scanCss(value, `<${name} style>`);
      else if (RESOURCE_ATTRS.has(attr) && !(NAVIGATION_TAGS.has(name) && attr === "href")) {
        for (const url of remoteUrls(value)) add(url, `<${name} ${attr}>`);
      } else if (name === "meta" && attr === "content" && attrs.some(([k, v]) => k === "http-equiv" && /refresh/i.test(v))) {
        for (const url of remoteUrls(value)) add(url, "<meta refresh>");
      }
    }
  }
  return found;
}
