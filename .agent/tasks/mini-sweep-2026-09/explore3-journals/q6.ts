import { db } from "./lib";
import fs from "node:fs";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore3-journals";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  const id = ZZ["hygiene"][0].id;
  const doc = await db.journalDocument.findUnique({ where: { id }, select: { createdAt: true, dateFrom: true, dateTo: true, autoFill: true } });
  console.log("doc created", doc?.createdAt.toISOString(), "period", doc?.dateFrom.toISOString().slice(0,10), doc?.dateTo.toISOString().slice(0,10), "autoFill", doc?.autoFill);
  const e = await db.journalDocumentEntry.findMany({ where: { documentId: id }, select: { employeeId: true, date: true, data: true, createdAt: true, updatedAt: true }, orderBy: [{ date: "asc" }] });
  const byCreate: any = {}; const byUpdate: any = {};
  for (const x of e) { const k = x.createdAt.toISOString().slice(0, 19); byCreate[k] = (byCreate[k] || 0) + 1; const u = x.updatedAt.toISOString().slice(0, 19); byUpdate[u] = (byUpdate[u] || 0) + 1; }
  console.log("createdAt buckets:", byCreate);
  console.log("updatedAt buckets:", byUpdate);
  const dates = [...new Set(e.map(x => x.date.toISOString().slice(0, 10)))];
  console.log("dates:", dates.join(" "));
  const kinds: any = {}; for (const x of e) { const k = JSON.stringify(x.data); kinds[k] = (kinds[k] || 0) + 1; }
  console.log("data kinds:", kinds);
  const emps = [...new Set(e.map(x => x.employeeId))];
  const u = await db.user.findMany({ where: { id: { in: emps } }, select: { id: true, name: true, email: true } });
  console.log("employees:", u.map(x => x.name || x.email).join(", "));
  await db.$disconnect();
})();
