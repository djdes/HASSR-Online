// Стенд ядра QR-кодов (C2–C4): СВОИ организации, чужие не трогаем.
//   • e2e-org-qrc      — без точек: холодильник, УФ-лампа, документы
//     «металлопримесей» (два активных), «забраковки» прошлого месяца,
//     «генуборки» до вчера; «фритюр» и «списание» без единого документа;
//   • e2e-org-qrc-loc  — с двумя точками, без оборудования и помещений.
// Идемпотентно: каждый запуск — чистый старт этих двух организаций.
// Запуск: npx tsx .agent/tasks/qr-codes-page-2026-09/e2e/core-setup.ts
import fs from "node:fs";
import path from "node:path";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { getPrimarySlotId } from "../../../../src/lib/journal-responsible-schemas";
import { orgTodayKey } from "../../../../src/lib/timezone";
import { defaultUvSpecification } from "../../../../src/lib/uv-lamp-runtime-document";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
export const ORG = "e2e-org-qrc";
export const ORG_LOC = "e2e-org-qrc-loc";
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
    create: { id, type: "restaurant", phone: "+79990000077", subscriptionEnd: new Date(Date.now() + 365 * 86400_000), ...data },
  });
}

async function upsertUser(orgId: string, email: string, name: string, role: string, position: string) {
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
    passwordHash: "x",
    phone: "+79990000077",
    legalVersion: LEGAL_VERSION,
    showWhatsNew: false,
    qrPinHash: null,
    qrPinEncrypted: null,
  };
  return db.user.upsert({ where: { email }, update: data, create: { email, ...data } });
}

async function main() {
  const today = orgTodayKey("Europe/Moscow");
  const [year, month] = today.split("-").map(Number);
  const prevMonthFrom = iso(new Date(Date.UTC(year, month - 2, 1)));
  const prevMonthTo = iso(new Date(Date.UTC(year, month - 1, 0)));
  const curMonthFrom = iso(new Date(Date.UTC(year, month - 1, 1)));
  const curMonthTo = iso(new Date(Date.UTC(year, month, 0)));
  const yesterday = iso(new Date(day(today).getTime() - 86400_000));

  await resetOrg(ORG);
  await resetOrg(ORG_LOC);
  await upsertOrg(ORG, "Кафе «QR-ядро»", false);
  await upsertOrg(ORG_LOC, "Сеть «QR-точки»", true);

  const resp = await upsertUser(ORG, "qrc-resp@e2e.local", "Ольга Ответственная", "manager", "Заведующая");
  const cook = await upsertUser(ORG, "qrc-cook@e2e.local", "Пётр Повар", "cook", "Повар");
  const respLoc = await upsertUser(ORG_LOC, "qrc-loc-resp@e2e.local", "Нина Точкова", "manager", "Заведующая");
  await upsertUser(ORG_LOC, "qrc-loc-cook@e2e.local", "Иван Точкин", "cook", "Повар");

  // Ответственные в «Ответственных за журналы» — главный слот.
  const slots = (codes: string[], userId: string) => Object.fromEntries(codes.map((code) => [code, { [getPrimarySlotId(code)]: userId }]));
  await db.organization.update({ where: { id: ORG }, data: { journalResponsibleUsersJson: slots(["cold_equipment_control", "fryer_oil"], resp.id) as never } });
  await db.organization.update({
    where: { id: ORG_LOC },
    data: { journalResponsibleUsersJson: slots(["cold_equipment_control", "climate_control", "metal_impurity", "fryer_oil", "product_writeoff"], respLoc.id) as never },
  });

  // ---- справочники организации без точек
  const area = await db.area.create({ data: { organizationId: ORG, name: "Горячий цех" } });
  const fridge = await db.equipment.create({ data: { areaId: area.id, name: "Холодильник №1", type: "refrigerator", tempMin: 2, tempMax: 6 } });
  const lamp = await db.equipment.create({ data: { areaId: area.id, name: "Облучатель ОБН-150", type: "uv_lamp", lampLifetimeHours: 8000 } });
  // Точки сети.
  const b1 = await db.building.create({ data: { organizationId: ORG_LOC, name: "Точка на Ленина", sortOrder: 0 } });
  const b2 = await db.building.create({ data: { organizationId: ORG_LOC, name: "Точка на Мира", sortOrder: 1 } });
  // Здание организации без точек — «чужое» для сети.
  const foreignBuilding = await db.building.create({ data: { organizationId: ORG, name: "Основное здание" } });

  const docs: Record<string, string> = {};
  const create = async (
    orgId: string,
    key: string,
    code: string,
    from: string,
    to: string,
    config: Record<string, unknown>,
    extra: { buildingId?: string | null; responsibleUserId?: string } = {}
  ) => {
    const tpl = await template(code);
    const doc = await db.journalDocument.create({
      data: {
        organizationId: orgId,
        templateId: tpl.id,
        title: `${tpl.name} — ${key}`,
        dateFrom: day(from),
        dateTo: day(to),
        status: "active",
        responsibleUserId: extra.responsibleUserId ?? null,
        buildingId: extra.buildingId ?? null,
        config: config as never,
      },
      select: { id: true },
    });
    docs[key] = doc.id;
  };
  // Два активных документа металлопримесей — для «чужого documentId».
  await create(ORG, "metalA", "metal_impurity", curMonthFrom, curMonthTo, {}, { responsibleUserId: resp.id });
  await create(ORG, "metalB", "metal_impurity", curMonthFrom, curMonthTo, {}, { responsibleUserId: resp.id });
  // Забраковка прошлого месяца — старый QR документа переходит в новый период.
  await create(ORG, "writeoffPrev", "product_writeoff", prevMonthFrom, prevMonthTo, {}, { responsibleUserId: resp.id });
  // Для просроченного QR: документ, кончившийся вчера. Прошлый период —
  // любое создание при скане было бы заметно по числу документов.
  await create(ORG, "expiredDoc", "fryer_oil", prevMonthFrom, yesterday, {}, { responsibleUserId: resp.id });
  // Холодильники и УФ — активные документы (статус объектов и хаб без УФ).
  await create(ORG, "cold", "cold_equipment_control", curMonthFrom, curMonthTo, {
    equipment: [{ id: "row-fridge", sourceEquipmentId: fridge.id, name: "Холодильник №1", min: 2, max: 6 }],
    skipWeekends: false,
  });
  await create(ORG, "uv", "uv_lamp_runtime", curMonthFrom, curMonthTo, {
    lampNumber: "7",
    areaName: "Горячий цех",
    spec: { ...defaultUvSpecification(), lampLifetimeHours: 8000 },
    equipmentId: lamp.id,
  });
  // Сеть: документы металлопримесей по точкам — «чужая точка» для submit.
  await create(ORG_LOC, "locMetalB1", "metal_impurity", curMonthFrom, curMonthTo, {}, { buildingId: b1.id, responsibleUserId: respLoc.id });
  await create(ORG_LOC, "locMetalB2", "metal_impurity", curMonthFrom, curMonthTo, {}, { buildingId: b2.id, responsibleUserId: respLoc.id });

  const state = {
    org: ORG,
    orgLoc: ORG_LOC,
    today,
    yesterday,
    periods: { prevMonthFrom, prevMonthTo, curMonthFrom, curMonthTo },
    users: { resp: resp.id, cook: cook.id, respLoc: respLoc.id },
    buildings: { b1: b1.id, b2: b2.id, foreign: foreignBuilding.id },
    equipment: { fridge: fridge.id, lamp: lamp.id },
    docs,
  };
  fs.writeFileSync(path.join(HERE, "core-state.json"), JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
