import type { QrPrintFormat } from "@/lib/qr-fill-types";

/**
 * Раскладка смешанной печати QR-кодов по листам A4 (чистый модуль, без DOM).
 *
 *   • A4       — один плакат на лист;
 *   • A5       — два на лист, половинки с линией реза;
 *   • наклейка — 12 на лист, сетка 3 × 4.
 *
 * Листы режем в JS, а не надеемся на `break-inside` внутри grid/flex:
 * `break-after` работает только у блочных коробок, поэтому каждый лист —
 * отдельный блок, прямой потомок корня печати. Порядок листов — по первому
 * появлению формата в выборе; внутри формата — порядок карточек на экране.
 */

export const QR_PRINT_PER_SHEET: Readonly<Record<QrPrintFormat, number>> = Object.freeze({
  a4: 1,
  a5: 2,
  sticker: 12,
});

export type QrPrintEntry = { key: string; format: QrPrintFormat };
export type QrPrintPage = { format: QrPrintFormat; keys: string[] };

export function composeQrPrintPages(entries: ReadonlyArray<QrPrintEntry>): QrPrintPage[] {
  const byFormat = new Map<QrPrintFormat, string[]>();
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    const keys = byFormat.get(entry.format) ?? [];
    keys.push(entry.key);
    byFormat.set(entry.format, keys);
  }
  const pages: QrPrintPage[] = [];
  for (const [format, keys] of byFormat) {
    const perSheet = QR_PRINT_PER_SHEET[format];
    for (let index = 0; index < keys.length; index += perSheet) {
      pages.push({ format, keys: keys.slice(index, index + perSheet) });
    }
  }
  return pages;
}

/** «1 лист», «3 листа», «5 листов». */
export function sheetsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "лист" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "листа" : "листов";
  return `${count} ${word}`;
}
