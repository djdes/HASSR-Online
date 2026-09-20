import { db } from "../tg-session";
(async () => {
  for (const org of ["e2e-org-a", "e2e-org-b"]) {
    const docs = await db.journalDocument.findMany({ where: { organizationId: org, status: "active" }, select: { id: true, title: true, template: { select: { code: true } } }, take: 8, orderBy: { createdAt: "desc" } });
    console.log(org, JSON.stringify(docs.map(d => ({ id: d.id, code: d.template?.code, t: d.title })), null, 1));
  }
  const acl = await db.userJournalAccess.findMany({ where: { user: { email: { in: ["cook-a@e2e.local", "cleaner-a@e2e.local"] } } }, select: { journalCode: true, canWrite: true, user: { select: { email: true } } } });
  console.log("ACL", JSON.stringify(acl));
  await db.$disconnect();
})().catch(e => { console.log("FATAL", String(e).slice(0, 400)); process.exit(1); });
