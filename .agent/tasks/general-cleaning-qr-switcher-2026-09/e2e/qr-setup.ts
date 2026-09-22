// Стенд частей C–E (QR-кнопка, QR через смену периода, золотой блок кнопок):
// СВОЯ организация e2e-org-qr — руководитель и повар с известным паролем,
// холодильники, склады, УФ-лампа и документы ПРОШЛЫХ периодов (цепочки
// прерваны: «наступило новое число, автосоздание выключено»).
// Чужие e2e-организации не трогаем.
// Запуск: npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/qr-setup.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { orgTodayKey } from "../../../../src/lib/timezone";
import { defaultUvSpecification } from "../../../../src/lib/uv-lamp-runtime-document";

export const PASSWORD = "E2eTest2026!";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORG_ID = "e2e-org-qr";
const LEGAL_VERSION = "2026-09-22";
/** Выключен в наборе — страховка «выключенный журнал не создаём». */
const DISABLED = ["traceability_test"];

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

async function upsertPosition(organizationId: string, name: string, categoryKey: "management" | "staff") {
  const existing = await db.jobPosition.findFirst({ where: { organizationId, name } });
  if (existing) return existing;
  return db.jobPosition.create({ data: { organizationId, name, categoryKey } });
}

async function upsertUser(input: { email: string; name: string; role: string; jobPositionId: string; passwordHash: string }) {
  const data = {
    name: input.name,
    role: input.role,
    organizationId: ORG_ID,
    jobPositionId: input.jobPositionId,
    isActive: true,
    archivedAt: null,
    isRoot: false,
    passwordHash: input.passwordHash,
    phone: "+79990000088",
    legalVersion: LEGAL_VERSION,
    showWhatsNew: false,
    qrPinHash: null,
    qrPinEncrypted: null,
  };
  return db.user.upsert({ where: { email: input.email }, update: data, create: { email: input.email, ...data } });
}

