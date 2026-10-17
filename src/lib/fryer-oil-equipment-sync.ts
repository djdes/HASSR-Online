/**
 * Синхронизация журнала фритюра со справочником «Оборудование» — БД.
 * Правила — `fryer-oil-equipment-link.ts` (чистые функции, тесты).
 *
 * Зовётся при создании документа, при создании/изменении/удалении
 * фритюрницы, при открытии документа и QR-наклейки фритюрницы. Трогает
 * только АКТИВНЫЕ документы: закрытые предъявляют инспектору как есть.
 * Точка: фритюрница точки A не попадает в документ точки B; документ без
 * точки (общий) получает все фритюрницы, фритюрница без точки — во все.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  FRYER_OIL_TEMPLATE_CODE,
  normalizeFryerOilDocumentConfig,
  normalizeFryerOilEntryData,
} from "@/lib/fryer-oil-document";
import {
  FRYER_EQUIPMENT_TYPE,
  fryersForDocument,
  syncFryerOilEquipment,
} from "@/lib/fryer-oil-equipment-link";

export async function listDirectoryFryers(organizationId: string) {
  const rows = await db.equipment.findMany({
    // Как `isFryerEquipmentType`: код «fryer» и старое «Фритюрница» словом.
    where: {
      area: { organizationId },
      OR: [
        { type: { equals: FRYER_EQUIPMENT_TYPE, mode: "insensitive" } },
        { type: { equals: "фритюрница", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, area: { select: { buildingId: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, buildingId: row.area.buildingId }));
}

/**
 * Привести списки фритюрниц активных документов к справочнику. Возвращает
 * id изменённых документов. Best-effort для вызывающих: ошибка здесь не
 * должна ронять сохранение оборудования или открытие журнала.
 */
export async function syncFryerOilDocuments(
  organizationId: string,
  options: { documentIds?: string[] } = {},
): Promise<string[]> {
  const [fryers, documents] = await Promise.all([
    listDirectoryFryers(organizationId),
    db.journalDocument.findMany({
      where: {
        organizationId,
        status: "active",
        template: { code: FRYER_OIL_TEMPLATE_CODE },
        ...(options.documentIds ? { id: { in: options.documentIds } } : {}),
      },
      select: { id: true, buildingId: true, config: true },
    }),
  ]);
  const changedIds: string[] = [];
  for (const document of documents) {
    const config = normalizeFryerOilDocumentConfig(document.config);
    const directory = fryersForDocument(fryers, document.buildingId);
    // Образцы «Фритюрница №1–3» убираются, только если ими не подписана
    // ни одна строка — для этого нужны строки документа.
    const usedNames =
      directory.length > 0
        ? (
            await db.journalDocumentEntry.findMany({
              where: { documentId: document.id },
              select: { data: true },
            })
          )
            .map((entry) => normalizeFryerOilEntryData(entry.data).equipmentType)
            .filter(Boolean)
        : [];
    const result = syncFryerOilEquipment(config, directory, usedNames);
    if (!result.changed) continue;
    // Конфиг пишем поверх сырого JSON документа: в нём могут быть ключи,
    // которых нормализация не знает.
    const raw =
      document.config && typeof document.config === "object" && !Array.isArray(document.config)
        ? (document.config as Record<string, unknown>)
        : {};
    await db.journalDocument.update({
      where: { id: document.id },
      data: {
        config: {
          ...raw,
          lists: result.config.lists,
          equipmentLinks: result.config.equipmentLinks,
        } as Prisma.InputJsonValue,
      },
    });
    changedIds.push(document.id);
  }
  return changedIds;
}

/** Обёртка для мест, где синхронизация — побочное действие. */
export async function syncFryerOilDocumentsSafe(
  organizationId: string,
  options: { documentIds?: string[] } = {},
): Promise<void> {
  try {
    await syncFryerOilDocuments(organizationId, options);
  } catch (error) {
    console.error("[fryer-oil] equipment sync failed", error);
  }
}
