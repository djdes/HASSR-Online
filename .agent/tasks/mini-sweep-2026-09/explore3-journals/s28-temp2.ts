import { openTelegramSession, SHOT, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const id = ZZ["cold_equipment_control"][0].id;
const today = "2026-09-21";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const read = async () => { const e = await db.journalDocumentEntry.findFirst({ where: { documentId: id, date: new Date(today + "T00:00:00.000Z") }, select: { data: true } }); return JSON.stringify((e?.data as any)?.temperatures); };
  for (const val of ["5", "4,5", "44", "-999", "12345678"]) {
    await s.page.goto(`${s.base}/journals/cold_equipment_control/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(8000);
    const inp = s.page.locator('input').nth(2);
    await inp.click(); await inp.fill(""); await inp.type(val, { delay: 60 });
    await s.page.waitForTimeout(400);
    await s.page.locator('h1').first().click({ force: true }).catch(() => null);  // blur
    await s.page.waitForTimeout(3000);
    const ui = await s.page.evaluate(`(function(){return {val:(document.querySelectorAll('input')[2]||{}).value, toast: Array.from(document.querySelectorAll('[data-sonner-toast]')).map(function(e){return e.innerText.trim()}).join(' || '), err: Array.from(document.querySelectorAll('*')).filter(function(e){return !e.children.length && /Проверьте|допустим|норм/i.test(e.textContent||'')}).map(function(e){return e.textContent.trim().slice(0,80)}).slice(0,5)}})()`);
    await s.page.screenshot({ path: SHOT + "/t2-" + encodeURIComponent(val) + ".png" });
    console.log("###", JSON.stringify(val), "input=", JSON.stringify((ui as any).val), "toast=", JSON.stringify((ui as any).toast), "msgs=", JSON.stringify((ui as any).err));
    console.log("   db:", await read());
  }
  await s.close();
})();
