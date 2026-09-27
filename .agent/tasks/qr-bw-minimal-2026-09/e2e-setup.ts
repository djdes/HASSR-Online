// Стенд e2e ч/б QR (e2e-site.ts): своя организация `e2e-org-bwqr` в ЛОКАЛЬНОЙ базе
// задачи (wesetup_wt_bwqr), чужие не трогаем; идемпотентно.
// Запуск: node --env-file=.env --import tsx .agent/tasks/qr-bw-minimal-2026-09/e2e-setup.ts  (STATE — куда писать state.json)
import fs from "node:fs";

import bcrypt from "bcryptjs";

import { db } from "@/lib/db";

const ORG = "e2e-org-bwqr";
const PASSWORD = "bwqr-e2e-2026";

async function main() {
  if (!/@localhost:5432\/wesetup_wt_bwqr\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("только локальная база задачи");
  await db.journalDocument.deleteMany({ where: { organizationId: ORG } });
  await db.equipment.deleteMany({ where: { area: { organizationId: ORG } } });
  await db.area.deleteMany({ where: { organizationId: ORG } });
  const data = {
    name: "Кафе «Чёрно-белый QR»",
    isDemo: false,
    timezone: "Europe/Moscow",
    qrFillMode: "public",
    subscriptionPlan: "pro",
    disabledJournalCodes: [] as string[],
    journalResponsibleUsersJson: {},
    autoJournalCodes: [] as string[],
    journalAutomationJson: {},
    perLocationJournals: false,
  };
  await db.organization.upsert({
    where: { id: ORG },
    update: data,
    create: { id: ORG, type: "restaurant", phone: "+79990000078", subscriptionEnd: new Date(Date.now() + 365 * 86400_000), ...data },
  });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = async (email: string, name: string, role: string, position: string) => {
    const pos =
      (await db.jobPosition.findFirst({ where: { organizationId: ORG, name: position } })) ??
      (await db.jobPosition.create({ data: { organizationId: ORG, name: position, categoryKey: role === "cook" ? "staff" : "management" } }));
    const fields = {
      name,
      role,
      organizationId: ORG,
      jobPositionId: pos.id,
      isActive: true,
      archivedAt: null,
      isRoot: false,
      passwordHash,
      phone: "+79990000078",
      legalVersion: "2026-09-22",
      showWhatsNew: false,
      themePreference: "light",
    };
    return db.user.upsert({ where: { email }, update: fields, create: { email, ...fields } });
  };
  const manager = await user("bwqr-manager@e2e.local", "Ольга Руководитель", "manager", "Заведующая");
  const cook = await user("bwqr-cook@e2e.local", "Пётр Повар", "cook", "Повар");
  const area = await db.area.create({ data: { organizationId: ORG, name: "Горячий цех" } });
  for (let i = 1; i <= 6; i += 1) {
    await db.equipment.create({ data: { areaId: area.id, name: i === 1 ? "Холодильник №1" : `Витрина ${String(i).padStart(2, "0")}`, type: "refrigerator", tempMin: 2, tempMax: 6 } });
  }
  const tpl = await db.journalTemplate.findFirst({ where: { code: "hygiene" }, select: { id: true, name: true } });
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const doc = await db.journalDocument.create({
    data: { organizationId: ORG, templateId: tpl!.id, title: `${tpl!.name} за месяц`, dateFrom: from, dateTo: to, status: "active", config: {} as never },
    select: { id: true },
  });
  const state = { org: ORG, password: PASSWORD, manager: manager.email, managerId: manager.id, cookId: cook.id, hygieneDoc: doc.id };
  fs.writeFileSync(process.env.STATE ?? "D:/wt-build/tmp-bwqr/e2e/state.json", JSON.stringify(state, null, 2));
  console.log(JSON.stringify({ ...state, password: "***" }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
