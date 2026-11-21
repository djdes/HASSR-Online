import { db } from "@/lib/db";
import {
  CHANGE_RETENTION_DAYS,
  DAY_MS,
  RUN_RETENTION_DAYS,
  cabinetProblem,
  runErrorText,
  runTotals,
  type ExchangeRunStatus,
  type ExchangeTrigger,
} from "@/lib/directory-exchange/runs";
import type { ExchangeSummary } from "@/lib/directory-exchange/summary";
import { MASTER_ORG_KIND } from "@/lib/master-directory";
import { isTechnicalEmail } from "@/lib/technical-email";

/**
 * Журнал обменов справочниками (серия D, Р2): строка `DirectoryExchangeRun`
 * на каждую попытку обмена — её ведёт `runDirectoryExchange` (run.server.ts),
 * в том числе в фоне; и сводка для страницы ROOT «Обмен справочниками».
 *
 * Запись журнала никогда не ломает обмен: сбой записи только в лог.
 */

export type ExchangeRunHandle = { id: string; startedAtMs: number };

/** Начать строку журнала (`running`); не вышло — null, обмен идёт дальше. */
export async function startExchangeRun(masterOrganizationId: string, trigger: ExchangeTrigger): Promise<ExchangeRunHandle | null> {
  const startedAt = new Date();
  try {
    const row = await db.directoryExchangeRun.create({
      data: { masterOrganizationId, trigger, status: "running", startedAt },
      select: { id: true },
    });
    return { id: row.id, startedAtMs: startedAt.getTime() };
  } catch (error) {
    console.error("[directory-exchange] run not recorded", { masterOrganizationId, trigger, error });
    return null;
  }
}

/** Закончить строку журнала: итог, длительность, счётчики или текст ошибки. Не бросает. */
export async function finishExchangeRun(
  run: ExchangeRunHandle | null,
  outcome: { status: Exclude<ExchangeRunStatus, "running">; summary?: ExchangeSummary; error?: unknown },
): Promise<void> {
  if (!run) return;
  const finishedAt = new Date();
  const totals = outcome.summary ? runTotals(outcome.summary) : { created: 0, updated: 0, skipped: 0 };
  try {
    await db.directoryExchangeRun.update({
      where: { id: run.id },
      data: {
        status: outcome.status,
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - run.startedAtMs),
        ...totals,
        error: outcome.status === "error" ? runErrorText(outcome.error) : null,
      },
    });
  } catch (error) {
    console.error("[directory-exchange] run result not recorded", { runId: run.id, error });
  }
}

/**
 * Очистка при плановом обмене: журнал обменов старше 90 дней, история
 * изменений старше 30 дней. Не бросает.
 */
export async function pruneExchangeLogs(now: Date): Promise<{ runs: number; changes: number }> {
  const result = { runs: 0, changes: 0 };
  try {
    result.runs = (
      await db.directoryExchangeRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - RUN_RETENTION_DAYS * DAY_MS) } } })
    ).count;
    result.changes = (
      await db.directoryExchangeChange.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - CHANGE_RETENTION_DAYS * DAY_MS) } } })
    ).count;
  } catch (error) {
    console.error("[directory-exchange] exchange logs not pruned", error);
  }
  return result;
}

/* ───────────────────────── страница ROOT ───────────────────────── */

export type CabinetLabel = {
  id: string;
  name: string;
  /** Владелец аккаунта кабинета: имя и почта для связи (служебная почта не показывается). */
  ownerName: string | null;
  ownerEmail: string | null;
};

export type ExchangeRunRow = {
  id: string;
  cabinet: CabinetLabel;
  trigger: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  created: number;
  updated: number;
  skipped: number;
  error: string | null;
};

export type ProblemCabinet = {
  cabinet: CabinetLabel;
  problem: "error" | "no_success";
  /** Участников обмена в кабинете. */
  members: number;
  lastRun: { status: string; startedAt: Date; error: string | null } | null;
  lastOkAt: Date | null;
};

export type ExchangeRunsOverview = { runs: ExchangeRunRow[]; problems: ProblemCabinet[]; cabinets: number };

/** Подписи кабинетов: название и владелец аккаунта (как на странице ROOT). */
export async function cabinetLabels(ids: readonly string[]): Promise<Map<string, CabinetLabel>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const cabinets = await db.organization.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      name: true,
      account: { select: { owner: { select: { name: true, email: true, contactEmail: true } } } },
    },
  });
  return new Map(
    cabinets.map((cabinet) => {
      const owner = cabinet.account?.owner ?? null;
      const email = owner ? owner.contactEmail?.trim() || (isTechnicalEmail(owner.email) ? null : owner.email) : null;
      return [cabinet.id, { id: cabinet.id, name: cabinet.name, ownerName: owner?.name?.trim() || null, ownerEmail: email }];
    }),
  );
}

