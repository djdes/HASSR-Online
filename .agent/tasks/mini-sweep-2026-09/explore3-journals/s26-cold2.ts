import { openTelegramSession, SHOT, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const id = ZZ["cold_equipment_control"][0].id;
  for (let i = 0; i < 2; i++) {
    await s.page.goto(`${s.base}/journals/cold_equipment_control/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(9000);
    const vals = await s.page.evaluate(`(function(){ return Array.from(document.querySelectorAll('input')).map(function(e){return (e.getAttribute('placeholder')||'')+'='+JSON.stringify(e.value)}).slice(0,12); })()`);
    console.log("run", i, "today inputs:", JSON.stringify(vals));
    await s.page.screenshot({ path: SHOT + `/cold2-today-${i}.png` });
  }
  // По оборудованию
  await s.page.locator('button:has-text("По оборудованию")').first().click();
  await s.page.waitForTimeout(3500);
  await s.page.screenshot({ path: SHOT + "/cold2-byequip.png", fullPage: true });
  console.log("BYEQUIP:", (await s.page.evaluate(`document.body.innerText.slice(0,1200)`) as string).replace(/\n/g, " | "));
  await s.page.locator('button:has-text("Таблица")').first().click();
  await s.page.waitForTimeout(3500);
  await s.page.screenshot({ path: SHOT + "/cold2-table.png", fullPage: true });
  console.log("TABLE:", (await s.page.evaluate(`(function(){var t=document.querySelectorAll('table'); return t.length+' tables: '+Array.from(t).map(function(x){return x.innerText.slice(0,600)}).join(' ~~ ')})()`) as string).replace(/\n/g, " | ").slice(0, 1600));
  await s.close();
})();
