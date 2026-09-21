import { db } from "./lib";
import fs from "node:fs";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore3-journals";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  for (const code of ["hygiene", "health_check"]) {
    const id = ZZ[code][0].id;
    const e = await db.journalDocumentEntry.findMany({ where: { documentId: id }, select: { employeeId: true, date: true, data: true, createdAt: true } });
    console.log(code, "entries:", e.length);
    for (const x of e.slice(0, 6)) console.log("   ", x.date.toISOString(), JSON.stringify(x.data).slice(0, 200), "created", x.createdAt.toISOString());
    const doc = await db.journalDocument.findUnique({ where: { id }, select: { autoFill: true, config: true } });
    console.log("   autoFill:", doc?.autoFill, "config:", JSON.stringify(doc?.config).slice(0, 200));
  }
  await db.$disconnect();
})();
