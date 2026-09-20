/* eslint-disable no-console */
// Временные помещения и оборудование в тестовой организации для проверки
// QR-страниц замера (быстрая смена объектов): add | remove.
import fs from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createClimateRoomConfig, normalizeClimateDocumentConfig } from "@/lib/climate-document";
import { createColdEquipmentConfigItem, normalizeColdEquipmentDocumentConfig } from "@/lib/cold-equipment-document";
import { mintQrFillToken } from "@/lib/qr-fill-token";

const ORG = "cmoe6rpt4000097ts71yb922y";
const CLIMATE_DOC = "cmt6j45ne0hy482ts2ii5wkkd";
const COLD_DOC = "cmu3e8tav00gqd7tspsb35swv";
const STATE = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e/seed-objects.json");
const TAG = "E2E QS";

(async () => {
  const mode = process.argv[2];
  if (mode === "add") {
    let createdBuildingId: string | null = null;
    let building = await db.building.findFirst({ where: { organizationId: ORG }, select: { id: true, name: true } });
    if (!building) {
      building = await db.building.create({ data: { organizationId: ORG, name: `${TAG} Точка` }, select: { id: true, name: true } });
      createdBuildingId = building.id;
    }
    const rooms = [];
    for (const [name, tmin, tmax] of [["Склад Бакалея", 18, 22], ["Склад Овощи", 16, 20], ["Склад Заморозка", -20, -16]] as const) {
      rooms.push(await db.room.create({ data: { buildingId: building.id, name: `${TAG} ${name}`, kind: "other" }, select: { id: true, name: true } }).then((r) => ({ ...r, tmin, tmax })));
    }
    const area = await db.area.create({ data: { organizationId: ORG, name: `${TAG} Цех` }, select: { id: true } });
    const equipment = [];
    for (const [name, tmin, tmax] of [["Холодильник №1", 2, 6], ["Морозильник", -20, -16], ["Витрина", 2, 8]] as const) {
      equipment.push(await db.equipment.create({ data: { areaId: area.id, name: `${TAG} ${name}`, type: "fridge", tempMin: tmin, tempMax: tmax }, select: { id: true, name: true } }));
    }
    // строки в документах
    const climate = await db.journalDocument.findUniqueOrThrow({ where: { id: CLIMATE_DOC }, select: { config: true } });
    const cconf = normalizeClimateDocumentConfig(climate.config);
    const craw = (climate.config ?? {}) as Record<string, unknown>;
    const newRooms = rooms.map((r) => createClimateRoomConfig({ roomId: r.id, name: r.name, temperature: { enabled: true, min: r.tmin, max: r.tmax }, humidity: { enabled: true, min: 40, max: 60 } }));
    await db.journalDocument.update({ where: { id: CLIMATE_DOC }, data: { config: { ...craw, rooms: [...cconf.rooms, ...newRooms] } as Prisma.InputJsonValue } });
    const cold = await db.journalDocument.findUniqueOrThrow({ where: { id: COLD_DOC }, select: { config: true } });
    const kconf = normalizeColdEquipmentDocumentConfig(cold.config);
    const kraw = (cold.config ?? {}) as Record<string, unknown>;
    const newItems = equipment.map((e, i) => createColdEquipmentConfigItem({ sourceEquipmentId: e.id, name: e.name, min: [2, -20, 2][i], max: [6, -16, 8][i] }));
    await db.journalDocument.update({ where: { id: COLD_DOC }, data: { config: { ...kraw, equipment: [...kconf.equipment, ...newItems] } as Prisma.InputJsonValue } });
    const out = {
      areaId: area.id,
      buildingId: createdBuildingId,
      rooms: rooms.map((r) => ({ id: r.id, name: r.name, href: `/room-fill/${r.id}?token=${encodeURIComponent(mintQrFillToken("room", r.id))}` })),
      equipment: equipment.map((e) => ({ id: e.id, name: e.name, href: `/equipment-fill/${e.id}?token=${encodeURIComponent(mintQrFillToken("equipment", e.id))}` })),
      climateRowIds: newRooms.map((r) => r.id),
      coldItemIds: newItems.map((i) => i.id),
    };
    fs.writeFileSync(STATE, JSON.stringify(out, null, 2));
    console.log("added", out.rooms.length, "rooms,", out.equipment.length, "equipment");
  } else {
    const st = JSON.parse(fs.readFileSync(STATE, "utf8")) as { areaId: string; buildingId: string | null; rooms: Array<{ id: string }>; equipment: Array<{ id: string }>; climateRowIds: string[]; coldItemIds: string[] };
    const climate = await db.journalDocument.findUniqueOrThrow({ where: { id: CLIMATE_DOC }, select: { config: true } });
    const craw = (climate.config ?? {}) as Record<string, unknown>;
    const rooms = (Array.isArray(craw.rooms) ? craw.rooms : []) as Array<{ id: string }>;
    await db.journalDocument.update({ where: { id: CLIMATE_DOC }, data: { config: { ...craw, rooms: rooms.filter((r) => !st.climateRowIds.includes(r.id)) } as Prisma.InputJsonValue } });
    const cold = await db.journalDocument.findUniqueOrThrow({ where: { id: COLD_DOC }, select: { config: true } });
    const kraw = (cold.config ?? {}) as Record<string, unknown>;
    const items = (Array.isArray(kraw.equipment) ? kraw.equipment : []) as Array<{ id: string }>;
    await db.journalDocument.update({ where: { id: COLD_DOC }, data: { config: { ...kraw, equipment: items.filter((i) => !st.coldItemIds.includes(i.id)) } as Prisma.InputJsonValue } });
    // замеры за сегодня, сделанные тестом, чистим по ключам строк
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    for (const docId of [CLIMATE_DOC, COLD_DOC]) {
      const entries = await db.journalDocumentEntry.findMany({ where: { documentId: docId, date: today }, select: { id: true, data: true } });
      for (const entry of entries) {
        const data = (entry.data ?? {}) as Record<string, unknown>;
        if (docId === CLIMATE_DOC) {
          const m = (data.measurements ?? {}) as Record<string, unknown>;
          for (const id of st.climateRowIds) delete m[id];
          await db.journalDocumentEntry.update({ where: { id: entry.id }, data: { data: { ...data, measurements: m } as Prisma.InputJsonValue } });
        } else {
          const t = (data.temperatures ?? {}) as Record<string, unknown>;
          for (const key of Object.keys(t)) if (st.coldItemIds.some((id) => key === id || key.startsWith(`${id}#`))) delete t[key];
          await db.journalDocumentEntry.update({ where: { id: entry.id }, data: { data: { ...data, temperatures: t } as Prisma.InputJsonValue } });
        }
      }
    }
    await db.room.deleteMany({ where: { id: { in: st.rooms.map((r) => r.id) } } });
    await db.equipment.deleteMany({ where: { id: { in: st.equipment.map((e) => e.id) } } });
    await db.area.delete({ where: { id: st.areaId } }).catch(() => null);
    if (st.buildingId) await db.building.delete({ where: { id: st.buildingId } }).catch(() => null);
    console.log("removed");
  }
  await db.$disconnect();
})();
