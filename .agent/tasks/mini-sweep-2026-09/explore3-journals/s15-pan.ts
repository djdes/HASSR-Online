import { openTelegramSession, SHOT, out } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const CODES = ["cleaning_ventilation_checklist", "med_books", "perishable_rejection", "uv_lamp_runtime", "staff_training", "hygiene", "equipment_cleaning", "accident_journal"];
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const cdp = await s.ctx.newCDPSession(s.page);
  const res: any = {};
  for (const code of CODES) {
    const id = ZZ[code][0].id;
    try {
      await s.page.goto(`${s.base}/journals/${code}/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(4500);
      const t = s.page.locator('button:has-text("Таблица")').first();
      if (await t.count()) { await t.click().catch(() => null); await s.page.waitForTimeout(2500); }
      await s.page.evaluate(`window.scrollTo(0, 400)`);
      await s.page.waitForTimeout(600);
      const before = await s.page.evaluate(`(function(){
        var out=[]; document.querySelectorAll('*').forEach(function(e){ if(e.scrollWidth>e.clientWidth+8) out.push({tag:e.tagName, cls:(e.className||'').toString().slice(0,40), sl:e.scrollLeft, sw:e.scrollWidth, cw:e.clientWidth, ox:getComputedStyle(e).overflowX}); });
        window.__cands = out; return out.slice(0,6);
      })()`);
      // real touch pan right-to-left in the middle of the screen
      for (let i = 0; i < 2; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 300, y: 420 }] });
        for (let x = 290; x >= 60; x -= 25) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: 420 }] }); }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await s.page.waitForTimeout(700);
      }
      const after = await s.page.evaluate(`(function(){
        var out=[]; document.querySelectorAll('*').forEach(function(e){ if(e.scrollWidth>e.clientWidth+8) out.push({tag:e.tagName, cls:(e.className||'').toString().slice(0,40), sl:e.scrollLeft, sw:e.scrollWidth, cw:e.clientWidth, ox:getComputedStyle(e).overflowX}); });
        return out.slice(0,6);
      })()`);
      res[code] = { before, after };
      await s.page.screenshot({ path: SHOT + "/pan-" + code + ".png" });
      console.log("###", code);
      console.log("  before:", JSON.stringify(before));
      console.log("  after :", JSON.stringify(after));
    } catch (e) { console.log(code, "ERR", String(e).slice(0, 150)); }
  }
  out("pan.json", res);
  await s.close();
})();
