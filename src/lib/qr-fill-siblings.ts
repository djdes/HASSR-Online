import { buildingWhere } from "@/lib/building-scope";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  normalizeClimateDocumentConfig,
  type ClimateMeasurement,
} from "@/lib/climate-document";
import { pickNearestControlTime } from "@/lib/climate-fill";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  coldReadingSlotKey,
  normalizeColdEquipmentDocumentConfig,
  normalizeColdEquipmentEntryData,
} from "@/lib/cold-equipment-document";
import { db } from "@/lib/db";
import { mintQrFillToken } from "@/lib/qr-fill-token";
import type { QuickSwitchItem } from "@/components/qr-fill/quick-switch";

/**
 * Соседние объекты для быстрой смены на QR-страницах замера: ответственный
 * обходит склады или холодильники по очереди, не сканируя каждый плакат.
 * Статус «снято сегодня» и значения считаются по записям за день всех
 * сотрудников; ссылки — с бессрочными токенами тех же плакатов.
 */

function formatValue(value: number | null | undefined, unit: string): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `${value} ${unit}` : null;
}

export async function listRoomSiblings(params: {
  organizationId: string;
  buildingId: string;
  currentRoomId: string;
  currentRoomName: string;
  day: Date;
  now: Date;
  timezone: string;
}): Promise<QuickSwitchItem[]> {
  const documents = await db.journalDocument.findMany({
    where: {
      organizationId: params.organizationId,
      status: "active",
      template: { code: CLIMATE_DOCUMENT_TEMPLATE_CODE },
      dateFrom: { lte: params.day },
      dateTo: { gte: params.day },
      ...buildingWhere(params.buildingId),
    },
    select: { id: true, config: true },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
  });
  if (documents.length === 0) return [];

  const rows: Array<{ roomId: string; rowId: string; name: string; documentId: string; slot: string }> = [];
  const seen = new Set<string>();
  for (const doc of documents) {
    const config = normalizeClimateDocumentConfig(doc.config);
    const slot = pickNearestControlTime(config.controlTimes, params.now, params.timezone);
    for (const room of config.rooms) {
      const roomId = room.roomId ?? null;
      if (!roomId || seen.has(roomId)) continue;
      seen.add(roomId);
      rows.push({ roomId, rowId: room.id, name: room.name, documentId: doc.id, slot });
    }
  }
  if (rows.length === 0) return [];

  const entries = await db.journalDocumentEntry.findMany({
    where: { documentId: { in: documents.map((doc) => doc.id) }, date: params.day },
    select: { documentId: true, data: true },
  });
  const measurementOf = (documentId: string, rowId: string, slot: string): ClimateMeasurement | null => {
    for (const entry of entries) {
      if (entry.documentId !== documentId) continue;
      const data = entry.data && typeof entry.data === "object" ? (entry.data as { measurements?: Record<string, Record<string, ClimateMeasurement>> }) : null;
      const cell = data?.measurements?.[rowId]?.[slot];
      if (cell && (typeof cell.temperature === "number" || typeof cell.humidity === "number")) return cell;
    }
    return null;
  };

  const items: QuickSwitchItem[] = rows.map((row) => {
    const cell = measurementOf(row.documentId, row.rowId, row.slot);
    const summary = cell ? [formatValue(cell.temperature, "°C"), formatValue(cell.humidity, "%")].filter(Boolean).join(" · ") : null;
    return {
      id: row.roomId,
      name: row.name,
      sublabel: null,
      href: `/room-fill/${row.roomId}?token=${encodeURIComponent(mintQrFillToken("room", row.roomId))}`,
      filled: cell !== null,
      summary: summary || null,
      values: cell ? { temperature: cell.temperature ?? null, humidity: cell.humidity ?? null } : null,
      current: row.roomId === params.currentRoomId,
    };
  });
  if (!items.some((item) => item.current)) {
    items.unshift({ id: params.currentRoomId, name: params.currentRoomName, href: "#", filled: false, current: true });
  }
  return items;
}

export async function listEquipmentSiblings(params: {
  organizationId: string;
  currentEquipmentId: string;
  currentEquipmentName: string;
  day: Date;
}): Promise<QuickSwitchItem[]> {
  const documents = await db.journalDocument.findMany({
    where: {
      organizationId: params.organizationId,
      status: "active",
      template: { code: COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE },
      dateFrom: { lte: params.day },
      dateTo: { gte: params.day },
    },
    select: { id: true, config: true },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
  });
  if (documents.length === 0) return [];

  const entries = await db.journalDocumentEntry.findMany({
    where: { documentId: { in: documents.map((doc) => doc.id) }, date: params.day },
    select: { documentId: true, data: true },
  });
  const temperatureOf = (documentId: string, itemId: string): number | null => {
    const key = coldReadingSlotKey(itemId, 0);
    for (const entry of entries) {
      if (entry.documentId !== documentId) continue;
      const value = normalizeColdEquipmentEntryData(entry.data ?? null).temperatures[key];
      if (typeof value === "number") return value;
    }
    return null;
  };

  const items: QuickSwitchItem[] = [];
  const seen = new Set<string>();
  for (const doc of documents) {
    const config = normalizeColdEquipmentDocumentConfig(doc.config);
    for (const item of config.equipment) {
      const equipmentId = item.sourceEquipmentId ?? null;
      if (!equipmentId || seen.has(equipmentId)) continue;
      seen.add(equipmentId);
      const temperature = temperatureOf(doc.id, item.id);
      items.push({
        id: equipmentId,
        name: item.name,
        sublabel: null,
        href: `/equipment-fill/${equipmentId}?token=${encodeURIComponent(mintQrFillToken("equipment", equipmentId))}`,
        filled: temperature !== null,
        summary: formatValue(temperature, "°C"),
        values: temperature !== null ? { temperature } : null,
        current: equipmentId === params.currentEquipmentId,
      });
    }
  }
  if (items.length > 0 && !items.some((item) => item.current)) {
    items.unshift({ id: params.currentEquipmentId, name: params.currentEquipmentName, href: "#", filled: false, current: true });
  }
  return items;
}
