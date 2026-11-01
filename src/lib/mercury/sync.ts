/**
 * Синхронизация ВСД и проигрывание очереди заявок.
 *
 * Здесь единственное место интеграции, которое одновременно знает и про
 * БД, и про клиента Ветис. Всё, что можно было вынести в чистые функции
 * (политика повторов, дедлайны, маппинг в журнал), вынесено — сюда
 * попала только оркестрация.
 *
 * Инварианты, которые держит этот файл:
 *   • upsert по (организация, uuid) — перечитывание окна изменений
 *     безопасно и не плодит дублей;
 *   • курсор двигается только после успешного разбора страницы;
 *   • команда не отправляется повторно, пока не проверен фактический
 *     статус ВСД (иначе можно погасить документ дважды).
 */
import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { orgTodayKey } from "@/lib/timezone";

import { MercuryClient, mercuryClientFor } from "./client";
import { computeProcessingDueAt } from "./deadline";
import { applyEnterpriseList, vsdPointFollowsEnterprise } from "./enterprise-mapping";
import { describeMercuryError, MercuryError } from "./errors";
import {
  decideAfterStatusCheck,
  decideOutboxOutcome,
  type OutboxOutcome,
} from "./outbox-policy";
import type { MercuryOperation } from "./ns";
import type { ProcessIncomingInput, VetDocument } from "./types";

/** Нахлёст окна изменений: дешевле перечитать, чем потерять документ. */
const CHANGES_OVERLAP_MINUTES = 10;
/** Первая синхронизация не тянет всю историю — только последний месяц. */
const BACKFILL_DAYS = 30;

type IntegrationRow = {
  id: string;
  organizationId: string;
  environment: string;
  issuerGuid: string;
  initiatorLogin: string;
  apiKeyEncrypted: string | null;
  changesCursorAt: Date | null;
};

