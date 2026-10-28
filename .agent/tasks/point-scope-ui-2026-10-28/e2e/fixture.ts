/**
 * Локальная фикстура для проверки правок по сканам 98–99. Пишет ТОЛЬКО в
 * базу из DATABASE_URL и отказывается работать с чем-то кроме локальной
 * `wesetup_pscope` (5433 — туннель в прод).
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/wesetup_pscope npx tsx .agent/tasks/point-scope-ui-2026-10-28/e2e/fixture.ts
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1:5432\/wesetup_pscope|localhost:5432\/wesetup_pscope/.test(url)) {
  throw new Error("Фикстура пишет только в локальную wesetup_pscope");
}

const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) });
const PASSWORD = "Pscope-2026!";

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  await db.organization.deleteMany({ where: { name: { startsWith: "E2E " } } });
  await db.user.deleteMany({ where: { email: { endsWith: "@pscope.test" } } });

  const org = await db.organization.create({
    data: { name: "E2E МАУ КП ДК", type: "school", perLocationJournals: true, serviceCode: "ORGCD-00001" },
  });
  const owner = await db.user.create({
    data: { email: "owner@pscope.test", name: "Алексей Владелец", passwordHash: hash, organizationId: org.id, role: "owner", isActive: true, legalVersion: "2026-09-30" },
  });
  const manager = await db.user.create({
    data: { email: "manager@pscope.test", name: "Мария Управляющая", passwordHash: hash, organizationId: org.id, role: "manager", isActive: true, legalVersion: "2026-09-30" },
  });
  const account = await db.account.create({ data: { ownerUserId: owner.id } });
  await db.organization.update({ where: { id: org.id }, data: { accountId: account.id } });

  const office = await db.building.create({ data: { organizationId: org.id, name: "Офис", kind: "office", sortOrder: 0, address: "ул. Северная, 35" } });
  const garden = await db.building.create({ data: { organizationId: org.id, name: "д/с №68", sortOrder: 1, address: "ул. Вокзальная, 55", serviceCode: "POINT-00068" } });
  const school = await db.building.create({ data: { organizationId: org.id, name: "Гимназия №14", sortOrder: 2, address: "ул. Школьная, 14", serviceCode: "POINT-00014" } });

  const gardenProd = await db.area.create({ data: { organizationId: org.id, buildingId: garden.id, name: "Основное производство" } });
  const gardenStore = await db.area.create({ data: { organizationId: org.id, buildingId: garden.id, name: "Склад бакалеи" } });
  const schoolProd = await db.area.create({ data: { organizationId: org.id, buildingId: school.id, name: "Основное производство" } });
  const loose = await db.area.create({ data: { organizationId: org.id, buildingId: null, name: "Общий склад" } });
  const fridge = (areaId: string, name: string) =>
    db.equipment.create({ data: { areaId, name, type: "refrigerator", tempMin: 2, tempMax: 6 } });
  await fridge(gardenProd.id, "ШХ-1 Сад");
  await fridge(gardenProd.id, "ШХ-2 Сад");
  await fridge(gardenStore.id, "ШХ-3 Сад");
  await fridge(schoolProd.id, "ШХ-1 Школа");
  await fridge(schoolProd.id, "ШХ-2 Школа");
  await fridge(loose.id, "Ларь общий");

  await db.room.create({ data: { buildingId: garden.id, name: "Склад овощей" } });
  await db.room.create({ data: { buildingId: garden.id, name: "Склад скоропорта" } });
  await db.room.create({ data: { buildingId: school.id, name: "Склад гимназии" } });

  // Мастер-кабинеты аккаунта: «Сады» с точкой д/с №68 и оператором, «Школы» — пустой.
  const gardens = await db.organization.create({
    data: { name: "E2E Мастер-кабинет Сады", type: "school", kind: "directory", serviceCode: "GARDN-00001", accountId: account.id },
  });
  const schools = await db.organization.create({
    data: { name: "E2E Мастер-кабинет Школы", type: "school", kind: "directory", serviceCode: "SCHOL-00001", accountId: account.id },
  });
  for (const cabinet of [gardens, schools]) {
    await db.organizationMember.create({ data: { userId: owner.id, organizationId: cabinet.id, role: "owner" } });
  }
  await db.building.update({ where: { id: garden.id }, data: { linkedServiceCode: "GARDN-00001" } });
  await db.user.create({
    data: { email: "operator@pscope.test", name: "Карина Оператор", passwordHash: hash, organizationId: gardens.id, role: "manager", isActive: true, legalVersion: "2026-09-30" },
  });

  console.log(JSON.stringify({ org: org.id, office: office.id, garden: garden.id, school: school.id, gardens: gardens.id, schools: schools.id, owner: owner.email, manager: manager.email, password: PASSWORD }, null, 1));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
