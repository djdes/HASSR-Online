import { db } from "../tg-session";
(async () => {
await db.organization.update({ where: { id: "e2e-org-a" }, data: { taskFlowMode: "manual" } });
const cleaner = "cmu2stncj0009wk9mgu2p7eq1";
const act = await db.journalTaskClaim.findMany({ where: { organizationId: "e2e-org-a", userId: cleaner, status: "active" } });
for (const c of act) {
  if (c.journalCode === "cleaning") { console.log("keep stuck", c.id); continue; }
  await db.journalTaskClaim.deleteMany({ where: { organizationId: c.organizationId, journalCode: c.journalCode, scopeKey: c.scopeKey, status: "released" } });
  await db.journalTaskClaim.update({ where: { id: c.id }, data: { status: "released", releasedAt: new Date() } });
  console.log("released", c.id, c.journalCode);
}
const org = await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { taskFlowMode: true, timezone: true, name: true } });
console.log("ORG", JSON.stringify(org));
await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,600));process.exit(1);});
