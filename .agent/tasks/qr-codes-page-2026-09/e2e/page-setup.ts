// Стенд страницы QR-кодов (C1): СВОИ организации, чужие не трогаем.
//   • e2e-org-qrp      — без точек: гигиена (активный документ), фритюр
//     (два активных + один закончившийся), металлопримеси без документов,
//     холодильники (документ с одним из двух), склад, УФ-лампа;
//   • e2e-org-qrp-loc  — две точки, активная у руководителя — «Точка на Мира».
// Идемпотентно: каждый запуск — чистый старт этих двух организаций.
// Запуск: npx tsx .agent/tasks/qr-codes-page-2026-09/e2e/page-setup.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { orgTodayKey } from "../../../../src/lib/timezone";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORG = "e2e-org-qrp";
const ORG_LOC = "e2e-org-qrp-loc";
const PASSWORD = "qrp-e2e-2026";
const LEGAL_VERSION = "2026-09-22";

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

async function template(code: string) {
  const found = await db.journalTemplate.findFirst({ where: { code }, select: { id: true, name: true } });
  if (!found) throw new Error(`нет шаблона ${code}`);
  return found;
}

async function resetOrg(id: string) {
  await db.journalDocument.deleteMany({ where: { organizationId: id } });
  await db.auditLog.deleteMany({ where: { organizationId: id } }).catch(() => null);
  await db.notification.deleteMany({ where: { organizationId: id } }).catch(() => null);
  await db.equipmentRunSession.deleteMany({ where: { organizationId: id } }).catch(() => null);
  await db.equipment.deleteMany({ where: { area: { organizationId: id } } }).catch(() => null);
  await db.area.deleteMany({ where: { organizationId: id } }).catch(() => null);
  await db.user.updateMany({ where: { organizationId: id }, data: { lastActiveBuildingId: null } }).catch(() => null);
  await db.room.deleteMany({ where: { building: { organizationId: id } } }).catch(() => null);
  await db.building.deleteMany({ where: { organizationId: id } }).catch(() => null);
}

async function upsertOrg(id: string, name: string, perLocationJournals: boolean) {
  const data = {
    name,
    isDemo: false,
    timezone: "Europe/Moscow",
    qrFillMode: "public",
    subscriptionPlan: "pro",
    disabledJournalCodes: [] as string[],
    journalResponsibleUsersJson: {},
    autoJournalCodes: [] as string[],
    journalAutomationJson: {},
    perLocationJournals,
  };
  return db.organization.upsert({
    where: { id },
    update: data,
    create: { id, type: "restaurant", phone: "+79990000066", subscriptionEnd: new Date(Date.now() + 365 * 86400_000), ...data },
  });
}

