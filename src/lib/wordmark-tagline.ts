/**
 * Подпись под знаком «сетап» на главной — ровно по ширине знака, как на
 * визитке (владелец, 2026-10-29: «по ширине как логотип, чтобы симметрично»).
 *
 * Подпись рисуется SVG-текстом в рамке `TAGLINE_VIEW_WIDTH` единиц, а рамка
 * растягивается на ширину знака. `textLength` дотягивает строку до края
 * точно, при любом шрифте; размер шрифта подбираем по длине строки, чтобы
 * растяжка была едва заметной (буквы не слипаются и не разлетаются).
 * Подпись переводится (RU/EN/UZ, редактор переводов), поэтому ширину
 * оцениваем по классам символов, а не по таблице одной строки.
 */

export const TAGLINE_VIEW_WIDTH = 1000;

/**
 * Средняя ширина символа Manrope 600 в em (замер в браузере, 2026-10-29):
 * по ним «Ваш электронный ХАССП» — 12.6 em при настоящих 12.39 em.
 */
const EM = {
  cyrillicLower: 0.613,
  cyrillicUpper: 0.707,
  latinLower: 0.543,
  latinUpper: 0.65,
  digit: 0.578,
  space: 0.2,
  other: 0.45,
} as const;

/** Короче этого (в em) строку не растягиваем — буквы разлетелись бы. */
const MIN_STRETCH_EM = 9;

export function estimateTaglineEm(text: string): number {
  let em = 0;
  for (const char of text) {
    if (/[а-яё]/.test(char)) em += EM.cyrillicLower;
    else if (/[А-ЯЁ]/.test(char)) em += EM.cyrillicUpper;
    else if (/[a-z]/.test(char)) em += EM.latinLower;
    else if (/[A-Z]/.test(char)) em += EM.latinUpper;
    else if (/\d/.test(char)) em += EM.digit;
    else if (/\s/.test(char)) em += EM.space;
    else em += EM.other;
  }
  return em;
}

export type TaglineLayout = {
  /** Размер шрифта в единицах рамки. */
  fontSize: number;
  /** Высота рамки (viewBox) и базовая линия текста. */
  height: number;
  baseline: number;
  /** Дотягивать ли строку до ширины знака (`textLength`). */
  stretch: boolean;
};

export function taglineLayout(text: string): TaglineLayout {
  const em = Math.max(estimateTaglineEm(text.trim()), 1);
  const stretch = em >= MIN_STRETCH_EM;
  const fontSize = Math.round((TAGLINE_VIEW_WIDTH / Math.max(em, MIN_STRETCH_EM)) * 10) / 10;
  // Прописные с надстрочными знаками поднимаются на 0.75 em, нижние выносные
  // опускаются на 0.26 em: базовая линия на 0.82, рамка — 1.1 em.
  return {
    fontSize,
    height: Math.round(fontSize * 1.1),
    baseline: Math.round(fontSize * 0.82),
    stretch,
  };
}
