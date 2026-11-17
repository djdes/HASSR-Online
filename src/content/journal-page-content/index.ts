import { CLEANING_PAGE_CONTENT } from "./cleaning";
import { EQUIPMENT_PAGE_CONTENT } from "./equipment";
import { PRODUCTION_PAGE_CONTENT } from "./production";
import { SANITARY_PAGE_CONTENT } from "./sanitary";
import { STAFF_PAGE_CONTENT } from "./staff";
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
