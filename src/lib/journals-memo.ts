/**
 * Памятка по заполнению журналов (09.11.2026) — лист А4 с «Сегодня»: по
 * строке на журнал, слева название, справа — как часто заполнять.
 *
 * Лист обязан уместиться на одну страницу, а журналов бывает от пяти до
 * всего каталога, поэтому кегль и отступы строк при печати зависят от
 * числа строк. Пороги подобраны по печати из Chromium: полный каталог
 * (46 журналов) в самой плотной раскладке занимает одну страницу А4.
 */
export type MemoDensity = "roomy" | "normal" | "compact" | "dense";

export function memoDensity(rowCount: number): MemoDensity {
  if (rowCount <= 16) return "roomy";
  if (rowCount <= 26) return "normal";
  if (rowCount <= 36) return "compact";
  return "dense";
}

/**
 * Печать по плотности: кегль строки (pt), вертикальный отступ ячейки (мм)
 * и межстрочный интервал. Страница отдаёт их таблице CSS-переменными
 * `--memo-fs`, `--memo-py`, `--memo-lh` — на экране они не действуют.
 */
export const MEMO_PRINT: Record<MemoDensity, { fontPt: number; padMm: number; lineHeight: number }> = {
  roomy: { fontPt: 11, padMm: 2.2, lineHeight: 1.35 },
  normal: { fontPt: 9.5, padMm: 1.5, lineHeight: 1.3 },
  compact: { fontPt: 8.5, padMm: 0.9, lineHeight: 1.25 },
  dense: { fontPt: 7.5, padMm: 0.5, lineHeight: 1.15 },
};
