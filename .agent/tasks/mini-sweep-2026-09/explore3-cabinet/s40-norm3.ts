import { openSite } from "./site";
import { shot, go, probe } from "./lib";
import { db } from "../tg-session";
const EQ = "cmu32lpb30001pg9mro5ckqh8";
(async () => {
const before = await db.journalDocument.findMany({ where: { template: { code: "cold_equipment_control" }, organization: { id: "e2e-org-a" } }, select: { id: true, title: true, status: true, config: true } });
console.log("BEFORE:");
for (const d of before) { const e = (d.config as any)?.equipment?.find((x:any)=>x.sourceEquipmentId===EQ); if (e) console.log(" ", d.title, d.status, JSON.stringify({min:e.min,max:e.max})); }
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/settings/equipment", 5000);
await p.waitForFunction(`/Холодильник без журнала/.test(document.body.innerText)`, { timeout: 180000 });
await p.waitForTimeout(2000);
await p.click('button[aria-label="Изменить оборудование «Холодильник без журнала»"]');
await p.waitForTimeout(1500);
await p.fill('input[placeholder="например 2 или -18"]', "1");
await p.fill('input[placeholder="например 6 или -15"]', "5");
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Сохранить').click()`);
await p.waitForTimeout(4000);
console.log("after save:", (await probe(p)).bodyText.slice(0,300).replace(/\n/g," | "));
await shot(p, "40-after-norm");
const eq = await db.equipment.findUnique({ where: { id: EQ }, select: { tempMin: true, tempMax: true } });
console.log("EQ now", JSON.stringify(eq));
const after = await db.journalDocument.findMany({ where: { template: { code: "cold_equipment_control" }, organization: { id: "e2e-org-a" } }, select: { id: true, title: true, status: true, config: true } });
console.log("AFTER:");
for (const d of after) { const e = (d.config as any)?.equipment?.find((x:any)=>x.sourceEquipmentId===EQ); if (e) console.log(" ", d.title, d.status, JSON.stringify({min:e.min,max:e.max})); }
console.log("ERRORS", JSON.stringify(s.errors).slice(0,400));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
