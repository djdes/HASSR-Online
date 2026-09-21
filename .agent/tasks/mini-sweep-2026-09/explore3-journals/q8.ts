import { db } from "./lib";
import fs from "node:fs";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore3-journals";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  for (const c of ["training_plan", "audit_plan", "equipment_calibration", "glass_control", "sanitary_day_control", "intensive_cooling"]) {
    const d = await db.journalDocument.findUnique({ where: { id: ZZ[c][0].id }, select: { dateFrom: true, dateTo: true, config: true } });
    console.log("###", c, d?.dateFrom.toISOString().slice(0, 10), "..", d?.dateTo.toISOString().slice(0, 10));
    console.log("   cfg:", JSON.stringify(d?.config).slice(0, 320));
  }
  await db.$disconnect();
})();
