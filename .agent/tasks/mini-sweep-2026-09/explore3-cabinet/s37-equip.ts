import { openSite } from "./site";
import { shot, go, probe, CLICKABLES } from "./lib";
import { db } from "../tg-session";
(async () => {
const eq = await db.equipment.findMany({ where: { area: { organizationId: "e2e-org-a" } }, select: { id: true, name: true, type: true, tempMin: true, tempMax: true } });
console.log("EQUIPMENT", JSON.stringify(eq, null, 1));
const docs = await db.journalDocument.findMany({ where: { organizationId: "e2e-org-a", journalCode: "cold_equipment_control" }, select: { id: true, title: true, status: true, periodStart: true, meta: true }, orderBy: { periodStart: "desc" }, take: 5 });
for (const d of docs) console.log("DOC", d.id, d.title, d.status, d.periodStart?.toISOString().slice(0,10), JSON.stringify(d.meta)?.slice(0,400));
await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
