import { db, state } from "./lib";
(async () => {
  const zz = await db.journalDocument.findMany({ where: { organizationId: state.orgA, title: { contains: "ZZ5" } }, select: { id: true, title: true, dateFrom: true, dateTo: true, template: { select: { code: true } } }, orderBy: { createdAt: "asc" } });
  console.log("ZZ5 docs:", zz.length);
  for (const z of zz) console.log(z.template.code, "|", z.id, "|", z.title, "|", z.dateFrom.toISOString().slice(0,10), "..", z.dateTo.toISOString().slice(0,10));
  await db.$disconnect();
})();
