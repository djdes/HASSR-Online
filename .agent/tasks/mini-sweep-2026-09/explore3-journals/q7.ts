import { db } from "./lib";
import fs from "node:fs";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore3-journals";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  const id = ZZ["cold_equipment_control"][0].id;
  const e = await db.journalDocumentEntry.findMany({ where: { documentId: id }, select: { date: true, data: true, employeeId: true }, orderBy: { date: "asc" } });
  for (const x of e) console.log(x.date.toISOString().slice(0, 10), JSON.stringify(x.data).slice(0, 260));
  await db.$disconnect();
})();
