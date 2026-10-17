/**
 * Куда ляжет замер, снятый по QR-наклейке оборудования.
 *
 * Общая функция для страницы `/equipment-fill/[equipmentId]` и её POST:
 * раньше страница ничего не проверяла, и «журнала на сегодня нет»
 * человек узнавал только после «Сохранить» (409). Теперь оба решают по
 * одному и тому же ответу — страница рисует жёлтую плашку заранее.
 */

import { db } from "@/lib/db";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  normalizeColdEquipmentDocumentConfig,
  type ColdEquipmentConfigItem,
} from "@/lib/cold-equipment-document";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  normalizeClimateDocumentConfig,
  type ClimateDocumentConfig,
  type ClimateRoomConfig,
} from "@/lib/climate-document";
import { findClimateRowForEquipment } from "@/lib/climate-fill";
import { ensureQrPeriodDocuments } from "@/lib/journal-qr-rollover";
import {
  FRYER_OIL_TEMPLATE_CODE,
  normalizeFryerOilDocumentConfig,
  normalizeFryerOilEntryData,
  type FryerOilDocumentConfig,
} from "@/lib/fryer-oil-document";
import {
  fryerQrPhase,
  lastFryerValues,
  pickFryerQrRow,
  type FryerQrRow,
} from "@/lib/fryer-oil-equipment-link";
import { syncFryerOilDocuments } from "@/lib/fryer-oil-equipment-sync";

/** Текст 409 и жёлтой плашки — один на страницу и на API. */
export const EQUIPMENT_FILL_NO_DOCUMENT_ERROR =
  "Сегодня это оборудование не входит ни в один активный журнал температуры. Попросите управляющего создать документ или добавить в него оборудование.";

export type EquipmentFillTargets = {
  /** Активные на сегодня документы холодильного журнала с этим оборудованием. */
  coldDocuments: Array<{ id: string; items: ColdEquipmentConfigItem[] }>;
  /** Строка климат-журнала для цеха оборудования (для влажности). */
  climate: {
    documentId: string;
    config: ClimateDocumentConfig;
    row: ClimateRoomConfig;
  } | null;
  /** Есть куда записать замер. False — «Сохранить» заблокировано. */
  hasActiveDocument: boolean;
};

export async function resolveEquipmentFillTargets(params: {
  equipment: { id: string; areaId: string; areaName: string };
  organizationId: string;
  /** Начало сегодняшнего дня в зоне организации. */
  day: Date;
}): Promise<EquipmentFillTargets> {
  const { equipment, organizationId, day } = params;

  // Первый скан нового периода: документ холодильников создаётся по
  // образцу прошлого (те же холодильники), и замер ложится как обычно.
  await ensureQrPeriodDocuments({
    organizationId,
    templateCode: COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
    todayKey: day.toISOString().slice(0, 10),
    source: "equipment-fill",
  });
  const documents = await db.journalDocument.findMany({
    where: {
      organizationId,
      status: "active",
      template: { code: COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE },
      dateFrom: { lte: day },
      dateTo: { gte: day },
    },
    select: { id: true, config: true },
  });

  const coldDocuments = documents
    .map((doc) => ({
      id: doc.id,
      items: normalizeColdEquipmentDocumentConfig(doc.config).equipment.filter(
        (item) => item.sourceEquipmentId === equipment.id
      ),
    }))
    .filter((doc) => doc.items.length > 0);

  const climate = await resolveClimateTarget({ equipment, organizationId, day });

  return {
    coldDocuments,
    climate,
    hasActiveDocument: coldDocuments.length > 0 || climate !== null,
  };
}

/** Климат-журнал цеха — нужен только оборудованию с датчиком влажности. */
async function resolveClimateTarget(params: {
  equipment: { id: string; areaId: string; areaName: string };
  organizationId: string;
  day: Date;
}): Promise<EquipmentFillTargets["climate"]> {
  const { equipment, organizationId, day } = params;

  const mapping = await db.equipmentSensorMapping.findFirst({
    where: {
      equipmentId: equipment.id,
      readingType: "humidity",
      template: { code: CLIMATE_DOCUMENT_TEMPLATE_CODE },
    },
    select: { templateId: true },
  });
  if (!mapping) return null;

  await ensureQrPeriodDocuments({
    organizationId,
    templateCode: CLIMATE_DOCUMENT_TEMPLATE_CODE,
    todayKey: day.toISOString().slice(0, 10),
    source: "equipment-fill",
  });
  const document = await db.journalDocument.findFirst({
    where: {
      organizationId,
      templateId: mapping.templateId,
      status: "active",
      dateFrom: { lte: day },
      dateTo: { gte: day },
    },
    select: { id: true, config: true },
  });
  if (!document) return null;

  const config = normalizeClimateDocumentConfig(document.config);
  const row = findClimateRowForEquipment(config, {
    areaId: equipment.areaId,
    areaName: equipment.areaName,
  });
  if (!row) return null;

  return { documentId: document.id, config, row };
}

