import { openTelegramSession, SHOT, out } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const res: any = {};
  for (const code of Object.keys(ZZ)) {
    const id = ZZ[code][0].id;
    const r: any = {};
    try {
      // card text in list
      await s.page.goto(`${s.base}/journals/${code}`, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(3500);
      r.card = await s.page.evaluate(`(function(){
        var els = Array.from(document.querySelectorAll('*')).filter(function(e){return e.children.length && (e.innerText||'').indexOf('ZZ5 ')===0;});
        var best = els.length? els[els.length-1] : null;
        var n = best; var hops=0; while(n && n.innerText.length < 60 && hops<6){ n = n.parentElement; hops++; }
        return n ? n.innerText.slice(0,400) : 'not found';
      })()`);
      // doc -> table view
      await s.page.goto(`${s.base}/journals/${code}/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(4000);
      const tab = s.page.locator('button:has-text("Таблица")').first();
      if (await tab.count()) {
        await tab.click({ timeout: 15000 }).catch(() => null);
        await s.page.waitForTimeout(2500);
        r.hasTable = true;
      } else r.hasTable = false;
      r.probe = await s.page.evaluate(`(function(){
        var vw=window.innerWidth;
        var sc=[]; document.querySelectorAll('*').forEach(function(e){ if(e.scrollWidth>e.clientWidth+8 && /auto|scroll/.test(getComputedStyle(e).overflowX)) sc.push({tag:e.tagName,cls:(e.className||'').toString().slice(0,40),sw:e.scrollWidth,cw:e.clientWidth}); });
        var over=[]; document.querySelectorAll('body *').forEach(function(e){ if(e.children.length) return; var b=e.getBoundingClientRect(); if(b.width>0&&b.right>vw+1.5){ var p=e,ok=false; while(p&&p!==document.body){ if(/auto|scroll/.test(getComputedStyle(p).overflowX)){ok=true;break;} p=p.parentElement;} if(!ok) over.push(e.tagName+':'+(e.textContent||'').trim().slice(0,35)+' r='+Math.round(b.right)); } });
        var tbl = document.querySelector('table');
        return { docW: document.documentElement.scrollWidth, scrollers: sc.slice(0,4), over: over.slice(0,8), hasTableEl: !!tbl, tblW: tbl? tbl.scrollWidth:0, text: document.body.innerText.slice(0,900) };
      })()`);
      await s.page.screenshot({ path: SHOT + "/t-" + code + ".png", fullPage: false });
      console.log(code, "table=" + r.hasTable, "tblW=" + r.probe.tblW, "scrollers=" + JSON.stringify(r.probe.scrollers).slice(0, 120), "over=" + r.probe.over.length, r.probe.over.join(";").slice(0, 150));
      console.log("   CARD:", String(r.card).replace(/\n/g, " | ").slice(0, 220));
    } catch (e) { r.err = String(e).slice(0, 200); console.log(code, "ERR", r.err.slice(0, 120)); }
    res[code] = r;
  }
  out("tables.json", res);
  await s.close();
})();
