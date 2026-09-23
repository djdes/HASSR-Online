// Стенд «QR для проверяющих»: СВОЯ организация e2e-org-insp — руководитель
// с известным паролем, повар, журналы за последние 2 месяца (гигиена,
// холодильники, бракераж), отключённый журнал с документом, документ вне
// окна 12 месяцев. Чужие e2e-организации не трогаем.
// Запуск: npx tsx .agent/tasks/inspector-qr-2026-09/e2e/setup.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { orgTodayKey } from "../../../../src/lib/timezone";
import { buildFinishedProductSampleConfig } from "../../../../src/lib/finished-product-document";

export const PASSWORD = "E2eTest2026!";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORG_ID = "e2e-org-insp";
const LEGAL_VERSION = "2026-09-22";
const DISABLED = ["fryer_oil"];

const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (key: string, n: number) => {
  const d = day(key);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

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
    phone: "+79990000077",
    legalVersion: LEGAL_VERSION,
    showWhatsNew: false,
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
  const [year, month] = today.split("-").map(Number);
  const prevMonthFrom = iso(new Date(Date.UTC(year, month - 2, 1)));
  const prevMonthTo = iso(new Date(Date.UTC(year, month - 1, 0)));
  const curMonthFrom = iso(new Date(Date.UTC(year, month - 1, 1)));
  const curMonthTo = iso(new Date(Date.UTC(year, month, 0)));
  const oldFrom = iso(new Date(Date.UTC(year - 1, month - 3, 1)));
  const oldTo = iso(new Date(Date.UTC(year - 1, month - 2, 0)));

  // ---- чистый старт
  await db.journalDocument.deleteMany({ where: { organizationId: ORG_ID } });
  await db.inspectorToken.deleteMany({ where: { organizationId: ORG_ID } });
  await db.auditLog.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => null);
  await db.equipment.deleteMany({ where: { area: { organizationId: ORG_ID } } }).catch(() => null);
  await db.area.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => null);

  const legalProfileJson = {
    inn: "7701234567",
    nameFull: "ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «ПРОВЕРКА»",
    nameShort: "ООО «Проверка»",
    address: "125009, г Москва, ул Тверская, д 7",
    management: { name: "Соколова Марина Игоревна", post: "генеральный директор" },
  };
  const orgData = {
    name: "Кафе «Проверка»",
    isDemo: false,
    timezone: "Europe/Moscow",
    subscriptionPlan: "pro",
    disabledJournalCodes: DISABLED,
    inn: "7701234567",
    address: "125009, г Москва, ул Тверская, д 7",
    legalProfileJson,
    perLocationJournals: false,
  };
  const org = await db.organization.upsert({
    where: { id: ORG_ID },
    update: orgData,
    create: {
      id: ORG_ID,
      type: "restaurant",
      phone: "+79990000077",
      subscriptionEnd: new Date(Date.now() + 365 * 86400_000),
      ...orgData,
    },
  });

  const posManager = await upsertPosition(org.id, "Управляющий", "management");
  const posCook = await upsertPosition(org.id, "Повар", "staff");
  const manager = await upsertUser({ email: "insp-manager@e2e.local", name: "Марина Соколова", role: "manager", jobPositionId: posManager.id, passwordHash });
  const cook = await upsertUser({ email: "insp-cook@e2e.local", name: "Пётр Повар", role: "cook", jobPositionId: posCook.id, passwordHash });

  const area = await db.area.create({ data: { organizationId: org.id, name: "Горячий цех" } });
  const fridge = await db.equipment.create({ data: { areaId: area.id, name: "Холодильник №1", type: "refrigerator", tempMin: 2, tempMax: 6 } });

  const docs: Record<string, string> = {};
  const create = async (key: string, code: string, from: string, to: string, config: Record<string, unknown>, status = "active") => {
    const tpl = await template(code);
    const doc = await db.journalDocument.create({
      data: {
        organizationId: org.id,
        templateId: tpl.id,
        title: tpl.name,
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
    return doc.id;
  };

  const fillDays = (from: string, to: string) => {
    const out: string[] = [];
    for (let k = from; k <= to && k <= today; k = addDays(k, 1)) out.push(k);
    return out;
  };

  // Гигиена: прошлый месяц (закрыт) и текущий.
  for (const [key, from, to, status] of [
    ["hygienePrev", prevMonthFrom, prevMonthTo, "closed"],
    ["hygieneCur", curMonthFrom, curMonthTo, "active"],
  ] as const) {
    const id = await create(key, "hygiene", from, to, {}, status);
    await db.journalDocumentEntry.createMany({
      data: fillDays(from, to).flatMap((d) =>
        [manager.id, cook.id].map((employeeId) => ({
          documentId: id,
          employeeId,
          date: day(d),
          data: { status: "healthy", temperatureAbove37: false },
        }))
      ),
    });
  }

  // Холодильники: прошлый и текущий месяц.
  const coldConfig = {
    equipment: [{ id: "row-fridge", sourceEquipmentId: fridge.id, name: "Холодильник №1", min: 2, max: 6 }],
    skipWeekends: false,
  };
  for (const [key, from, to, status] of [
    ["coldPrev", prevMonthFrom, prevMonthTo, "closed"],
    ["coldCur", curMonthFrom, curMonthTo, "active"],
  ] as const) {
    const id = await create(key, "cold_equipment_control", from, to, coldConfig, status);
    await db.journalDocumentEntry.createMany({
      data: fillDays(from, to).map((d, i) => ({
        documentId: id,
        employeeId: cook.id,
        date: day(d),
        data: { responsibleTitle: "Повар", temperatures: { "row-fridge": 3 + (i % 3) } },
      })),
    });
  }

  // Бракераж готовой продукции: текущий месяц, строки в config.
  await create(
    "brakerage",
    "finished_product",
    curMonthFrom,
    curMonthTo,
    buildFinishedProductSampleConfig([{ name: manager.name, role: "manager" }, { name: cook.name, role: "cook" }], ["Борщ", "Котлета"]) as unknown as Record<string, unknown>
  );

  // Отключённый журнал — документ есть, проверяющему не показывается.
  await create("disabled", "fryer_oil", curMonthFrom, curMonthTo, {});
  // Документ вне окна 12 месяцев.
  await create("outOfWindow", "hygiene", oldFrom, oldTo, {}, "closed");

  // Чужой документ — любой документ другой организации.
  const foreign = await db.journalDocument.findFirst({ where: { organizationId: { not: ORG_ID } }, select: { id: true } });

  const state = {
    password: PASSWORD,
    org: org.id,
    today,
    periods: { prevMonthFrom, prevMonthTo, curMonthFrom, curMonthTo, oldFrom, oldTo },
    users: { manager: { id: manager.id, email: manager.email }, cook: { id: cook.id, email: cook.email } },
    docs,
    foreignDoc: foreign?.id ?? null,
  };
  fs.writeFileSync(path.join(HERE, "state.json"), JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
