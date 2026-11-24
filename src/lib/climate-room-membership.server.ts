import { Prisma } from "@prisma/client";

import { buildingWhere } from "@/lib/building-scope";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  normalizeClimateDocumentConfig,
  normalizeClimateRoomNorms,
} from "@/lib/climate-document";
import {
  climateRowHasReadings,
  findClimateRowIndex,
  pickClimateDocumentsForRoom,
  planClimateRoomMembership,
} from "@/lib/climate-room-membership";
import { db } from "@/lib/db";
import { orgTodayKey } from "@/lib/timezone";

/**
 * Климат помещения включили или выключили — правим действующие документы
 * журнала климата (сегодняшний период и будущие) объекта помещения. Правила —
 * `planClimateRoomMembership`. Ошибка не должна ломать сохранение помещения:
 * вызывающий ловит её и пишет в лог.
 */
export async function syncRoomClimateDocuments(args: {
  organizationId: string;
  roomId: string;
}): Promise<{ updated: number }> {
  const room = await db.room.findFirst({
    where: { id: args.roomId, building: { organizationId: args.organizationId } },
    select: {
      id: true,
      name: true,
      climateNorms: true,
      buildingId: true,
      building: { select: { organization: { select: { timezone: true } } } },
    },
  });
  if (!room) return { updated: 0 };
  const controlled = normalizeClimateRoomNorms(room.climateNorms) !== null;
  const todayKey = orgTodayKey(room.building.organization.timezone || "Europe/Moscow");
  const today = new Date(`${todayKey}T00:00:00.000Z`);

  const documents = await db.journalDocument.findMany({
    where: {
      organizationId: args.organizationId,
      status: "active",
      template: { code: CLIMATE_DOCUMENT_TEMPLATE_CODE },
      dateTo: { gte: today },
      ...buildingWhere(room.buildingId),
    },
    select: { id: true, config: true, buildingId: true },
    orderBy: [{ dateFrom: "asc" }, { createdAt: "asc" }],
  });
  const candidates = documents.map((doc) => {
    const config = normalizeClimateDocumentConfig(doc.config);
    return { ...doc, normalized: config, hasRoom: findClimateRowIndex(config.rooms, room.id) >= 0 };
  });

  let updated = 0;
  for (const doc of pickClimateDocumentsForRoom(candidates, room.buildingId)) {
    // Замеры читаем, только когда строку собираются убрать.
    const entries =
      !controlled && doc.hasRoom
        ? await db.journalDocumentEntry.findMany({ where: { documentId: doc.id }, select: { data: true } })
        : [];
    const finalPlan = planClimateRoomMembership({
      rooms: doc.normalized.rooms,
      room,
      controlled,
      hasReadings: (rowId) => climateRowHasReadings(entries, rowId),
    });
    if (finalPlan.action !== "write") continue;
    const rawConfig =
      doc.config && typeof doc.config === "object" && !Array.isArray(doc.config)
        ? (doc.config as Record<string, unknown>)
        : {};
    await db.journalDocument.update({
      where: { id: doc.id },
      data: { config: { ...rawConfig, rooms: finalPlan.rooms } as Prisma.InputJsonValue },
    });
    updated += 1;
  }
  return { updated };
}
