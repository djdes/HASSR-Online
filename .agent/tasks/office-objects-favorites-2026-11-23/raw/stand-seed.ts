/**
 * Локальный стенд для проверки «офис — не объект» (2026-11-23). Не для прода:
 * заводит организацию с офисом и тремя объектами, сотрудников с разными
 * местами работы, оборудование и два документа журналов, привязанных к офису
 * (один — с холодильником, которого больше нет в справочнике).
 * Запуск: npx tsx .agent/tasks/office-objects-favorites-2026-11-23/raw/stand-seed.ts
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../../../../src/lib/db";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("stand only");
  const existing = await db.organization.findFirst({ where: { name: "Стенд: Кафе «Берёзка»" } });
  if (existing) {
    console.log("stand exists", existing.id);
    return;
  }
  const passwordHash = await bcrypt.hash("Passw0rd!", 10);
  const org = await db.organization.create({
    data: { name: "Стенд: Кафе «Берёзка»", type: "restaurant", perLocationJournals: true },
  });
  const office = await db.building.create({ data: { organizationId: org.id, name: "Офис", kind: "office", sortOrder: 0 } });
  const p1 = await db.building.create({
    data: { organizationId: org.id, name: "Цех пищевых продуктов", address: "Апрелевка, ул. Августовская, 1/19", sortOrder: 1 },
  });
  const p2 = await db.building.create({ data: { organizationId: org.id, name: "Кафе на Мира", address: "пр. Мира, 5", sortOrder: 2 } });
  const p3 = await db.building.create({ data: { organizationId: org.id, name: "Склад", address: "ул. Складская, 3", sortOrder: 3 } });

  const owner = await db.user.create({
    data: { email: "owner@stand.local", name: "Ольга Владелец", passwordHash, organizationId: org.id, role: "owner", permissionPreset: "admin" },
  });
  await db.user.create({
    data: { email: "director@stand.local", name: "Дмитрий Директор", passwordHash, organizationId: org.id, role: "manager", permissionPreset: "admin", buildingIds: [office.id] },
  });
  await db.user.create({
    data: { email: "chef@stand.local", name: "Зоя Заведующая", passwordHash, organizationId: org.id, role: "head_chef", permissionPreset: "head_chef", buildingIds: [p1.id] },
  });
  await db.user.create({ data: { email: "cook1@stand.local", name: "Пётр Повар", passwordHash, organizationId: org.id, role: "cook", buildingIds: [p1.id] } });
  await db.user.create({ data: { email: "cook2@stand.local", name: "Анна Повар", passwordHash, organizationId: org.id, role: "cook", buildingIds: [p2.id] } });
  await db.user.create({ data: { email: "waiter@stand.local", name: "Иван Официант", passwordHash, organizationId: org.id, role: "waiter" } });

  for (const [index, point] of [p1, p2, p3].entries()) {
    const area = await db.area.create({ data: { organizationId: org.id, name: "Холодный цех", buildingId: point.id } });
    await db.equipment.create({ data: { name: `Холодильник ${index + 1}`, type: "fridge", tempMin: 2, tempMax: 6, areaId: area.id } });
    if (index === 0) await db.equipment.create({ data: { name: "Морозильник", type: "freezer", tempMin: -24, tempMax: -18, areaId: area.id } });
  }

  const cold = await db.journalTemplate.findUnique({ where: { code: "cold_equipment_control" } });
  const hygiene = await db.journalTemplate.findUnique({ where: { code: "hygiene" } });
  const from = new Date(Date.UTC(2026, 10, 1));
  const to = new Date(Date.UTC(2026, 10, 30));
  if (cold) {
    await db.journalDocument.create({
      data: {
        templateId: cold.id,
        organizationId: org.id,
        title: "Журнал холодильников (создан в офисе)",
        dateFrom: from,
        dateTo: to,
        buildingId: office.id,
        createdById: owner.id,
        config: {
          equipment: [
            { id: "cold-equipment-stand-1", sourceEquipmentId: "deleted-equipment-id", name: "морозильник 2", min: -24, max: -18, readingMode: "once" },
          ],
        },
      },
    });
  }
  if (hygiene) {
    await db.journalDocument.create({
      data: { templateId: hygiene.id, organizationId: org.id, title: "Гигиена (создан в офисе)", dateFrom: from, dateTo: to, buildingId: office.id, createdById: owner.id },
    });
  }
  console.log(JSON.stringify({ org: org.id, office: office.id, points: [p1.id, p2.id, p3.id], owner: owner.email }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
