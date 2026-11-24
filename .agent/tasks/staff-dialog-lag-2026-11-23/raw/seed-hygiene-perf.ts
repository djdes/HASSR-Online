/*
 * Local-only: a filled hygiene journal for the perf organization from
 * seed-staff-perf.ts — every staff member, every day of this month up to today
 * marked «Зд.». For the audit of other heavy screens (task staff-dialog-lag-2026-11-23).
 *
 *   npx tsx .agent/tasks/staff-dialog-lag-2026-11-23/raw/seed-hygiene-perf.ts
 */
import "../../../../scripts/e2e/env";

import { db } from "@/lib/db";

const ORG_NAME = "Перф-кафе сотрудники";

async function main() {
  const org = await db.organization.findFirst({ where: { name: ORG_NAME }, select: { id: true } });
  if (!org) throw new Error("Run seed-staff-perf.ts first");
  const template = await db.journalTemplate.findFirst({ where: { code: "hygiene" }, select: { id: true } });
  if (!template) throw new Error("No hygiene template — run prisma/seed.ts");
  await db.journalDocument.deleteMany({ where: { organizationId: org.id, templateId: template.id } });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const document = await db.journalDocument.create({
    data: {
      organizationId: org.id,
      templateId: template.id,
      title: "Гигиенический журнал",
      dateFrom: monthStart,
      dateTo: monthEnd,
      status: "active",
      config: {},
    },
  });
  const users = await db.user.findMany({
    where: { organizationId: org.id, archivedAt: null },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  const rows: Array<{ documentId: string; employeeId: string; date: Date; data: object }> = [];
  for (const user of users) {
    for (let day = 1; day <= now.getUTCDate(); day++) {
      rows.push({
        documentId: document.id,
        employeeId: user.id,
        date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day)),
        data: { status: "healthy", temperatureAbove37: false },
      });
    }
  }
  await db.journalDocumentEntry.createMany({ data: rows });
  console.log(JSON.stringify({ documentId: document.id, path: `/journals/hygiene/documents/${document.id}`, entries: rows.length }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
