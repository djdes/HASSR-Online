import { openTelegramSession, SHOT, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const id = ZZ["cold_equipment_control"][0].id;
const today = "2026-09-21";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const read = async () => { const e = await db.journalDocumentEntry.findFirst({ where: { documentId: id, date: new Date(today + "T00:00:00.000Z") }, select: { data: true } }); return JSON.stringify((e?.data as any)?.temperatures); };
  await s.page.goto(`${s.base}/journals/cold_equipment_control/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(8000);
  console.log("db before:", await read());
  const inp = s.page.locator('input').nth(2);
  await inp.click(); await inp.fill(""); await inp.type("2", { delay: 60 });
  await s.page.locator('h1').first().click({ force: true }).catch(() => null);
  await s.page.waitForTimeout(3000);
  console.log("db after edit:", await read());
  const undoBtns = await s.page.evaluate(`Array.from(document.querySelectorAll('button')).map(function(e,i){return i+':'+(e.getAttribute('aria-label')||'')+'|dis='+e.disabled}).filter(function(x){return /тмен|овтор|ndo|edo/i.test(x)}).join(' ; ')`);
  console.log("undo/redo buttons:", undoBtns);
  const undo = s.page.locator('button[aria-label*="тменить"], button[aria-label*="Отмена"]').first();
  if (await undo.count()) {
    await undo.click();
    await s.page.waitForTimeout(3500);
    console.log("db after UNDO:", await read());
    const ui = await s.page.evaluate(`(document.querySelectorAll('input')[2]||{}).value`);
    console.log("input after undo:", JSON.stringify(ui));
    const redo = s.page.locator('button[aria-label*="овтор"]').first();
    if (await redo.count()) { await redo.click(); await s.page.waitForTimeout(3500); console.log("db after REDO:", await read()); }
  } else console.log("no undo button found");
  await s.page.screenshot({ path: SHOT + "/undo.png" });
  await s.close();
})();
