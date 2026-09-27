/**
 * Тестовая организация для e2e «Фотофиксация показаний» (photo-fixation-2026-09)
 * в локальной базе копии: руководитель + повар с PIN, холодильная и морозильная
 * камеры с наклейками, склад с плакатом, активные документы на месяц.
 * Повторный запуск переиспользует организацию и сбрасывает настройку
 * фотофиксации к умолчанию.
 *
 *   npx tsx .agent/tasks/photo-fixation-2026-09/e2e/setup.ts <out.json> [free|paid]
 *
 * Пароль и PIN — только для локальной базы.
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
import { readingPhotoSettingKey } from "@/lib/reading-photo-fixation";

const ORG_NAME = "Кафе «Фотофиксация»";
const MANAGER_EMAIL = "photofix-manager@haccp.local";
const COOK_EMAIL = "photofix-cook@haccp.local";
const PASSWORD = "Photofix-2026!";
const COOK_PIN = "2468";

function monthBounds(now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from, to };
}

async function equipmentIn(areaId: string, name: string, tempMin: number, tempMax: number, type: string) {
  const found = await db.equipment.findFirst({ where: { areaId, name }, select: { id: true, name: true, type: true, tempMin: true, tempMax: true } });
  if (found) return found;
  return db.equipment.create({
    data: { areaId, name, type, tempMin, tempMax },
    select: { id: true, name: true, type: true, tempMin: true, tempMax: true },
  });
}

async function main() {
  const out = process.argv[2];
  const plan = process.argv[3] === "free" ? "free" : "paid";
  if (!out) throw new Error("usage: setup.ts <out.json> [free|paid]");

  let org = await db.organization.findFirst({ where: { name: ORG_NAME }, select: { id: true, accountId: true } });
  if (!org) {
    org = await db.organization.create({ data: { name: ORG_NAME, type: "restaurant", subscriptionPlan: plan, qrFillMode: "public" }, select: { id: true, accountId: true } });
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const manager = await db.user.upsert({
    where: { email: MANAGER_EMAIL },
    create: { email: MANAGER_EMAIL, name: "Анна Кузнецова", passwordHash, role: "manager", organizationId: org.id, isActive: true, journalAccessMigrated: true, emailVerifiedAt: new Date(), legalVersion: LEGAL_VERSION },
    update: { passwordHash, role: "manager", organizationId: org.id, isActive: true, archivedAt: null, legalVersion: LEGAL_VERSION },
    select: { id: true },
  });
  const qrPinHash = await bcrypt.hash(COOK_PIN, 10);
  const cook = await db.user.upsert({
    where: { email: COOK_EMAIL },
    create: { email: COOK_EMAIL, name: "Мария Иванова", passwordHash, qrPinHash, role: "cook", organizationId: org.id, isActive: true, emailVerifiedAt: new Date(), legalVersion: LEGAL_VERSION },
    update: { passwordHash, qrPinHash, role: "cook", organizationId: org.id, isActive: true, archivedAt: null, legalVersion: LEGAL_VERSION },
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
  await db.organization.update({ where: { id: org.id }, data: { subscriptionPlan: plan, qrFillMode: "public" } });
  // Фотофиксация — по умолчанию (включена, фото не обязательно).
  await db.platformSetting.deleteMany({ where: { key: readingPhotoSettingKey(org.id) } });

  let area = await db.area.findFirst({ where: { organizationId: org.id, name: "Холодильный цех" }, select: { id: true } });
  if (!area) area = await db.area.create({ data: { organizationId: org.id, name: "Холодильный цех" }, select: { id: true } });
  const fridge = await equipmentIn(area.id, "Холодильная камера №1", 2, 6, "refrigerator");
  const freezer = await equipmentIn(area.id, "Морозильная камера №2", -22, -18, "freezer");

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
        config: buildColdEquipmentConfigFromEquipment([fridge, freezer]) as never,
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
  // Каждый прогон — с чистого листа: записи этих журналов и счётчик распознаваний (локальная база) стираем.
  await db.journalDocumentEntry.deleteMany({ where: { documentId: { in: [coldDoc.id, climateDoc.id] } } });
  await db.auditLog.deleteMany({ where: { organizationId: org.id, action: "ai.vision_extract" } });

  const fixture = {
    plan,
    organizationId: org.id,
    managerEmail: MANAGER_EMAIL,
    cookEmail: COOK_EMAIL,
    password: PASSWORD,
    cookPin: COOK_PIN,
    managerId: manager.id,
    cookId: cook.id,
    fridgeId: fridge.id,
    fridgeToken: mintEquipmentQrToken(fridge.id),
    freezerId: freezer.id,
    freezerToken: mintEquipmentQrToken(freezer.id),
    roomId: room.id,
    roomToken: mintQrFillToken("room", room.id),
    coldDocumentId: coldDoc.id,
    climateDocumentId: climateDoc.id,
  };
  writeFileSync(out, JSON.stringify(fixture, null, 2));
  console.log(JSON.stringify({ ...fixture, password: "***", cookPin: "***", fridgeToken: "…", freezerToken: "…", roomToken: "…" }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