async function upsertUser(orgId: string, email: string, name: string, role: string, position: string, passwordHash: string) {
  const pos =
    (await db.jobPosition.findFirst({ where: { organizationId: orgId, name: position } })) ??
    (await db.jobPosition.create({ data: { organizationId: orgId, name: position, categoryKey: role === "cook" ? "staff" : "management" } }));
  const data = {
    name,
    role,
    organizationId: orgId,
    jobPositionId: pos.id,
    isActive: true,
    archivedAt: null,
    isRoot: false,
    passwordHash,
    phone: "+79990000066",
    legalVersion: LEGAL_VERSION,
    showWhatsNew: false,
    themePreference: "light",
    qrPinHash: null,
    qrPinEncrypted: null,
  };
  return db.user.upsert({ where: { email }, update: data, create: { email, ...data } });
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const today = orgTodayKey("Europe/Moscow");
  const [year, month] = today.split("-").map(Number);
  const prevMonthFrom = iso(new Date(Date.UTC(year, month - 2, 1)));
  const prevMonthTo = iso(new Date(Date.UTC(year, month - 1, 0)));
  const curMonthFrom = iso(new Date(Date.UTC(year, month - 1, 1)));
  const curMonthTo = iso(new Date(Date.UTC(year, month, 0)));

  await resetOrg(ORG);
  await resetOrg(ORG_LOC);
  await upsertOrg(ORG, "Кафе «QR-страница»", false);
  await upsertOrg(ORG_LOC, "Сеть «QR-страница точки»", true);

  const manager = await upsertUser(ORG, "qrp-manager@e2e.local", "Ольга Руководитель", "manager", "Заведующая", passwordHash);
  await upsertUser(ORG, "qrp-cook@e2e.local", "Пётр Повар", "cook", "Повар", passwordHash);
  const managerLoc = await upsertUser(ORG_LOC, "qrp-loc-manager@e2e.local", "Нина Сетевая", "manager", "Управляющая", passwordHash);

  const area = await db.area.create({ data: { organizationId: ORG, name: "Горячий цех" } });
  const fridge1 = await db.equipment.create({ data: { areaId: area.id, name: "Холодильник №1", type: "refrigerator", tempMin: 2, tempMax: 6 } });
  const fridge2 = await db.equipment.create({ data: { areaId: area.id, name: "Морозильник №2", type: "freezer", tempMin: -18, tempMax: -12 } });
  const lamp = await db.equipment.create({ data: { areaId: area.id, name: "Облучатель ОБН-150", type: "uv_lamp", lampLifetimeHours: 8000 } });
  // Ещё 14 холодильников — смешанная печать 1 A4 + 3 A5 + 13 наклеек (17 объектов).
  for (let index = 1; index <= 14; index += 1) {
    await db.equipment.create({ data: { areaId: area.id, name: `Витрина ${String(index).padStart(2, "0")}`, type: "refrigerator", tempMin: 0, tempMax: 8 } });
  }
  const building = await db.building.create({ data: { organizationId: ORG, name: "Основное здание" } });
  const room = await db.room.create({ data: { buildingId: building.id, name: "Сухой склад" } });

  const b1 = await db.building.create({ data: { organizationId: ORG_LOC, name: "Точка на Ленина", sortOrder: 0 } });
  const b2 = await db.building.create({ data: { organizationId: ORG_LOC, name: "Точка на Мира", sortOrder: 1 } });
  await db.user.update({ where: { id: managerLoc.id }, data: { lastActiveBuildingId: b2.id } });

  const docs: Record<string, string> = {};
  const create = async (orgId: string, key: string, code: string, from: string, to: string, config: Record<string, unknown>, buildingId: string | null = null) => {
    const tpl = await template(code);
    const doc = await db.journalDocument.create({
      data: {
        organizationId: orgId,
        templateId: tpl.id,
        title: `${tpl.name} — ${key}`,
        dateFrom: day(from),
        dateTo: day(to),
        status: "active",
        buildingId,
        config: config as never,
      },
      select: { id: true },
    });
    docs[key] = doc.id;
  };
  await create(ORG, "hygiene", "hygiene", curMonthFrom, curMonthTo, {});
  await create(ORG, "fryerA", "fryer_oil", curMonthFrom, curMonthTo, {});
  await create(ORG, "fryerB", "fryer_oil", curMonthFrom, curMonthTo, {});
  await create(ORG, "fryerOld", "fryer_oil", prevMonthFrom, prevMonthTo, {});
  await create(ORG, "cold", "cold_equipment_control", curMonthFrom, curMonthTo, {
    equipment: [{ id: "row-fridge", sourceEquipmentId: fridge1.id, name: "Холодильник №1", min: 2, max: 6 }],
    skipWeekends: false,
  });
  await create(ORG, "climate", "climate_control", curMonthFrom, curMonthTo, {});
  await create(ORG_LOC, "locFryerB2", "fryer_oil", curMonthFrom, curMonthTo, {}, b2.id);

  const state = {
    password: PASSWORD,
    org: ORG,
    orgLoc: ORG_LOC,
    today,
    periods: { prevMonthFrom, prevMonthTo, curMonthFrom, curMonthTo },
    users: { manager: manager.email, managerLoc: managerLoc.email },
    equipment: { fridge1: fridge1.id, fridge2: fridge2.id, lamp: lamp.id },
    rooms: { room: room.id },
    buildings: { b1: b1.id, b2: b2.id },
    docs,
  };
  fs.writeFileSync(path.join(HERE, "page-state.json"), JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
