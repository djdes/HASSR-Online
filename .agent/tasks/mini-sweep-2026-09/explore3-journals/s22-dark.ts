import { openTelegramSession, SHOT, out } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const CONTRAST = `(function(){
  function toRGB(c){var m=c.match(/rgba?\(([^)]+)\)/); if(!m) return null; var p=m[1].split(',').map(parseFloat); if(p.length>3&&p[3]<0.1) return null; return p;}
  function lum(p){var a=p.slice(0,3).map(function(v){v/=255;return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);}); return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2];}
  function bgOf(e){ var n=e; while(n&&n!==document.documentElement){ var c=getComputedStyle(n).backgroundColor; var p=toRGB(c); if(p) return p; n=n.parentElement;} return [255,255,255]; }
  var bad=[];
  document.querySelectorAll('body *').forEach(function(e){
    if(e.children.length) return; var t=(e.textContent||'').trim(); if(!t) return;
    var b=e.getBoundingClientRect(); if(b.width<4||b.height<4) return;
    var cs=getComputedStyle(e); var fg=toRGB(cs.color); if(!fg) return; var bg=bgOf(e);
    var l1=lum(fg), l2=lum(bg); var r=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
    if(r<2.2) bad.push({t:t.slice(0,40), fg:cs.color, bg:'rgb('+bg.slice(0,3).join(',')+')', r:Math.round(r*100)/100});
  });
  // white-ish panels on dark
  var whitePanels=[];
  document.querySelectorAll('div,section,table,td,th,li').forEach(function(e){
    var p=toRGB(getComputedStyle(e).backgroundColor); if(!p) return;
    if(p[0]>245&&p[1]>245&&p[2]>245){ var b=e.getBoundingClientRect(); if(b.width>80&&b.height>24) whitePanels.push({cls:(e.className||'').toString().slice(0,40), w:Math.round(b.width),h:Math.round(b.height), t:(e.innerText||'').trim().slice(0,40)}); }
  });
  return { bad: bad.slice(0,12), whitePanels: whitePanels.slice(0,8) };
})()`;
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "dark" });
  const res: any = {};
  for (const code of Object.keys(ZZ)) {
    const id = ZZ[code][0].id;
    try {
      await s.page.goto(`${s.base}/journals/${code}/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(4500);
      const r: any = await s.page.evaluate(CONTRAST);
      res[code] = r;
      await s.page.screenshot({ path: SHOT + "/dark-" + code + ".png" });
      console.log(code, "lowContrast=" + r.bad.length, "whitePanels=" + r.whitePanels.length);
      if (r.bad.length) console.log("   ", JSON.stringify(r.bad).slice(0, 400));
      if (r.whitePanels.length) console.log("   WP:", JSON.stringify(r.whitePanels).slice(0, 350));
    } catch (e) { console.log(code, "ERR", String(e).slice(0, 120)); }
  }
  out("dark.json", res);
  await s.close();
})();
