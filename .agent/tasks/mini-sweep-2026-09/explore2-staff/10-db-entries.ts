import { db } from "../tg-session";
(async () => {
  const doc = await db.journalDocument.findUnique({ where: { id: "cmu8hkgnh001tic9md21uf2nx" }, include: { template: { select: { code: true, name: true } } } });
  console.log("документ:", JSON.stringify(doc));
  const entries = await db.journalDocumentEntry.findMany({ where: { documentId: "cmu8hkgnh001tic9md21uf2nx" }, orderBy: { createdAt: "desc" }, take: 12 });
  console.log("последние записи:", JSON.stringify(entries.map(e => ({ rowKey: (e as any).rowKey, dateKey: (e as any).dateKey, value: (e as any).value, data: (e as any).data, by: (e as any).createdById, at: e.createdAt })), null, 1).slice(0, 2500));
  const claims = await db.journalTaskClaim.findMany({ where: { organizationId: "e2e-org-a", status: "completed" }, orderBy: { completedAt: "desc" }, take: 6, select: { journalCode: true, scopeLabel: true, completedAt: true, entryId: true, completionData: true, verificationStatus: true } });
  console.log("завершённые задачи:", JSON.stringify(claims, null, 1).slice(0, 2500));
  await db.$disconnect();
})().catch(e => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
