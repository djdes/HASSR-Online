import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { rowsPointFromTargets } from "@/lib/document-point-rows";
import { isUvLampEquipment } from "@/lib/uv-lamp";
import { UV_LAMP_RUNTIME_TEMPLATE_CODE, normalizeUvRuntimeDocumentConfig } from "@/lib/uv-lamp-runtime-document";

/**
 * Документ журнала УФ-лампы живёт на точке цеха лампы (владелец, 2026-10-30:
 * «УФ установки из 4 гимназии теперь у всех ТТ»).
 *
 * Документ без точки виден во всех точках. Документы ламп, заведённые по QR
 * до 2026-10-29 (тогда без точки) или при выключенных точках, так и остались
 * без точки — и журнал лампы одной точки висел во всех. Правило:
 *  - документ лампы без точки или на удалённой точке → на точку цеха лампы;
 *  - активный документ лампы на другой точке → тоже: лампу перенесли, а
 *    сеансы по QR пишутся в этот документ;
 *  - закрытый документ на живой точке не трогаем — это история;
 *  - лампа в цехе без точки (общая) или удалена → документ как есть.
 * Лампа документа — `config.equipmentId`; старый документ без связи — по
 * номеру установки, если он совпадает с названием ровно одной лампы.
 */

export type UvLampPoint = { id: string; name: string; pointId: string | null };
export type UvDocumentPointRow = { id: string; status: string; buildingId: string | null; config: unknown };
export type UvDocumentPointFix = { id: string; buildingId: string };

function nameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Какие документы УФ перенести на точку их лампы (чистая функция). */
export function uvDocumentPointFixes(
  documents: ReadonlyArray<UvDocumentPointRow>,
  lamps: ReadonlyArray<UvLampPoint>,
  targets: ReadonlyArray<string | null>,
): UvDocumentPointFix[] {
  const livePoints = new Set(targets.filter((id): id is string => Boolean(id)));
  if (livePoints.size === 0) return [];
  const byId = new Map(lamps.map((lamp) => [lamp.id, lamp]));
  const byName = new Map<string, UvLampPoint | null>();
  for (const lamp of lamps) {
    const key = nameKey(lamp.name);
    // Две лампы с одним названием — по номеру не угадываем.
    byName.set(key, byName.has(key) ? null : lamp);
  }
  const fixes: UvDocumentPointFix[] = [];
  for (const document of documents) {
    const config = normalizeUvRuntimeDocumentConfig(document.config);
    const lamp = config.equipmentId
      ? byId.get(config.equipmentId) ?? null
      : byName.get(nameKey(config.lampNumber)) ?? null;
    if (!lamp?.pointId || document.buildingId === lamp.pointId) continue;
    const placed = document.buildingId !== null && livePoints.has(document.buildingId);
    if (placed && document.status !== "active") continue;
    fixes.push({ id: document.id, buildingId: lamp.pointId });
  }
  return fixes;
}

/** Точка цеха лампы среди точек организации; цех без точки, точки выключены — null. */
export async function uvLampPointId(organizationId: string, equipmentId: string): Promise<string | null> {
  const lamp = await db.equipment.findFirst({
    where: { id: equipmentId, area: { organizationId } },
    select: { area: { select: { buildingId: true } } },
  });
  if (!lamp?.area.buildingId) return null;
  return rowsPointFromTargets(await buildingTargets(organizationId), lamp.area.buildingId);
}

/**
 * Переносит документы УФ организации на точки их ламп. Возвращает, сколько
 * документов перенесено. Дёшево и идемпотентно: при каждом открытии журнала,
 * раз в час кроном и после переноса лампы или цеха.
 */
export async function syncUvDocumentPoints(organizationId: string): Promise<number> {
  const targets = await buildingTargets(organizationId);
  if (!targets.some(Boolean)) return 0;
  const documents = await db.journalDocument.findMany({
    where: { organizationId, template: { code: UV_LAMP_RUNTIME_TEMPLATE_CODE } },
    select: { id: true, status: true, buildingId: true, config: true },
  });
  if (documents.length === 0) return 0;
  const linkedIds = new Set(
    documents
      .map((document) => normalizeUvRuntimeDocumentConfig(document.config).equipmentId)
      .filter((id): id is string => Boolean(id)),
  );
  const equipment = await db.equipment.findMany({
    where: { area: { organizationId } },
    select: { id: true, name: true, type: true, area: { select: { buildingId: true } } },
  });
  const lamps = equipment
    .filter((item) => linkedIds.has(item.id) || isUvLampEquipment(item))
    .map((item) => ({ id: item.id, name: item.name, pointId: rowsPointFromTargets(targets, item.area.buildingId) }));
  const fixes = uvDocumentPointFixes(documents, lamps, targets);
  const byPoint = new Map<string, string[]>();
  for (const fix of fixes) byPoint.set(fix.buildingId, [...(byPoint.get(fix.buildingId) ?? []), fix.id]);
  let moved = 0;
  for (const [buildingId, ids] of byPoint) {
    const result = await db.journalDocument.updateMany({
      where: { id: { in: ids }, organizationId },
      data: { buildingId },
    });
    moved += result.count;
  }
  return moved;
}

/** Все организации с журналом УФ — для часового крона. */
export async function syncAllUvDocumentPoints(): Promise<number> {
  const organizations = await db.journalDocument.findMany({
    where: { template: { code: UV_LAMP_RUNTIME_TEMPLATE_CODE } },
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  let moved = 0;
  for (const { organizationId } of organizations) {
    moved += await syncUvDocumentPoints(organizationId).catch((error) => {
      console.warn(`[uv-document-points] ${organizationId}`, error);
      return 0;
    });
  }
  return moved;
}
