/* eslint-disable no-console */
/**
 * Фикстура для e2e задачи mobile-cabinet-2026-09 (своя база из .env).
 *
 *   E2E_BASE=http://localhost:3040 npx tsx .agent/tasks/mobile-cabinet-2026-09/e2e/seed.ts
 *   ... seed.ts --cleanup   — удалить организации фикстуры
 *
 * Организация «Кафе «Ромашка»» с владельцем, шестью сотрудниками по
 * должностям и действующими документами журналов (создаются через
 * настоящий POST /api/journal-documents — с конфигом по умолчанию), плюс
 * мастер-кабинет справочников, привязанный к её коду пула. Идентификаторы
 * пишутся в fixture.json — их читает measure.ts.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { request } from "playwright-core";

import { db } from "@/lib/db";
import { LEGAL_VERSION } from "@/lib/legal-consent";
import { createOrInviteMasterCabinet } from "@/lib/master-cabinet";

const BASE = process.env.E2E_BASE ?? "http://localhost:3040";
const ORG_ID = "e2e-mobile-cabinet-org";
const OWNER_EMAIL = "e2e-mobile-owner@wesetup.local";
const MASTER_EMAIL = "e2e-mobile-master@wesetup.local";
const PASSWORD = "E2e-Mobile-2026!";
const FIXTURE = path.join(__dirname, "fixture.json");

type Fixture = {
  orgId: string;
  masterOrgId: string | null;
  ownerEmail: string;
  masterEmail: string;
  password: string;
  documents: Array<{ code: string; id: string }>;
};

async function cleanup() {
  const prev: Partial<Fixture> = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, "utf8")) : {};
  const ids = [ORG_ID, prev.masterOrgId].filter((id): id is string => Boolean(id));
  // Мастер-кабинет мог остаться от прошлого прогона без fixture.json.
  const masterUser = await db.user.findFirst({ where: { email: MASTER_EMAIL }, select: { organizationId: true } });
  if (masterUser?.organizationId && masterUser.organizationId !== ORG_ID) ids.push(masterUser.organizationId);
  await db.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, MASTER_EMAIL] } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  if (fs.existsSync(FIXTURE)) fs.unlinkSync(FIXTURE);
  console.log("cleanup done", ids);
}

async function main() {
  if (process.argv.includes("--cleanup")) {
    await cleanup();
    return;
  }
  await cleanup();

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await db.organization.create({
    data: { id: ORG_ID, name: "Кафе «Ромашка»", type: "restaurant", inn: "7707083893", address: "г. Москва, ул. Садовая, 12" },
  });
  const [manager, cook, waiter, cleaner] = await Promise.all(
    [
      { categoryKey: "management", name: "Управляющий", sortOrder: 0 },
      { categoryKey: "staff", name: "Повар", sortOrder: 1 },
      { categoryKey: "staff", name: "Официант", sortOrder: 2 },
      { categoryKey: "staff", name: "Уборщица", sortOrder: 3 },
    ].map((data) => db.jobPosition.create({ data: { organizationId: ORG_ID, ...data } }))
  );
  const owner = await db.user.create({
    data: {
      email: OWNER_EMAIL,
      name: "Иванова Анна Сергеевна",
      role: "manager",
      phone: "+79161234567",
      passwordHash,
      organizationId: ORG_ID,
      jobPositionId: manager.id,
      positionTitle: "Управляющий",
      isActive: true,
      legalVersion: LEGAL_VERSION,
      showWhatsNew: false,
    },
  });
  const staff = [
    ["Петров Иван Николаевич", "cook", cook, "+79161230001"],
    ["Смирнова Ольга Викторовна", "cook", cook, "+79161230002"],
    ["Кузнецов Дмитрий Андреевич", "cook", cook, "+79161230003"],
    ["Попова Мария Игоревна", "waiter", waiter, "+79161230004"],
    ["Васильева Елена Петровна", "waiter", waiter, "+79161230005"],
    ["Соколова Галина Ивановна", "cleaner", cleaner, "+79161230006"],
  ] as const;
  for (const [name, role, position, phone] of staff) {
    await db.user.create({
      data: {
        email: `e2e-mobile-${phone.slice(-4)}@wesetup.local`,
        name,
        role,
        phone,
        passwordHash,
        organizationId: ORG_ID,
        jobPositionId: position.id,
        positionTitle: position.name,
        isActive: true,
        legalVersion: LEGAL_VERSION,
      },
    });
  }

  // Документы — через настоящий API под владельцем: конфиг по умолчанию
  // (строки гигиены из сотрудников и т. п.) собирает сервер.
  const api = await request.newContext({ baseURL: BASE });
  const login = await api.post("/api/auth/login", { data: { email: OWNER_EMAIL, password: PASSWORD } });
  if (login.status() !== 200) throw new Error(`owner login ${login.status()} ${await login.text()}`);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const from = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const to = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
  const documents: Fixture["documents"] = [];
  for (const code of ["hygiene", "health_check", "fryer_oil"]) {
    const template = await db.journalTemplate.findFirst({ where: { code }, select: { id: true } });
    if (!template) {
      console.log("skip template (absent)", code);
      continue;
    }
    const res = await api.post("/api/journal-documents", { data: { templateCode: code, dateFrom: from, dateTo: to } });
    const body = (await res.json().catch(() => ({}))) as { document?: { id: string }; id?: string };
    const id = body.document?.id ?? body.id;
    if (res.status() >= 300 || !id) throw new Error(`create ${code}: ${res.status()} ${JSON.stringify(body).slice(0, 300)}`);
    documents.push({ code, id });
  }

  // Мастер-кабинет справочников, привязанный к коду пула «Ромашки».
  const cabinet = await createOrInviteMasterCabinet({
    organizationId: ORG_ID,
    actorUserId: owner.id,
    name: "Бэк Офисова Мария",
    email: MASTER_EMAIL,
  });
  const raw = cabinet.inviteUrl.split("/invite/")[1];
  const accept = await api.post(`/api/invite/${raw}/accept`, { data: { password: PASSWORD } });
  if (accept.status() !== 200) throw new Error(`invite accept ${accept.status()} ${await accept.text()}`);
  await db.user.update({ where: { email: MASTER_EMAIL }, data: { legalVersion: LEGAL_VERSION, showWhatsNew: false } });
  await db.sharedDirectoryItem.createMany({
    data: [
      { organizationId: cabinet.masterOrganizationId, kind: "dish", name: "Борщ со сметаной", portion: "250", time: "12:30", sortOrder: 0 },
      { organizationId: cabinet.masterOrganizationId, kind: "dish", name: "Каша овсяная", portion: "200", time: "08:00", sortOrder: 1 },
      { organizationId: cabinet.masterOrganizationId, kind: "dish", name: "Компот из сухофруктов", portion: "200", time: null, sortOrder: 2 },
    ],
  });
  await api.dispose();

  const fixture: Fixture = {
    orgId: ORG_ID,
    masterOrgId: cabinet.masterOrganizationId,
    ownerEmail: OWNER_EMAIL,
    masterEmail: MASTER_EMAIL,
    password: PASSWORD,
    documents,
  };
  fs.writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2));
  console.log(JSON.stringify(fixture));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
