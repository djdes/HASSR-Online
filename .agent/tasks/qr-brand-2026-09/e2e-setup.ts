// Стенд e2e фирменного QR (e2e-brand-qr.ts, e2e-api-qr.ts): своя организация `e2e-org-qrbrand`
// в ЛОКАЛЬНОЙ базе (DATABASE_URL на localhost), чужие не трогаем; идемпотентно.
// Запуск: npx tsx --env-file=.env .agent/tasks/qr-brand-2026-09/e2e-setup.ts  (STATE — куда писать state.json)
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

const ORG = "e2e-org-qrbrand";
const PASSWORD = "qrbrand-e2e-2026";

async function main() {
  if (!/@localhost:5432\//.test(process.env.DATABASE_URL ?? "")) throw new Error("только локальная база");
  await db.journalDocument.deleteMany({ where: { organizationId: ORG } });
  await db.equipment.deleteMany({ where: { area: { organizationId: ORG } } });
  await db.area.deleteMany({ where: { organizationId: ORG } });
  const data = {
    name: "Кафе «Фирменный QR»", isDemo: false, timezone: "Europe/Moscow", qrFillMode: "public", subscriptionPlan: "pro",
    disabledJournalCodes: [] as string[], journalResponsibleUsersJson: {}, autoJournalCodes: [] as string[], journalAutomationJson: {}, perLocationJournals: false,
  };
  await db.organization.upsert({ where: { id: ORG }, update: data, create: { id: ORG, type: "restaurant", phone: "+79990000077", subscriptionEnd: new Date(Date.now() + 365 * 86400_000), ...data } });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = async (email: string, name: string, role: string, position: string) => {
    const pos = (await db.jobPosition.findFirst({ where: { organizationId: ORG, name: position } })) ??
      (await db.jobPosition.create({ data: { organizationId: ORG, name: position, categoryKey: role === "cook" ? "staff" : "management" } }));
    const fields = { name, role, organizationId: ORG, jobPositionId: pos.id, isActive: true, archivedAt: null, isRoot: false, passwordHash, phone: "+79990000077", legalVersion: "2026-09-22", showWhatsNew: false, themePreference: "light" };
    return db.user.upsert({ where: { email }, update: fields, create: { email, ...fields } });
  };
  const manager = await user("qrbrand-manager@e2e.local", "Ольга Руководитель", "manager", "Заведующая");
  const cook = await user("qrbrand-cook@e2e.local", "Пётр Повар", "cook", "Повар");
  const area = await db.area.create({ data: { organizationId: ORG, name: "Горячий цех" } });
  const fridge = await db.equipment.create({ data: { areaId: area.id, name: "Холодильник №1", type: "refrigerator", tempMin: 2, tempMax: 6 } });
  for (let i = 1; i <= 7; i += 1) await db.equipment.create({ data: { areaId: area.id, name: `Витрина ${String(i).padStart(2, "0")}`, type: "refrigerator", tempMin: 0, tempMax: 8 } });
  const tpl = await db.journalTemplate.findFirst({ where: { code: "hygiene" }, select: { id: true, name: true } });
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const doc = await db.journalDocument.create({
    data: { organizationId: ORG, templateId: tpl!.id, title: `${tpl!.name} за месяц`, dateFrom: from, dateTo: to, status: "active", config: {} as never },
    select: { id: true },
  });
  const state = { org: ORG, password: PASSWORD, manager: manager.email, managerId: manager.id, cookId: cook.id, fridge: fridge.id, hygieneDoc: doc.id };
  fs.writeFileSync(process.env.STATE ?? "C:/wt/qrbrand-tmp/e2e/state.json", JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
