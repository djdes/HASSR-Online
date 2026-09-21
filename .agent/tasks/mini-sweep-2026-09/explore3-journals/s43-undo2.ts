import { openTelegramSession, SHOT, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const id = ZZ["cold_equipment_control"][0].id;
const today = "2026-09-21";
const state = async (p: any) => await p.evaluate(`Array.from(document.querySelectorAll('button')).map(function(e){return (e.getAttribute('aria-label')||'')+'|dis='+e.disabled}).filter(function(x){return /тменить последнее|овторить отм/i.test(x)}).join(' ; ')`);
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const read = async () => { const e = await db.journalDocumentEntry.findFirst({ where: { documentId: id, date: new Date(today + "T00:00:00.000Z") }, select: { data: true } }); return JSON.stringify((e?.data as any)?.temperatures); };
  await s.page.goto(`${s.base}/journals/cold_equipment_control/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(9000);
  console.log("db before:", await read(), "| btns:", await state(s.page));
  const inp = s.page.locator('input').nth(2);
  await inp.click(); await inp.fill(""); await inp.type("6", { delay: 60 });
  await s.page.locator('h1').first().click({ force: true }).catch(() => null);
  for (const w of [2000, 4000, 6000]) { await s.page.waitForTimeout(w); console.log(`  +${w}ms db:`, await read(), "| input:", JSON.stringify(await s.page.evaluate(`(document.querySelectorAll('input')[2]||{}).value`)), "| btns:", await state(s.page)); }
  const undo = s.page.locator('button[aria-label="Отменить последнее изменение"]').first();
  console.log("undo disabled?", await undo.isDisabled());
  if (!(await undo.isDisabled())) { await undo.click(); await s.page.waitForTimeout(5000); console.log("after undo db:", await read()); }
  await s.page.screenshot({ path: SHOT + "/undo2.png" });
  await s.close();
})();
