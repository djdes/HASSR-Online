import { buildingTargets } from "@/lib/building-targets";
import { CLEANING_DOCUMENT_TEMPLATE_CODE } from "@/lib/cleaning-document";
import { CLIMATE_DOCUMENT_TEMPLATE_CODE } from "@/lib/climate-document";
import { COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE, createColdEquipmentConfigItem } from "@/lib/cold-equipment-document";
import { db } from "@/lib/db";
import { EQUIPMENT_CALIBRATION_TEMPLATE_CODE } from "@/lib/equipment-calibration-document";
import { EQUIPMENT_MAINTENANCE_TEMPLATE_CODE } from "@/lib/equipment-maintenance-document";
import { syncUvDocumentPoints } from "@/lib/uv-document-points";
import { isUvLampEquipment } from "@/lib/uv-lamp";

/**
 * Документы точки, собранные до разделения журналов по точкам (до
 * 2026-10-29), — без «Пересоздать документы» (владелец и партнёр,
 * 2026-10-30: «в журналах темп. режима — всё оборудование организации»;
 * «чтобы ТТ не своё просто не видела»).
 *
 * Активный документ точки держит только своё:
 *  - оборудование (холодильники, поверка, обслуживание) — цехов этой точки,
 *    цехов без точки и ручные строки; строки оборудования других точек
 *    убираются из конфига;
 *  - помещения (климат, уборка) — этой точки;
 *  - сотрудники (гигиена, здоровье) — см. `visiblePointStaffEntries`:
 *    записи не удаляем, строки сотрудников других точек не показываем.
 * Закрытые документы — история, их не трогаем. Показания из убранной строки
 * не теряются: QR холодильника пишет во все документы с этим холодильником,
 * то есть и в документ его точки.
 */

export const POINT_ROWS_CONFIG_CODES = [
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  EQUIPMENT_CALIBRATION_TEMPLATE_CODE,
  EQUIPMENT_MAINTENANCE_TEMPLATE_CODE,
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  CLEANING_DOCUMENT_TEMPLATE_CODE,
] as const;

export const POINT_STAFF_CODES = ["hygiene", "health_check"] as const;

export type PointDirectory = {
  /** Оборудование → точка его цеха (null — цех без точки). */
  equipmentPoint: ReadonlyMap<string, string | null>;
  /** Помещение → его точка. */
  roomPoint: ReadonlyMap<string, string>;
  /**
   * Холодильное оборудование организации (как в новом документе: холодильник,
   * морозильник или задана норма; не УФ-лампа) — для пустого журнала точки.
   */
  coldEquipment?: ReadonlyArray<{ id: string; name: string; pointId: string | null; min: number | null; max: number | null }>;
};