const unknownCabinet = (id: string): CabinetLabel => ({ id, name: "—", ownerName: null, ownerEmail: null });

/**
 * Страница ROOT «Обмен справочниками»: последние обмены (`onlyErrors` —
 * только ошибки) и кабинеты, у которых последний обмен — ошибка или нет
 * успешного обмена за сутки. Кабинет считается, когда в нём два участника
 * и больше — как у планового обмена.
 */
export async function loadExchangeRunsOverview(options: { now?: Date; onlyErrors?: boolean; limit?: number } = {}): Promise<ExchangeRunsOverview> {
  const now = options.now ?? new Date();
  const [runs, groups] = await Promise.all([
    db.directoryExchangeRun.findMany({
      where: options.onlyErrors ? { status: "error" } : {},
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: Math.max(1, Math.min(options.limit ?? 100, 500)),
    }),
    db.directoryExchangeMember.groupBy({ by: ["masterOrganizationId"], _count: { _all: true } }),
  ]);
  const active = groups.filter((group) => group._count._all >= 2);
  const activeIds = active.map((group) => group.masterOrganizationId);
  // Кабинет — организация-справочник; участники без живого кабинета не считаются.
  const realCabinets = new Set(
    activeIds.length
      ? (await db.organization.findMany({ where: { id: { in: activeIds }, kind: MASTER_ORG_KIND }, select: { id: true } })).map((row) => row.id)
      : [],
  );
  const exchanging = active.filter((group) => realCabinets.has(group.masterOrganizationId));
  const ids = exchanging.map((group) => group.masterOrganizationId);

  // Последний обмен кабинета: время — агрегатом в базе, сами строки — только эти (без перебора всего журнала).
  const [lastAt, lastOk] = ids.length
    ? await Promise.all([
        db.directoryExchangeRun.groupBy({ by: ["masterOrganizationId"], where: { masterOrganizationId: { in: ids } }, _max: { startedAt: true } }),
        db.directoryExchangeRun.groupBy({
          by: ["masterOrganizationId"],
          where: { masterOrganizationId: { in: ids }, status: "ok" },
          _max: { startedAt: true },
        }),
      ])
    : [[], []];
  const latest = lastAt.flatMap((row) => (row._max.startedAt ? [{ masterOrganizationId: row.masterOrganizationId, startedAt: row._max.startedAt }] : []));
  const lastRuns = latest.length
    ? await db.directoryExchangeRun.findMany({
        where: { OR: latest },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        select: { masterOrganizationId: true, status: true, startedAt: true, error: true },
      })
    : [];
  const lastRunOf = new Map<string, (typeof lastRuns)[number]>();
  // Два обмена в одну миллисекунду — берётся первый по порядку выше.
  for (const run of lastRuns) if (!lastRunOf.has(run.masterOrganizationId)) lastRunOf.set(run.masterOrganizationId, run);
  const lastOkOf = new Map(lastOk.map((row) => [row.masterOrganizationId, row._max.startedAt ?? null]));

  const labels = await cabinetLabels([...runs.map((run) => run.masterOrganizationId), ...ids]);
  const problems: ProblemCabinet[] = [];
  for (const group of exchanging) {
    const id = group.masterOrganizationId;
    const last = lastRunOf.get(id) ?? null;
    const okAt = lastOkOf.get(id) ?? null;
    const problem = cabinetProblem({ lastStatus: last?.status ?? null, lastOkAt: okAt, now });
    if (!problem) continue;
    problems.push({
      cabinet: labels.get(id) ?? unknownCabinet(id),
      problem,
      members: group._count._all,
      lastRun: last ? { status: last.status, startedAt: last.startedAt, error: last.error } : null,
      lastOkAt: okAt,
    });
  }
  // Ошибки — первыми, потом давно без успешного обмена.
  problems.sort(
    (a, b) =>
      Number(b.problem === "error") - Number(a.problem === "error") ||
      (a.lastOkAt?.getTime() ?? 0) - (b.lastOkAt?.getTime() ?? 0) ||
      a.cabinet.name.localeCompare(b.cabinet.name, "ru"),
  );

  return {
    runs: runs.map((run) => ({
      id: run.id,
      cabinet: labels.get(run.masterOrganizationId) ?? unknownCabinet(run.masterOrganizationId),
      trigger: run.trigger,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      created: run.created,
      updated: run.updated,
      skipped: run.skipped,
      error: run.error,
    })),
    problems,
    cabinets: exchanging.length,
  };
}
