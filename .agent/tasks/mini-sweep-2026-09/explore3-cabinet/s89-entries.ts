import { db } from "../tg-session";
(async () => {
console.log("JournalEntry всего в орг:", await db.journalEntry.count({ where: { organizationId: "e2e-org-a" } }));
console.log("JournalDocumentEntry всего в орг:", await db.journalDocumentEntry.count({ where: { document: { organization: { id: "e2e-org-a" } } } }));
const hyg = await db.journalTemplate.findUnique({ where: { code: "hygiene" }, select: { id: true } });
console.log("JournalEntry hygiene:", await db.journalEntry.count({ where: { organizationId: "e2e-org-a", templateId: hyg!.id } }));
console.log("JournalDocumentEntry hygiene сент.2026:", await db.journalDocumentEntry.count({ where: { document: { organization: { id: "e2e-org-a" }, template: { code: "hygiene" } }, date: { gte: new Date("2026-09-01"), lte: new Date("2026-09-21T23:59:59Z") } } }));
await db.$disconnect();
})().catch(e=>{console.log("FATAL",String(e).slice(0,900));process.exit(1);});
