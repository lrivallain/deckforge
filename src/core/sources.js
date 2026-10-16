// Per-slide sources as editable text: one source per line, either plain text
// (a URL included) or `Label | https://url` for a {label, href} entry.

export function formatSourceLines(sources) {
  return (sources || [])
    .map((source) => (typeof source === "string" ? source : source.href ? `${source.label} | ${source.href}` : source.label))
    .join("\n");
}

export function parseSourceLines(text) {
  const out = [];
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const cut = line.lastIndexOf("|");
    const href = cut > 0 ? line.slice(cut + 1).trim() : "";
    const label = cut > 0 ? line.slice(0, cut).trim() : "";
    if (label && href) out.push({ label, href });
    else out.push(line);
  }
  return out;
}
