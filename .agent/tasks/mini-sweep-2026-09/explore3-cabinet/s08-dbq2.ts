import { db } from "../tg-session";
(async () => {
const rows = await db.journalTaskClaim.findMany({ where: { organizationId: "e2e-org-a", journalCode: "cold_equipment_control" }, orderBy: { claimedAt: "desc" }, take: 12 });
for (const r of rows) console.log(r.id, "|", r.scopeKey, "|", r.scopeLabel, "|", r.status, "|", (r as any).verificationStatus, "| claimed", r.claimedAt.toISOString(), "| completed", r.completedAt?.toISOString());
await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,800));process.exit(1);});
