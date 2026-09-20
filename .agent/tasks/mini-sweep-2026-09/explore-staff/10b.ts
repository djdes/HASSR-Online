import { db } from "../tg-session";
(async () => {
  const acl = await db.userJournalAccess.findMany({ where: { userId: { in: ["cmu2stncc0008wk9m2yu67ip7", "cmu2stncj0009wk9mgu2p7eq1"] } }, select: { userId: true, templateCode: true } });
  console.log("ACL", JSON.stringify(acl));
  const eb = await db.journalEntry.findMany({ where: { organizationId: "e2e-org-b" }, select: { id: true, journalCode: true }, take: 3 });
  console.log("ENTRIES-B", JSON.stringify(eb));
  const db2 = await db.journalDocument.findMany({ where: { organizationId: "e2e-org-b" }, select: { id: true, status: true, title: true }, take: 5 });
  console.log("DOCS-B-any", JSON.stringify(db2));
  const ea = await db.journalEntry.findMany({ where: { organizationId: "e2e-org-a" }, select: { id: true, journalCode: true }, take: 3 });
  console.log("ENTRIES-A", JSON.stringify(ea));
  await db.$disconnect();
})().catch(e => { console.log("FATAL", String(e).slice(0, 400)); process.exit(1); });
