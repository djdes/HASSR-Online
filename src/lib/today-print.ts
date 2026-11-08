/**
 * Лист «Что заполнить сегодня» (08.11.2026): коды незаполненных журналов
 * приходят с «Сегодня» параметром `codes` — лист совпадает с тем, что человек
 * видел. Здесь — разбор параметра: только коды журналов, без повторов, не
 * больше 120, порядок сохраняется.
 */
const CODE = /^[a-z0-9_-]{1,64}$/i;

export const TODAY_PRINT_MAX = 120;

export function parsePrintCodes(raw: string | string[] | null | undefined): string[] {
  const text = Array.isArray(raw) ? raw.join(",") : String(raw ?? "");
  const codes = text
    .split(",")
    .map((code) => code.trim())
    .filter((code) => CODE.test(code));
  return [...new Set(codes)].slice(0, TODAY_PRINT_MAX);
}
