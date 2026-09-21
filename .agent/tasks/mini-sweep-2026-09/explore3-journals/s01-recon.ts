import { db, state } from "./lib";
(async () => {
  const org = state.orgA;
  const tpls = await db.journalTemplate.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true, isActive: true, fields: true, fillMode: true } });
  console.log("templates:", tpls.length);
  for (const t of tpls) {
    const f: any = t.fields;
    const kind = f && typeof f === "object" && !Array.isArray(f) ? Object.keys(f).join(",") : Array.isArray(f) ? `fields[${f.length}]` : typeof f;
    console.log([t.code, t.isActive ? "on" : "OFF", t.fillMode, kind, t.name].join(" | "));
  }
  const docs = await db.journalDocument.groupBy({ by: ["templateId"], where: { organizationId: org }, _count: true });
  console.log("docs by tpl:", docs.length, "total", docs.reduce((a, b: any) => a + b._count, 0));
  const ojs = await (db as any).organizationJournal?.findMany?.({ where: { organizationId: org } }).catch(() => null);
  console.log("orgJournal rows:", ojs ? ojs.length : "n/a");
  await db.$disconnect();
})();
