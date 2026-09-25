/* eslint-disable no-console */
// Локальная организация для e2e задачи cabinet-nav-dashboard-2026-09.
//   npx tsx .agent/tasks/cabinet-nav-dashboard-2026-09/e2e/seed.ts
// Воспроизводит «пропавшую гигиену»: документ гигиены за текущий месяц
// ЗАКРЫТ, а у фритюра — действующий документ. Остальные журналы без
// документов. Раньше на /settings/qr-posters была только фритюрка.
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { LEGAL_VERSION } from "@/lib/legal-consent";

const ORG_ID = "e2e-nav-dashboard-org";
const EMAIL = "e2e-nav@wesetup.local";
const PASSWORD = "E2e-Nav-2026!";

async function main() {
  await db.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: { id: ORG_ID, name: "Кафе «Навигация»", type: "restaurant", subscriptionPlan: "pro" },
  });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await db.user.deleteMany({ where: { email: EMAIL } });
  await db.user.create({
    data: { email: EMAIL, name: "Иванова Анна Сергеевна", role: "owner", passwordHash, organizationId: ORG_ID, isActive: true, legalVersion: LEGAL_VERSION },
  });
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  await db.journalDocument.deleteMany({ where: { organizationId: ORG_ID } });
  for (const [code, status] of [["hygiene", "closed"], ["fryer_oil", "active"]] as const) {
    const template = await db.journalTemplate.findFirst({ where: { code }, select: { id: true, name: true } });
    if (!template) throw new Error(`no template ${code}`);
    await db.journalDocument.create({
      data: { templateId: template.id, organizationId: ORG_ID, title: template.name, dateFrom: from, dateTo: to, status },
    });
  }
  const enabled = await db.journalTemplate.count({ where: { isActive: true } });
  console.log(JSON.stringify({ org: ORG_ID, email: EMAIL, password: PASSWORD, enabledTemplates: enabled }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