/** Текст 409 и жёлтой плашки наклейки фритюрницы. */
export const FRYER_FILL_NO_DOCUMENT_ERROR =
  "Сегодня эта фритюрница не входит ни в один активный журнал учёта фритюрных жиров. Попросите управляющего создать документ журнала.";

export type FryerFillTarget = {
  documentId: string;
  config: FryerOilDocumentConfig;
  /** Строка фритюрницы за сегодня (или заготовка дня, или «новая»). */
  row: FryerQrRow;
  /** Начало жарки или её окончание. */
  phase: "start" | "end";
  /** Жир и продукция прошлой жарки этой фритюрницы — значения по умолчанию. */
  last: { fatType: string; productType: string } | null;
};

/**
 * Куда ляжет запись с наклейки фритюрницы (2026-10-17): активный на
 * сегодня документ журнала фритюрных жиров, в списке которого есть эта
 * фритюрница (`equipmentLinks`). Сначала документ точки фритюрницы, потом
 * общий. Перед поиском — переход периода (как у холодильников) и
 * синхронизация со справочником: фритюрница, заведённая минуту назад, уже
 * в журнале. `null` — записать некуда, «Сохранить» заблокировано.
 */
export async function resolveFryerFillTarget(params: {
  equipment: { id: string; name: string; buildingId: string | null };
  organizationId: string;
  /** Начало сегодняшнего дня в зоне организации. */
  day: Date;
}): Promise<FryerFillTarget | null> {
  const { equipment, organizationId, day } = params;
  const todayKey = day.toISOString().slice(0, 10);
  await ensureQrPeriodDocuments({
    organizationId,
    templateCode: FRYER_OIL_TEMPLATE_CODE,
    todayKey,
    anchor: equipment.buildingId ? { buildingId: equipment.buildingId } : undefined,
    source: "equipment-fill",
  });
  try {
    await syncFryerOilDocuments(organizationId);
  } catch (error) {
    console.error("[equipment-fill] fryer sync failed", error);
  }
  const documents = await db.journalDocument.findMany({
    where: {
      organizationId,
      status: "active",
      template: { code: FRYER_OIL_TEMPLATE_CODE },
      dateFrom: { lte: day },
      dateTo: { gte: day },
    },
    select: { id: true, buildingId: true, config: true },
    orderBy: { dateFrom: "desc" },
  });
  const linked = documents
    .map((doc) => ({ ...doc, parsed: normalizeFryerOilDocumentConfig(doc.config) }))
    .filter((doc) => doc.parsed.equipmentLinks.some((link) => link.sourceEquipmentId === equipment.id));
  const document =
    linked.find((doc) => equipment.buildingId && doc.buildingId === equipment.buildingId) ??
    linked.find((doc) => !doc.buildingId) ??
    linked[0];
  if (!document) return null;

  // Документ — на период (обычно месяц): строк немного, берём все — нужны
  // и сегодняшняя строка, и вчерашние жир с продукцией для подсказки.
  const entries = (
    await db.journalDocumentEntry.findMany({
      where: { documentId: document.id },
      select: { id: true, date: true, data: true },
      orderBy: { date: "asc" },
    })
  ).map((entry) => ({
    id: entry.id,
    date: entry.date.toISOString(),
    data: normalizeFryerOilEntryData(entry.data),
  }));
  const target = { equipmentId: equipment.id, equipmentName: equipment.name, dayKey: todayKey };
  const row = pickFryerQrRow(entries, target);
  return {
    documentId: document.id,
    config: document.parsed,
    row,
    phase: fryerQrPhase(row),
    last: lastFryerValues(entries, target),
  };
}
