import { openTelegramSession, SHOT, out } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const PROBE = `(function(){
  var vw = window.innerWidth;
  var over = [];
  document.querySelectorAll('body *').forEach(function(e){
    if(e.children.length) return;
    var b = e.getBoundingClientRect();
    if(b.width>0 && b.height>0 && b.right > vw+1.5){
      var p=e; var scrollable=false;
      while(p && p!==document.body){ var cs=getComputedStyle(p); if(/auto|scroll/.test(cs.overflowX)) {scrollable=true;break;} p=p.parentElement; }
      if(!scrollable) over.push((e.tagName)+':'+(e.textContent||'').trim().slice(0,40)+' r='+Math.round(b.right));
    }
  });
  var tabs = Array.from(document.querySelectorAll('[role="tab"],button')).map(function(e){return (e.textContent||'').trim()}).filter(function(t){return t.length>0 && t.length<40});
  var scrollers = [];
  document.querySelectorAll('div').forEach(function(e){ if(e.scrollWidth > e.clientWidth+8 && /auto|scroll/.test(getComputedStyle(e).overflowX)) scrollers.push({cls:(e.className||'').toString().slice(0,50), sw:e.scrollWidth, cw:e.clientWidth}); });
  return { docW: document.documentElement.scrollWidth, vw: vw, over: over.slice(0,10), tabs: tabs.slice(0,40), scrollers: scrollers.slice(0,5), text: document.body.innerText.slice(0,1500) };
})()`;
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const res: any = {};
  for (const code of Object.keys(ZZ)) {
    const id = ZZ[code][0].id;
    try {
      await s.page.goto(`${s.base}/journals/${code}/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(4500);
      const d: any = await s.page.evaluate(PROBE);
      res[code] = d;
      await s.page.screenshot({ path: SHOT + "/d-" + code + ".png", fullPage: true });
      console.log(code, "docW=" + d.docW, "over=" + d.over.length, "scrollers=" + d.scrollers.length, "| tabs:", d.tabs.slice(0, 12).join(" / ").slice(0, 160));
      if (d.over.length) console.log("   OVER:", d.over.join(" ; ").slice(0, 300));
    } catch (e) { res[code] = { err: String(e).slice(0, 200) }; console.log(code, "ERR", String(e).slice(0, 120)); }
  }
  out("docs.json", res);
  out("docs-errors.json", s.errors);
  console.log("pageerrors:", s.errors.length);
  await s.close();
})();
