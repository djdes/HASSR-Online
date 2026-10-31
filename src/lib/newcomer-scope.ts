/**
 * Новичок и демо в автоматических сообщениях. Чистые правила без БД:
 * крон `compliance` и письма первых шагов решают по ним, кому писать.
 */

const HOUR_MS = 60 * 60 * 1000;

/**
 * Сколько часов новая организация без единой записи не получает напоминаний
 * «незаполненные журналы»: в первые сутки-двое человек ещё настраивается, и
 * «СРОЧНО» на второй день после регистрации отпугивает, а не помогает.
 */
export const NEWCOMER_QUIET_HOURS = 48;

/** Пропустить напоминание о пустых журналах для организации. */
export function skipComplianceReminder(
  org: { isDemo: boolean; createdAt: Date },
  hasEntries: boolean,
  now: Date
): boolean {
  if (org.isDemo) return true;
  const ageMs = now.getTime() - org.createdAt.getTime();
  return ageMs < NEWCOMER_QUIET_HOURS * HOUR_MS && !hasEntries;
}

/** Организация моложе окна тишины — тогда нужна проверка «есть ли записи». */
export function isWithinNewcomerQuietWindow(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < NEWCOMER_QUIET_HOURS * HOUR_MS;
}
