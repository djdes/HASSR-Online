import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards motion round 4 (`src/app/motion-disclosure.css`): disclosure, toasts, loading, stagger,
 * messages. Same restraint as round 1 (`motion.test.ts`): springs from globals.css, no visible
 * overshoot, no decoration, everything off under «Без анимации» and «Reduce motion».
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const CSS = read("src/app/motion-disclosure.css");
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function block(start: string): string {
  const from = RULES.indexOf(start);
  assert.ok(from >= 0, `есть блок: ${start}`);
  let depth = 0;
  for (let index = RULES.indexOf("{", from); index < RULES.length; index += 1) {
    if (RULES[index] === "{") depth += 1;
    if (RULES[index] === "}" && --depth === 0) return RULES.slice(from, index + 1);
  }
  throw new Error(`блок не закрыт: ${start}`);
}

test("слой подключён после motion.css", () => {
  const layout = read("src/app/layout.tsx");
  const motion = layout.indexOf('import "./motion.css"');
  const disclosure = layout.indexOf('import "./motion-disclosure.css"');
  assert.ok(motion >= 0 && disclosure > motion);
});

test("сдержанность: без will-change, свечения, градиентов и движения на наведении", () => {
  assert.doesNotMatch(RULES, /will-change/);
  assert.doesNotMatch(RULES, /gradient\(/);
  assert.doesNotMatch(RULES, /box-shadow:\s*0 0 \d+px/, "нет свечения");
  assert.doesNotMatch(RULES, /filter:\s*(blur|drop-shadow)/);
  assert.doesNotMatch(RULES, /:hover/, "ничего не движется от наведения");
  assert.doesNotMatch(RULES, /#[0-9a-f]{3,8}\b/i, "без своих цветов: слой только про движение");
});

test("кривые: пружины из globals.css, cubic-bezier без перелёта выше 5 %", () => {
  for (const match of RULES.matchAll(/cubic-bezier\(([^)]*)\)/g)) {
    const [, y1, , y2] = match[1].split(",").map((value) => Number(value.trim()));
    assert.ok(y1 >= 0 && y1 <= 1.05 && y2 >= 0 && y2 <= 1.05, `перелёт: ${match[0]}`);
  }
  assert.doesNotMatch(RULES, /linear\(\s*0/, "пружины не копируются — берём токены");
  assert.match(RULES, /var\(--spring\)/);
  assert.match(RULES, /var\(--spring-soft\)/);
  assert.doesNotMatch(RULES, /--spring-lively/, "живая пружина — только для мелких ручек");
});

test("ключевые кадры: только прозрачность и короткий сдвиг, масштаб не меньше 0.96", () => {
  for (const match of RULES.matchAll(/scale:\s*([\d.]+)/g)) {
    assert.ok(Number(match[1]) >= 0.96 && Number(match[1]) <= 1, `scale ${match[1]}`);
  }
  for (const match of RULES.matchAll(/translate:\s*0 (-?\d+)px/g)) {
    assert.ok(Math.abs(Number(match[1])) <= 8, `сдвиг ${match[1]}px`);
  }
  for (const match of RULES.matchAll(/(?:animation|transition)-duration:\s*([^;]+);/g)) {
    for (const value of match[1].split(",")) {
      const seconds = value.trim().endsWith("ms") ? parseFloat(value) / 1000 : parseFloat(value);
      assert.ok(seconds <= 2, `длительность ${value.trim()}`);
    }
  }
});

test("раскрытие: высота <details> по guide accordion, позади совместимый фолбэк", () => {
  const open = block(":root :where(details:not(.motion-faq, .mini-root *))::details-content {");
  assert.match(open, /interpolate-size: allow-keywords;/);
  assert.match(open, /transition-property: block-size, opacity, content-visibility;/);
  assert.match(open, /transition-behavior: allow-discrete;/);
  assert.ok(open.indexOf("transition-behavior") > open.indexOf("transition-property"), "allow-discrete — после transition");
  assert.doesNotMatch(open, /contain:\s*layout/, "не ловим fixed-окна внутри секции");
  assert.match(RULES, /:not\(\[open\]\)\)::details-content \{\s*block-size: 0;/);
});

test("рассыпание: sibling-index() под @supports с литералом, фолбэк на :nth-child, не больше семи шагов", () => {
  assert.match(RULES, /@supports \(animation-delay: calc\(sibling-index\(\) \* 0\.1s\)\)/);
  assert.match(RULES, /@supports not \(animation-delay: calc\(sibling-index\(\) \* 0\.1s\)\)/);
  assert.match(RULES, /min\(sibling-index\(\) - 1, 6\)/);
  assert.doesNotMatch(RULES, /@supports[^{]*var\(/, "в @supports нет var()");
});

test("всё выключается: data-view-still и prefers-reduced-motion", () => {
  const still = RULES.split("\n").filter((line) => line.includes(":root[data-view-still]")).join("\n");
  const stillRules = RULES.slice(RULES.indexOf(":root[data-view-still]"));
  for (const hook of [
    "details)::details-content",
    'summary :is(svg, span)[class*="group-open"]',
    "[data-more-text-rest]",
    '[aria-busy="true"]',
    "[data-motion-stagger] > *",
    '[role="alert"]',
    '[data-slot="form-message"]',
    "[data-motion-empty]",
    ".skeleton-shimmer)::after",
    "[data-sonner-toast]",
  ]) {
    assert.ok(stillRules.includes(hook), `«Без анимации» выключает: ${hook}`);
  }
  assert.ok(still.length > 0);
  const reduce = block("@media (prefers-reduced-motion: reduce)");
  assert.match(reduce, /::details-content \{\s*transition: none;/);
  assert.match(reduce, /\[data-sonner-toast\]\) \{\s*scale: none !important;/);
  // Появления (рассыпание, сообщения) включаются только при no-preference — guide `motion`.
  for (const name of ["motion-stagger-in", "motion-note-in", "motion-empty-in"]) {
    const use = RULES.indexOf(`animation: ${name}`);
    const gate = RULES.lastIndexOf("@media (prefers-reduced-motion: no-preference)", use);
    assert.ok(use > 0 && gate >= 0 && gate < use, `${name} — под no-preference`);
  }
});

test("тосты: палец на тосте и смахивание остаются за sonner, уход быстрее прихода", () => {
  assert.match(RULES, /:not\(\[data-swiping="true"\], \[data-swipe-out="true"\]\)/);
  const enter = RULES.match(/transition-duration: 0\.5s, 0\.3s, 0\.45s, 0\.2s, 0\.5s;/);
  const leave = RULES.match(/\[data-removed="true"\]:not[^{]*\{\s*transition-duration: 0\.24s/);
  assert.ok(enter && leave);
});

test("компоненты несут свои метки", () => {
  assert.match(read("src/components/ui/more-text.tsx"), /data-more-text-rest/);
  assert.match(read("src/components/journals/journals-browser.tsx"), /data-motion-empty/);
  assert.match(read("src/app/baza-znaniy/page.tsx"), /data-motion-stagger/);
});
