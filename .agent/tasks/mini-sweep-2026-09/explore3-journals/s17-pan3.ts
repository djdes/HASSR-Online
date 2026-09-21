import { openTelegramSession, SHOT, out } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const LIST = ["cleaning_ventilation_checklist", "finished_product", "general_cleaning", "incoming_control", "incoming_raw_materials_control", "med_books", "perishable_rejection", "uv_lamp_runtime", "audit_report"];
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const cdp = await s.ctx.newCDPSession(s.page);
  const res: any = {};
  for (const code of LIST) {
    const id = ZZ[code][0].id;
    try {
      await s.page.goto(`${s.base}/journals/${code}/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(5000);
      const t = s.page.locator('button:has-text("Таблица")').first();
      if (await t.count()) { await t.click().catch(() => null); }
      await s.page.waitForTimeout(6000);
      const f: any = await s.page.evaluate(`(function(){
        var all=[]; document.querySelectorAll('div,section,main,table').forEach(function(e){
          if(e.scrollWidth<=e.clientWidth+8) return; var cs=getComputedStyle(e); var b=e.getBoundingClientRect();
          all.push({tag:e.tag,cls:(e.className||'').toString().slice(0,45),sw:e.scrollWidth,cw:e.clientWidth,ox:cs.overflowX,y:Math.round(b.y+window.scrollY),h:Math.round(b.height)});
        });
        var tbl=document.querySelector('table');
        var tb = tbl? tbl.getBoundingClientRect(): null;
        return { over: all.slice(0,8), bodyOver: document.body.scrollWidth-document.body.clientWidth, docH: document.documentElement.scrollHeight,
          tbl: tb? {w:Math.round(tb.width), x:Math.round(tb.x), y:Math.round(tb.y+window.scrollY)}:null, txt: document.body.innerText.slice(0,200) };
      })()`);
      res[code] = f;
      console.log("###", code, "bodyOver=" + f.bodyOver, "tbl=" + JSON.stringify(f.tbl));
      console.log("   over:", JSON.stringify(f.over).slice(0, 700));
      if (f.tbl) {
        await s.page.evaluate(`window.scrollTo(0, ${Math.max(0, f.tbl.y - 150)})`);
        await s.page.waitForTimeout(800);
        const y = 350;
        const pre = await s.page.evaluate(`(function(){var best=null;document.querySelectorAll('div').forEach(function(e){if(e.scrollWidth>e.clientWidth+8&&/auto|scroll/.test(getComputedStyle(e).overflowX)){if(!best||e.scrollWidth>best.scrollWidth)best=e;}});window.__p=best;return best?{sw:best.scrollWidth,cw:best.clientWidth,sl:best.scrollLeft}:null})()`);
        for (let i = 0; i < 2; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 320, y }] }); for (let x = 310; x >= 40; x -= 20) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await s.page.waitForTimeout(600); }
        const post = await s.page.evaluate(`(function(){var e=window.__p;return e?{sl:Math.round(e.scrollLeft),max:e.scrollWidth-e.clientWidth}:null})()`);
        console.log("   pan:", JSON.stringify(pre), "->", JSON.stringify(post));
        res[code].pan = { pre, post };
      }
      await s.page.screenshot({ path: SHOT + "/pan3-" + code + ".png" });
    } catch (e) { console.log(code, "ERR", String(e).slice(0, 140)); }
  }
  out("pan3.json", res);
  await s.close();
})();
