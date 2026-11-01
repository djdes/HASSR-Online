import { worksAtBuilding } from "@/lib/building-settings";
import { pickPrimaryManager } from "@/lib/user-roles";

/**
 * Датчики и точки (2026-11-01). Показание холодильника точки А раньше
 * уходило в первый попавшийся активный документ организации — то есть
 * в журнал точки Б, а подписывал запись руководитель любой точки.
 * Здесь — выбор документа и подписанта по точке оборудования
 * (`Equipment.area.buildingId`). Чистые функции: их читают cron Tuya и
 * внешний API датчиков, проверяют тесты.
 */

export type SensorDocumentCandidate = {
  id: string;
  buildingId: string | null;
  config: unknown;
};

/** Где в `config` документа лежат строки: холодильники или помещения. */
export type SensorRowList = "equipment" | "rooms";

/**
 * Ключи строк документа, которые относятся к оборудованию: строка с тем же
 * id или с `sourceEquipmentId` этого оборудования.
 */
export function sensorRowKeys(config: unknown, equipmentId: string, list: SensorRowList): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const rows = (config as Record<string, unknown>)[list];
  if (!Array.isArray(rows)) return [];
  const keys: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { id, sourceEquipmentId } = row as { id?: unknown; sourceEquipmentId?: unknown };
    if (typeof id !== "string" || id.length === 0) continue;
    if ((id === equipmentId || sourceEquipmentId === equipmentId) && !keys.includes(id)) keys.push(id);
  }
  return keys;
}

/**
 * Документы, куда писать показание оборудования точки `pointId`:
 *  1. документы своей точки и общие (без точки), где оборудование есть в
 *     строках, — все такие (как `iot-auto-fill`);
 *  2. иначе один документ: своей точки, затем общий;
 *  3. оборудование без точки (цех без точки, точки выключены): документы,
 *     где оно есть в строках, иначе общий документ, иначе единственный.
 * Документ чужой точки не выбирается никогда. `keys` пустой — документ
 * выбран без строки оборудования (запись по id оборудования, как раньше).
 */
export function pickSensorDocuments<T extends SensorDocumentCandidate>(
  docs: readonly T[],
  args: { pointId: string | null; rowKeys: (doc: T) => string[] },
): Array<{ doc: T; keys: string[] }> {
  const candidates = args.pointId
    ? docs.filter((doc) => doc.buildingId === args.pointId || doc.buildingId === null)
    : [...docs];
  const listing = candidates
    .map((doc) => ({ doc, keys: args.rowKeys(doc) }))
    .filter((item) => item.keys.length > 0);
  if (listing.length > 0) return listing;
  const own = args.pointId ? candidates.find((doc) => doc.buildingId === args.pointId) : undefined;
  const shared = candidates.find((doc) => doc.buildingId === null);
  const fallback = own ?? shared ?? (!args.pointId && candidates.length === 1 ? candidates[0] : undefined);
  return fallback ? [{ doc: fallback, keys: [] }] : [];
}

/**
 * Кто подписывает запись датчика в документе точки: руководитель этой
 * точки (или сотрудник, если руководителя нет), без точки — вся
 * организация. На точке никого — запасной вариант по всей организации,
 * как раньше: у записи должен быть живой автор (FK).
 */
export function pickPointSigner<T extends { role?: string | null; buildingIds?: string[] | null }>(
  users: readonly T[],
  buildingId: string | null,
): T | null {
  const local = users.filter((user) => worksAtBuilding(user, buildingId));
  return pickPrimaryManager(local.length > 0 ? local : [...users]);
}
