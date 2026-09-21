import { openTelegramSession, SHOT, out, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const id = ZZ["cold_equipment_control"][0].id;
  await s.page.goto(`${s.base}/journals/cold_equipment_control/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(6000);
  await s.page.screenshot({ path: SHOT + "/cold-today.png", fullPage: true });
  console.log("BODY:", (await s.page.evaluate(`document.body.innerText.slice(0,1500)`) as string).replace(/\n/g, " | "));
  const doc = await db.journalDocument.findUnique({ where: { id }, select: { config: true } });
  console.log("CONFIG:", JSON.stringify(doc?.config).slice(0, 1200));
  const e = await db.journalDocumentEntry.count({ where: { documentId: id } });
  console.log("entries:", e);
  await s.close();
})();