/** Поставить заявку в очередь. Ничего не отправляет — этим занят крон. */
export async function enqueueMercuryApplication(input: {
  integrationId: string;
  organizationId: string;
  action: MercuryOperation;
  payload: Record<string, unknown>;
  isCommand?: boolean;
  vetDocumentId?: string | null;
}): Promise<string> {
  const row = await db.mercuryOutbox.create({
    data: {
      integrationId: input.integrationId,
      organizationId: input.organizationId,
      idempotencyKey: randomUUID(),
      action: input.action,
      isCommand: input.isCommand ?? false,
      payload: input.payload as never,
      vetDocumentId: input.vetDocumentId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Записать разобранный ВСД.
 *
 * Только входящие: исходящие помечаем `irrelevant`, чтобы не перечитывать
 * их каждый тик и не показывать менеджеру чужую работу.
 */
export async function upsertVetDocument(input: {
  integration: IntegrationRow;
  enterprise: { id: string; enterpriseGuid: string; buildingId: string | null };
  vsd: VetDocument;
  timezone: string | null;
}): Promise<{ created: boolean; overdue: boolean }> {
  const { integration, enterprise, vsd } = input;
  const incoming = vsd.consigneeEnterpriseGuid === enterprise.enterpriseGuid;

  const base = vsd.deliveryDate ?? vsd.issueDate;
  const deadline =
    incoming && base
      ? computeProcessingDueAt({ base, timezone: input.timezone })
      : null;

  const data = {
    integrationId: integration.id,
    organizationId: integration.organizationId,
    enterpriseId: enterprise.id,
    buildingId: enterprise.buildingId,
    number: vsd.number ?? null,
    docType: vsd.docType,
    remoteStatus: vsd.status,
    issueDate: vsd.issueDate ? new Date(`${vsd.issueDate}T00:00:00Z`) : null,
    deliveryDate: vsd.deliveryDate ? new Date(`${vsd.deliveryDate}T00:00:00Z`) : null,
    processingDueAt: deadline?.dueAt ?? null,
    productName: vsd.productName ?? null,
    productType: vsd.productType ?? null,
    volume: vsd.volume ?? null,
    unit: vsd.unit ?? null,
    batchNumber: vsd.batchNumber ?? null,
    productionDate: vsd.productionDate ? new Date(`${vsd.productionDate}T00:00:00Z`) : null,
    expiryDate: vsd.expiryDate ? new Date(`${vsd.expiryDate}T00:00:00Z`) : null,
    consignorName: vsd.consignorName ?? null,
    consignorInn: vsd.consignorInn ?? null,
    manufacturerName: vsd.manufacturerName ?? null,
    transportInfo: vsd.transportInfo ?? null,
    accompanyingDocs: vsd.accompanyingDocs ?? null,
    raw: vsd.raw as never,
    lastSyncedAt: new Date(),
  };

  const existing = await db.mercuryVetDocument.findUnique({
    where: {
      organizationId_uuid: {
        organizationId: integration.organizationId,
        uuid: vsd.uuid,
      },
    },
    select: { id: true, localStatus: true },
  });

  if (!existing) {
    await db.mercuryVetDocument.create({
      data: {
        ...data,
        uuid: vsd.uuid,
        localStatus: incoming ? "new" : "irrelevant",
      },
    });
    return {
      created: incoming,
      overdue: Boolean(deadline && deadline.dueAt.getTime() < Date.now()),
    };
  }

  // Уже гасим или погасили — статус в Ветис обновляем, но НАШ статус не
  // трогаем: иначе успешное гашение откатилось бы обратно в «новый».
  const keepLocal = ["processing", "processed", "process_failed"].includes(
    existing.localStatus,
  );
  // Точка следует за площадкой, пока ВСД не погашен: погашенный уже лёг
  // строкой в журнал приёмки своей точки (`enterprise-mapping.ts`).
  const { buildingId, ...withoutPoint } = data;
  const pointed = vsdPointFollowsEnterprise(existing.localStatus) ? { ...withoutPoint, buildingId } : withoutPoint;

  await db.mercuryVetDocument.update({
    where: { id: existing.id },
    data: keepLocal
      ? pointed
      : { ...pointed, localStatus: incoming ? existing.localStatus : "irrelevant" },
  });
  return { created: false, overdue: false };
}

/**
 * Тик синхронизации по одной площадке.
 *
 * Ставит в очередь ОДНУ заявку — на изменения за окно (или backfill при
 * первой синхронизации). Результат заберёт крон очереди и передаст в
 * `applyVetDocumentPage`.
 */
export async function enqueueEnterpriseSync(input: {
  integration: IntegrationRow;
  enterprise: { id: string; enterpriseGuid: string };
  now?: Date;
}): Promise<{ action: MercuryOperation; from: Date | null }> {
  const now = input.now ?? new Date();
  const cursor = input.integration.changesCursorAt;

  if (!cursor) {
    // Первая синхронизация: тянем текущий список, а не всю историю —
    // ВСД месячной давности уже просрочены, и их «гашение» это разбор
    // несоответствий, а не наш сценарий.
    await enqueueMercuryApplication({
      integrationId: input.integration.id,
      organizationId: input.integration.organizationId,
      action: "getVetDocumentList",
      payload: {
        enterpriseGuid: input.enterprise.enterpriseGuid,
        enterpriseId: input.enterprise.id,
        status: "CONFIRMED",
        backfillDays: BACKFILL_DAYS,
      },
    });
    return { action: "getVetDocumentList", from: null };
  }

  const beginDate = new Date(cursor.getTime() - CHANGES_OVERLAP_MINUTES * 60_000);
  await enqueueMercuryApplication({
    integrationId: input.integration.id,
    organizationId: input.integration.organizationId,
    action: "getVetDocumentChangesList",
    payload: {
      enterpriseGuid: input.enterprise.enterpriseGuid,
      enterpriseId: input.enterprise.id,
      beginDate: beginDate.toISOString(),
      endDate: now.toISOString(),
    },
  });
  return { action: "getVetDocumentChangesList", from: beginDate };
}

/** Отправка одной заявки: шаг 1 протокола. */
async function submitApplication(
  client: MercuryClient,
  action: string,
  payload: Record<string, unknown>,
): Promise<OutboxOutcome> {
  try {
    const submitted = await (() => {
      switch (action) {
        case "getVetDocumentList":
          return client.submitGetVetDocumentList({
            enterpriseGuid: String(payload.enterpriseGuid),
            status: payload.status ? String(payload.status) : undefined,
          });
        case "getVetDocumentChangesList":
          return client.submitGetVetDocumentChangesList({
            enterpriseGuid: String(payload.enterpriseGuid),
            beginDate: String(payload.beginDate),
            endDate: String(payload.endDate),
          });
        case "getVetDocumentByUuid":
          return client.submitGetVetDocumentByUuid({ uuid: String(payload.uuid) });
        case "getActivityLocationList":
          return client.submitGetActivityLocationList({
            enterpriseGuid: String(payload.enterpriseGuid),
          });
        case "processIncomingConsignment":
          return client.submitProcessIncomingConsignment(
            payload as unknown as ProcessIncomingInput,
          );
        default:
          throw new MercuryError("config", `Неизвестная операция ${action}`);
      }
    })();
    return { kind: "submitted", applicationId: submitted.applicationId };
  } catch (error) {
    return { kind: "error", error };
  }
}

/** Получение результата: шаг 2 протокола. */
async function receiveApplication(
  client: MercuryClient,
  applicationId: string,
): Promise<OutboxOutcome & { xml?: string }> {
  try {
    const result = await client.receive(applicationId);
    if (result.status === "COMPLETED") {
      return { kind: "completed", resultXml: result.xml, xml: result.xml };
    }
    return { kind: "inProcess" };
  } catch (error) {
    return { kind: "error", error };
  }
}

/** Записать страницу ВСД, пришедшую в ответ на заявку-чтение. */
async function applyVetDocumentPage(
  integration: IntegrationRow,
  payload: Record<string, unknown>,
  xml: string,
  action: string,
): Promise<{ created: number }> {
  const parsed = MercuryClient.parseResult(action, xml);
  if (parsed.kind !== "vetDocumentList") return { created: 0 };

  const enterpriseId = payload.enterpriseId ? String(payload.enterpriseId) : null;
  const enterprise = enterpriseId
    ? await db.mercuryEnterprise.findUnique({
        where: { id: enterpriseId },
        select: { id: true, enterpriseGuid: true, buildingId: true },
      })
    : null;
  if (!enterprise) return { created: 0 };

  const org = await db.organization.findUnique({
    where: { id: integration.organizationId },
    select: { timezone: true },
  });

  let created = 0;
  for (const vsd of parsed.page.documents) {
    const result = await upsertVetDocument({
      integration,
      enterprise,
      vsd,
      timezone: org?.timezone ?? null,
    });
    if (result.created) created += 1;
  }

  // Курсор двигаем ТОЛЬКО после успешной записи всей страницы.
  await db.mercuryIntegration.update({
    where: { id: integration.id },
    data: {
      changesCursorAt: payload.endDate ? new Date(String(payload.endDate)) : new Date(),
      lastSyncAt: new Date(),
      lastSyncError: null,
    },
  });

  return { created };
}

/** Записать результат гашения. */
async function applyProcessResult(
  vetDocumentId: string | null,
  xml: string,
): Promise<void> {
  if (!vetDocumentId) return;
  const parsed = MercuryClient.parseResult("processIncomingConsignment", xml);
  await db.mercuryVetDocument.update({
    where: { id: vetDocumentId },
    data: {
      localStatus: "processed",
      processedAt: new Date(),
      processError: null,
      remoteStatus: "UTILIZED",
      stockEntryGuid:
        parsed.kind === "processIncoming" ? parsed.stockEntryGuid : null,
    },
  });
}

export type OutboxRunResult = {
  processed: number;
  delivered: number;
  failed: number;
  retried: number;
};

/**
 * Один прогон очереди.
 *
 * Логика решений живёт в `outbox-policy.ts` и покрыта тестами; здесь —
 * только выполнение решения.
 */
export async function runMercuryOutbox(options: {
  limit?: number;
  now?: Date;
} = {}): Promise<OutboxRunResult> {
  const limit = options.limit ?? 50;
  const now = options.now ?? new Date();
  const result: OutboxRunResult = { processed: 0, delivered: 0, failed: 0, retried: 0 };

  const rows = await db.mercuryOutbox.findMany({
    where: { status: { in: ["pending", "submitted"] } },
    orderBy: [{ lastAttemptAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: limit,
    include: { integration: true },
  });

  for (const row of rows) {
    result.processed += 1;
    const integration = row.integration as IntegrationRow & { enabled: boolean };
    if (!integration.enabled) {
      await db.mercuryOutbox.update({
        where: { id: row.id },
        data: { lastAttemptAt: now, lastError: "integration_disabled" },
      });
      continue;
    }

    let client: MercuryClient;
    try {
      client = mercuryClientFor(integration);
    } catch (error) {
      await db.mercuryOutbox.update({
        where: { id: row.id },
        data: {
          status: "failed",
          lastAttemptAt: now,
          lastError: describeMercuryError(error),
        },
      });
      result.failed += 1;
      continue;
    }

    const payload = (row.payload ?? {}) as Record<string, unknown>;

    const outcome: OutboxOutcome & { xml?: string } = row.applicationId
      ? await receiveApplication(client, row.applicationId)
      : await submitApplication(client, row.action, payload);

    let decision = decideOutboxOutcome(
      {
        action: row.action,
        status: row.status,
        attempts: row.attempts,
        pollAttempts: row.pollAttempts,
        applicationId: row.applicationId,
        submittedAt: row.submittedAt,
      },
      outcome,
      now,
    );

    // Команда протухла: спрашиваем фактический статус ВСД, а не
    // отправляем гашение вслепую.
    if (decision.next === "verify" && row.vetDocumentId) {
      const doc = await db.mercuryVetDocument.findUnique({
        where: { id: row.vetDocumentId },
        select: { uuid: true },
      });
      if (doc) {
        try {
          const submitted = await client.submitGetVetDocumentByUuid({ uuid: doc.uuid });
          const check = await client.receive(submitted.applicationId);
          const parsed = MercuryClient.parseResult("getVetDocumentByUuid", check.xml);
          const status =
            parsed.kind === "vetDocument" ? (parsed.document?.status ?? "UNKNOWN") : "UNKNOWN";
          decision = decideAfterStatusCheck(status);
        } catch {
          decision = { next: "retry", reason: "Не удалось проверить статус ВСД" };
        }
      }
    }

    switch (decision.next) {
      case "submitted":
        await db.mercuryOutbox.update({
          where: { id: row.id },
          data: {
            status: "submitted",
            applicationId: decision.applicationId,
            submittedAt: now,
            lastAttemptAt: now,
            attempts: { increment: 1 },
            lastError: null,
          },
        });
        result.retried += 1;
        break;

      case "delivered": {
        if (outcome.xml) {
          if (row.action === "processIncomingConsignment") {
            await applyProcessResult(row.vetDocumentId, outcome.xml);
          } else if (row.action === "getActivityLocationList") {
            // «Загрузить площадки из Меркурия»: новые — без точки и выключены.
            const parsed = MercuryClient.parseResult(row.action, outcome.xml);
            if (parsed.kind === "enterprises") await applyEnterpriseList(integration, parsed.items);
          } else {
            await applyVetDocumentPage(integration, payload, outcome.xml, row.action);
          }
        } else if (row.action === "processIncomingConsignment" && row.vetDocumentId) {
          // Ветка «уже погашен»: результата нет, но факт есть.
          await db.mercuryVetDocument.update({
            where: { id: row.vetDocumentId },
            data: {
              localStatus: "processed",
              processedAt: new Date(),
              remoteStatus: "UTILIZED",
              processError: null,
            },
          });
        }
        await db.mercuryOutbox.update({
          where: { id: row.id },
          data: {
            status: "delivered",
            deliveredAt: now,
            lastAttemptAt: now,
            lastError: decision.reason ?? null,
          },
        });
        result.delivered += 1;
        break;
      }

      case "resubmit":
        await db.mercuryOutbox.update({
          where: { id: row.id },
          data: {
            status: "pending",
            applicationId: null,
            submittedAt: null,
            pollAttempts: 0,
            lastAttemptAt: now,
            lastError: decision.reason,
          },
        });
        result.retried += 1;
        break;

      case "retry":
        await db.mercuryOutbox.update({
          where: { id: row.id },
          data: {
            lastAttemptAt: now,
            attempts: { increment: outcome.kind === "error" ? 1 : 0 },
            pollAttempts: { increment: outcome.kind === "inProcess" ? 1 : 0 },
            lastError: decision.reason,
          },
        });
        result.retried += 1;
        break;

      case "failed":
        if (row.action === "processIncomingConsignment" && row.vetDocumentId) {
          await db.mercuryVetDocument.update({
            where: { id: row.vetDocumentId },
            data: { localStatus: "process_failed", processError: decision.reason },
          });
        }
        await db.mercuryOutbox.update({
          where: { id: row.id },
          data: {
            status: "failed",
            lastAttemptAt: now,
            attempts: { increment: 1 },
            lastError: decision.reason,
          },
        });
        result.failed += 1;
        break;

      default:
        break;
    }
  }

  return result;
}

/** Сколько ВСД ждут гашения и сколько просрочено — для шапки и алертов. */
/**
 * То же по точкам (2026-11-01): напоминание о горящем гашении — людям точки
 * площадки, а не всем руководителям организации. `buildingId` null — ВСД
 * без точки (общее, офису).
 */
export async function countPendingVetDocumentsByPoint(
  organizationId: string,
  timezone?: string | null,
): Promise<{ todayKey: string; points: Array<{ buildingId: string | null; pending: number; overdue: number }> }> {
  const now = new Date();
  const pendingWhere = { organizationId, localStatus: { in: ["new", "acknowledged"] } };
  const [pending, overdue] = await Promise.all([
    db.mercuryVetDocument.groupBy({ by: ["buildingId"], where: pendingWhere, _count: { _all: true } }),
    db.mercuryVetDocument.groupBy({
      by: ["buildingId"],
      where: { ...pendingWhere, processingDueAt: { lt: now } },
      _count: { _all: true },
    }),
  ]);
  const overdueByPoint = new Map(overdue.map((row) => [row.buildingId, row._count._all] as const));
  return {
    todayKey: orgTodayKey(timezone ?? undefined, now),
    points: pending.map((row) => ({
      buildingId: row.buildingId,
      pending: row._count._all,
      overdue: overdueByPoint.get(row.buildingId) ?? 0,
    })),
  };
}

export async function countPendingVetDocuments(
  organizationId: string,
  timezone?: string | null,
): Promise<{ pending: number; overdue: number; todayKey: string }> {
  const now = new Date();
  const [pending, overdue] = await Promise.all([
    db.mercuryVetDocument.count({
      where: { organizationId, localStatus: { in: ["new", "acknowledged"] } },
    }),
    db.mercuryVetDocument.count({
      where: {
        organizationId,
        localStatus: { in: ["new", "acknowledged"] },
        processingDueAt: { lt: now },
      },
    }),
  ]);
  return { pending, overdue, todayKey: orgTodayKey(timezone ?? undefined, now) };
}