/** Оборудование идёт в журнал холодильников — правило `buildColdEquipmentConfigFromEquipment`. */
export function isColdJournalEquipment(item: {
  type?: string | null;
  name?: string | null;
  tempMin?: number | null;
  tempMax?: number | null;
}): boolean {
  if (isUvLampEquipment(item)) return false;
  const type = item.type?.toLowerCase();
  return type === "refrigerator" || type === "freezer" || item.tempMin != null || item.tempMax != null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function linked(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Конфиг документа точки без строк других точек; null — менять нечего.
 * Неизвестный журнал, ручная строка, удалённое оборудование или помещение,
 * цех без точки — остаются.
 */
export function trimPointDocumentConfig(
  templateCode: string,
  config: unknown,
  pointId: string,
  directory: PointDirectory,
): { config: Record<string, unknown>; removed: number } | null {
  const record = asRecord(config);
  if (!record) return null;
  const foreignEquipment = (id: string | null) => {
    if (!id || !directory.equipmentPoint.has(id)) return false;
    const point = directory.equipmentPoint.get(id) ?? null;
    return point !== null && point !== pointId;
  };
  const foreignRoom = (id: string | null) => Boolean(id && directory.roomPoint.has(id) && directory.roomPoint.get(id) !== pointId);

  const filterList = (key: string, isForeign: (item: Record<string, unknown>) => boolean) => {
    const list = record[key];
    if (!Array.isArray(list)) return null;
    const kept = list.filter((item) => {
      const row = asRecord(item);
      return !row || !isForeign(row);
    });
    return kept.length === list.length ? null : { config: { ...record, [key]: kept }, removed: list.length - kept.length };
  };

  if (templateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE) {
    const trimmed = filterList("equipment", (row) => foreignEquipment(linked(row.sourceEquipmentId)));
    // Пустой журнал точки, а холодильники у точки есть: документ собран
    // раньше, чем их завели (д/с №83, 2026-10-30), — ставим их, как в новом
    // документе. Журнал с ручными строками не трогаем.
    const rows = (trimmed?.config.equipment ?? record.equipment) as unknown;
    const own = (directory.coldEquipment ?? []).filter((item) => item.pointId === pointId || item.pointId === null);
    if (Array.isArray(rows) && rows.length === 0 && own.length > 0) {
      return {
        config: {
          ...(trimmed?.config ?? record),
          equipment: own.map((item) =>
            createColdEquipmentConfigItem({ sourceEquipmentId: item.id, name: item.name, min: item.min, max: item.max }),
          ),
        },
        removed: trimmed?.removed ?? 0,
      };
    }
    return trimmed;
  }
  if (templateCode === EQUIPMENT_CALIBRATION_TEMPLATE_CODE || templateCode === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE) {
    return filterList("rows", (row) => foreignEquipment(linked(row.sourceEquipmentId)));
  }
  if (templateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE) {
    return filterList("rooms", (row) => foreignRoom(linked(row.roomId)));
  }
  if (templateCode === CLEANING_DOCUMENT_TEMPLATE_CODE) {
    const selected = record.selectedRoomIds;
    if (!Array.isArray(selected)) return null;
    const kept = selected.filter((id) => !foreignRoom(linked(id)));
    return kept.length === selected.length
      ? null
      : { config: { ...record, selectedRoomIds: kept }, removed: selected.length - kept.length };
  }
  return null;
}

/** Ключи записи гигиены, которые ставит человек (QR, подтверждение, правка). */
const HUMAN_MARK_KEYS = ["confirmations", "confirmedAt", "source", "verification", "editedById", "editedByName"];

function hasHumanMark(data: unknown): boolean {
  const record = asRecord(data);
  return Boolean(record && HUMAN_MARK_KEYS.some((key) => record[key] !== undefined && record[key] !== null));
}

/**
 * Записи гигиены / здоровья, которые показывать в активном документе точки:
 * сотрудники этой точки и без точек, неизвестные (нет в справочнике — не
 * прячем историю) и все, у кого в документе есть отметка человека.
 * Точки, которых больше нет в организации, не считаются.
 */
export function visiblePointStaffEntries<T extends { employeeId: string; data: unknown }>(
  entries: ReadonlyArray<T>,
  pointId: string,
  staffBuildingIds: ReadonlyMap<string, ReadonlyArray<string>>,
  livePointIds: ReadonlySet<string>,
): T[] {
  const marked = new Set(entries.filter((entry) => hasHumanMark(entry.data)).map((entry) => entry.employeeId));
  const visible = (employeeId: string) => {
    if (marked.has(employeeId)) return true;
    const ids = staffBuildingIds.get(employeeId);
    if (!ids) return true;
    const live = ids.filter((id) => livePointIds.has(id));
    return live.length === 0 || live.includes(pointId);
  };
  return entries.filter((entry) => visible(entry.employeeId));
}

/**
 * Точка, по которой режем строки документа: активный документ на точке
 * организации с включёнными точками; иначе null — показываем как есть.
 */
export function pointForRows(
  document: { status: string; buildingId: string | null },
  targets: ReadonlyArray<string | null>,
): string | null {
  if (document.status !== "active" || !document.buildingId) return null;
  return targets.includes(document.buildingId) ? document.buildingId : null;
}

/** Активные документы точек организации — без строк других точек. Сколько документов поправлено. */
export async function syncPointDocumentRows(
  organizationId: string,
  options: { documentId?: string } = {},
): Promise<number> {
  const targets = await buildingTargets(organizationId);
  const livePoints = targets.filter((id): id is string => Boolean(id));
  if (livePoints.length === 0) return 0;
  const documents = await db.journalDocument.findMany({
    where: {
      organizationId,
      status: "active",
      buildingId: { in: livePoints },
      template: { code: { in: [...POINT_ROWS_CONFIG_CODES] } },
      ...(options.documentId ? { id: options.documentId } : {}),
    },
    select: { id: true, buildingId: true, config: true, template: { select: { code: true } } },
  });
  if (documents.length === 0) return 0;
  const [equipment, rooms] = await Promise.all([
    db.equipment.findMany({
      where: { area: { organizationId } },
      select: { id: true, name: true, type: true, tempMin: true, tempMax: true, area: { select: { buildingId: true } } },
      orderBy: { name: "asc" },
    }),
    db.room.findMany({ where: { building: { organizationId } }, select: { id: true, buildingId: true } }),
  ]);
  const directory: PointDirectory = {
    equipmentPoint: new Map(equipment.map((item) => [item.id, item.area.buildingId])),
    roomPoint: new Map(rooms.map((room) => [room.id, room.buildingId])),
    coldEquipment: equipment
      .filter(isColdJournalEquipment)
      .map((item) => ({ id: item.id, name: item.name, pointId: item.area.buildingId, min: item.tempMin, max: item.tempMax })),
  };
  let fixed = 0;
  for (const document of documents) {
    if (!document.buildingId) continue;
    const trimmed = trimPointDocumentConfig(document.template.code, document.config, document.buildingId, directory);
    if (!trimmed) continue;
    await db.journalDocument.update({ where: { id: document.id }, data: { config: trimmed.config as never } });
    fixed += 1;
  }
  return fixed;
}

const lastOrgSync = new Map<string, number>();
const ORG_SYNC_EVERY_MS = 10 * 60 * 1000;

/**
 * Не чаще раза в 10 минут на организацию (в памяти процесса): журналы точек
 * и журналы УФ-ламп. Зовётся из макета кабинета без ожидания — первый же
 * заход руководителя после выкладки чинит документы организации.
 */
export function syncOrganizationPointDocumentsSoon(organizationId: string): void {
  const now = Date.now();
  if ((lastOrgSync.get(organizationId) ?? 0) > now - ORG_SYNC_EVERY_MS) return;
  lastOrgSync.set(organizationId, now);
  void Promise.all([syncPointDocumentRows(organizationId), syncUvDocumentPoints(organizationId)]).catch((error) => {
    console.warn(`[point-document-rows] ${organizationId}`, error);
  });
}

/** Все организации с включёнными точками — для часового крона. */
export async function syncAllPointDocumentRows(): Promise<number> {
  const organizations = await db.organization.findMany({ where: { perLocationJournals: true }, select: { id: true } });
  let fixed = 0;
  for (const { id } of organizations) {
    fixed += await syncPointDocumentRows(id).catch((error) => {
      console.warn(`[point-document-rows] ${id}`, error);
      return 0;
    });
  }
  return fixed;
}
