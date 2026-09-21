import { db } from "../tg-session";
(async () => {
const docs = await db.journalDocument.findMany({ where: { organization: { id: "e2e-org-a" } }, select: { id: true, title: true, template: { select: { code: true } }, status: true } });
const byCode: Record<string, number> = {};
for (const d of docs) {
  const n = await db.journalDocumentEntry.count({ where: { documentId: d.id, date: { gte: new Date("2026-09-21T00:00:00Z"), lt: new Date("2026-09-22T00:00:00Z") } } }).catch(()=>-1);
  if (n > 0) byCode[d.template.code] = (byCode[d.template.code] ?? 0) + n;
}
console.log("Записи за 21.09 по журналам:", JSON.stringify(byCode, null, 1));
await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,900));process.exit(1);});
