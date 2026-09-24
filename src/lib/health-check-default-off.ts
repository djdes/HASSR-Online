/**
 * Журналы, выключенные «из коробки».
 *
 * Журнал здоровья (`health_check`) дублирует гигиенический: включённый, он
 * отмечается по тому же QR перед сменой (см. HEALTH_REGISTER_REMINDER в
 * hygiene-document.ts). Решение владельца: у новых организаций он
 * выключен, у существующих — выключается, если за 30 дней в нём нет
 * реальных записей (см. prisma/seed-disable-health-check.ts).
 *
 * Модуль чистый (без БД): его используют и API-роуты, и seed, и тесты.
 */
import {
  parseJournalAutomationJson,
  withJournalAutomation,
} from "@/lib/journal-automation";
import { SEEDED_DEFAULT_OFF_CODES } from "@/lib/new-journals-default-off";

export const DEFAULT_OFF_JOURNAL_CODES = ["health_check"] as const;

const HEALTH_CHECK_CODE = "health_check";

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Список выключенных журналов + default-off коды. Порядок входа
 * сохраняется, дубли убираются — так список можно сразу писать в
 * `Organization.disabledJournalCodes`.
 */
export function withDefaultOffCodes(codes: string[]): string[] {
  return [...new Set([...toStringArray(codes), ...DEFAULT_OFF_JOURNAL_CODES])];
}

/**
 * «Организация список выключенных журналов не трогала»: он пуст или
 * содержит только то, что мы выключили сами по умолчанию. Нужен, чтобы
 * дефолты сферы применялись и к оргам, созданным уже с `["health_check"]`.
 */
export function isUntouchedDisabledCodes(
  codes: string[] | null | undefined
): boolean {
  // Новые журналы сентября 2026 у старых организаций выключил сидер, а
  // не человек, — список с ними тоже считается нетронутым, иначе анкета
  // перестала бы применять набор журналов сферы.
  const defaults = new Set<string>([
    ...DEFAULT_OFF_JOURNAL_CODES,
    ...SEEDED_DEFAULT_OFF_CODES,
  ]);
  return toStringArray(codes).every((code) => defaults.has(code));
}

export type HealthCheckOrgSettings = {
  disabledJournalCodes: string[];
  journalAutomationJson: unknown;
  autoJournalCodes: string[];
};

/**
 * Выключает журнал здоровья целиком: в каталоге, в автоматике
 * (autoCreate/autoFill = false, прочие настройки записи сохраняются —
 * если журнал включат обратно, ответственные не потеряются) и в
 * легаси-списке автосоздания. Идемпотентно: `changed=false`, если
 * менять нечего.
 */
export function applyHealthCheckDefaultOff(
  org: HealthCheckOrgSettings
): HealthCheckOrgSettings & { changed: boolean } {
  const currentDisabled = toStringArray(org.disabledJournalCodes);
  const currentAuto = toStringArray(org.autoJournalCodes);
  const rawAutomation =
    org.journalAutomationJson &&
    typeof org.journalAutomationJson === "object" &&
    !Array.isArray(org.journalAutomationJson)
      ? (org.journalAutomationJson as Record<string, unknown>)
      : {};

  let changed = false;

  let disabledJournalCodes = currentDisabled;
  if (!currentDisabled.includes(HEALTH_CHECK_CODE)) {
    disabledJournalCodes = [...currentDisabled, HEALTH_CHECK_CODE];
    changed = true;
  }

  const autoJournalCodes = currentAuto.filter(
    (code) => code !== HEALTH_CHECK_CODE
  );
  if (autoJournalCodes.length !== currentAuto.length) changed = true;

  // Остальные ключи JSON оставляем как есть (даже непарсящиеся) —
  // трогаем только запись health_check.
  let journalAutomationJson: Record<string, unknown> = rawAutomation;
  const existing = parseJournalAutomationJson(rawAutomation)[HEALTH_CHECK_CODE];
  if (existing && (existing.autoCreate || existing.autoFill)) {
    const next = withJournalAutomation(rawAutomation, HEALTH_CHECK_CODE, {
      ...existing,
      autoCreate: false,
      autoFill: false,
    });
    journalAutomationJson = {
      ...rawAutomation,
      [HEALTH_CHECK_CODE]: next[HEALTH_CHECK_CODE],
    };
    changed = true;
  }

  return {
    disabledJournalCodes,
    journalAutomationJson,
    autoJournalCodes,
    changed,
  };
}
