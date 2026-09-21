import { db } from "../tg-session";
(async () => {
const rows = await db.auditLog.findMany({ where: { organizationId: "e2e-org-a", createdAt: { gte: new Date("2026-09-21T06:00:00Z") } }, orderBy: { createdAt: "desc" }, take: 40 });
console.log("count since 06:00Z:", rows.length);
for (const r of rows) console.log(r.createdAt.toISOString(), r.action, r.entityType, r.entityId?.slice(0,12), JSON.stringify(r.metadata)?.slice(0,150));
const all = await db.auditLog.count({ where: { organizationId: "e2e-org-a" } });
console.log("total audit rows:", all);
const acts = await db.auditLog.groupBy({ by: ["action"], where: { organizationId: "e2e-org-a" }, _count: true });
console.log("actions:", acts.map(a=>a.action+"="+(a as any)._count).join(", "));
await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,900));process.exit(1);});
