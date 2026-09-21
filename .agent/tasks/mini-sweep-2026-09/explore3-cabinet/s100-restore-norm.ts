import { db } from "../tg-session";
const EQ = "cmu32lpb30001pg9mro5ckqh8";
(async () => {
const docs = await db.journalDocument.findMany({ where: { organization: { id: "e2e-org-a" }, template: { code: "cold_equipment_control" } }, select: { id: true, title: true, status: true, config: true } });
for (const d of docs) {
  const cfg: any = d.config;
  if (!cfg?.equipment) continue;
  let changed = false;
  for (const e of cfg.equipment) if (e.sourceEquipmentId === EQ && (e.min !== 2 || e.max !== 6)) { e.min = 2; e.max = 6; changed = true; }
  if (changed) { await db.journalDocument.update({ where: { id: d.id }, data: { config: cfg } }); console.log("restored in", d.title, d.status); }
}
console.log("done");
await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,900));process.exit(1);});
