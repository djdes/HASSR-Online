import { openTelegramSession, SHOT, out } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const FIND = `(function(){
  var best=null;
  document.querySelectorAll('div,section,main').forEach(function(e){
    if(e.scrollWidth <= e.clientWidth+8) return;
    var cs=getComputedStyle(e); if(!/auto|scroll/.test(cs.overflowX)) return;
    var b=e.getBoundingClientRect(); if(b.height<40||b.width<100) return;
    if(!best || e.scrollWidth>best.sw){ best={sw:e.scrollWidth,cw:e.clientWidth,x:Math.round(b.x),y:Math.round(b.y),h:Math.round(b.height),cls:(e.className||'').toString().slice(0,50)}; window.__panEl=e; }
  });
  var bodyOver = document.body.scrollWidth - document.body.clientWidth;
  return { best: best, bodyOver: bodyOver, bodyOx: getComputedStyle(document.body).overflowX };
})()`;
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const cdp = await s.ctx.newCDPSession(s.page);
  const res: any = {};
  for (const code of Object.keys(ZZ)) {
    const id = ZZ[code][0].id;
    try {
      await s.page.goto(`${s.base}/journals/${code}/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(4200);
      const t = s.page.locator('button:has-text("Таблица")').first();
      if (await t.count()) { await t.click().catch(() => null); await s.page.waitForTimeout(2500); }
      const f: any = await s.page.evaluate(FIND);
      let after: any = null;
      if (f.best) {
        const y = Math.max(120, Math.min(560, f.best.y + Math.min(f.best.h, 200) / 2));
        for (let i = 0; i < 2; i++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 310, y }] });
          for (let x = 300; x >= 50; x -= 20) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await s.page.waitForTimeout(600);
        }
        after = await s.page.evaluate(`(function(){ var e=window.__panEl; return e? {sl:Math.round(e.scrollLeft), max: e.scrollWidth-e.clientWidth} : null; })()`);
      }
      res[code] = { find: f, after };
      console.log(code, "bodyOver=" + f.bodyOver, f.bodyOx, "| scroller=" + (f.best ? `${f.best.sw}/${f.best.cw}@y${f.best.y}` : "NONE"), "| panned=" + JSON.stringify(after));
      if (!f.best || (after && after.sl === 0)) await s.page.screenshot({ path: SHOT + "/pan2-" + code + ".png" });
    } catch (e) { console.log(code, "ERR", String(e).slice(0, 140)); }
  }
  out("pan2.json", res);
  await s.close();
})();
