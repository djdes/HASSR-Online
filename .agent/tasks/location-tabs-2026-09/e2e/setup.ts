// Стенд вкладок точек (location-tabs-2026-09). Идемпотентный.
//
// СВОИ организации, чужие e2e-орги (e2e-org-a и др.) не трогаем:
//   - e2e-org-loc  — 3 точки (как на скриншоте владельца), perLocationJournals=true,
//                    4 включённых ежедневных журнала, документ на каждую точку,
//                    «Закрыть день»: точка 1 — все 4 журнала, точка 2 — 2 журнала,
//                    точка 3 — ничего. Ожидаемые счётчики 4/4, 2/4, 0/4.
//   - e2e-org-loc1 — одна точка, флаг включён: вкладок быть не должно.
//   - e2e-org-loc0 — две точки, флаг выключен: вкладок быть не должно.
// Запуск: npx tsx .agent/tasks/location-tabs-2026-09/e2e/setup.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

export const PASSWORD = "E2eTest2026!";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
/** Текущая редакция документов — чтобы окно «Мы обновили условия» не мешало. */
const LEGAL_VERSION = "2026-09-22";
const TIMEZONE = "Europe/Moscow";
const ENABLED = ["hygiene", "health_check", "climate_control", "cold_equipment_control"];
const BUILDINGS = [
  { name: "лордлор", address: "ул. Пушкина, 1" },
  { name: "hgjhghj", address: null },
  { name: "Какая то там вторая точка ленина 10 допустим", address: "ул. Ленина, 10" },
];

