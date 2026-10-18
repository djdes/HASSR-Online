/**
 * Портал проверяющего, дополнительные листы (2026-10-17): итоги проверок по
 * чек-листам и медкнижки. Чистые расчёты без БД — их проверяют тесты;
 * выборка — `inspector-portal-extras.server.ts`.
 *
 * Персональные данные сюда не попадают (152-ФЗ): у чек-листов нет ФИО
 * проверявших, у медкнижек — только счётчики.
 */

export type ChecklistResultSummary = {
  earned: number;
  possible: number;
  /** Балл в процентах, null — у проверки нет оцениваемых вопросов. */
  percent: number | null;
  violations: number;
  critical: number;
  stopped: boolean;
};

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);

/**
 * Итог завершённой проверки из записанного `ChecklistInspection.result`
 * (`{ score: { earned, possible }, violations[], critical[], stopped }`).
 * Не разобрался — null (строка покажет «итог не записан»).
 */
export function summarizeChecklistResult(result: unknown): ChecklistResultSummary | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { score?: { earned?: unknown; possible?: unknown }; violations?: unknown; critical?: unknown; stopped?: unknown };
  const earned = Number(r.score?.earned);
  const possible = Number(r.score?.possible);
  if (!Number.isFinite(earned) || !Number.isFinite(possible) || earned < 0 || possible < 0) return null;
  const zeroed = r.stopped === true && (result as { zeroScore?: unknown }).zeroScore === true;
  return {
    earned,
    possible,
    percent: possible > 0 ? (zeroed ? 0 : Math.round((earned / possible) * 100)) : null,
    violations: count(r.violations),
    critical: count(r.critical),
    stopped: r.stopped === true,
  };
}

export type MedBookStatus = "expired" | "warning" | "ok" | "missing" | "no_expiry";

/**
 * Статус медкнижки сотрудника — те же правила, что у виджета «Медкнижки»
 * (`/api/dashboard/med-books-expiry`): нет записи — missing, без срока —
 * no_expiry, срок прошёл — expired, меньше 30 дней — warning.
 */
export function medBookStatus(expiresAt: Date | null | undefined, hasRecord: boolean, now: Date): MedBookStatus {
  if (!hasRecord) return "missing";
  if (!expiresAt) return "no_expiry";
  if (expiresAt < now) return "expired";
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + 30);
  return expiresAt < in30 ? "warning" : "ok";
}

/**
 * Счётчик для проверяющего: «действуют» (срок не прошёл, в т. ч. истекающие
 * в 30 дней) и «просрочены». Без ФИО и без числа сотрудников без сведений.
 * У сотрудника берётся самая поздняя запись о медкнижке.
 */
export function countMedBooks(
  userIds: string[],
  certs: { userId: string; expiresAt: Date | null }[],
  now: Date
): { valid: number; expired: number } {
  const latest = new Map<string, Date | null>();
  for (const cert of certs) {
    const prev = latest.get(cert.userId);
    if (prev === undefined || (cert.expiresAt && (!prev || cert.expiresAt > prev))) latest.set(cert.userId, cert.expiresAt);
  }
  let valid = 0;
  let expired = 0;
  for (const id of new Set(userIds)) {
    const status = medBookStatus(latest.get(id) ?? null, latest.has(id), now);
    if (status === "ok" || status === "warning") valid += 1;
    else if (status === "expired") expired += 1;
  }
  return { valid, expired };
}
