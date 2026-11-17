import { CLEANING_PAGE_CONTENT } from "./cleaning";
import { EQUIPMENT_PAGE_CONTENT } from "./equipment";
import { PRODUCTION_PAGE_CONTENT } from "./production";
import { SANITARY_PAGE_CONTENT } from "./sanitary";
import { STAFF_PAGE_CONTENT } from "./staff";
import { CLEANING_PAGE_CONTENT_EN } from "./en/cleaning";
import { EQUIPMENT_PAGE_CONTENT_EN } from "./en/equipment";
import { PRODUCTION_PAGE_CONTENT_EN } from "./en/production";
import { SANITARY_PAGE_CONTENT_EN } from "./en/sanitary";
import { STAFF_PAGE_CONTENT_EN } from "./en/staff";
import { CLEANING_PAGE_CONTENT_UZ } from "./uz/cleaning";
import { EQUIPMENT_PAGE_CONTENT_UZ } from "./uz/equipment";
import { PRODUCTION_PAGE_CONTENT_UZ } from "./uz/production";
import { SANITARY_PAGE_CONTENT_UZ } from "./uz/sanitary";
import { STAFF_PAGE_CONTENT_UZ } from "./uz/staff";
import type { JournalPageContent } from "./types";

export type { JournalPageContent } from "./types";

/**
 * Блоки страниц журналов по кодам: уборка и группы — персонал и питание,
 * санитария и температура, приёмка и производство, оборудование и аудиты.
 */
export const JOURNAL_PAGE_CONTENT: Record<string, JournalPageContent> = {
  ...CLEANING_PAGE_CONTENT,
  ...STAFF_PAGE_CONTENT,
  ...SANITARY_PAGE_CONTENT,
  ...PRODUCTION_PAGE_CONTENT,
  ...EQUIPMENT_PAGE_CONTENT,
};

/** Перевод тех же блоков на английский (спека journal-page-content-i18n-2026-11). */
export const JOURNAL_PAGE_CONTENT_EN: Record<string, JournalPageContent> = {
  ...CLEANING_PAGE_CONTENT_EN,
  ...STAFF_PAGE_CONTENT_EN,
  ...SANITARY_PAGE_CONTENT_EN,
  ...PRODUCTION_PAGE_CONTENT_EN,
  ...EQUIPMENT_PAGE_CONTENT_EN,
};

/** Перевод тех же блоков на узбекский (латиница). */
export const JOURNAL_PAGE_CONTENT_UZ: Record<string, JournalPageContent> = {
  ...CLEANING_PAGE_CONTENT_UZ,
  ...STAFF_PAGE_CONTENT_UZ,
  ...SANITARY_PAGE_CONTENT_UZ,
  ...PRODUCTION_PAGE_CONTENT_UZ,
  ...EQUIPMENT_PAGE_CONTENT_UZ,
};

const BY_LOCALE: Record<"ru" | "en" | "uz", Record<string, JournalPageContent>> = {
  ru: JOURNAL_PAGE_CONTENT,
  en: JOURNAL_PAGE_CONTENT_EN,
  uz: JOURNAL_PAGE_CONTENT_UZ,
};

/** Блоки страницы журнала на языке сайта; перевода нет — `null`. */
export function journalPageContent(code: string, locale: "ru" | "en" | "uz"): JournalPageContent | null {
  const table = BY_LOCALE[locale];
  return Object.hasOwn(table, code) ? table[code] : null;
}
