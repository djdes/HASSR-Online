import { db } from "../tg-session";
(async () => {
  const rows = await db.journalDocumentEntry.findMany({ where: { documentId: "cmu3xjc390004ks9mroi7qi9i", employeeId: "cmu2stncc0008wk9m2yu67ip7", date: { gte: new Date("2026-09-19") } }, select: { employeeId: true, date: true, data: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 8 });
  console.log(JSON.stringify(rows, null, 1));
  await db.$disconnect();
})().catch(e => { console.log("FATAL", String(e).slice(0, 300)); });
