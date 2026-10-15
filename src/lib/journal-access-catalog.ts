import { ACTIVE_JOURNAL_CATALOG, type JournalCatalogItem } from "./journal-catalog";
import { CHECKLIST_CODE } from "./custom-checklists";

// The constructor has its own templates rather than a regulatory grid form.
// Include it in employee grants without changing the regulatory/tariff catalog.
export const JOURNAL_ACCESS_CATALOG: readonly JournalCatalogItem[] = [
  ...ACTIVE_JOURNAL_CATALOG,
  { code: CHECKLIST_CODE, name: "Конструктор чек-листов" },
];
