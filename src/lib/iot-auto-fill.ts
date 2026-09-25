/**
 * Helpers for IoT-driven journal auto-fill. Tuya cron collects device
 * readings → these helpers mirror the same readings into the modern
 * JournalDocumentEntry tables so the grid journals (cold_equipment_control,
 * climate_control) light up their «сегодня» cells without anyone typing.
 *
 * Idempotent: each function re-reads the current entry, merges in the new
 * reading, and upserts. Running the tuya cron twice in an hour just keeps
 * the freshest value.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  normalizeColdEquipmentDocumentConfig,
  normalizeColdEquipmentEntryData,
  type ColdEquipmentEntryData,
} from "@/lib/cold-equipment-document";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  normalizeClimateDocumentConfig,
  normalizeClimateEntryData,
  type ClimateEntryData,
} from "@/lib/climate-document";

function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

function toPrismaJsonValue(
  value: unknown
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

/**
 * Upsert today's cold_equipment_control entry for every active doc that
 * lists this equipment by `sourceEquipmentId`. Merges the new reading
 * into the existing `temperatures` map so manual entries for other
 * fridges stay intact.
 *
 * Returns the number of documents touched.
 */
export async function autofillColdEquipmentReading(args: {
  organizationId: string;
  equipmentId: string;
  temperature: number;
  systemUserId: string;
  now?: Date;
}): Promise<number> {
  const now = args.now ?? new Date();
  const todayStart = utcDayStart(now);

  const docs = await db.journalDocument.findMany({
    where: {
      organizationId: args.organizationId,
      status: "active",
      template: { code: COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE },
      dateFrom: { lte: todayStart },
      dateTo: { gte: todayStart },
    },
    select: { id: true, config: true },
  });

  let touched = 0;
  for (const doc of docs) {
    const config = normalizeColdEquipmentDocumentConfig(doc.config);
    const matching = config.equipment.filter(
      (item) => item.sourceEquipmentId === args.equipmentId
    );
    if (matching.length === 0) continue;

    const existing = await db.journalDocumentEntry.findUnique({
      where: {
        documentId_employeeId_date: {
          documentId: doc.id,
          employeeId: args.systemUserId,
          date: todayStart,
        },
      },
      select: { data: true },
    });
    const current: ColdEquipmentEntryData = normalizeColdEquipmentEntryData(
      existing?.data ?? null
    );
    const temperatures = { ...current.temperatures };
    for (const item of matching) {
      // Холодильник на обслуживании/в ремонте («обсл»/«рем») — датчик не пишет поверх отметки.
      if (current.statuses?.[item.id]) continue;
      temperatures[item.id] = args.temperature;
    }
    const nextData: ColdEquipmentEntryData = {
      responsibleTitle: current.responsibleTitle,
      temperatures,
      ...(current.corrections ? { corrections: current.corrections } : {}),
      ...(current.statuses ? { statuses: current.statuses } : {}),
    };

    await db.journalDocumentEntry.upsert({
      where: {
        documentId_employeeId_date: {
          documentId: doc.id,
          employeeId: args.systemUserId,
          date: todayStart,
        },
      },
      create: {
        documentId: doc.id,
        employeeId: args.systemUserId,
        date: todayStart,
        data: toPrismaJsonValue(nextData),
      },
      update: { data: toPrismaJsonValue(nextData) },
    });
    touched += 1;
  }
  return touched;
}

/**
 * Climate: upsert today's entry with temperature + humidity, snapped to
 * the document's closest control-time slot. Multiple devices can feed
 * the same room — the last writer wins per slot, which is fine for a
 * cron that runs hourly.
 */
export async function autofillClimateReading(args: {
  organizationId: string;
  equipmentId: string;
  temperature: number;
  humidity: number | null;
  systemUserId: string;
  now?: Date;
}): Promise<number> {
  const now = args.now ?? new Date();
  const todayStart = utcDayStart(now);

  const docs = await db.journalDocument.findMany({
    where: {
      organizationId: args.organizationId,
      status: "active",
      template: { code: CLIMATE_DOCUMENT_TEMPLATE_CODE },
      dateFrom: { lte: todayStart },
      dateTo: { gte: todayStart },
    },
    select: { id: true, config: true },
  });

  let touched = 0;
  for (const doc of docs) {
    const config = normalizeClimateDocumentConfig(doc.config);
    // Rooms don't have sourceEquipmentId today — feature ready for the
    // day admin binds a Tuya device per room, but we silently no-op for
    // now. Touching all rooms blindly would be wrong (different fridges
    // ≠ different climate rooms).
    type MaybeBound = { sourceEquipmentId?: string | null };
    const matching = config.rooms.filter(
      (room) =>
        (room as unknown as MaybeBound).sourceEquipmentId ===
        args.equipmentId
    );
    if (matching.length === 0) continue;

    const times = config.controlTimes.length
      ? config.controlTimes
      : ["10:00", "17:00"];
    const nearestTime = pickNearestSlot(times, now);

    const existing = await db.journalDocumentEntry.findUnique({
      where: {
        documentId_employeeId_date: {
          documentId: doc.id,
          employeeId: args.systemUserId,
          date: todayStart,
        },
      },
      select: { data: true },
    });
    const current: ClimateEntryData = normalizeClimateEntryData(
      existing?.data ?? null
    );
    const measurements = { ...current.measurements };
    for (const room of matching) {
      const priorRoom = measurements[room.id] ?? {};
      measurements[room.id] = {
        ...priorRoom,
        [nearestTime]: {
          temperature: room.temperature.enabled ? args.temperature : null,
          humidity: room.humidity.enabled ? args.humidity : null,
        },
      };
    }
    const nextData: ClimateEntryData = {
      responsibleTitle: current.responsibleTitle,
      measurements,
    };

    await db.journalDocumentEntry.upsert({
      where: {
        documentId_employeeId_date: {
          documentId: doc.id,
          employeeId: args.systemUserId,
          date: todayStart,
        },
      },
      create: {
        documentId: doc.id,
        employeeId: args.systemUserId,
        date: todayStart,
        data: toPrismaJsonValue(nextData),
      },
      update: { data: toPrismaJsonValue(nextData) },
    });
    touched += 1;
  }
  return touched;
}

function pickNearestSlot(slots: string[], now: Date): string {
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  let best = slots[0];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const [hh, mm] = slot.split(":").map((s) => Number(s) || 0);
    const diff = Math.abs(hh * 60 + mm - nowMin);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = slot;
    }
  }
  return best;
}
