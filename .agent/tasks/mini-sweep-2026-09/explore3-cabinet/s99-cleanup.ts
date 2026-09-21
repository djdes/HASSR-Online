import { db } from "../tg-session";
(async () => {
// 1. health_check: пропуск был разрешён — вернуть
await db.journalTemplate.update({ where: { code: "health_check" }, data: { allowNoEvents: true } });
console.log("health_check allowNoEvents ->", (await db.journalTemplate.findUnique({ where: { code: "health_check" }, select: { allowNoEvents: true } }))?.allowNoEvents);
// 2. норма «Холодильник без журнала» 1/5 -> 2/6 (и в активных бланках она обновится тем же механизмом? нет — правим только справочник)
await db.equipment.update({ where: { id: "cmu32lpb30001pg9mro5ckqh8" }, data: { tempMin: 2, tempMax: 6 } });
console.log("equipment ->", JSON.stringify(await db.equipment.findUnique({ where: { id: "cmu32lpb30001pg9mro5ckqh8" }, select: { tempMin: true, tempMax: true } })));
// 3. отпуск ZZ6
const u = await db.user.findFirst({ where: { name: { contains: "ZZ6 Новичок" } } });
if (u) { const d = await db.staffVacation.deleteMany({ where: { userId: u.id } }); console.log("vacations deleted:", d.count); }
// 4. токены инспектора, созданные мной
const del = await db.inspectorToken.deleteMany({ where: { organizationId: "e2e-org-a", label: null, createdAt: { gte: new Date("2026-09-21T09:30:00Z") } } });
console.log("inspector tokens deleted:", del.count);
// 5. организация
const org = await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { name: true, timezone: true, taskFlowMode: true } });
console.log("ORG:", JSON.stringify(org));
// 6. активные claim'ы ZZ6/мои
const act = await db.journalTaskClaim.findMany({ where: { organizationId: "e2e-org-a", status: "active" }, include: { user: { select: { name: true } } } });
for (const c of act) console.log("ACTIVE CLAIM:", c.user.name, c.journalCode, c.scopeLabel, c.dateKey.toISOString().slice(0,10));
await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,900));process.exit(1);});
