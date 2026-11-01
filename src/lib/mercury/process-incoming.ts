/**
 * Приёмка партии по ВСД: строка журнала + (опционально) гашение.
 *
 * Порядок операций здесь важнее кода. Сначала мы фиксируем СВОЙ
 * документ — строку журнала входного контроля, — и только потом ставим
 * команду гашения в очередь. Не наоборот.
 *
 * Причина в П-15: журнал приёмки это наш собственный юридически
 * значимый документ, и он не должен зависеть от доступности Ветис. Если
 * Меркурий лежит, у клиента всё равно есть заполненный журнал, а
 * гашение доедет само. Обратный порядок означал бы, что при недоступном
 * шлюзе приёмка не фиксируется вообще.
 */
import { randomUUID } from "node:crypto";

import { normalizeAcceptanceDocumentConfig } from "@/lib/acceptance-document";
import { logAudit } from "@/lib/audit";
import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { ensureActiveDocument } from "@/lib/journal-auto-create";
import { generateBatchKey } from "@/lib/journal-traceability";

import { enqueueMercuryApplication } from "./sync";
import type { ConsignmentDecision, VetDocument } from "./types";
import { applyPhysicalCheck, vsdToAcceptanceRow } from "./vsd-to-acceptance-row";

/** Шаблон, в который попадает приёмка по ВСД. */
const ACCEPTANCE_TEMPLATE_CODE = "incoming_control";

export type PhysicalCheckInput = {
  deliveryHour?: string;
  deliveryMinute?: string;
  transportConditionOk: boolean;
  packagingOk: boolean;
  organolepticOk: boolean;
  documentsOk: boolean;
  productTemperature?: string;
  actualVolume?: number | null;
  decision: ConsignmentDecision;
  discrepancyReason?: string;
  correctiveActions?: string;
};

export type ProcessIncomingOutcome = {
  vetDocumentId: string;
  journalDocumentId: string;
  journalRowId: string;
  batchKey: string;
  /** true — команда гашения поставлена в очередь. */
  queuedForProcessing: boolean;
};

/**
 * Записать приёмку и, если попросили, поставить гашение в очередь.
 *
 * `withdraw = false` — валидный сценарий: клиент ведёт журнал у нас, а
 * гасит сам в кабинете Меркурия. Тогда ВСД помечается `acknowledged`.
 */
