import type { JournalAutomationMap } from "@/lib/journal-automation";

/**
 * Автоматика журналов по точкам (2026-11-01). Правка «всей организации»
 * доходит и до точек со своей автоматикой (`Building.journalAutomationJson`):
 * им переносятся только тумблеры автосоздания и автозаполнения изменённых
 * журналов. Ответственные и сотрудники-строки у точки свои — их не трогаем.
 */
export type AutomationFlagChange = { code: string; autoCreate: boolean; autoFill: boolean };

export function applyAutomationFlags(
  map: JournalAutomationMap,
  changes: readonly AutomationFlagChange[],
): JournalAutomationMap {
  const next: JournalAutomationMap = { ...map };
  for (const change of changes) {
    const previous = next[change.code];
    next[change.code] = { ...(previous ?? {}), autoCreate: change.autoCreate, autoFill: change.autoFill };
  }
  return next;
}

/** Журналы с автосозданием — `autoJournalCodes` рядом с картой. */
export function autoCreateCodes(map: JournalAutomationMap): string[] {
  return Object.entries(map)
    .filter(([, value]) => value.autoCreate)
    .map(([code]) => code)
    .sort();
}
