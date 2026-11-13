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
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
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
  // Other indigo/violet accents.
  "5563ff": [17, 17, 20],
  "4554ff": [17, 17, 20],
  "4b57ff": [17, 17, 20],
  "5863f8": [17, 17, 20],
  "7a5cff": [17, 17, 20],
  "1f3a8a": [17, 17, 20],
  // Bluish greys of the old palette → neutral greys (owner, 2026-11-11:
  // «руководство на голубом или фиолетовом цвете странновато»).
  "0b1024": [17, 17, 20], // text
  "141821": [17, 17, 20],
  "3c4053": [60, 61, 72],
  "5b6170": [90, 92, 102],
  "6f7282": [106, 108, 122],
  "73738a": [106, 108, 122],
  "7a7c8e": [116, 117, 127],
  "9b9fb3": [154, 156, 168],
  "c7ccea": [207, 208, 214], // borders
  "c8cbe0": [207, 208, 214],
  "d8dae6": [216, 217, 222],
  "dcdfed": [220, 221, 227],
  "dfe1ec": [220, 221, 227],
  "ececf4": [231, 231, 236],
  "eef0f6": [237, 237, 240], // surfaces
  "f1f2f8": [241, 241, 244],
  "f2f3f8": [242, 242, 244],
  "f3f4fb": [243, 243, 245],
  "f4f5fb": [244, 244, 246],
  "fafbff": [250, 250, 251],
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

// Only the «Новая» design (`data-view-design="new"`, lib/view-prefs.ts).
const SCOPE =
  'html[data-view-design="new"]:not(:has([data-app-theme="dark"], [data-partner-accent], .mini-root))';

const hexes = Object.keys(MAP).join("|");
const props = Object.keys(PROPS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const TOKEN = new RegExp(
  String.raw`(?<![\w\[\]:/-])(!?)((?:[a-z0-9-]+(?:\[[^\]\s"'\x60]+\])?(?:\/[a-z0-9_-]+)?:)*)(!?)(${props})-\[#(${hexes})\](?:\/(\[[0-9.]+\]|\d+))?(!?)(?![\w\[-])`,
  "gi",
);

const SHADOW = /(?<![\w\[\]:/-])((?:[a-z0-9-]+(?:\[[^\]\s"'\x60]+\])?(?:\/[a-z0-9_-]+)?:)*)shadow-\[([^\]\s"'\x60]*rgba\(85,102,246,[0-9.]+\)[^\]\s"'\x60]*)\](?![\w\[-])/g;

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
  // Indigo glows under buttons (`shadow-[…rgba(85,102,246,0.55)]`) → soft grey.
  for (const m of text.matchAll(SHADOW)) {
    const [whole, variantChain, value] = m;
    const variants = variantChain ? variantChain.slice(0, -1).split(":") : [];
    const rule = buildRule(variants, whole);
    if (!rule) continue;
    const shadow = value
      .replace(/_/g, " ")
      .replace(/rgba\(85,\s*102,\s*246,\s*([0-9.]+)\)/g, (_, a) => `rgba(17,17,20,${+(Number(a) * 0.45).toFixed(3)})`);
    rules.set(`${rule.media ?? ""}|${rule.selector}`, { ...rule, decl: `box-shadow: ${shadow}` });
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
  --app-text: #111114;
  --app-text-secondary: #3c3d48;
  --app-text-muted: #6a6c7a;
  --app-text-faint: #9a9ca8;
  --app-skeleton-base: #ededf0;
}`;
// Accents (owner, 2026-11-11: «разнообразить — розовые и синие иконки,
// галочки»): check marks outside buttons/checkboxes are blue; green
// «done» checks keep their colour.
const accents = `${SCOPE} :is(.lucide-check, .lucide-circle-check, .lucide-circle-check-big, .lucide-check-check):not(:is(button, a, [role="button"], [role="checkbox"], [data-state]) *):not([class*="#116b2a"]):not([class*="#136b2a"]):not([class*="green"]):not([class*="emerald"]):not([class*="text-white"]) { color: #2f80c9; }`;
// Button variants of the «Новая» design (src/components/ui/button.tsx keeps
// its classic classes): outline is white with a grey border, secondary grey.
const OUTLINE = '[data-slot="button"][data-variant="outline"].bg-\\[\\#5566f6\\]\\/\\[0\\.04\\]';
const SECONDARY = '[data-slot="button"][data-variant="secondary"].bg-\\[\\#5566f6\\]\\/\\[0\\.04\\]';
const buttons = [
  `${SCOPE} ${OUTLINE} { background-color: #ffffff; color: #111114; border: 1px solid #dcdde3; }`,
  `${SCOPE} ${OUTLINE}:is(:hover, [aria-pressed="true"], [data-state="open"]) { background-color: #f1f1f4; }`,
  `${SCOPE} ${SECONDARY} { background-color: #ececef; color: #111114; }`,
  `${SCOPE} ${SECONDARY}:hover { background-color: #e2e2e7; }`,
  `${SCOPE} [data-slot="button"][data-variant="ghost"]:hover { background-color: #f1f1f4; }`,
  // Soft bottom shadow under white bordered blocks (owner, 2026-11-11).
  `${SCOPE} main :is(.rounded-xl, .rounded-2xl, .rounded-3xl, [class*="rounded-[1"]).border:is(.bg-white, .bg-card) { box-shadow: 0 1px 2px rgba(17,17,20,0.04), 0 3px 8px -4px rgba(17,17,20,0.10); }`,
].join("\n");
const body = [
  tokens,
  accents,
  buttons,
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
