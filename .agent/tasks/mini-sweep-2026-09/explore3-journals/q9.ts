import { db } from "./lib";
import fs from "node:fs";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore3-journals";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  for (const c of ["glass_control", "sanitary_day_control", "intensive_cooling"]) {
    const id = ZZ[c][0].id;
    const e = await db.journalDocumentEntry.findMany({ where: { documentId: id }, select: { date: true, data: true, employeeId: true }, orderBy: { date: "asc" } });
    const kinds: any = {}; for (const x of e) { const k = JSON.stringify(x.data); kinds[k] = (kinds[k] || 0) + 1; }
    console.log("###", c, "entries:", e.length, "first", e[0]?.date.toISOString().slice(0, 10), "last", e[e.length - 1]?.date.toISOString().slice(0, 10));
    console.log("   kinds:", JSON.stringify(kinds).slice(0, 400));
  }
  await db.$disconnect();
})();