async function template(code: string) {
  const found = await db.journalTemplate.findFirst({ where: { code }, select: { id: true, name: true } });
  if (!found) throw new Error(`нет шаблона ${code}`);
  return found;
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const today = orgTodayKey("Europe/Moscow");
  const [year, month, dom] = today.split("-").map(Number);
  // Прошлый месяц целиком и прошлая половина месяца.
  const prevMonthFrom = iso(new Date(Date.UTC(year, month - 2, 1)));
  const prevMonthTo = iso(new Date(Date.UTC(year, month - 1, 0)));
  const prevHalf =
    dom >= 16
      ? { from: iso(new Date(Date.UTC(year, month - 1, 1))), to: iso(new Date(Date.UTC(year, month - 1, 15))) }
      : { from: iso(new Date(Date.UTC(year, month - 2, 16))), to: prevMonthTo };
  const curMonthFrom = iso(new Date(Date.UTC(year, month - 1, 1)));
  const curMonthTo = iso(new Date(Date.UTC(year, month, 0)));

  // ---- чистый старт
  const oldUsers = await db.user.findMany({ where: { organizationId: ORG_ID }, select: { id: true } });
  await db.journalDocument.deleteMany({ where: { organizationId: ORG_ID } });
  await db.auditLog.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => null);
  await db.notification.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => null);
  await db.equipment.deleteMany({ where: { area: { organizationId: ORG_ID } } }).catch(() => null);
  await db.area.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => null);
  await db.room.deleteMany({ where: { building: { organizationId: ORG_ID } } }).catch(() => null);
  await db.building.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => null);
  void oldUsers;

  const org = await db.organization.upsert({
    where: { id: ORG_ID },
    update: {
      name: "Кафе «QR-точка»",
      isDemo: false,
      timezone: "Europe/Moscow",
      qrFillMode: "public",
      subscriptionPlan: "pro",
      disabledJournalCodes: DISABLED,
      journalResponsibleUsersJson: {},
      autoJournalCodes: [],
      journalAutomationJson: {},
      perLocationJournals: false,
    },
    create: {
      id: ORG_ID,
      name: "Кафе «QR-точка»",
      type: "restaurant",
      phone: "+79990000088",
      timezone: "Europe/Moscow",
      qrFillMode: "public",
      subscriptionPlan: "pro",
      subscriptionEnd: new Date(Date.now() + 365 * 86400_000),
      isDemo: false,
      disabledJournalCodes: DISABLED,
    },
  });

  const posManager = await upsertPosition(org.id, "Управляющий", "management");
  const posCook = await upsertPosition(org.id, "Повар", "staff");
  const manager = await upsertUser({ email: "qr-manager@e2e.local", name: "Кира Руководитель", role: "manager", jobPositionId: posManager.id, passwordHash });
  const cook = await upsertUser({ email: "qr-cook@e2e.local", name: "Пётр Повар", role: "cook", jobPositionId: posCook.id, passwordHash });
  await db.userJournalAccess.deleteMany({ where: { userId: cook.id } }).catch(() => null);

  // ---- справочники
  const area = await db.area.create({ data: { organizationId: org.id, name: "Горячий цех" } });
  const fridge = await db.equipment.create({ data: { areaId: area.id, name: "Холодильник №1", type: "refrigerator", tempMin: 2, tempMax: 6 } });
  const freezer = await db.equipment.create({ data: { areaId: area.id, name: "Морозильник", type: "freezer", tempMax: -18 } });
  const dead = await db.equipment.create({ data: { areaId: area.id, name: "Списанный холодильник", type: "refrigerator", tempMin: 2, tempMax: 6 } });
  const lamp = await db.equipment.create({ data: { areaId: area.id, name: "Облучатель ОБН-150", type: "uv_lamp", lampLifetimeHours: 8000 } });
  const building = await db.building.create({ data: { organizationId: org.id, name: "Основная точка" } });
  const room1 = await db.room.create({ data: { buildingId: building.id, name: "Склад сухих продуктов", kind: "storage" } });
  const room2 = await db.room.create({ data: { buildingId: building.id, name: "Склад овощей", kind: "storage" } });

  // ---- документы прошлых периодов
  const docs: Record<string, string> = {};
  const create = async (key: string, code: string, from: string, to: string, config: Record<string, unknown>, status = "active") => {
    const tpl = await template(code);
    const doc = await db.journalDocument.create({
      data: {
        organizationId: org.id,
        templateId: tpl.id,
        title: `${tpl.name} — ${from}…${to}`,
        dateFrom: day(from),
        dateTo: day(to),
        status,
        responsibleUserId: manager.id,
        responsibleTitle: "Управляющий",
        config: config as never,
      },
      select: { id: true },
    });
    docs[key] = doc.id;
  };

  await create("checklistPrev", "cleaning_ventilation_checklist", prevMonthFrom, prevMonthTo, {
    procedures: [
      { id: "disinfection", label: "Дезинфекция", enabled: true, times: ["10:00"] },
      { id: "ventilation", label: "Проветривание", enabled: true, times: ["12:00"] },
    ],
    responsibles: [],
    skipWeekends: false,
  });
  await create("coldPrev", "cold_equipment_control", prevHalf.from, prevHalf.to, {
    equipment: [
      { id: "row-fridge", sourceEquipmentId: fridge.id, name: "Холодильник №1", min: 2, max: 6, readingMode: "twice" },
      { id: "row-dead", sourceEquipmentId: dead.id, name: "Списанный холодильник", min: 2, max: 6 },
      { id: "row-freezer", sourceEquipmentId: freezer.id, name: "Морозильник", min: null, max: -18 },
    ],
    skipWeekends: true,
  });
  await create("climatePrev", "climate_control", prevMonthFrom, prevMonthTo, {
    rooms: [
      { id: `room-${room1.id}`, roomId: room1.id, name: room1.name, temperature: { enabled: true, min: 15, max: 22 }, humidity: { enabled: true, min: 40, max: 70 } },
      { id: `room-${room2.id}`, roomId: room2.id, name: room2.name, temperature: { enabled: true, min: 4, max: 12 }, humidity: { enabled: true, min: 80, max: 95 } },
    ],
    controlTimes: ["09:00", "18:00"],
    skipWeekends: false,
  });
  await create("uvPrev", "uv_lamp_runtime", prevMonthFrom, prevMonthTo, {
    lampNumber: "7",
    areaName: "Холодный цех",
    spec: { ...defaultUvSpecification(), controlFrequency: "ежедневно", lampLifetimeHours: 8000 },
    equipmentId: lamp.id,
  });
  await create("metalPrev", "metal_impurity", prevMonthFrom, prevMonthTo, {});
  await create("writeoffPrev", "product_writeoff", prevMonthFrom, prevMonthTo, {});
  await create("writeoffClosed", "product_writeoff", curMonthFrom, curMonthTo, {}, "closed");
  await create("tracePrev", "traceability_test", prevMonthFrom, prevMonthTo, {});
  await create("fryerPrev", "fryer_oil", prevMonthFrom, prevMonthTo, {});
  await create("maintPrev", "equipment_maintenance", `${year - 1}-01-01`, `${year - 1}-12-31`, {
    year: year - 1,
    documentDate: `${year - 1}-01-01`,
    rows: [{ id: "m1", equipmentName: "Пароконвектомат", plan: { jan: "+", jul: "+" }, fact: { jan: "12.01", jul: "15.07" } }],
  });

  // Холодильник списан — из «Оборудования» удалён, в прошлом документе остался.
  await db.equipment.delete({ where: { id: dead.id } });

  const state = {
    password: PASSWORD,
    org: org.id,
    today,
    periods: { prevMonthFrom, prevMonthTo, prevHalf, curMonthFrom, curMonthTo },
    users: {
      manager: { id: manager.id, email: manager.email, name: manager.name },
      cook: { id: cook.id, email: cook.email, name: cook.name },
    },
    equipment: { fridge: fridge.id, freezer: freezer.id, dead: dead.id, lamp: lamp.id },
    rooms: { room1: room1.id, room2: room2.id },
    buildingId: building.id,
    docs,
    disabled: DISABLED,
  };
  fs.writeFileSync(path.join(HERE, "qr-state.json"), JSON.stringify(state, null, 2));
  console.log("OK", JSON.stringify(state, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
