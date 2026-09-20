import { db } from "../tg-session";
(async () => {
  const t = await db.journalTemplate.findFirst({ where: { code: "hygiene" }, select: { id: true } });
  const exists = await db.journalDocument.findFirst({ where: { organizationId: "e2e-org-b", title: { startsWith: "СЕКРЕТ Беты" } } });
  if (exists) { console.log("already", exists.id); } else {
    const d = await db.journalDocument.create({ data: { templateId: t!.id, organizationId: "e2e-org-b", title: "СЕКРЕТ Беты — гигиена сентябрь", dateFrom: new Date("2026-09-01"), dateTo: new Date("2026-09-30"), status: "active" }, select: { id: true } });
    console.log("created", d.id);
  }
  await db.$disconnect();
})().catch(e => { console.log("FATAL", String(e).slice(0, 400)); process.exit(1); });
