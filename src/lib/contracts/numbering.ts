/**
 * Номер договора: `2026/4827` — год договора и случайный номер в этом году
 * (с 12.11.2026: порядковый «0001» выдавал, сколько у нас договоров).
 * Уникальность держат `@@unique([year, seq])` и `number @unique`; занятый
 * номер `issueClientContract` перевыбирает.
 */

/** Диапазон случайной части: четыре цифры без ведущего нуля. */
export const CONTRACT_SEQ_MIN = 1000;
export const CONTRACT_SEQ_MAX = 9999;

/** Случайная часть номера, не из `taken` (уже выданные в этом году). null — свободных нет. */
export function pickContractSeq(taken: ReadonlySet<number>, random: () => number = Math.random): number | null {
  const span = CONTRACT_SEQ_MAX - CONTRACT_SEQ_MIN + 1;
  if (taken.size >= span) return null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const seq = CONTRACT_SEQ_MIN + Math.floor(random() * span);
    if (!taken.has(seq)) return seq;
  }
  for (let seq = CONTRACT_SEQ_MIN; seq <= CONTRACT_SEQ_MAX; seq += 1) if (!taken.has(seq)) return seq;
  return null;
}

export function formatContractNumber(year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error(`Bad contract year: ${year}`);
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`Bad contract sequence: ${seq}`);
  return `${year}/${String(seq).padStart(4, "0")}`;
}

export function parseContractNumber(value: string): { year: number; seq: number } | null {
  // Старые договоры были «WS-2026/0001» — префикс при разборе необязателен.
  const match = /^(?:WS-)?(\d{4})\/(\d{4,})$/.exec(value.trim());
  if (!match) return null;
  return { year: Number(match[1]), seq: Number(match[2]) };
}

/** Номер черновика до выпуска: год известен, порядковый — ещё нет. */
export function draftContractNumber(year: number): string {
  return `${year}/____`;
}

/** Имя файла: ASCII для заголовка Content-Disposition и кириллица рядом. */
export function contractFileName(number: string, ext: "pdf" | "docx"): { ascii: string; utf8: string } {
  const safe = number.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "");
  return { ascii: `Contract-${safe}.${ext}`, utf8: `Договор-${safe}.${ext}` };
}
