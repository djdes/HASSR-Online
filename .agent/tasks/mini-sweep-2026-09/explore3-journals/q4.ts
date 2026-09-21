import { db, state, out } from "./lib";
(async () => {
  const zz = await db.journalDocument.findMany({ where: { organizationId: state.orgA, title: { contains: "ZZ5" } }, select: { id: true, title: true, dateFrom: true, dateTo: true, status: true, template: { select: { code: true } } }, orderBy: { createdAt: "asc" } });
  const map: any = {};
  for (const z of zz) { if (!map[z.template.code]) map[z.template.code] = []; map[z.template.code].push({ id: z.id, title: z.title, from: z.dateFrom.toISOString().slice(0,10), to: z.dateTo.toISOString().slice(0,10) }); }
  out("zz5.json", map);
  for (const k of Object.keys(map)) console.log(k, map[k].length, map[k][0].id, map[k][0].from, map[k][0].to);
  console.log("codes:", Object.keys(map).length);
  await db.$disconnect();
})();
