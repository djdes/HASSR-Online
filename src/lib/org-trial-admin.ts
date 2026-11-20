import { ORG_TRIAL_MAX_GRANTS, type OrgTrialStatus } from "@/lib/org-trial";

/**
 * Свои 14 дней организации у ROOT (серия B, Р11) — чистые правила: что
 * показать в карточке и какие действия принимает
 * `POST /api/root/organizations/[id]/org-trial`. Client-safe.
 */

export const ORG_TRIAL_EXTEND_MIN_DAYS = 1;
export const ORG_TRIAL_EXTEND_MAX_DAYS = 60;
export { ORG_TRIAL_MAX_GRANTS };

/** Записи журнала, которые пишет `checkTrialReuse` (`org-trial.server.ts`). */
export const TRIAL_REUSE_ACTIONS = ["billing.trial.reuse_suspected", "billing.trial.reused"] as const;

export type OrgTrialAdminAction =
  | { action: "extend"; days: number }
  | { action: "clear" }
  | { action: "reset_grants" };

export type OrgTrialAdminActionCheck =
  | { ok: true; value: OrgTrialAdminAction }
  | { ok: false; error: string };

/** Тело запроса → действие; дни — целые от 1 до 60. */
export function parseOrgTrialAdminAction(body: unknown): OrgTrialAdminActionCheck {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (raw.action === "clear") return { ok: true, value: { action: "clear" } };
  if (raw.action === "reset_grants") return { ok: true, value: { action: "reset_grants" } };
  if (raw.action === "extend") {
    const days = typeof raw.days === "string" && raw.days.trim() ? Number(raw.days) : raw.days;
    if (
      typeof days !== "number" ||
      !Number.isInteger(days) ||
      days < ORG_TRIAL_EXTEND_MIN_DAYS ||
      days > ORG_TRIAL_EXTEND_MAX_DAYS
    ) {
      return { ok: false, error: `Продлить можно на ${ORG_TRIAL_EXTEND_MIN_DAYS}–${ORG_TRIAL_EXTEND_MAX_DAYS} дней` };
    }
    return { ok: true, value: { action: "extend", days } };
  }
  return { ok: false, error: "Неизвестное действие" };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Новый конец своих 14 дней: от более позднего из «сейчас» и текущего срока
 * плюс N дней, до полуночи по Москве — как `orgTrialEnd`: человеку обещано
 * «по такое-то число включительно». Срок, который уже кончается в полночь,
 * просто сдвигается на N суток.
 */
export function extendedOrgTrialEnd(current: Date | null, days: number, now: Date): Date {
  const base = Math.max(now.getTime(), current?.getTime() ?? 0);
  const raw = base + days * DAY_MS + MSK_OFFSET_MS;
  return new Date(Math.ceil(raw / DAY_MS) * DAY_MS - MSK_OFFSET_MS);
}

/**
 * Состояние для карточки: `trial` — в своих 14 днях, `locked` — закрыта,
 * `none` — нет отметки, `inactive` — отметка есть, но не действует (срок
 * прошёл, а организация в тарифе, или аккаунт не оплачен).
 */
export type OrgTrialAdminState = "trial" | "locked" | "none" | "inactive";

export function orgTrialAdminState(trialEndsAt: Date | null, status: OrgTrialStatus | null | undefined): OrgTrialAdminState {
  if (!trialEndsAt) return "none";
  if (status === "trial" || status === "locked") return status;
  return "inactive";
}

export type TrialReuseSuspicion = {
  id: string;
  at: string;
  /** `billing.trial.reused` — пробный закончен сам; иначе только сигнал. */
  ended: boolean;
  /** Совпавший ИНН (если совпал). */
  inn: string | null;
  phoneMatch: boolean;
  usedByOrganizationId: string | null;
  usedByName: string | null;
};

/** Запись журнала `billing.trial.*` → строка карточки; чужие поля не читаем. */
export function readTrialReuseSuspicion(row: {
  id: string;
  action: string;
  createdAt: Date;
  details: unknown;
}): TrialReuseSuspicion {
  const details = row.details && typeof row.details === "object" ? (row.details as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    ended: row.action === "billing.trial.reused",
    inn: text(details.inn),
    phoneMatch: details.phoneMatch === true,
    usedByOrganizationId: text(details.usedByOrganizationId),
    usedByName: text(details.usedByName),
  };
}

/** Карточка «Свои 14 дней организации» у ROOT. */
export type OrgTrialAdminView = {
  organizationId: string;
  accountId: string;
  trialEndsAt: string | null;
  state: OrgTrialAdminState;
  grantsUsed: number;
  grantsMax: number;
  suspicions: TrialReuseSuspicion[];
};
