import { db } from "../tg-session";
(async () => {
  const a = await db.journalDocument.findMany({ where: { organizationId: "e2e-org-a", status: "active", template: { code: { in: ["hygiene", "health_check", "cold_equipment_control", "cleaning"] } } }, select: { id: true, title: true, dateFrom: true, dateTo: true, template: { select: { code: true } } }, take: 10 });
  console.log(JSON.stringify(a, null, 1));
  await db.$disconnect();
})().catch(e => { console.log("FATAL", String(e).slice(0, 300)); });
