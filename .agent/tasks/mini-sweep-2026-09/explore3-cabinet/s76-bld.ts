import { db } from "../tg-session";
(async () => {
const docs = await db.journalDocument.findMany({ where: { organization: { id: "e2e-org-a" }, status: "active" }, select: { id: true, title: true, buildingId: true, dateFrom: true, dateTo: true, template: { select: { code: true } } } });
const t = new Date("2026-09-21T00:00:00Z");
const covering = docs.filter(d=> d.dateFrom <= t && d.dateTo >= t);
console.log("active docs:", docs.length, "| covering today:", covering.length);
console.log(JSON.stringify(covering.map(d=>({c:d.template.code,b:d.buildingId,t:d.title})).slice(0,40), null, 0));
const b = await db.building.findMany({ where: { organizationId: "e2e-org-a" }, select: { id: true, name: true, isDefault: true } }).catch(()=>null);
console.log("buildings:", JSON.stringify(b));
await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,900));process.exit(1);});
