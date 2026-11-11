#!/usr/bin/env node
/**
 * Neutral palette layer (owner, 2026-11-11: «все фиолетовые ссылки и
 * выделения по всему сайту — тёмные и серые»).
 *
 * The codebase uses the old brand indigo as literal Tailwind classes
 * (`text-[#5566f6]`, `bg-[#f5f6ff]`, `hover:bg-[#4a5bf0]`, …) in thousands of
 * places. Instead of rewriting every call site, this script scans `src/` for
 * every such class (with its variants and opacity) and writes
 * `src/app/neutral-palette.css`, which repaints them to black / graphite /
 * greys in the light theme. Dark theme, partner accent colours and the Mini
 * App keep their own rules.
 *
 * Run after adding new indigo classes: `npm run palette:neutral`.
 * New code should use neutral colours directly (#111114, #2c2d36, #ececef,
 * #f4f4f6, #dcdde3) instead of relying on this layer.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "src/app/neutral-palette.css");

/** Old indigo shade → neutral replacement (r, g, b). */
const MAP = {
  "5566f6": [17, 17, 20], // brand solid → black
  "4a5bf0": [44, 45, 54], // brand hover → graphite
  "3848c7": [17, 17, 20], // dark indigo text/links → black
  "3343cf": [17, 17, 20],
  "4c5ae0": [44, 45, 54],
  "f5f6ff": [244, 244, 246], // pale hover → light grey
  "eef1ff": [236, 236, 239], // pale selected → grey
  "eef0ff": [236, 236, 239],
  "eef0fe": [236, 236, 239],
  "e8ebff": [236, 236, 239],
  "dfe3ff": [220, 221, 227], // pale border → grey border
};

const PROPS = {
  text: (c) => `color: ${c}`,
  bg: (c) => `background-color: ${c}`,
  border: (c) => `border-color: ${c}`,
  "border-t": (c) => `border-top-color: ${c}`,
  "border-b": (c) => `border-bottom-color: ${c}`,
  "border-l": (c) => `border-left-color: ${c}`,
  "border-r": (c) => `border-right-color: ${c}`,
  "border-x": (c) => `border-left-color: ${c}; border-right-color: ${c}`,
  "border-y": (c) => `border-top-color: ${c}; border-bottom-color: ${c}`,
  ring: (c) => `--tw-ring-color: ${c}`,
  outline: (c) => `outline-color: ${c}`,
  accent: (c) => `accent-color: ${c}`,
  decoration: (c) => `text-decoration-color: ${c}`,
  caret: (c) => `caret-color: ${c}`,
  fill: (c) => `fill: ${c}`,
  stroke: (c) => `stroke: ${c}`,
};

const PSEUDO = {
  hover: ":hover",
  focus: ":focus",
  "focus-visible": ":focus-visible",
  "focus-within": ":focus-within",
  active: ":active",
  disabled: ":disabled",
  checked: ":checked",
  first: ":first-child",
  last: ":last-child",
  visited: ":visited",
};
const MEDIA = {
  sm: "(width >= 40rem)",
  md: "(width >= 48rem)",
  lg: "(width >= 64rem)",
  xl: "(width >= 80rem)",
  "2xl": "(width >= 96rem)",
  "max-sm": "(width < 40rem)",
  "max-md": "(width < 48rem)",
  "max-lg": "(width < 64rem)",
};

const SCOPE =
  'html:not(:has([data-app-theme="dark"], [data-partner-accent], .mini-root))';

const hexes = Object.keys(MAP).join("|");
const props = Object.keys(PROPS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const TOKEN = new RegExp(
  String.raw`(?<![\w\[\]:/-])(!?)((?:[a-z0-9-]+(?:\[[^\]\s"'\x60]+\])?(?:\/[a-z0-9_-]+)?:)*)(!?)(${props})-\[#(${hexes})\](?:\/(\[[0-9.]+\]|\d+))?(!?)(?![\w\[-])`,
  "gi",
);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|jsx?|mdx?)$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const escapeClass = (value) => value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);

/** data-[state=open] → [data-state="open"]; aria-[current=page] → [aria-current="page"]. */
function attributeVariant(variant) {
  const bracket = variant.match(/^(data|aria)-\[([a-z0-9_-]+)(?:=([^\]]+))?\]$/i);
  if (bracket) {
    const [, kind, name, value] = bracket;
    return value ? `[${kind}-${name}="${value.replace(/^['"]|['"]$/g, "")}"]` : `[${kind}-${name}]`;
  }
  const aria = variant.match(/^aria-(selected|pressed|checked|expanded|current|disabled)$/);
  if (aria) return aria[1] === "current" ? `[aria-current]:not([aria-current="false"])` : `[aria-${aria[1]}="true"]`;
  const data = variant.match(/^data-([a-z0-9_-]+)$/);
  if (data) return `[data-${data[1]}]`;
  return null;
}

