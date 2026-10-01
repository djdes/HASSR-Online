/**
 * Idempotent seeder that guarantees a predictable «demo kitchen» state
 * on prod so the screenshot bot always has something meaningful to
 * capture. Runs as part of the deploy workflow alongside the other
 * seeders.
 *
 * What it ensures:
 *  - One Organization: «Демо-кухня WESETUP» (id fixed so re-runs match)
 *  - One manager user with credentials from env:
 *      DEMO_SCREENSHOT_EMAIL / DEMO_SCREENSHOT_PASSWORD
 *  - 5 active staff with JobPositions covering both management and staff
 *  - 5 recent JournalEntry per field-based journal (uv_lamp_runtime,
 *    fryer_oil, complaint_register, pest_control, equipment_calibration,
 *    product_writeoff)
 *  - 1 open JournalDocument per document-based journal we want in the
 *    screenshot fan (hygiene, cold_equipment_control, climate_control,
 *    cleaning)
 *
 * Running multiple times is safe — every insert is an upsert or skipped
 * if the demo already has ≥3 entries / ≥1 document per template.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import pg from "pg";

const DEMO_ORG_ID = "demo-screenshots";
const DEMO_ORG_NAME = "Демо-кухня WESETUP";
const DEMO_EMAIL =
  process.env.DEMO_SCREENSHOT_EMAIL ?? "demo-screenshots@wesetup.local";
const DEMO_PASSWORD =
  process.env.DEMO_SCREENSHOT_PASSWORD ?? "DemoScreens2026!";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function ensureOrg() {
  return prisma.organization.upsert({
    where: { id: DEMO_ORG_ID },
    create: {
      id: DEMO_ORG_ID,
      name: DEMO_ORG_NAME,
      type: "restaurant",
      subscriptionPlan: "extended",
    },
    update: { name: DEMO_ORG_NAME, subscriptionPlan: "extended" },
  });
}

async function ensureManager(orgId: string) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const manager = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: {
      email: DEMO_EMAIL,
      name: "Демо Менеджер",
      passwordHash: hash,
      role: "manager",
      positionTitle: "Управляющий",
      organizationId: orgId,
      isActive: true,
    },
    update: {
      passwordHash: hash,
      organizationId: orgId,
      role: "manager",
      isActive: true,
    },
  });
  return manager;
}

async function ensureStaff(orgId: string) {
  const staff = [
    { name: "Волков Д.В.", role: "head_chef", title: "Шеф-повар" },
    { name: "Петрова Н.А.", role: "cook", title: "Повар" },
    { name: "Соколов А.М.", role: "cook", title: "Повар" },
    { name: "Иванова Е.П.", role: "waiter", title: "Официант" },
    { name: "Морозов К.С.", role: "cook", title: "Кондитер" },
  ];
  const results: { id: string; name: string }[] = [];
  for (const s of staff) {
    const email = `${s.name.toLowerCase().replace(/\s+/g, ".")}@${DEMO_ORG_ID}.local`;
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: s.name,
        passwordHash: "",
        role: s.role,
        positionTitle: s.title,
        organizationId: orgId,
        isActive: true,
      },
      update: { organizationId: orgId, isActive: true },
    });
    results.push({ id: user.id, name: user.name });
  }
  return results;
}

async function ensureFieldEntries(
  orgId: string,
  filledById: string,
  templateCode: string,
  build: () => Record<string, unknown>
) {
  const template = await prisma.journalTemplate.findUnique({
    where: { code: templateCode },
    select: { id: true },
  });
  if (!template) return;
  const existing = await prisma.journalEntry.count({
    where: { organizationId: orgId, templateId: template.id },
  });
  if (existing >= 3) return; // already seeded
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const when = new Date(now - i * 24 * 60 * 60 * 1000);
    await prisma.journalEntry.create({
      data: {
        templateId: template.id,
        organizationId: orgId,
        filledById,
        data: build() as unknown as object,
        status: "submitted",
        createdAt: when,
      },
    });
  }
}

async function ensureDocument(
  orgId: string,
  createdById: string,
  templateCode: string,
  title: string
) {
  const template = await prisma.journalTemplate.findUnique({
    where: { code: templateCode },
    select: { id: true },
  });
  if (!template) return;
  const existing = await prisma.journalDocument.count({
    where: { organizationId: orgId, templateId: template.id, status: "active" },
  });
  if (existing >= 1) return;
  const today = new Date();
  const dateFrom = new Date(today);
  dateFrom.setDate(dateFrom.getDate() - 14);
  const dateTo = new Date(today);
  dateTo.setDate(dateTo.getDate() + 1);
  await prisma.journalDocument.create({
    data: {
      templateId: template.id,
      organizationId: orgId,
      title,
      dateFrom,
      dateTo,
      responsibleTitle: "Управляющий",
      status: "active",
      createdById,
    },
  });
}

async function main() {
  const org = await ensureOrg();
  const manager = await ensureManager(org.id);
  await ensureStaff(org.id);

  // Field-based journals — 5 recent entries each.
  await ensureFieldEntries(org.id, manager.id, "uv_lamp_runtime", () => ({
    lampName: "УФ-1 цех №1",
    hoursBefore: Math.floor(Math.random() * 1000) + 7000,
    hoursAfter: Math.floor(Math.random() * 1000) + 7500,
  }));
  await ensureFieldEntries(org.id, manager.id, "fryer_oil", () => ({
    fryerName: "Фритюр цех №2",
    polarPct: +(Math.random() * 4 + 18).toFixed(1),
    replaced: Math.random() > 0.6,
  }));
  await ensureFieldEntries(org.id, manager.id, "complaint_register", () => ({
    source: ["Гость в зале", "Отзыв на Яндекс.Картах", "Жалоба по почте"][
      Math.floor(Math.random() * 3)
    ],
    subject: "Проверено, приняты меры",
    status: "resolved",
  }));
  await ensureFieldEntries(org.id, manager.id, "pest_control", () => ({
    type: "Дератизация",
    contractor: "ООО «СЭС-Москва»",
    agent: "Бродифакум 0.005%",
  }));
  await ensureFieldEntries(org.id, manager.id, "equipment_calibration", () => ({
    device: "Термометр ТК-5.11",
    result: "В норме",
    nextDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
  }));
  await ensureFieldEntries(org.id, manager.id, "product_writeoff", () => ({
    product: "Творог 9% (партия 0418-03)",
    quantity: +(Math.random() * 3 + 0.5).toFixed(2),
    reason: "Истёк срок годности",
  }));

  // Document-based journals — one active document per code.
  await ensureDocument(
    org.id,
    manager.id,
    "hygiene",
    "Гигиенический журнал · 01.04 — 14.04.2026"
  );
  await ensureDocument(
    org.id,
    manager.id,
    "cold_equipment_control",
    "Температура холодильников · апрель 2026"
  );
  await ensureDocument(
    org.id,
    manager.id,
    "climate_control",
    "Температура и влажность · апрель 2026"
  );
  await ensureDocument(
    org.id,
    manager.id,
    "cleaning",
    "Уборка помещений · неделя 15"
  );

  console.log(
    `[seed-demo-screenshots] org=${org.id} manager=${manager.id} email=${DEMO_EMAIL}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
