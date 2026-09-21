import { db } from "../tg-session";
(async () => {
const eq = await db.equipment.findMany({ where: { area: { organizationId: "e2e-org-a" } }, select: { id: true, name: true, type: true, tempMin: true, tempMax: true } });
console.log("EQUIPMENT", JSON.stringify(eq));
const docs = await db.journalDocument.findMany({ where: { template: { code: "cold_equipment_control" }, organization: { id: "e2e-org-a" } }, select: { id: true, title: true, status: true, dateFrom: true, dateTo: true, config: true }, orderBy: { dateFrom: "desc" }, take: 4 });
for (const d of docs) console.log("DOC", d.id, "|", d.title, "|", d.status, "|", d.dateFrom?.toISOString().slice(0,10), "->", d.dateTo?.toISOString().slice(0,10), "|", JSON.stringify(d.config)?.slice(0,700));
await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,600));process.exit(1);});
