import { openTelegramSession, SHOT, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const id = ZZ["glass_control"][0].id;
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  await s.page.goto(`${s.base}/journals/glass_control/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(6500);
  console.log("CARDS:", (await s.page.evaluate(`document.body.innerText.slice(0,1200)`) as string).replace(/\n/g, " | "));
  await s.page.locator('button:has-text("Таблица")').first().click();
  await s.page.waitForTimeout(4000);
  const tbl = await s.page.evaluate(`(function(){var ts=document.querySelectorAll('table'); var t=ts[ts.length-1]; if(!t) return 'none'; return t.innerText.slice(0,1200)})()`);
  console.log("TABLE:", String(tbl).replace(/\n/g, " | ").slice(0, 1200));
  const e = await db.journalDocumentEntry.count({ where: { documentId: id } });
  const d = await db.journalDocument.findUnique({ where: { id }, select: { config: true } });
  console.log("entries:", e, "config:", JSON.stringify(d?.config).slice(0, 400));
  await s.close();
})();
