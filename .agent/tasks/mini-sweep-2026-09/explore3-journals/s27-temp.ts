import { openTelegramSession, SHOT, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const id = ZZ["cold_equipment_control"][0].id;
const today = "2026-09-21";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const read = async () => { const e = await db.journalDocumentEntry.findFirst({ where: { documentId: id, date: new Date(today + "T00:00:00.000Z") }, select: { data: true } }); return JSON.stringify(e?.data); };
  for (const val of ["4,5", "44", "-999", "12345678", "abc", "1e3"]) {
    await s.page.goto(`${s.base}/journals/cold_equipment_control/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(8000);
    // second temp input on "Сегодня" = Холодильник QR E2E (norm 2..6)
    const inp = s.page.locator('input').nth(2);
    await inp.click();
    await inp.fill("");
    await inp.type(val, { delay: 60 });
    await s.page.waitForTimeout(400);
    await s.page.keyboard.press("Enter");
    await s.page.waitForTimeout(2500);
    const ui = await s.page.evaluate(`(function(){return {val: (document.querySelectorAll('input')[2]||{}).value, toast: Array.from(document.querySelectorAll('[data-sonner-toast]')).map(function(e){return e.innerText.trim()}).join(' || '), body: document.body.innerText.slice(0,500)}})()`);
    await s.page.screenshot({ path: SHOT + "/temp-" + encodeURIComponent(val) + ".png" });
    console.log("###", JSON.stringify(val), "-> input=", JSON.stringify((ui as any).val), "toast=", JSON.stringify((ui as any).toast));
    console.log("   db:", (await read())?.slice(0, 220));
    console.log("   banner:", String((ui as any).body).replace(/\n/g, " | ").slice(0, 300));
  }
  await s.close();
})();
