/**
 * Название организации в шапке журнала и в печатных формах.
 *
 * Полное юридическое название («Общество с ограниченной ответственностью
 * «Кафе у дома»») в узкую левую ячейку бумажной шапки не помещается, а
 * заглушка из мгновенной регистрации («Организация ivan@mail.ru») в бланке
 * выглядит как ошибка. Поэтому у журналов своё название:
 *
 *   1. `config.headerOrgName` документа — «только в этом документе»;
 *   2. `Organization.journalShortName` — «во всех журналах организации»;
 *   3. краткое название из ЕГРЮЛ (`legalProfileJson.nameShort`);
 *   4. `Organization.name` (почтовые заглушки не показываем);
 *   5. «Организация».
 *
 * Крошки и шапка кабинета по-прежнему показывают полное название.
 */

import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";
import { orgDisplayName } from "@/lib/org-display-name";

/** Ключ override'а внутри `JournalDocument.config`. */
export const ORG_HEADER_NAME_CONFIG_KEY = "headerOrgName";

/** Предел длины: название живёт в ячейке шапки. */
export const ORG_JOURNAL_NAME_MAX = 120;

/** Нормализация ввода: пробелы схлопнуты, длина ограничена. Пусто → "". */
export function sanitizeOrgJournalName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, ORG_JOURNAL_NAME_MAX);
}

/** Override документа или null, если его нет или он пустой. */
export function readHeaderOrgNameOverride(config: unknown): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const raw = (config as Record<string, unknown>)[ORG_HEADER_NAME_CONFIG_KEY];
  const value = sanitizeOrgJournalName(raw);
  return value || null;
}

function legalShortName(legalProfileJson: unknown): string | null {
  if (!legalProfileJson || typeof legalProfileJson !== "object" || Array.isArray(legalProfileJson)) {
    return null;
  }
  const value = sanitizeOrgJournalName((legalProfileJson as { nameShort?: unknown }).nameShort);
  return value || null;
}

export type OrgJournalNameSource = {
  name?: string | null;
  journalShortName?: string | null;
  legalProfileJson?: unknown;
};

/** Название организации без учёта документа (для настроек и бандлов). */
export function resolveOrgJournalName(
  organization: OrgJournalNameSource | null | undefined,
  documentConfig?: unknown
): string {
  return (
    readHeaderOrgNameOverride(documentConfig) ??
    (sanitizeOrgJournalName(organization?.journalShortName) || null) ??
    legalShortName(organization?.legalProfileJson) ??
    orgDisplayName(organization?.name, ORG_NAME_FALLBACK)
  );
}

/** Подсказка «Взять из ЕГРЮЛ: …» — краткое название из снимка реестра. */
export function suggestOrgJournalName(legalProfileJson: unknown): string | null {
  return legalShortName(legalProfileJson);
}
