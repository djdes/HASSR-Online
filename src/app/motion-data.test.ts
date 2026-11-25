import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { countFrame, easeOutCubic, formatCount, sampleLinear } from "@/components/motion/motion-number-model";

/**
 * Guards motion round 4 (`src/app/motion-data.css`, `MotionNumber`): bars grow, rings draw,
 * numbers count — on the soft spring, and not at all under «Без анимации» or «Reduce motion».
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const CSS = read("src/app/motion-data.css");
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const NUMBER = read("src/components/motion/motion-number.tsx");

test("motion-data.css подключён в корневом layout после motion.css", () => {
  const layout = read("src/app/layout.tsx");
  const motion = layout.indexOf('import "./motion.css"');
  const data = layout.indexOf('import "./motion-data.css"');
  assert.ok(motion >= 0 && data > motion);
});

test("всё движение — только при no-preference и без data-view-still", () => {
  const open = RULES.indexOf("@media (prefers-reduced-motion: no-preference)");
  assert.ok(open >= 0, "правила внутри prefers-reduced-motion: no-preference");
  assert.equal(RULES.slice(0, open).trim(), "", "вне медиа-запроса правил нет");
  const selectors = [...RULES.matchAll(/(^|[{}])\s*([^{}@]+)\{/g)].map((match) => match[2].trim()).filter(Boolean);
  assert.ok(selectors.length >= 4);
  for (const selector of selectors) {
    for (const part of selector.split(",")) {
      assert.match(part.trim(), /^:root:not\(\[data-view-still\]\) :where\(/, `выключатель на селекторе: ${part.trim()}`);
    }
  }
});

test("полосы и кольца едут на мягкой пружине и появляются из нуля", () => {
  assert.match(RULES, /transition-property: width[^;]*;/);
  assert.match(RULES, /transition-property: stroke-dasharray[^;]*;/);
  assert.equal((RULES.match(/var\(--spring-soft\)/g) ?? []).length, 2);
  assert.match(RULES, /@starting-style \{[\s\S]*width: 0 !important;[\s\S]*stroke-dasharray: 0 1000;/);
});

test("без свечения, градиентов, will-change и hover", () => {
  assert.doesNotMatch(RULES, /will-change|gradient|:hover|box-shadow|filter|infinite/);
});

test("MotionNumber уважает выключатели и не считает при гидрации", () => {
  assert.match(NUMBER, /data-view-still/);
  assert.match(NUMBER, /prefers-reduced-motion: reduce/);
  assert.match(NUMBER, /useSyncExternalStore\(noop, \(\) => true, \(\) => false\)/);
  assert.match(NUMBER, /nodeValue/);
  assert.doesNotMatch(NUMBER, /textContent =/);
});

test("formatCount: как на странице до замены", () => {
  assert.equal(formatCount(42), "42");
  assert.equal(formatCount(41.6), "42");
  assert.equal(formatCount(3.25, { fractionDigits: 1 }), "3.3");
  assert.equal(formatCount(1234567, { group: true }), (1234567).toLocaleString("ru-RU"));
});

test("countFrame не уходит за цель, даже если пружина перелетает", () => {
  assert.equal(countFrame(0, 100, 0), 0);
  assert.equal(countFrame(0, 100, 0.5), 50);
  assert.equal(countFrame(0, 100, 1.02), 100);
  assert.equal(countFrame(80, 20, 1.02), 20);
  assert.equal(countFrame(80, 20, -0.1), 80);
});

test("sampleLinear читает linear() токена, иначе — ease-out", () => {
  const globals = read("src/app/globals.css");
  const token = globals.match(/--spring-soft:\s*(linear\([^)]*\))/);
  assert.ok(token);
  const ease = sampleLinear(token[1]);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  let peak = 0;
  for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, ease(t));
  assert.ok(peak <= 1.05, `перелёт ${peak}`);
  assert.equal(sampleLinear("cubic-bezier(0.25, 1, 0.5, 1)"), easeOutCubic);
  assert.equal(sampleLinear("linear(0, 0.5, 1)")(0.25), 0.25);
});

test("полосы кабинета помечены data-meter", () => {
  const marked = [
    "src/components/journals/today-progress-strip.tsx",
    "src/components/dashboard/quick-start-card-client.tsx",
    "src/components/dashboard/org-health-widget.tsx",
    "src/components/production-control/ppk-progress-bar.tsx",
    "src/components/task-fill/task-fill-checklist.tsx",
    "src/app/(dashboard)/plans/page.tsx",
    "src/app/root/mailing/monitor-tab.tsx",
  ];
  for (const file of marked) assert.match(read(file), /data-meter\b/, file);
  assert.match(read("src/app/(dashboard)/monitoring/page.tsx"), /data-meter="ring"/);
});
