import { db } from "@/lib/db";
import {
  EXCHANGE_ALERT_ACTION,
  EXCHANGE_ALERT_MAX_NAMES,
  alertCabinets,
  alertDayStart,
  composeExchangeAlert,
  decideExchangeAlert,
  type AlertCabinet,
} from "@/lib/directory-exchange/alert";
import { cabinetLabels, loadExchangeRunsOverview, type CabinetLabel, type ProblemCabinet } from "@/lib/directory-exchange/runs.server";
import { notifyPlatformAdmin } from "@/lib/platform-admin";

/**
 * Тревога о сбоях обмена (серия E, Р1) после планового обмена: одно
 * сообщение владельцу платформы (`notifyPlatformAdmin`) со списком
 * кабинетов, у которых последний обмен с ошибкой или нет успешного обмена
 * за сутки, — не чаще раза в московские сутки (отметка — `AuditLog` у
 * организации платформы). Ничего не бросает: сбой только в лог, обмен идёт
 * своим чередом.
 */

export type ExchangeAlertStatus = "healthy" | "already_sent" | "sent" | "not_delivered" | "failed";
export type ExchangeAlertResult = { status: ExchangeAlertStatus; cabinets: number };
export type ExchangeAlertSender = (text: string, options: { kind: string; dedupeKey: string }) => Promise<boolean>;

const platformOrgId = () => (process.env.PLATFORM_ORG_ID ?? "platform").trim();

function fromProblem(problem: ProblemCabinet): AlertCabinet {
  return {
    id: problem.cabinet.id,
    name: problem.cabinet.name,
    ownerName: problem.cabinet.ownerName,
    ownerEmail: problem.cabinet.ownerEmail,
    problem: problem.problem,
    error: problem.lastRun?.status === "error" ? problem.lastRun.error : null,
    lastOkAt: problem.lastOkAt,
  };
}

/** Когда тревога уходила в последний раз (отметка в журнале действий платформы). */
async function lastAlertAt(): Promise<Date | null> {
  const row = await db.auditLog.findFirst({
    where: { organizationId: platformOrgId(), action: EXCHANGE_ALERT_ACTION },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

export async function alertExchangeProblems(
  input: {
    now?: Date;
    /** Кабинеты, обмен которых упал в этом прогоне. */
    failedCabinetIds?: readonly string[];
    /** Проблемные кабинеты; по умолчанию — из журнала обменов (как страница ROOT). */
    problems?: readonly ProblemCabinet[];
    send?: ExchangeAlertSender;
    appUrl?: string;
  } = {},
): Promise<ExchangeAlertResult> {
  const now = input.now ?? new Date();
  try {
    const problems = (input.problems ?? (await loadExchangeRunsOverview({ now, onlyErrors: true, limit: 1 })).problems).map(fromProblem);
    // Упавшие в этом прогоне: подпись — из журнала, если кабинет там уже есть, иначе — своя.
    const known = new Map(problems.map((cabinet) => [cabinet.id, cabinet]));
    const failedIds = [...new Set(input.failedCabinetIds ?? [])];
    const missing = failedIds.filter((id) => !known.has(id));
    const labels = missing.length > 0 ? await cabinetLabels(missing) : new Map<string, CabinetLabel>();
    const failed: AlertCabinet[] = failedIds.map((id) => {
      const label = known.get(id) ?? labels.get(id);
      return { id, name: label?.name ?? "—", ownerName: label?.ownerName ?? null, ownerEmail: label?.ownerEmail ?? null, problem: "error", error: null, lastOkAt: known.get(id)?.lastOkAt ?? null };
    });
    const cabinets = alertCabinets(problems, failed);
    const decision = decideExchangeAlert({ cabinets, lastSentAt: cabinets.length > 0 ? await lastAlertAt() : null, now });
    if (!decision.send) return { status: decision.reason, cabinets: cabinets.length };

    const day = alertDayStart(now).toISOString().slice(0, 10);
    const text = composeExchangeAlert(decision.cabinets, input.appUrl ?? process.env.NEXTAUTH_URL ?? "https://wesetup.ru");
    const send: ExchangeAlertSender = input.send ?? ((message, options) => notifyPlatformAdmin(message, options));
    const sent = await send(text, { kind: "directory_exchange", dedupeKey: `directory-exchange-alert:${day}` }).catch((error: unknown) => {
      console.error("[directory-exchange] alert not sent", error);
      return false;
    });
    // Не дошло — отметки нет: следующий плановый обмен попробует снова.
    if (!sent) return { status: "not_delivered", cabinets: cabinets.length };
    await db.auditLog
      .create({
        data: {
          organizationId: platformOrgId(),
          action: EXCHANGE_ALERT_ACTION,
          entity: "directory_exchange",
          details: {
            cabinets: decision.cabinets.length,
            cabinetIds: decision.cabinets.slice(0, EXCHANGE_ALERT_MAX_NAMES).map((cabinet) => cabinet.id),
            errors: decision.cabinets.filter((cabinet) => cabinet.problem === "error").length,
          },
          createdAt: now,
        },
      })
      .catch((error: unknown) => console.error("[directory-exchange] alert mark not recorded", error));
    return { status: "sent", cabinets: cabinets.length };
  } catch (error) {
    console.error("[directory-exchange] alert failed", error);
    return { status: "failed", cabinets: 0 };
  }
}