export async function processIncomingVetDocument(input: {
  vetDocumentId: string;
  organizationId: string;
  actor: { id: string; name: string | null; role: string };
  check: PhysicalCheckInput;
  withdraw: boolean;
  /**
   * Точка, если у ВСД её нет (площадка не сопоставлена): торговая точка,
   * которую человек выбрал в шапке. Без точки при включённых точках
   * приёмку не оформляем — строка ушла бы в журнал не той точки.
   */
  fallbackBuildingId?: string | null;
}): Promise<ProcessIncomingOutcome> {
  const vsdRow = await db.mercuryVetDocument.findFirst({
    where: { id: input.vetDocumentId, organizationId: input.organizationId },
    include: { integration: true, enterprise: true },
  });
  if (!vsdRow) throw new Error("ВСД не найден");

  // Переход в processing только из состояний «ещё не гасили»: это часть
  // защиты от двойного гашения наравне с unique (организация, uuid).
  if (!["new", "acknowledged", "process_failed"].includes(vsdRow.localStatus)) {
    throw new Error(
      `ВСД уже в статусе «${vsdRow.localStatus}» — повторная приёмка невозможна`,
    );
  }

  const vsd: VetDocument = {
    uuid: vsdRow.uuid,
    number: vsdRow.number,
    docType: (vsdRow.docType as VetDocument["docType"]) ?? "UNKNOWN",
    status: (vsdRow.remoteStatus as VetDocument["status"]) ?? "UNKNOWN",
    issueDate: vsdRow.issueDate?.toISOString().slice(0, 10) ?? null,
    deliveryDate: vsdRow.deliveryDate?.toISOString().slice(0, 10) ?? null,
    consigneeEnterpriseGuid: vsdRow.enterprise?.enterpriseGuid ?? null,
    consignorEnterpriseGuid: null,
    consignorName: vsdRow.consignorName,
    consignorInn: vsdRow.consignorInn,
    manufacturerName: vsdRow.manufacturerName,
    productName: vsdRow.productName,
    productType: vsdRow.productType,
    volume: vsdRow.volume,
    unit: vsdRow.unit,
    batchNumber: vsdRow.batchNumber,
    productionDate: vsdRow.productionDate?.toISOString().slice(0, 10) ?? null,
    expiryDate: vsdRow.expiryDate?.toISOString().slice(0, 10) ?? null,
    transportInfo: vsdRow.transportInfo,
    accompanyingDocs: vsdRow.accompanyingDocs,
    raw: vsdRow.raw,
  };

  // 1. Документ журнала приёмки — тем же путём, что ночной cron, на точку
  // площадки ВСД (2026-11-01): раньше строка падала в журнал приёмки любой
  // точки, а без него создавался общий.
  const targets = await buildingTargets(input.organizationId);
  const orgPoints = targets.filter((id): id is string => Boolean(id));
  const pointId = orgPoints.length === 0
    ? null
    : [vsdRow.buildingId, input.fallbackBuildingId].find(
        (id): id is string => typeof id === "string" && orgPoints.includes(id),
      ) ?? null;
  if (orgPoints.length > 0 && !pointId) {
    throw new Error(
      "У ВСД не указана точка: выберите торговую точку вверху страницы, и приёмка попадёт в её журнал",
    );
  }
  const report = await ensureActiveDocument(db, {
    organizationId: input.organizationId,
    templateCode: ACCEPTANCE_TEMPLATE_CODE,
    now: new Date(),
    buildingId: pointId,
  });
  if (!report.documentId) {
    throw new Error("Не удалось открыть журнал приёмки");
  }

  const doc = await db.journalDocument.findUnique({
    where: { id: report.documentId },
    select: { id: true, config: true },
  });
  if (!doc) throw new Error("Журнал приёмки не найден");

  const config = normalizeAcceptanceDocumentConfig(doc.config);

  // 2. Строка: данные из ВСД + физический контроль, введённый человеком.
  const baseRow = vsdToAcceptanceRow({
    vsd,
    responsibleTitle: config.defaultResponsibleTitle ?? null,
    responsibleUserId: config.defaultResponsibleUserId ?? input.actor.id,
  });
  const row = applyPhysicalCheck(baseRow, {
    deliveryHour: input.check.deliveryHour,
    deliveryMinute: input.check.deliveryMinute,
    transportConditionOk: input.check.transportConditionOk,
    packagingOk: input.check.packagingOk,
    organolepticOk: input.check.organolepticOk,
    documentsOk: input.check.documentsOk,
    productTemperature: input.check.productTemperature,
    decision: input.check.decision === "ACCEPT" ? "accept" : "reject",
    correctiveActions: input.check.correctiveActions,
  });

  const batchKey = generateBatchKey(input.organizationId);

  await db.journalDocument.update({
    where: { id: doc.id },
    data: {
      config: {
        ...config,
        rows: [...config.rows, row],
        // Пополняем справочники документа — в следующий раз поставщик
        // и продукт уже будут в подсказках.
        products: Array.from(
          new Set([...config.products, row.productName].filter(Boolean)),
        ),
        manufacturers: Array.from(
          new Set([...config.manufacturers, row.manufacturer].filter(Boolean)),
        ),
        suppliers: Array.from(
          new Set([...config.suppliers, row.supplier].filter(Boolean)),
        ),
      } as never,
    },
  });

  // 3. Партия — чтобы приёмка была видна в прослеживаемости.
  const batch = await db.batch
    .create({
      data: {
        organizationId: input.organizationId,
        // Партия точки приёмки — той же, что и журнал (2026-11-01).
        buildingId: pointId,
        code: batchKey,
        productName: row.productName || "Без названия",
        supplier: row.supplier || null,
        // В схеме Batch quantity обязателен, а unit имеет default —
        // ВСД без объёма не должен ронять приёмку.
        quantity: vsdRow.volume ?? 0,
        unit: vsdRow.unit ?? "kg",
        receivedAt: vsdRow.deliveryDate ?? new Date(),
        expiryDate: vsdRow.expiryDate ?? null,
        status: input.check.decision === "ACCEPT" ? "received" : "rejected",
      },
      select: { id: true },
    })
    .catch(() => null);

  // 4. Отметка на ВСД. Статус зависит от того, гасим ли мы.
  await db.mercuryVetDocument.update({
    where: { id: vsdRow.id },
    data: {
      localStatus: input.withdraw ? "processing" : "acknowledged",
      journalDocumentId: doc.id,
      journalRowId: row.id,
      batchKey,
      batchId: batch?.id ?? null,
      processedById: input.actor.id,
      processDecision: input.check.decision,
      processError: null,
    },
  });

  // 5. И только теперь — команда в Меркурий, через очередь.
  let queued = false;
  if (input.withdraw) {
    await enqueueMercuryApplication({
      integrationId: vsdRow.integrationId,
      organizationId: input.organizationId,
      action: "processIncomingConsignment",
      isCommand: true,
      vetDocumentId: vsdRow.id,
      payload: {
        vetDocumentUuid: vsdRow.uuid,
        enterpriseGuid: vsdRow.enterprise?.enterpriseGuid ?? "",
        initiatorLogin: vsdRow.integration.initiatorLogin,
        decision: input.check.decision,
        actualVolume: input.check.actualVolume ?? null,
        unit: vsdRow.unit,
        transportConditionOk: input.check.transportConditionOk,
        packagingOk: input.check.packagingOk,
        documentsOk: input.check.documentsOk,
        productTemperature: input.check.productTemperature ?? null,
        discrepancyReason: input.check.discrepancyReason ?? null,
        // Ключ идемпотентности на нашей стороне, чтобы повтор запроса из
        // UI не создал вторую команду.
        clientKey: randomUUID(),
      },
    });
    queued = true;
  }

  await logAudit({
    organizationId: input.organizationId,
    userId: input.actor.id,
    userName: input.actor.name ?? undefined,
    action: input.withdraw ? "mercury.process" : "mercury.acknowledge",
    entity: "MercuryVetDocument",
    entityId: vsdRow.id,
    details: {
      uuid: vsdRow.uuid,
      number: vsdRow.number,
      decision: input.check.decision,
      journalDocumentId: doc.id,
      batchKey,
    },
  }).catch(() => {});

  return {
    vetDocumentId: vsdRow.id,
    journalDocumentId: doc.id,
    journalRowId: row.id,
    batchKey,
    queuedForProcessing: queued,
  };
}
