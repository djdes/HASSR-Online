import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Guards the owner's rule of 2026-11-22 (spec `.agent/tasks/borderless-2026-11-22`): in the
 * cabinet a neutral grey box border gives way to a fill; borders stay where they mean something.
 * The layer is generated (`scripts/gen-borderless.mjs` → `src/app/borderless.css`).
 */

const CSS = readFileSync(join(process.cwd(), "src/app/borderless.css"), "utf8");

test("borderless.css собран из текущих цветов рамок в src/ (npm run borderless)", () => {
  const run = spawnSync(process.execPath, ["scripts/gen-borderless.mjs", "--check"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("рамка-коробка — светло-серая, серо-голубая или бледно-индиговая; статус и акцент — нет", async () => {
  const { isNeutralBorder } = (await import(pathToFileURL(join(process.cwd(), "scripts/borderless-neutral.mjs")).href)) as {
    isNeutralBorder: (hex: string) => boolean;
  };
  for (const hex of ["dcdfed", "ececf4", "dfe1ec", "e7e7ec", "dcdde3", "c9cee6", "e5e7eb", "dfe3ff", "dfe3fb"]) {
    assert.equal(isNeutralBorder(hex), true, `#${hex} — рамка-коробка`);
  }
  // Selected, error, warning, success, dark outline: the border is the message.
  for (const hex of ["5566f6", "ffd2cd", "ffe9b0", "c8f0d5", "bce3c8", "c8cdf7", "0b1024", "a13a32"]) {
    assert.equal(isNeutralBorder(hex), false, `#${hex} — рамка со смыслом`);
  }
});

test("рамка остаётся у полей ввода, в таблицах, у картинок и у состояний", () => {
  const rule = CSS.slice(CSS.indexOf("/* 1. Neutral box border"), CSS.indexOf("/* A card that clips"));
  assert.match(rule, /border-color: transparent !important;/);
  for (const kept of [
    "input",
    "textarea",
    "select",
    '[role="combobox"]',
    '[role="checkbox"]',
    "table *",
    '[role="grid"] *',
    "img",
    '[style*="background"]',
    "[data-keep-border]",
    ":has(> input:not(",
    ':hover[class*="hover:border-"]',
    ':focus-within[class*="focus-within:border-"]',
    '[aria-invalid="true"]',
  ]) {
    assert.ok(rule.includes(kept), `исключение ${kept}`);
  }
});

test("правило действует только в кабинете и не в печати", () => {
  assert.match(CSS, /@media screen \{/);
  const rules = CSS.slice(CSS.indexOf("@media screen {"));
  const scoped = rules.match(/^ {2}[^\s/}][^{]*\{/gm) ?? [];
  assert.ok(scoped.length >= 8);
  for (const selector of scoped) {
    assert.match(selector, /app-shell:not\(\.mini-root, \.public-theme/, selector.slice(0, 80));
  }
});

test("окна, меню и прилипающие панели не становятся полупрозрачными", () => {
  const veil = CSS.split("\n").filter((line) => line.includes("var(--app-veil)") || line.includes("background-color: var(--app-veil"));
  assert.ok(veil.length > 0);
  const veilRules = [...CSS.matchAll(/^ {2}(body:has[^{]*)\{\s*background-color: var\(--app-veil(?:-hover)?\) !important;/gm)].map((match) => match[1]);
  assert.ok(veilRules.length >= 4, "правила мягкой заливки на месте");
  for (const selector of veilRules) {
    assert.ok(selector.includes(':not(.fixed, .absolute, .sticky, [role="dialog"]'), "всплывающие слои исключены");
  }
});
