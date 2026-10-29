/**
 * Номер договора: `WS-2026/0001` — год договора и порядковый номер в этом
 * году. Номер выдаётся в транзакции (`service.server.ts`): уникальность
 * держат `@@unique([year, seq])` и `number @unique`.
 */

export const CONTRACT_NUMBER_PREFIX = "WS";

export function formatContractNumber(year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error(`Bad contract year: ${year}`);
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`Bad contract sequence: ${seq}`);
  return `${CONTRACT_NUMBER_PREFIX}-${year}/${String(seq).padStart(4, "0")}`;
}

export function parseContractNumber(value: string): { year: number; seq: number } | null {
  const match = /^WS-(\d{4})\/(\d{4,})$/.exec(value.trim());
  if (!match) return null;
  return { year: Number(match[1]), seq: Number(match[2]) };
}

/** Номер черновика до выпуска: год известен, порядковый — ещё нет. */
export function draftContractNumber(year: number): string {
  return `${CONTRACT_NUMBER_PREFIX}-${year}/____`;
}

/** Имя файла: ASCII для заголовка Content-Disposition и кириллица рядом. */
export function contractFileName(number: string, ext: "pdf" | "docx"): { ascii: string; utf8: string } {
  const safe = number.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "");
  return { ascii: `Contract-${safe}.${ext}`, utf8: `Договор-${safe}.${ext}` };
}
