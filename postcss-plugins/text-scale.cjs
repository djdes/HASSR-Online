/**
 * PostCSS-плагин «Размер текста» (Настройки → Оформление → Удобство чтения).
 *
 * Кегли в проекте — пиксельные классы Tailwind (`text-[13px]`, `sm:text-[15px]`,
 * `text-sm`, `leading-[18px]`, `clamp()` у заголовков) и ручные правила в CSS.
 * Поменять размер корня (`html { font-size }`) их не увеличит, а переписать
 * тысячи классов — нельзя. Поэтому при сборке каждое объявление кегля и
 * межстрочного интервала умножается на CSS-переменную:
 *
 *   font-size: 13px          →  font-size: calc(13px * var(--app-text-scale, 1))
 *   font-size: var(--text-sm) →  font-size: calc(var(--text-sm) * var(--app-text-scale, 1))
 *   font-size: 26px          →  font-size: calc(26px * var(--app-heading-scale, 1))
 *
 * По умолчанию переменные не заданы — множитель 1, страница та же, что была.
 * Значения переменных ставит `src/app/view-prefs.css` по атрибуту
 * `data-view-text` на `<html>`; при печати они всегда 1.
 *
 * Правила:
 *  - кегль < 20px — основной текст (`--app-text-scale`);
 *  - 20–31px — подзаголовки и заголовки (`--app-heading-scale`, растут меньше);
 *  - от 32px — крупные заголовки лендинга не трогаем: они и так большие, а
 *    на узком телефоне иначе вылезли бы за край;
 *  - относительные значения (em, %, ключевые слова) не трогаем — они растут
 *    вместе с родителем;
 *  - `@media print` и `@keyframes` не трогаем.
 *
 * Чистые функции экспортируются для тестов (`src/lib/text-scale-plugin.test.ts`).
 */

const TEXT_SCALE_VAR = "--app-text-scale";
const HEADING_SCALE_VAR = "--app-heading-scale";
/** С этого кегля — «заголовочный» множитель. */
const HEADING_FROM_PX = 20;
/** С этого кегля не масштабируем. */
const UNSCALED_FROM_PX = 32;
const ROOT_FONT_PX = 16;

/** Кегли Tailwind по умолчанию (`--text-*`), px. */
const TAILWIND_TEXT_PX = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
  "7xl": 72,
  "8xl": 96,
  "9xl": 128,
};

/** Свойства кегля и межстрочного интервала. `--tw-leading` — так Tailwind передаёт `leading-*` в `text-*`. */
const FONT_SIZE_PROPS = new Set(["font-size"]);
const LINE_HEIGHT_PROPS = new Set(["line-height", "--tw-leading"]);

/**
 * Самая большая абсолютная длина в значении, px (px, rem, `var(--text-*)`).
 * Нет абсолютных длин — null (em, %, ключевые слова, unitless).
 */
function largestAbsolutePx(value, { withTextVars }) {
  let largest = null;
  const take = (px) => {
    if (!Number.isFinite(px)) return;
    largest = largest === null ? px : Math.max(largest, px);
  };
  for (const match of value.matchAll(/(-?\d*\.?\d+)(px|rem)(?![a-z-])/gi)) {
    const number = Number(match[1]);
    take(match[2].toLowerCase() === "rem" ? number * ROOT_FONT_PX : number);
  }
  if (withTextVars) {
    for (const match of value.matchAll(/var\(\s*--text-([a-z0-9]+)\s*[,)]/gi)) {
      const px = TAILWIND_TEXT_PX[match[1]];
      if (px !== undefined) take(px);
    }
  }
  return largest;
}

/** Какой множитель нужен кеглю такого размера; null — не масштабировать. */
function scaleVarForPx(px) {
  if (px === null || !(px > 0)) return null;
  if (px >= UNSCALED_FROM_PX) return null;
  return px >= HEADING_FROM_PX ? HEADING_SCALE_VAR : TEXT_SCALE_VAR;
}

/**
 * Новое значение свойства или null, если менять не надо.
 * `prop` — `font-size`, `line-height` или `--tw-leading`.
 */
function scaleDeclarationValue(prop, value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  if (raw.includes(TEXT_SCALE_VAR) || raw.includes(HEADING_SCALE_VAR)) return null;
  const isFontSize = FONT_SIZE_PROPS.has(prop);
  const isLineHeight = LINE_HEIGHT_PROPS.has(prop);
  if (!isFontSize && !isLineHeight) return null;
  // Межстрочный интервал: только длины px/rem. Без единиц и в em он и так
  // растёт вместе с кеглем.
  const largest = largestAbsolutePx(raw, { withTextVars: isFontSize });
  const scaleVar = scaleVarForPx(largest);
  if (!scaleVar) return null;
  return `calc(${raw} * var(${scaleVar}, 1))`;
}

/** Внутри `@media print` или `@keyframes` — не трогаем. */
function isInsideSkippedAtRule(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type !== "atrule") continue;
    const name = String(parent.name || "").toLowerCase();
    if (name.endsWith("keyframes")) return true;
    if (name === "media" && /(^|[\s,(])print\b/i.test(String(parent.params || ""))) return true;
  }
  return false;
}

function textScalePlugin() {
  return {
    postcssPlugin: "wesetup-text-scale",
    // После Tailwind: его `Once` уже развернул утилиты в обычные правила.
    OnceExit(root) {
      root.walkDecls((decl) => {
        const prop = String(decl.prop || "").toLowerCase();
        if (!FONT_SIZE_PROPS.has(prop) && !LINE_HEIGHT_PROPS.has(prop)) return;
        if (isInsideSkippedAtRule(decl)) return;
        const next = scaleDeclarationValue(prop, decl.value);
        if (next !== null) decl.value = next;
      });
    },
  };
}
textScalePlugin.postcss = true;

module.exports = textScalePlugin;
module.exports.scaleDeclarationValue = scaleDeclarationValue;
module.exports.scaleVarForPx = scaleVarForPx;
module.exports.largestAbsolutePx = largestAbsolutePx;
module.exports.TEXT_SCALE_VAR = TEXT_SCALE_VAR;
module.exports.HEADING_SCALE_VAR = HEADING_SCALE_VAR;
module.exports.HEADING_FROM_PX = HEADING_FROM_PX;
module.exports.UNSCALED_FROM_PX = UNSCALED_FROM_PX;
