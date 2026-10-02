// Per-slide summary of the changes between two decks, for pull request reviews.

const SLIDE_FIELDS = ["template", "title", "hidden", "footer", "notes", "sources", "overlays", "placeholders"];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function describeValue(key, before, after) {
  if (Array.isArray(before) || Array.isArray(after)) {
    const a = Array.isArray(before) ? before.length : 0;
    const b = Array.isArray(after) ? after.length : 0;
    if (a !== b) return `${key} (${a} → ${b} items)`;
    const changed = Array.from({ length: b }, (_, i) => i).filter((i) => !same(before[i], after[i]));
    return `${key} (item${changed.length > 1 ? "s" : ""} ${changed.map((i) => i + 1).join(", ")})`;
  }
  if (before === undefined) return `${key} (added)`;
  if (after === undefined) return `${key} (removed)`;
  return key;
}

/** Ids of `b` that keep their relative order from `a` (longest common subsequence). */
function stableIds(a, b) {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const keep = new Set();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) {
      keep.add(a[i]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return keep;
}

/**
 * Compare two normalized decks.
 * @returns {{ meta: string[], slides: object[], summary: object }}
 *   slides: one entry per slide of either deck, in the new order (removed ones
 *   where they were): { id, template, status: added|removed|changed|moved|unchanged, from, to, changes }
 */
export function diffDecks(before, after) {
  const meta = [];
  const keys = new Set([...Object.keys(before.meta || {}), ...Object.keys(after.meta || {})]);
  for (const key of keys) if (!same(before.meta?.[key], after.meta?.[key])) meta.push(key);
  const oldIds = before.slides.map((s) => s.id);
  const newIds = after.slides.map((s) => s.id);
  const common = newIds.filter((id) => oldIds.includes(id));
  const stable = stableIds(oldIds.filter((id) => common.includes(id)), common);
  const slides = [];
  const changesOf = (a, b) => {
    const changes = [];
    for (const field of SLIDE_FIELDS) if (!same(a[field], b[field])) changes.push(field === "template" ? `template (${a.template} → ${b.template})` : field);
    const dataKeys = new Set([...Object.keys(a.data || {}), ...Object.keys(b.data || {})]);
    for (const key of dataKeys) if (!same(a.data?.[key], b.data?.[key])) changes.push(describeValue(key, a.data?.[key], b.data?.[key]));
    return changes;
  };
  const emitRemoved = (upTo) => {
    while (removedQueue.length && removedQueue[0].from <= upTo) slides.push(removedQueue.shift());
  };
  const removedQueue = before.slides
    .map((s, i) => ({ id: s.id, template: s.template, status: "removed", from: i + 1, to: null, changes: [] }))
    .filter((s) => !newIds.includes(s.id));
  after.slides.forEach((slide, index) => {
    const from = oldIds.indexOf(slide.id);
    if (from === -1) {
      slides.push({ id: slide.id, template: slide.template, status: "added", from: null, to: index + 1, changes: [] });
      return;
    }
    emitRemoved(from + 1);
    const changes = changesOf(before.slides[from], slide);
    const moved = !stable.has(slide.id);
    slides.push({ id: slide.id, template: slide.template, status: moved ? "moved" : changes.length ? "changed" : "unchanged", from: from + 1, to: index + 1, changes });
  });
  slides.push(...removedQueue);
  const summary = { added: 0, removed: 0, changed: 0, moved: 0, unchanged: 0 };
  for (const s of slides) summary[s.status]++;
  return { meta, slides, summary };
}

/** Plain-text report of diffDecks(), one line per slide that changed. */
export function formatDiff(diff, { from = "a", to = "b" } = {}) {
  const lines = [`deckforge diff ${from} → ${to}`];
  if (diff.meta.length) lines.push(`  meta: ${diff.meta.join(", ")}`);
  for (const s of diff.slides) {
    const what = s.changes.length ? `: ${s.changes.join(", ")}` : "";
    if (s.status === "added") lines.push(`+ ${s.id} [${s.template}] added at ${s.to}`);
    else if (s.status === "removed") lines.push(`- ${s.id} [${s.template}] removed (was ${s.from})`);
    else if (s.status === "moved") lines.push(`↕ ${s.id} [${s.template}] moved ${s.from} → ${s.to}${what}`);
    else if (s.status === "changed") lines.push(`~ ${s.id} [${s.template}]${what}`);
  }
  const { added, removed, changed, moved, unchanged } = diff.summary;
  if (!diff.meta.length && !added && !removed && !changed && !moved) lines.push("  no changes");
  lines.push(`  ${added} added, ${removed} removed, ${changed} changed, ${moved} moved, ${unchanged} unchanged`);
  return lines.join("\n");
}
