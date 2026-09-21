import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
async function main() {
  const docs = await db.journalDocument.findMany({
    where: { organizationId: "e2e-org-a", template: { code: { in: ["finished_product", "perishable_rejection"] } } },
    select: { id: true, title: true, status: true, dateFrom: true, dateTo: true, template: { select: { code: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log(JSON.stringify(docs, null, 1));
  const org = await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { disabledJournalCodes: true, qrFillMode: true, timezone: true } });
  console.log(JSON.stringify(org));
  await db.$disconnect();
}
main();
