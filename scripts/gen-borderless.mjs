#!/usr/bin/env node
/**
 * «Без рамок» (owner, 2026-11-22: «по сайту слишком много бордеров и выглядит
 * грязно… мне нравится как в приложении Claude»).
 *
 * The cabinet draws a grey 1px box around almost everything: cards, cards
 * inside cards, buttons, chips, empty slots (~3 000 `border` classes with a
 * neutral colour). In the Claude app surfaces differ by fill, not by outline.
 * Instead of rewriting every call site, this script scans `src/` for the
 * neutral grey border colours in use and writes `src/app/borderless.css`:
 *
 *   • a box border of a neutral colour becomes transparent (width stays, so
 *     nothing shifts);
 *   • a box that lies on another surface gets a soft translucent fill, a box
 *     that lies on the page canvas stays (or becomes) a plain surface;
 *   • dashed "empty slot" boxes become soft fills.
 *
 * Borders that carry meaning stay: form fields, tables and journal grids,
 * selected / hovered / focused / invalid states, status and accent colours,
 * images, colour swatches. Opt out for one element: `data-keep-border`.
 *
 * Scope: the cabinet and its portals (dialogs, menus), light and dark theme,
 * both designs. Not the Mini App, not public pages, not print.
 *
 * Run after adding a new neutral border colour: `npm run borderless`.
 * `src/app/borderless.test.ts` fails when the file is stale.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isNeutralBorder } from "./borderless-neutral.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "src/app/borderless.css");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const escapeClass = (name) => `.${name.replace(/[:[\]#/.=()%,]/g, "\\$&")}`;

// Neutral border colours used as a base class or under the «Новая» variant.
const neutral = new Set();
const files = walk(SRC);
for (const file of files) {
  for (const match of readFileSync(file, "utf8").matchAll(/(?<![\w:-])((?:newd:)?)border-\[#([0-9a-fA-F]{6})\](?![\w/])/g)) {
    const hex = match[2].toLowerCase();
    if (isNeutralBorder(hex)) neutral.add(`${match[1]}border-[#${hex}]`);
  }
}
const NAMED = ["border-gray-200", "border-gray-300", "border-slate-200", "border-slate-300", "border-border"];
const neutralClasses = [...[...neutral].sort(), ...NAMED].map(escapeClass);

// A class token `border-<colour>` at the start of the attribute or after a space: the element
// names its own border colour. Without one it uses the default `--border` grey.
const COLOUR_TOKENS = ["[", "gray-", "slate-", "zinc-", "neutral-", "stone-", "red-", "rose-", "orange-", "amber-", "yellow-", "green-", "emerald-", "teal-", "sky-", "blue-", "indigo-", "violet-", "purple-", "pink-", "white", "black", "transparent", "current", "input", "border", "primary", "destructive"];
const named = COLOUR_TOKENS.flatMap((token) => [`[class^="border-${token}"]`, `[class*=" border-${token}"]`]).join(", ");

const SCOPE = "body:has(.app-shell:not(.mini-root, .public-theme))";
const BOX = ":is(.border, .border-2, .newd\\:border)";
const NEUTRAL = `:is(${neutralClasses.join(", ")}, [class*="border-[var(--app-border"], :not(${named}))`;
// Borders that mean something: where you type, tables, pictures, swatches, explicit opt-out.
const KEEP = [
  "input", "textarea", "select", '[role="combobox"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="slider"]',
  '[data-slot="select-trigger"]', '[data-slot="input"]', '[contenteditable="true"]',
  "img", "picture", "canvas", "video", "iframe", "kbd",
  "table", "table *", '[role="grid"]', '[role="grid"] *',
  '[style*="background"]',
  "[data-keep-border]", "[data-keep-border] *",
  // A field drawn as a wrapper: the border belongs to the input inside.
  ':has(> input:not([type="checkbox"], [type="radio"], [type="hidden"], [type="file"]), > textarea, > select)',
].join(", ");
// States painted by a border colour (hover, focus, selected, invalid): step aside while they apply.
const STATE = [
  ':hover[class*="hover:border-"]', ':focus[class*="focus:border-"]', ':focus-visible[class*="focus-visible:border-"]',
  ':focus-within[class*="focus-within:border-"]', ':active[class*="active:border-"]',
  '[data-state="checked"][class*="data-[state=checked]:border-"]', '[data-state="active"][class*="data-[state=active]:border-"]',
  '[data-state="on"][class*="data-[state=on]:border-"]', '[aria-invalid="true"]',
  ':is(.group, [class*="group/"]):is(:hover, :focus-visible, [data-highlighted]) [class*="group-"][class*=":border-"]',
].join(", ");
const TARGET = `${BOX}${NEUTRAL}:not(${KEEP}):not(${STATE})`;

const WHITE = ":is(.bg-white, .bg-\\[\\#ffffff\\], .bg-\\[\\#fff\\], .bg-card, .bg-background, .bg-\\[\\#fafbff\\], .bg-\\[\\#fbfbff\\], .bg-gray-50, .newd\\:bg-white)";
const NO_FILL = ':not([class^="bg-"], [class*=" bg-"])';
// What a box can lie on: another box or a white surface. Only painted surfaces, by class: a
// `role="dialog"` wrapper is often the dimmed backdrop, and `<aside>` in the «Новая» design is
// a transparent holder of the floating menu panel.
const SURFACE = `:is(.border, .border-2, .newd\\:border, .bg-white, .bg-\\[\\#ffffff\\], .bg-card, .bg-background, .bg-popover)`;
// Layers that float over content keep their own opaque fill: a translucent window, menu or
// sticky bar would show the page through.
const FLOATING = ':not(.fixed, .absolute, .sticky, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], [data-radix-popper-content-wrapper] > *)';
const PRESSABLE = ':is(a, button, [role="button"], label, summary)';

const header = `/*
 * GENERATED by scripts/gen-borderless.mjs — do not edit by hand.
 * Run \`npm run borderless\` after adding a neutral border colour.
 *
 * «Без рамок» (owner, 2026-11-22): in the cabinet a neutral grey box border is
 * transparent; surfaces differ by fill. Borders stay on form fields, tables,
 * journal grids, pictures, swatches and on hovered / focused / selected /
 * invalid states. Opt out: \`data-keep-border\`.
 * ${neutral.size} neutral border colours from ${files.length} files (${relative(ROOT, SRC)}/).
 */
