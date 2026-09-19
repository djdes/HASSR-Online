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
