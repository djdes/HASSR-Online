/**
 * Тестовая организация для e2e «Фото к замеру» (temp-photo-2026-09) в
 * локальной базе копии: руководитель + повар, холодильник с наклейкой,
 * склад с плакатом, активные документы холодильников и климата на
 * сегодня. Повторный запуск переиспользует организацию.
 *
 *   npx tsx .agent/tasks/temp-photo-2026-09/e2e/setup.ts <out.json> [free|paid]
 *
 * Пароль руководителя — только для локальной базы.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { buildColdEquipmentConfigFromEquipment } from "@/lib/cold-equipment-document";
import { climateRoomFromDirectory } from "@/lib/climate-document";
import { mintEquipmentQrToken } from "@/lib/equipment-qr-token";
import { mintQrFillToken } from "@/lib/qr-fill-token";
import { LEGAL_VERSION } from "@/lib/legal-consent";

const ORG_NAME = "Кафе «Фото-тест»";
const MANAGER_EMAIL = "tphoto-manager@haccp.local";
const COOK_EMAIL = "tphoto-cook@haccp.local";
const PASSWORD = "Tphoto-2026!";

function monthBounds(now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from, to };
}

async function main() {
  const out = process.argv[2];
  const plan = process.argv[3] === "paid" ? "paid" : "free";
  if (!out) throw new Error("usage: setup.ts <out.json> [free|paid]");

  let org = await db.organization.findFirst({ where: { name: ORG_NAME }, select: { id: true, accountId: true } });
  if (!org) {
    org = await db.organization.create({ data: { name: ORG_NAME, type: "restaurant", subscriptionPlan: "free", qrFillMode: "public" }, select: { id: true, accountId: true } });
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const manager = await db.user.upsert({
    where: { email: MANAGER_EMAIL },
    create: { email: MANAGER_EMAIL, name: "Ольга Смирнова", passwordHash, role: "manager", organizationId: org.id, isActive: true, journalAccessMigrated: true, emailVerifiedAt: new Date(), legalVersion: LEGAL_VERSION },
    update: { passwordHash, role: "manager", organizationId: org.id, isActive: true, archivedAt: null, legalVersion: LEGAL_VERSION },
    select: { id: true },
  });
  const cook = await db.user.upsert({
    where: { email: COOK_EMAIL },
    create: { email: COOK_EMAIL, name: "Иван Петров", passwordHash, role: "cook", organizationId: org.id, isActive: true, emailVerifiedAt: new Date(), legalVersion: LEGAL_VERSION },
    update: { passwordHash, role: "cook", organizationId: org.id, isActive: true, archivedAt: null, legalVersion: LEGAL_VERSION },
    select: { id: true },
  });
  if (!org.accountId) {
    const account = await db.account.upsert({
      where: { ownerUserId: manager.id },
      create: { ownerUserId: manager.id, subscriptionPlan: plan },
      update: {},
      select: { id: true },
    });
    await db.organization.update({ where: { id: org.id }, data: { accountId: account.id } });
    org = { id: org.id, accountId: account.id };
  }
  await db.account.update({ where: { id: org.accountId! }, data: { subscriptionPlan: plan } });
  await db.organization.update({ where: { id: org.id }, data: { subscriptionPlan: plan } });

  let area = await db.area.findFirst({ where: { organizationId: org.id, name: "Холодильный цех" }, select: { id: true } });
  if (!area) area = await db.area.create({ data: { organizationId: org.id, name: "Холодильный цех" }, select: { id: true } });
  let fridge = await db.equipment.findFirst({ where: { areaId: area.id, name: "Холодильник №1" }, select: { id: true, name: true, type: true, tempMin: true, tempMax: true } });
  if (!fridge) {
    fridge = await db.equipment.create({
      data: { areaId: area.id, name: "Холодильник №1", type: "refrigerator", tempMin: 2, tempMax: 6 },
      select: { id: true, name: true, type: true, tempMin: true, tempMax: true },
    });
  }

  let building = await db.building.findFirst({ where: { organizationId: org.id, name: "Основная точка" }, select: { id: true } });
  if (!building) building = await db.building.create({ data: { organizationId: org.id, name: "Основная точка" }, select: { id: true } });
  let room = await db.room.findFirst({ where: { buildingId: building.id, name: "Сухой склад" }, select: { id: true, name: true, climateNorms: true } });
  if (!room) {
    room = await db.room.create({
      data: {
        buildingId: building.id,
        name: "Сухой склад",
        climateNorms: { temperature: { enabled: true, min: 15, max: 25 }, humidity: { enabled: true, min: 30, max: 75 } },
      },
      select: { id: true, name: true, climateNorms: true },
    });
  }

  const { from, to } = monthBounds();
  const [coldTemplate, climateTemplate] = await Promise.all([
    db.journalTemplate.findUniqueOrThrow({ where: { code: "cold_equipment_control" }, select: { id: true, name: true } }),
    db.journalTemplate.findUniqueOrThrow({ where: { code: "climate_control" }, select: { id: true, name: true } }),
  ]);
  let coldDoc = await db.journalDocument.findFirst({ where: { organizationId: org.id, templateId: coldTemplate.id, status: "active" }, select: { id: true } });
  if (!coldDoc) {
    coldDoc = await db.journalDocument.create({
      data: {
        templateId: coldTemplate.id,
        organizationId: org.id,
        title: coldTemplate.name,
        dateFrom: from,
        dateTo: to,
        status: "active",
        responsibleUserId: manager.id,
        config: buildColdEquipmentConfigFromEquipment([fridge]) as never,
      },
      select: { id: true },
    });
  }
  let climateDoc = await db.journalDocument.findFirst({ where: { organizationId: org.id, templateId: climateTemplate.id, status: "active" }, select: { id: true } });
  if (!climateDoc) {
    climateDoc = await db.journalDocument.create({
      data: {
        templateId: climateTemplate.id,
        organizationId: org.id,
        buildingId: building.id,
        title: climateTemplate.name,
        dateFrom: from,
        dateTo: to,
        status: "active",
        responsibleUserId: manager.id,
        config: { rooms: [climateRoomFromDirectory(room)], controlTimes: ["10:00", "17:00"], skipWeekends: false } as never,
      },
      select: { id: true },
    });
  }

  const fixture = {
    plan,
    organizationId: org.id,
    managerEmail: MANAGER_EMAIL,
    cookEmail: COOK_EMAIL,
    password: PASSWORD,
    managerId: manager.id,
    cookId: cook.id,
    equipmentId: fridge.id,
    equipmentToken: mintEquipmentQrToken(fridge.id),
    roomId: room.id,
    roomToken: mintQrFillToken("room", room.id),
    coldDocumentId: coldDoc.id,
    climateDocumentId: climateDoc.id,
  };
  writeFileSync(out, JSON.stringify(fixture, null, 2));
  console.log(JSON.stringify({ ...fixture, password: "***", equipmentToken: "…", roomToken: "…" }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