`;

const body = `:root,
.app-shell {
  /* Page canvas under white cards, and the soft fill of a box that lies on another surface. */
  --app-canvas: #f3f4f9;
  --app-veil: rgb(11 16 36 / 0.045);
  --app-veil-hover: rgb(11 16 36 / 0.08);
}
html[data-view-design="new"]:not(:has([data-app-theme="dark"])) :is(.app-shell, body) {
  --app-canvas: #f4f4f6;
  --app-veil: rgb(17 17 20 / 0.045);
  --app-veil-hover: rgb(17 17 20 / 0.08);
}
.app-shell[data-app-theme="dark"],
body:is([data-app-theme="dark"], :has(.app-shell[data-app-theme="dark"])) {
  --app-veil: rgb(255 255 255 / 0.06);
  --app-veil-hover: rgb(255 255 255 / 0.1);
}

@media screen {
  /* The canvas is a step darker than a card, so a card needs no outline. Dark theme has its own. */
  .app-shell:not(.mini-root, .public-theme, [data-app-theme="dark"]):is(.bg-gray-50, .bg-\\[\\#fafbff\\]) {
    background-color: var(--app-canvas);
  }

  /* 1. Neutral box border → transparent. */
  ${SCOPE} ${TARGET} {
    border-color: transparent !important;
  }

  /* A card that clips a full-bleed strip or panel: without this its own fill would show as a
     1px ring around the strip, where the border used to be. */
  ${SCOPE} ${TARGET}.overflow-hidden {
    background-clip: padding-box;
  }

  /* 2. A box without its own fill: a plain surface on the canvas… */
  ${SCOPE} ${TARGET}${NO_FILL}:not(.fixed, .absolute) {
    background-color: var(--app-surface, #ffffff);
  }
  /* So is a pale help or notice strip on the canvas (\`bg-[#f5f6ff]\`, \`bg-[#eef1ff]\`): next
     to the canvas tone it was 1.02:1, i.e. invisible. On a card it keeps its tint. */
  ${SCOPE} ${TARGET}:is(.bg-\\[\\#f5f6ff\\], .bg-\\[\\#eef1ff\\]):not(${SURFACE} *) {
    background-color: var(--app-surface, #ffffff);
  }
  /* …and a soft fill when it lies on another surface (so does a white box there). */
  ${SCOPE} ${SURFACE} ${TARGET}:is(${NO_FILL}, ${WHITE})${FLOATING} {
    background-color: var(--app-veil) !important;
  }
  ${SCOPE} ${SURFACE} ${TARGET}:is(${NO_FILL}, ${WHITE})${FLOATING}${PRESSABLE}:hover {
    background-color: var(--app-veil-hover) !important;
  }

  /* 3. Chrome: the menu and the header are set apart from the canvas by fill, not by a line. */
  ${SCOPE} :is(aside[data-app-sidebar], body > header, .app-shell > header, .app-shell header.sticky) {
    border-color: transparent !important;
  }

  /* 4. Dashed "empty slot": a soft fill instead of a dashed outline. */
  ${SCOPE} ${TARGET}.border-dashed${FLOATING} {
    background-color: var(--app-veil) !important;
  }
  ${SCOPE} ${TARGET}.border-dashed${FLOATING}${PRESSABLE}:hover {
    background-color: var(--app-veil-hover) !important;
  }
}
`;

const output = `${header}${body}`;
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    /* missing file */
  }
  if (current !== output) {
    console.error("borderless.css is stale: run `npm run borderless`");
    process.exit(1);
  }
  console.log("borderless.css is up to date");
} else {
  writeFileSync(OUT, output);
  console.log(`borderless.css: ${neutral.size} neutral border colours from ${files.length} files`);
}
