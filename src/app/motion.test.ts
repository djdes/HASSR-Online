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

test("браузер без linear() получает обычное замедление, а не теряет переходы", async () => {
  // Fallback first, the real springs under @supports — both on the site and in the QR form.
  const fallback = GLOBALS.indexOf("--spring: cubic-bezier(0.22, 1, 0.36, 1);");
  const supports = GLOBALS.indexOf("@supports (transition-timing-function: linear(0, 1)) {");
  assert.ok(fallback > 0 && supports > fallback, "сначала запасная кривая, затем пружины под @supports");
  const real = GLOBALS.slice(supports, GLOBALS.indexOf("\n}\n", supports));
  for (const token of ["--spring: linear(", "--spring-soft: linear(", "--spring-lively: linear("]) assert.ok(real.includes(token), token);
  const { QR_MOTION_CSS } = await import("@/lib/qr-motion-css");
  assert.match(QR_MOTION_CSS, /:root\{--spring:cubic-bezier\([^)]*\);--spring-soft:cubic-bezier\([^)]*\)\}\n@supports \(transition-timing-function:linear\(0,1\)\)\{:root\{--spring:linear\(/);
  for (const curve of [...GLOBALS.matchAll(/--spring(?:-soft|-lively)?: cubic-bezier\(([^)]*)\)/g)]) {
    const [, y1, , y2] = curve[1].split(",").map((value) => Number(value.trim()));
    assert.ok(y1 <= 1 && y2 <= 1, `запасная кривая без перелёта: ${curve[0]}`);
  }
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

/* ── Round 2 (spec `.agent/tasks/site-motion-round2-2026-11-22`) ─────────────────────────── */

const PRESENCE = read("src/components/motion/motion-presence.ts");

test("круг 2: модуль появления и ухода запускается из рантайма и останавливается вместе с ним", () => {
  assert.match(RUNTIME, /const stopPresence = startPresence\(\);/);
  assert.match(RUNTIME, /stopPresence\(\);/);
  assert.match(PRESENCE, /function onTree\(records: MutationRecord\[\]\): void \{\s*if \(motionOff\(\)\) return;/);
  assert.match(PRESENCE, /observer\.observe\(document\.body, \{ childList: true, subtree: true \}\)/);
});

test("круг 2, AC2: новая строка — появление и гаснущая подсветка", () => {
  assert.match(RULES, /:root :where\(tr\[data-row-new\]\) \{\s*animation: motion-row-in 0\.3s ease-out backwards;/);
  assert.match(RULES, /:root :where\(tr\[data-row-new\]\) > :where\(td, th\) \{\s*animation: motion-row-new 1\.6s ease-out backwards;/);
  assert.match(RULES, /@keyframes motion-row-new \{\s*from \{\s*background-color: color-mix\(in srgb, var\(--app-indigo, #5566f6\) 16%, transparent\);/);
  assert.match(read("src/components/journals/record-cards-view.tsx"), /data-motion-list/);
});

test("круг 2, AC3: отметка «сохранено» — только после принятого сохранения, запрос не трогаем", () => {
  assert.match(PRESENCE, /const promise = original\.call\(window, input, init\);/);
  assert.match(PRESENCE, /return promise;/, "вызывающий получает исходный ответ");
  assert.match(PRESENCE, /if \(response\.ok\) showSaved\(\);/);
  assert.match(PRESENCE, /if \(originalFetch && window\.fetch === wrappedFetch\) window\.fetch = originalFetch;/);
  assert.match(RULES, /:root :where\(\[data-motion-saved\]\) \{[^}]*animation: motion-saved 1\.4s ease-out both;/);
  assert.match(RULES, /:root\[data-view-still\] :where\(\[data-motion-saved\]\) \{\s*animation: none !important;/, "без анимации отметка всё равно видна");
});

test("круг 2, AC4: копия уходящего окна не ловит нажатия и фокус и не остаётся на странице", () => {
  for (const line of ['setAttribute("data-motion-ghost", "")', 'setAttribute("aria-hidden", "true")', 'setAttribute("inert", "")', 'removeAttribute("id")', 'removeAttribute("name")']) {
    assert.ok(PRESENCE.includes(line), line);
  }
  assert.match(PRESENCE, /window\.setTimeout\(done, SHEET_OUT_MS \+ 400\);/, "копия убирается в любом случае");
  assert.match(PRESENCE, /if \(node\.hasAttribute\("data-motion-ghost"\)\) return null;/, "уход копии не порождает новую копию");
  assert.match(PRESENCE, /:not\(\[data-slot\], \[data-state\], \[data-vaul-drawer\], \[data-motion-ghost\]\)/, "Radix и vaul не трогаем");
  assert.match(RULES, /:root :where\(\[data-motion-ghost\]\),\s*:root :where\(\[data-motion-ghost\]\) \* \{\s*animation: none !important;\s*transition: none !important;\s*pointer-events: none !important;/);
  assert.match(PRESENCE, /const WINDOW_OUT_MS = 1[0-8]\d;/);
  assert.match(PRESENCE, /const SHEET_OUT_MS = 2[0-4]\d;/);
});

test("круг 2, AC5: лист тянут за верх, закрывает его собственная кнопка", () => {
  assert.match(PRESENCE, /if \(window\.innerWidth >= PHONE_WIDTH \|\| event\.touches\.length !== 1 \|\| motionOff\(\)\) return;/);
  assert.match(PRESENCE, /if \(!close\) return; \/\/ a sheet that cannot be closed stays put/);
  assert.match(PRESENCE, /current\.close\.click\(\);/);
  assert.match(RULES, /@media \(width < 40rem\) \{[\s\S]*:has\(button > svg\.lucide-x, button\[aria-label\*="акрыть"\], button\[aria-label\*="lose"\]\),[\s\S]*background-size: 40px 4px;/);
});

test("круг 2, AC6: сегменты — общие стили и шесть переведённых групп", () => {
  const styles = read("src/components/ui/segment-styles.ts");
  assert.match(styles, /SEGMENT_TRACK_CLASS = "[^"]*bg-\[var\(--app-veil\)\][^"]*"/);
  assert.match(styles, /SEGMENT_ON_CLASS = "bg-\[var\(--app-segment-pill,#ffffff\)\]/);
  assert.doesNotMatch(styles, /border-\[|bg-\[#5566f6\]/, "без рамок и без сплошной заливки акцентом");
  const theme = read("src/app/app-theme.css");
  assert.match(theme, /--app-segment-pill: #ffffff;/);
  assert.match(theme, /--app-segment-pill: rgba\(255, 255, 255, 0\.14\);/, "в тёмной плашка светлее подложки");
  for (const file of [
    "src/components/settings/choice-pills.tsx",
    "src/app/(dashboard)/ideas/ideas-client.tsx",
    "src/app/(dashboard)/batches/page.tsx",
    "src/app/(dashboard)/edo/page.tsx",
    "src/app/(dashboard)/settings/products/page.tsx",
    "src/app/(dashboard)/settings/print-agent/labels/page.tsx",
  ]) {
    assert.match(read(file), /@\/components\/ui\/segment-styles/, file);
  }
  // A filter made of links tells the runtime which one is chosen.
  assert.match(read("src/app/(dashboard)/batches/page.tsx"), /aria-current=\{isActive \? "true" : undefined\}/);
});

test("круг 2, AC7: пустое состояние журнала — значок и тот же текст, без пунктирной рамки", () => {
  const empty = read("src/components/journals/journal-empty.tsx");
  assert.match(empty, /print:hidden/, "на бумаге остаётся только текст");
  assert.doesNotMatch(empty, /border-dashed/);
  const cards = read("src/components/journals/record-cards-view.tsx");
  assert.match(cards, /<JournalEmpty>\{emptyLabel \?\? t\("empty"\)\}<\/JournalEmpty>/);
  assert.doesNotMatch(cards, /border-dashed/);
  for (const file of ["acceptance", "climate", "equipment-maintenance", "intensive-cooling", "tracked", "traceability"]) {
    assert.match(read(`src/components/journals/${file}-document-client.tsx`), /<JournalEmpty variant="cell">/, file);
  }
});

test("круг 2, AC9: сдержанность нового модуля", () => {
  assert.doesNotMatch(PRESENCE, /will-change|gradient\(|--spring-lively|ease-out-back/);
  for (const curve of PRESENCE.matchAll(/cubic-bezier\(([^)]*)\)/g)) {
    const [, y1, , y2] = curve[1].split(",").map((value) => Number(value.trim()));
    assert.ok(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1, `кривая без подпрыгивания: ${curve[0]}`);
  }
  assert.match(RULES, /@media print \{\s*:root :where\(\[data-motion-saved\], \[data-motion-ghost\]\) \{\s*display: none;/);
});
