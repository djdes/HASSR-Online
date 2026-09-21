import { openTelegramSession, SHOT, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  for (const [code, label] of [["accident_journal", "закрытый"], ["complaint_register", "активный"], ["cold_equipment_control", "активный"]] as any) {
    const id = ZZ[code][0].id;
    await s.page.goto(`${s.base}/journals/${code}/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(6000);
    await s.page.locator('button[aria-label="Ещё действия"]').first().click().catch((e) => console.log("no dots", code));
    await s.page.waitForTimeout(2200);
    const m = await s.page.evaluate(`(function(){var ms=document.querySelectorAll('[role="menu"],[role="dialog"]'); return Array.from(ms).map(function(x){return x.innerText.slice(0,400)}).join(' ~~ ')})()`);
    console.log("###", code, `(${label}) MENU:`, String(m).replace(/\n/g, " | "));
    await s.page.screenshot({ path: SHOT + "/menu-" + code + ".png" });
    await s.page.keyboard.press("Escape");
    await s.page.waitForTimeout(1200);
    // settings dialog
    const st = s.page.locator('button:has-text("Настройки журнала")').first();
    if (await st.count()) {
      await st.click().catch(() => null);
      await s.page.waitForTimeout(2500);
      const d = await s.page.evaluate(`(function(){var x=document.querySelector('[role="dialog"]'); if(!x) return 'no dialog: '+location.pathname; var b=x.getBoundingClientRect(); return JSON.stringify({y:Math.round(b.y),bot:Math.round(b.bottom),sh:x.scrollHeight,ch:x.clientHeight})+' :: '+x.innerText.slice(0,600)})()`);
      console.log("   SETTINGS:", String(d).replace(/\n/g, " | "));
      await s.page.screenshot({ path: SHOT + "/set-" + code + ".png" });
    }
  }
  await s.close();
})();
