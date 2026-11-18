import { FAQ_EXTRA_EN_A } from "./en-a";
import { FAQ_EXTRA_EN_B } from "./en-b";
import { FAQ_EXTRA_RU_A } from "./ru-a";
import { FAQ_EXTRA_RU_B } from "./ru-b";
import { FAQ_EXTRA_UZ_A } from "./uz-a";
import { FAQ_EXTRA_UZ_B } from "./uz-b";
import type { JournalFaqExtra } from "./types";

export type { JournalFaqExtra } from "./types";

/**
 * Дополнительные вопросы FAQ по журналам (спека seo-speed-pack-2026-11, п. 14):
 * 3–4 вопроса в тех формулировках, в каких их ищут, — сверх общих вопросов
 * шаблона («что писать», «как часто», «норматив», «электронно», «сколько хранить»).
 */
export const JOURNAL_FAQ_EXTRA: Record<"ru" | "en" | "uz", JournalFaqExtra> = {
  ru: { ...FAQ_EXTRA_RU_A, ...FAQ_EXTRA_RU_B },
  en: { ...FAQ_EXTRA_EN_A, ...FAQ_EXTRA_EN_B },
  uz: { ...FAQ_EXTRA_UZ_A, ...FAQ_EXTRA_UZ_B },
};

export function journalFaqExtra(code: string, locale: "ru" | "en" | "uz"): Array<{ q: string; a: string }> {
  const table = JOURNAL_FAQ_EXTRA[locale];
  return Object.hasOwn(table, code) ? table[code] : [];
}
