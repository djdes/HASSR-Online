import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the motion layer (spec `.agent/tasks/site-motion-2026-11-22`): one language of motion
 * for the cabinet, the Mini App, QR pages and windows — springs with a barely visible overshoot,
 * nothing decorative, everything off under «Без анимации».
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const MOTION = read("src/app/motion.css");
const RULES = MOTION.replace(/\/\*[\s\S]*?\*\//g, "");
const GLOBALS = read("src/app/globals.css");
const RUNTIME = read("src/components/motion/motion-runtime.tsx");

/** Largest value of a `linear()` spring token — its overshoot above 1. */
function springPeak(token: string): number {
  const match = GLOBALS.match(new RegExp(`${token}:\\s*linear\\(([^)]*)\\)`));
  assert.ok(match, `${token} объявлен в globals.css`);
  return Math.max(...match[1].split(",").map((value) => Number(value.trim())));
}

test("AC1: слой подключён после app-theme.css, рантайм — в корневом layout", () => {
  const layout = read("src/app/layout.tsx");
  const theme = layout.indexOf('import "./app-theme.css"');
  const motion = layout.indexOf('import "./motion.css"');
  assert.ok(theme >= 0 && motion > theme, "motion.css идёт после app-theme.css");
  assert.match(layout, /<MotionRuntime \/>/);
});

test("AC1: правила слоя начинаются с :root и держат списки в :where()", () => {
  // `.app-shell *` в app-theme.css — специфичность 0-1-0; слой выигрывает порядком, а не весом.
  const selectors = [...RULES.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((match) => match[2].trim()).filter(Boolean);
  const layered = RULES.slice(RULES.indexOf("@layer base"), RULES.indexOf("}\n}", RULES.indexOf("@layer base")));
  assert.ok(selectors.length > 30, `правил в слое: ${selectors.length}`);
  for (const selector of selectors) {
    if (/^(from|to|\d+%)/.test(selector)) continue; // keyframes
    if (layered.includes(selector)) continue; // базовый слой: там правило слабее любых утилит
    for (const part of selector.split(/,\s*\n?(?=:root|\s*:root)/)) {
      assert.match(part.trim(), /^:root/, `селектор начинается с :root: ${part.trim().slice(0, 70)}`);
    }
  }
  assert.doesNotMatch(RULES, /\.app-shell/, "слой не привязан к кабинету: он общий для всех экранов");
});

test("AC1: общее правило кабинета не трогает элементы со своим движением", () => {
  const theme = read("src/app/app-theme.css");
  assert.match(
    theme,
    /\.app-shell,\s*\.app-shell :where\(:not\(\.motion-submit, \.motion-submit-label, \.motion-fab, \.motion-liquid, \.motion-knob, \.motion-card-arrow\)\) \{\s*transition-property: background-color, border-color, color, box-shadow;/,
  );
});

test("AC2: нажатие — три ступени сжатия, пружинный возврат, без серой вспышки", () => {
  assert.match(RULES, /--press-scale: 0\.97;/);
  assert.match(RULES, /--press-scale: 0\.985;/);
  assert.match(RULES, /--press-scale: 0\.92;/);
  assert.match(RULES, /:active \{\s*scale: var\(--press-scale\);/);
  assert.match(RULES, /-webkit-tap-highlight-color: transparent;/);
  const press = RULES.slice(RULES.indexOf("--press-scale: 0.97;"), RULES.indexOf("--press-scale: 0.985;"));
  assert.match(press, /transition-property: [^;]*\bscale\b[^;]*;/);
  assert.doesNotMatch(press, /transition-property: [^;]*\btransform\b/, "`transform` двигают перетаскивание и листы — его не анимируем");
  assert.match(press, /var\(--spring\)/);
  for (const skipped of [":disabled", '[aria-disabled="true"]', "[aria-roledescription]", '[data-press="off"]']) {
    assert.ok(RULES.includes(skipped), `не сжимается: ${skipped}`);
  }
});

test("AC3: кольцо поля распускается на пружине, каретка — в акцент", () => {
  assert.match(RULES, /caret-color: var\(--app-indigo, #5566f6\);/);
  assert.match(RULES, /:focus \{\s*transition-duration: 0\.18s, 0\.18s, 0\.18s, 0\.18s, 0\.42s, 0\.5s;\s*transition-timing-function: ease, ease, ease, ease, var\(--spring\), var\(--spring\);/);
  assert.match(RULES, /:focus::placeholder \{\s*opacity: 0\.6;/);
  assert.match(RULES, /@layer base \{[\s\S]*:focus-visible \{[\s\S]*box-shadow: 0 0 0 4px/);
  assert.match(RULES, /:not\(table \*, \[role="grid"\] \*, \[class\*="focus-within"\] \*\)/, "кольцо по умолчанию — не в таблицах и не в составных полях");
});

test("AC4, AC5: ручка переключателя и галочка", () => {
  assert.match(RULES, /\[role="switch"\]\) :where\(span:empty:only-child, div:empty:only-child\):where\(\[class~="rounded-full"\]\) \{[^}]*var\(--spring-soft\)/);
  assert.match(RULES, /\[role="switch"\]:not\(:disabled\)\):active[\s\S]*?scale: 1\.18 1;/);
  assert.match(RULES, /\[data-ticked\]\) :where\(svg\) :where\(path, polyline, line\) \{\s*stroke-dasharray: 24;\s*animation: motion-tick/);
  assert.match(RUNTIME, /setAttribute\("data-ticked", ""\)/);
  assert.match(RUNTIME, /change === "gained"\) tick\(element\)/, "галочка рисуется при отметке, а не при загрузке");
});

test("AC6: фигура перетекания — псевдоэлемент группы, у краёв свои пружины", () => {
  assert.match(RULES, /\[data-liquid-host="before"\]\)::before,\s*:root :where\(\[data-liquid-host="after"\]\)::after \{/);
  assert.match(RULES, /z-index: -1;/);
  assert.match(RULES, /isolation: isolate;/);
  for (const direction of ["right", "left", "down", "up"]) {
    const start = RULES.indexOf(`[data-liquid-dir="${direction}"])::before`);
    const rule = RULES.slice(start, RULES.indexOf("}", start));
    assert.match(rule, /0\.36s var\(--lq-lead, var\(--spring\)\)/, `${direction}: передний край быстрее`);
    assert.match(rule, /0\.6s var\(--spring-soft\) 0\.04s/, `${direction}: задний край отстаёт`);
  }
  assert.match(RULES, /\[data-liquid-phase="set"\]\)::before,[\s\S]*?transition: none;/);
  assert.match(RUNTIME, /data-liquid="off"/, "отключение перетекания для группы");
  assert.doesNotMatch(RUNTIME, /appendChild|insertBefore|createElement/, "рантайм не добавляет узлы в дерево React");
});

test("AC7: самодельные окна появляются, лист на телефоне — без перелёта", () => {
  assert.match(RULES, /@keyframes motion-window-in \{\s*from \{\s*opacity: 0;\s*scale: 0\.96;/);
  assert.match(RULES, /animation: motion-window-in 0\.3s var\(--spring\) backwards;/);
  assert.match(RULES, /@media \(width < 40rem\) \{[\s\S]*animation: motion-sheet-in 0\.45s var\(--spring-soft\) backwards;/);
  assert.doesNotMatch(RULES, /animation: motion-(window|sheet|fade)-in[^;]*\b(both|forwards)\b/, "после анимации на окне не остаётся transform");
  const menu = read("src/components/ui/menu-styles.ts");
  assert.match(menu, /data-\[state=open\]:ease-\(--spring\)/);
  assert.match(menu, /data-\[state=open\]:duration-300/);
  assert.match(menu, /data-\[state=closed\]:duration-100/);
  const dialog = read("src/components/ui/dialog.tsx");
  assert.match(dialog, /data-\[state=open\]:ease-\(--spring\)/);
  assert.match(dialog, /max-sm:data-\[state=open\]:ease-\(--spring-soft\)/);
});

test("AC8: страница проявляется только прозрачностью", () => {
  const fade = RUNTIME.slice(RUNTIME.indexOf("[data-page-area]"));
  assert.match(fade, /\[\{ opacity: 0 \}, \{ opacity: 1 \}\]/);
  assert.match(RUNTIME, /const PAGE_MS = 2[0-4]\d;/, "не дольше 0,25 с");
  assert.match(RUNTIME, /before === null \|\| before === pathname/, "первая загрузка не анимируется");
  assert.match(read("src/components/layout/section-frame.tsx"), /data-page-area=\{shell === "site" \? "" : undefined\}/);
});

test("AC9: мини-приложение на тех же пружинах, знак «готово» без подпрыгивания", () => {
  const mini = read("src/app/mini/mini-theme.css");
  const press = mini.slice(mini.indexOf(".mini-press {"), mini.indexOf("}", mini.indexOf(".mini-press:active {")));
  assert.match(press, /scale 0\.5s var\(--spring\)/);
  assert.match(press, /\.mini-press:active \{\s*scale: 0\.97;/);
  assert.doesNotMatch(press, /transform:/, "то же свойство, что у общего нажатия, — сжатия не перемножаются");
  assert.match(mini, /\.mini-input:focus \{[^}]*box-shadow 0\.42s var\(--spring\)/);
  assert.match(mini, /\.mini-nav-tab \{[^}]*scale 0\.5s var\(--spring\)/);
  assert.match(GLOBALS, /\.qr-success-pop \{ animation: qr-success-pop 0\.5s var\(--spring\) both; \}/);
});

test("AC9: форма журнала по QR-коду — те же пружины, что у сайта", async () => {
  const { QR_MOTION_CSS, SPRING_EASING, SPRING_SOFT_EASING } = await import("@/lib/qr-motion-css");
  const { QR_FILL_CSS } = await import("@/lib/journal-fill-html");
  const token = (name: string) => GLOBALS.match(new RegExp(`${name}:\\s*(linear\\([^)]*\\));`))?.[1];
  assert.equal(SPRING_EASING, token("--spring"), "--spring совпадает с globals.css");
  assert.equal(SPRING_SOFT_EASING, token("--spring-soft"), "--spring-soft совпадает с globals.css");
  assert.ok(QR_FILL_CSS.includes(QR_MOTION_CSS), "движение подключено в стили формы");
  assert.match(QR_MOTION_CSS, /\.btn:active:not\(:disabled\),[^{]*\{scale:\.97\}/);
  assert.match(QR_MOTION_CSS, /\.in:focus,\.qp-pin:focus\{[^}]*box-shadow \.42s var\(--spring\)\}/);
  assert.match(QR_MOTION_CSS, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*transition:none[\s\S]*scale:none/);
  assert.doesNotMatch(QR_MOTION_CSS, /will-change|gradient\(|:hover/);
});

test("AC10: сдержанность — перелёт пружин не больше 5 %, без свечений, градиентов и will-change", () => {
  assert.ok(springPeak("--spring") <= 1.02, "--spring: перелёт ~1,5 %");
  assert.ok(springPeak("--spring-soft") <= 1.005, "--spring-soft: без перелёта");
  assert.ok(springPeak("--spring-lively") <= 1.05, "--spring-lively: не больше 5 %");
  for (const source of [RULES, RUNTIME]) {
    assert.doesNotMatch(source, /will-change/);
    assert.doesNotMatch(source, /gradient\(/);
    assert.doesNotMatch(source, /ease-out-back|--spring-lively/, "живую пружину слой не использует");
    // Any hand-written curve must stay inside 0…1 on the value axis (no bounce).
    for (const curve of source.matchAll(/cubic-bezier\(([^)]*)\)/g)) {
      const [, y1, , y2] = curve[1].split(",").map((value) => Number(value.trim()));
      assert.ok(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1, `кривая без подпрыгивания: ${curve[0]}`);
    }
  }
  assert.doesNotMatch(RULES, /:hover/, "по наведению ничего не двигается");
  assert.doesNotMatch(RULES, /drop-shadow|text-shadow/);
});

test("AC11: «Без анимации» и «Уменьшить движение» выключают слой, рантайм молчит", () => {
  const still = RULES.slice(RULES.indexOf(":root[data-view-still]"));
  assert.match(still, /:root\[data-view-still\][\s\S]*?:active,[\s\S]*?scale: none;/);
  assert.match(still, /:root\[data-view-still\] :where\(\[data-liquid-host\]\)::before,[\s\S]*?content: none;/);
  assert.match(RULES, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*scale: none;[\s\S]*animation: none;[\s\S]*content: none;/);
  assert.match(RULES, /@media print \{[\s\S]*content: none;/);
  assert.match(RUNTIME, /function motionOff\(\): boolean \{\s*if \(document\.documentElement\.hasAttribute\("data-view-still"\)\) return true;/);
  assert.match(RUNTIME, /function onMutations\(records: MutationRecord\[\]\): void \{\s*if \(motionOff\(\)\) return;/);
  // The global «Без анимации» rule zeroes every duration — the layer relies on it for keyframes.
  assert.match(read("src/app/view-prefs.css"), /:root\[data-view-still\] \*::after \{\s*animation-duration: 0\.01ms !important;/);
});
