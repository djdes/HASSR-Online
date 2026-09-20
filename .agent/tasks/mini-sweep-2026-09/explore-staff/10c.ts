import { db } from "../tg-session";
(async () => {
  console.log("entriesB", await db.journalEntry.count({ where: { organizationId: "e2e-org-b" } }));
  const e = await db.journalEntry.findFirst({ where: { organizationId: "e2e-org-b" }, select: { id: true, templateId: true } });
  console.log("entryB", JSON.stringify(e));
  console.log("eqB", JSON.stringify(await db.equipment.findMany({ where: { organizationId: "e2e-org-b" }, select: { id: true, name: true }, take: 3 })));
  console.log("areaB", JSON.stringify(await db.area.findMany({ where: { organizationId: "e2e-org-b" }, select: { id: true, name: true }, take: 3 })));
  console.log("docsB", JSON.stringify(await db.journalDocument.findMany({ where: { organizationId: "e2e-org-b" }, select: { id: true }, take: 3 })));
  const tmpl = await db.journalTemplate.findFirst({ where: { code: "hygiene" }, select: { id: true, code: true } });
  console.log("tmpl", JSON.stringify(tmpl));
  await db.$disconnect();
})().catch(e => { console.log("FATAL", String(e).slice(0, 400)); process.exit(1); });
