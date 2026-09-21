import { db, state } from "./lib";
(async () => {
  const zz = await db.journalDocument.findMany({ where: { organizationId: state.orgA, title: { contains: "ZZ5" } }, select: { id: true, title: true, createdAt: true } });
  console.log("ZZ5 docs:", zz.length, zz);
  const recent = await db.journalDocument.findMany({ where: { organizationId: state.orgA }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, title: true, createdAt: true, template: { select: { code: true } } } });
  console.log("recent:", recent.map(r => [r.template.code, r.title, r.createdAt.toISOString()]));
  await db.$disconnect();
})();
