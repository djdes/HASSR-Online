import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the owner's rule of 2026-11-21 (spec `.agent/tasks/one-accent-unslop-2026-11-21`):
 * buttons and menu icons have one colour, the same in the light and the dark theme, and the
 * cabinet carries no decoration that reads as generated (per-item hues, gradients, glows,
 * wiggling icons). The rule lives in `app-theme.css`; these checks fail when it is undone.
 */

const ROOT = process.cwd();
const THEME = readFileSync(join(ROOT, "src/app/app-theme.css"), "utf8");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

test("у пунктов меню один тон: своих цветов по `data-tone` нет", () => {
  // The accent is declared once; the only other declaration follows a company's brand colour.
  const declaring = [...THEME.matchAll(/([^{}]+)\{[^{}]*--tone:[^{}]*\}/g)].map((match) =>
    match[1].replace(/\/\*[\s\S]*?\*\//g, "").trim(),
  );
  assert.deepEqual(declaring.sort(), ['.app-shell[data-partner-accent]:not([data-app-theme="dark"]) [data-tone]', "[data-tone]"]);
  assert.doesNotMatch(THEME, /\[data-tone="/, "нет правил под отдельные тона");
  assert.doesNotMatch(THEME, /--tone-(from|to|glow|soft)\b/, "нет градиента, свечения и цветной подложки тона");
  const base = THEME.indexOf("\n[data-tone] {");
  const tone = THEME.slice(base, THEME.indexOf("}", base));
  assert.match(tone, /--tone: var\(--app-indigo/, "тон — акцент темы, он же перекрашивает тёмную и «Новую»");
});

test("иконки меню и кнопки шапки не двигаются и не светятся", () => {
  assert.doesNotMatch(THEME, /nav-chip-(wiggle|pop)|nav-bell-ring|data-tone-button/);
  const chip = THEME.slice(THEME.indexOf("[data-nav-chip] {"), THEME.indexOf("}", THEME.indexOf("[data-nav-chip] {")));
  assert.doesNotMatch(chip, /gradient|box-shadow|background/, "иконка пункта — без плашки");
  for (const file of ["src/components/layout/header.tsx", "src/components/layout/notifications-bell.tsx"]) {
    assert.doesNotMatch(read(file), /data-tone/, `${file}: кнопки шапки нейтральные`);
  }
});

test("заливка основной кнопки в тёмной теме та же, что в светлой", () => {
  // `.bg-\[\#5566f6\] {` and the hover / checked variants must not be repainted under the dark theme.
  const repaint =
    /\[data-app-theme="dark"\][^{}]*\.(?:hover\\:bg-\\\[\\#4a5bf0\\\]:hover|bg-\\\[\\#5566f6\\\]|data-\\\[state\\=checked\\\]\\:bg-\\\[\\#5566f6\\\]\[data-state="checked"\])\s*\{/;
  assert.doesNotMatch(THEME, repaint);
});

test("светлая вуаль на фирменной заливке остаётся светлой в тёмной теме", () => {
  const rule = THEME.match(/:is\(\.bg-white\\\/5,[^)]*\)\s*\{\s*background-color: revert-layer;/);
  assert.ok(rule, "правило вуали на месте");
  for (const alpha of ["5", "10", "15", "20", "25"]) {
    assert.ok(rule[0].includes(`.bg-white\\/${alpha}`), `bg-white/${alpha}`);
  }
});

test("цветное свечение под кнопками гасится для каждого разброса тени из кода", () => {
  const covered = new Set([...THEME.matchAll(/\[class\*="_-(\d+)px_rgba\(85,102,246,"\]/g)].map((match) => match[1]));
  assert.ok(covered.size > 0, "правило нейтральной тени на месте");
  const missing = new Set<string>();
  for (const file of sourceFiles(join(ROOT, "src"))) {
    for (const match of readFileSync(file, "utf8").matchAll(/shadow-\[[^\]\s]*_-(\d+)px_rgba\(85,102,246,/g)) {
      if (!covered.has(match[1])) missing.add(`-${match[1]}px (${file.slice(ROOT.length + 1)})`);
    }
  }
  assert.deepEqual([...missing], [], "добавьте разброс в правило «Без цветного свечения» в app-theme.css");
});

test("аватар, бейдж «Премиум» и «Начальная настройка» — без градиента", () => {
  for (const file of [
    "src/components/layout/header.tsx",
    "src/components/layout/section-menu-list.tsx",
    "src/app/(dashboard)/home/page.tsx",
  ]) {
    assert.doesNotMatch(read(file), /bg-\[linear-gradient\(/, file);
  }
});