/** UTC-полночь сегодняшней даты по часовому поясу организации. */
function orgTodayStart(): Date {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${key}T00:00:00.000Z`);
}

async function upsertPosition(organizationId: string, name: string, categoryKey: "management" | "staff") {
  const existing = await db.jobPosition.findFirst({ where: { organizationId, name } });
  if (existing) return existing;
  return db.jobPosition.create({ data: { organizationId, name, categoryKey } });
}

async function upsertUser(input: {
  organizationId: string;
  email: string;
  name: string;
  role: string;
  jobPositionId: string;
  passwordHash: string;
}) {
  const data = {
    name: input.name,
    role: input.role,
    organizationId: input.organizationId,
    jobPositionId: input.jobPositionId,
    isActive: true,
    archivedAt: null,
    isRoot: false,
    passwordHash: input.passwordHash,
    phone: "+79990000088",
    legalVersion: LEGAL_VERSION,
    showWhatsNew: false,
    buildingIds: [],
    lastActiveBuildingId: null,
  };
  return db.user.upsert({
    where: { email: input.email },
    update: data,
    create: { email: input.email, ...data },
  });
}

async function upsertOrg(id: string, name: string, perLocationJournals: boolean, disabled: string[]) {
  const data = {
    name,
    isDemo: false,
    timezone: TIMEZONE,
    perLocationJournals,
    disabledJournalCodes: disabled,
    journalResponsibleUsersJson: {},
    autoJournalCodes: [],
  };
  return db.organization.upsert({
    where: { id },
    update: data,
    create: {
      id,
      type: "restaurant",
      phone: "+79990000088",
      subscriptionPlan: "pro",
      subscriptionEnd: new Date(Date.now() + 365 * 86400_000),
      ...data,
    },
  });
}

async function resetBuildings(organizationId: string, list: typeof BUILDINGS) {
  await db.journalCloseEvent.deleteMany({ where: { organizationId } });
  await db.journalDocument.deleteMany({ where: { organizationId } });
  await db.building.deleteMany({ where: { organizationId } });
  const out = [];
  for (const [index, item] of list.entries()) {
    out.push(
      await db.building.create({
        data: { organizationId, name: item.name, address: item.address, sortOrder: index },
        select: { id: true, name: true, address: true },
      }),
    );
  }
  return out;
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const templates = await db.journalTemplate.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
  });
  const disabled = templates.map((t) => t.code).filter((code) => !ENABLED.includes(code));
  const enabledTemplates = templates.filter((t) => ENABLED.includes(t.code));
  if (enabledTemplates.length !== ENABLED.length) throw new Error("не найдены шаблоны журналов");

  // ── Основная организация: три точки ─────────────────────────────
  const org = await upsertOrg("e2e-org-loc", "Кафе «Точки»", true, disabled);
  const buildings = await resetBuildings(org.id, BUILDINGS);
  const posManager = await upsertPosition(org.id, "Управляющий", "management");
  const posCook = await upsertPosition(org.id, "Повар", "staff");
  const manager = await upsertUser({
    organizationId: org.id,
    email: "loc-manager@e2e.local",
    name: "Лидия Руководитель",
    role: "manager",
    jobPositionId: posManager.id,
    passwordHash,
  });
  const cook = await upsertUser({
    organizationId: org.id,
    email: "loc-cook@e2e.local",
    name: "Лев Повар",
    role: "cook",
    jobPositionId: posCook.id,
    passwordHash,
  });
  await db.userJournalAccess.deleteMany({ where: { userId: cook.id } }).catch(() => null);

  const today = orgTodayStart();
  const dateFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const dateTo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  for (const building of buildings) {
    for (const template of enabledTemplates) {
      await db.journalDocument.create({
        data: {
          organizationId: org.id,
          templateId: template.id,
          title: `${template.name} — ${building.name}`,
          buildingId: building.id,
          dateFrom,
          dateTo,
          status: "active",
        },
      });
    }
  }
  // «Закрыть день»: точка 1 — все журналы, точка 2 — два, точка 3 — ничего.
  const closePlan: Array<[string, number]> = [
    [buildings[0].id, enabledTemplates.length],
    [buildings[1].id, 2],
  ];
  for (const [buildingId, count] of closePlan) {
    for (const template of enabledTemplates.slice(0, count)) {
      await db.journalCloseEvent.create({
        data: {
          organizationId: org.id,
          templateId: template.id,
          date: today,
          buildingKey: buildingId,
          kind: "no-events",
          reason: "e2e: закрыли день",
          closedByUserId: manager.id,
        },
      });
    }
  }

  // ── Одна точка: вкладок нет ─────────────────────────────────────
  const orgOne = await upsertOrg("e2e-org-loc1", "Кафе «Одна точка»", true, disabled);
  await resetBuildings(orgOne.id, BUILDINGS.slice(0, 1));
  const posOne = await upsertPosition(orgOne.id, "Управляющий", "management");
  const managerOne = await upsertUser({
    organizationId: orgOne.id,
    email: "loc1-manager@e2e.local",
    name: "Олег Одна Точка",
    role: "manager",
    jobPositionId: posOne.id,
    passwordHash,
  });

  // ── Точки выключены: вкладок нет ────────────────────────────────
  const orgOff = await upsertOrg("e2e-org-loc0", "Кафе «Без точек»", false, disabled);
  await resetBuildings(orgOff.id, BUILDINGS.slice(0, 2));
  const posOff = await upsertPosition(orgOff.id, "Управляющий", "management");
  const managerOff = await upsertUser({
    organizationId: orgOff.id,
    email: "loc0-manager@e2e.local",
    name: "Ольга Без Точек",
    role: "manager",
    jobPositionId: posOff.id,
    passwordHash,
  });

  const state = {
    password: PASSWORD,
    org: org.id,
    today: today.toISOString(),
    enabled: ENABLED,
    buildings: buildings.map((b, i) => ({ ...b, expected: `${[4, 2, 0][i]}/${ENABLED.length}` })),
    users: {
      manager: { id: manager.id, email: manager.email },
      cook: { id: cook.id, email: cook.email },
      managerOne: { id: managerOne.id, email: managerOne.email },
      managerOff: { id: managerOff.id, email: managerOff.email },
    },
  };
  fs.writeFileSync(path.join(HERE, "state.json"), JSON.stringify(state, null, 2));
  console.log("OK", JSON.stringify(state, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
