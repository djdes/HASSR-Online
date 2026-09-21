import { openTelegramSession, SHOT, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const id = ZZ["accident_journal"][0].id;
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  await s.page.goto(`${s.base}/journals/accident_journal/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(6000);
  await s.page.locator('button[aria-label="Ещё действия"]').first().click();
  await s.page.waitForTimeout(2500);
  await s.page.screenshot({ path: SHOT + "/close-menu2.png" });
  const menu = await s.page.evaluate(`(function(){var ms=document.querySelectorAll('[role="menu"],[role="dialog"]'); return Array.from(ms).map(function(m){return m.innerText.slice(0,600)}).join(' ~~ ')})()`);
  console.log("MENU:", String(menu).replace(/\n/g, " | "));
  // try "Закончить"/"Закрыть"
  for (const label of ["Закончить", "Закрыть журнал", "Завершить", "Закрыть документ"]) {
    const b = s.page.locator(`[role="menu"] :text("${label}"), [role="dialog"] :text("${label}")`).first();
    if (await b.count()) { console.log("found:", label); await b.click(); await s.page.waitForTimeout(2500); break; }
  }
  await s.page.screenshot({ path: SHOT + "/close-confirm.png" });
  const conf = await s.page.evaluate(`(function(){var ms=document.querySelectorAll('[role="alertdialog"],[role="dialog"]'); return Array.from(ms).map(function(m){return m.innerText.slice(0,500)}).join(' ~~ ')})()`);
  console.log("CONFIRM:", String(conf).replace(/\n/g, " | "));
  await s.close();
})();
