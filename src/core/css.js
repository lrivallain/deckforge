// Minimal CSS scoping: prefixes every selector of a stylesheet with a scope
// selector. Handles comments, strings, nested @media/@supports/@container and
// leaves @keyframes/@font-face/@property blocks untouched.

const PASSTHROUGH_AT_RULES = /^@(-[a-z]+-)?(keyframes|font-face|property|page|counter-style|font-feature-values)\b/i;
const NESTING_AT_RULES = /^@(media|supports|container|layer|document)\b/i;

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Split `source` into top-level blocks: [{prelude, body}] or {statement}. */
function splitBlocks(source) {
  const blocks = [];
  let i = 0;
  let start = 0;
  let depth = 0;
  let preludeEnd = -1;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "{") {
      if (depth === 0) preludeEnd = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        blocks.push({ prelude: source.slice(start, preludeEnd).trim(), body: source.slice(preludeEnd + 1, i) });
        start = i + 1;
      }
      if (depth < 0) depth = 0;
    } else if (ch === ";" && depth === 0) {
      const statement = source.slice(start, i + 1).trim();
      if (statement) blocks.push({ statement });
      start = i + 1;
    }
    i++;
  }
  const rest = source.slice(start).trim();
  if (rest) blocks.push({ statement: rest });
  return blocks;
}

function splitSelectors(prelude) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of prelude) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function scopeSelector(selector, scope) {
  if (/^(html|body|:root)\b/.test(selector)) return selector; // globals are author intent
  if (selector.includes(":scope")) return selector.replace(/:scope/g, scope);
  return `${scope} ${selector}`;
}

export function scopeCss(css, scope) {
  const out = [];
  for (const block of splitBlocks(stripComments(String(css ?? "")))) {
    if (block.statement) {
      out.push(block.statement);
    } else if (PASSTHROUGH_AT_RULES.test(block.prelude)) {
      out.push(`${block.prelude}{${block.body.trim()}}`);
    } else if (NESTING_AT_RULES.test(block.prelude)) {
      out.push(`${block.prelude}{\n${scopeCss(block.body, scope)}\n}`);
    } else if (block.prelude) {
      const selectors = splitSelectors(block.prelude).map((s) => scopeSelector(s, scope));
      out.push(`${selectors.join(", ")} {${block.body.trim().replace(/\s*\n\s*/g, " ")}}`);
    }
  }
  return out.join("\n");
}
