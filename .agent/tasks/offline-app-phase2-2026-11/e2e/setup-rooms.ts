// Demo data the first stage lacked: a building with two rooms (climate and daily
// cleaning) and a daily cleaning document set up for those rooms and two cleaners.
// Run after `setup-demo.mjs` (documents exist) on the LOCAL demo database.
//   npx tsx .agent/tasks/offline-app-phase2-2026-11/e2e/setup-rooms.ts
import "dotenv/config";

import { db } from "@/lib/db";
import { getJournalControls, updateJournalControls } from "@/lib/journal-controls.server";

async function main() {
  const org = await db.organization.findFirst({ where: { name: { contains: "HACCP Demo" } }, select: { id: true } });
  if (!org) throw new Error("Нет демо-организации");
  const owner = await db.user.findFirst({ where: { organizationId: org.id, email: "admin@haccp.local" }, select: { id: true } });
  const cleaner = await db.user.findFirst({ where: { organizationId: org.id, email: "cleaner1@haccp.local" }, select: { id: true } });
  if (!owner || !cleaner) throw new Error("Нет демо-сотрудников");

  const building =
    (await db.building.findFirst({ where: { organizationId: org.id }, select: { id: true } })) ??
    (await db.building.create({ data: { organizationId: org.id, name: "Кафе на Лесной", address: "ул. Лесная, 5" }, select: { id: true } }));
  const scope = ["Вымыть пол", "Протереть поверхности", "Вынести мусор"];
  const rooms = [];
  for (const [name, kind] of [["Сухой склад", "storage"], ["Зал для гостей", "hall"]] as const) {
    const room =
      (await db.room.findFirst({ where: { buildingId: building.id, name }, select: { id: true } })) ??
      (await db.room.create({
        data: {
          buildingId: building.id,
          name,
          kind,
          currentScope: scope,
          currentDays: 127,
          climateNorms: { temperature: { enabled: true, min: 18, max: 25 }, humidity: { enabled: true, min: 15, max: 75 } },
        },
        select: { id: true },
      }));
    rooms.push(room.id);
  }

  const cleaningDocs = await db.journalDocument.findMany({ where: { organizationId: org.id, status: "active", template: { code: "cleaning" } }, select: { id: true, config: true } });
  for (const doc of cleaningDocs) {
    const config = (doc.config && typeof doc.config === "object" && !Array.isArray(doc.config) ? doc.config : {}) as Record<string, unknown>;
    await db.journalDocument.update({
      where: { id: doc.id },
      data: { config: { ...config, cleaningMode: "rooms", rooms: [], selectedRoomIds: rooms, selectedCleanerUserIds: [owner.id, cleaner.id] } },
    });
  }
  // Photo of the reading is a per-journal switch («камера»), off by default: on for fridges, left off for rooms.
  const controls = await getJournalControls(org.id);
  await updateJournalControls(org.id, { sensorCamera: { ...controls.sensorCamera, cold_equipment_control: true } });

  console.log(JSON.stringify({ building: building.id, rooms, cleaningDocs: cleaningDocs.length, fridgeCamera: true }));
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
