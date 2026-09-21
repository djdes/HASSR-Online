import { db } from "../tg-session";
(async () => {
const rows = await db.journalTaskClaim.findMany({ where: { organizationId: "e2e-org-a" }, orderBy: { claimedAt: "desc" }, take: 8 });
for (const r of rows) console.log(r.id, r.journalCode, r.scopeLabel, "|", r.status, "|", (r as any).verificationStatus, "|", r.dateKey.toISOString().slice(0,10), "|", r.userId, "| cd:", JSON.stringify(r.completionData)?.slice(0,200));
await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,800));process.exit(1);});