/** Builds {selector, media} for a token, or null when a variant is unsupported. */
function buildRule(variants, className) {
  let self = `.${escapeClass(className)}`;
  let ancestor = "";
  let media = null;
  for (const variant of variants) {
    if (PSEUDO[variant]) self += PSEUDO[variant];
    else if (MEDIA[variant]) media = MEDIA[variant];
    else if (variant === "placeholder") self += "::placeholder";
    else if (/^group-/.test(variant)) {
      const m = variant.match(/^group-([a-z-]+|data-\[[^\]]+\]|aria-\[[^\]]+\])(?:\/([a-z0-9_-]+))?$/);
      if (!m) return null;
      const group = m[2] ? `.group\\/${m[2]}` : ".group";
      const state = PSEUDO[m[1]] ?? attributeVariant(m[1]);
      if (!state) return null;
      ancestor = `${group}${state} `;
    } else {
      const attr = attributeVariant(variant);
      if (!attr) return null; // dark:, print:, touch:, peer-*, motion-* … — leave as is
      self += attr;
    }
  }
  return { selector: `${SCOPE} ${ancestor}${self}`, media };
}

const rules = new Map();
let files = 0;
for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  let found = false;
  for (const m of text.matchAll(TOKEN)) {
    const [whole, bang1, variantChain, bang2, prop, hex, alphaRaw, bang3] = m;
    const variants = variantChain ? variantChain.slice(0, -1).split(":") : [];
    const rule = buildRule(variants, whole);
    if (!rule) continue;
    const alpha = alphaRaw
      ? alphaRaw.startsWith("[")
        ? Number(alphaRaw.slice(1, -1))
        : Number(alphaRaw) / 100
      : 1;
    const [r, g, b] = MAP[hex.toLowerCase()];
    const color = alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${+alpha.toFixed(3)})`;
    const important = bang1 || bang2 || bang3 ? " !important" : "";
    const decl = PROPS[prop.toLowerCase()](color)
      .split("; ")
      .map((d) => `${d}${important}`)
      .join("; ");
    const key = `${rule.media ?? ""}|${rule.selector}`;
    rules.set(key, { ...rule, decl });
    found = true;
  }
  if (found) files += 1;
}

const plain = [];
const byMedia = new Map();
for (const { selector, media, decl } of [...rules.values()].sort((a, b) => a.selector.localeCompare(b.selector))) {
  const line = `${selector} { ${decl}; }`;
  if (media) {
    if (!byMedia.has(media)) byMedia.set(media, []);
    byMedia.get(media).push(`  ${line}`);
  } else plain.push(line);
}

const header = `/*
 * GENERATED by scripts/gen-neutral-palette.mjs — do not edit by hand.
 * Run \`npm run palette:neutral\` after adding indigo classes.
 *
 * Light theme only: the old brand indigo classes (${Object.keys(MAP).map((h) => `#${h}`).join(", ")})
 * are repainted to black, graphite and greys. Dark theme, partner accent
 * and the Mini App keep their own colours.
 * ${rules.size} rules from ${files} files (${relative(ROOT, SRC)}/).
 */
`;
// Theme tokens that menus, popovers and hovers read (`var(--app-indigo)`, …).
const tokens = `${SCOPE} .app-shell, ${SCOPE} body {
  --app-tint-indigo: #f4f4f6;
  --app-indigo: #111114;
  --app-indigo-hover: #2c2d36;
  --app-indigo-deep: #111114;
  --app-bg: #fafafb;
  --app-surface-muted: #fafafb;
  --app-soft-surface: #fafafb;
  --app-border: #ececef;
  --app-border-strong: #dcdde3;
}`;
const body = [
  tokens,
  ...plain,
  ...[...byMedia.entries()].map(([media, lines]) => `@media ${media} {\n${lines.join("\n")}\n}`),
].join("\n");
const output = `${header}\n${body}\n`;
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    /* missing file */
  }
  if (current !== output) {
    console.error("neutral-palette.css is stale: run `npm run palette:neutral`");
    process.exit(1);
  }
  console.log("neutral-palette.css is up to date");
} else {
  writeFileSync(OUT, output);
  console.log(`neutral-palette.css: ${rules.size} rules from ${files} files`);
}
