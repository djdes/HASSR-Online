import { openTelegramSession, SHOT, out } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const CHECK = `(function(){
  var nav=document.querySelector('nav'); if(!nav) return {noNav:true};
  var nb=nav.getBoundingClientRect();
  var hidden=[];
  document.querySelectorAll('button,a,input,select,textarea').forEach(function(e){
    var b=e.getBoundingClientRect();
    if(b.width<8||b.height<8) return;
    if(b.top < nb.bottom && b.bottom > nb.top && b.left < nb.right && b.right > nb.left){
      // overlapping nav area
      var cx=(Math.max(b.left,nb.left)+Math.min(b.right,nb.right))/2, cy=(Math.max(b.top,nb.top)+Math.min(b.bottom,nb.bottom))/2;
      var top=document.elementFromPoint(cx,cy);
      if(top && !e.contains(top) && !nav.contains(e) && nav.contains(top)) hidden.push((e.textContent||e.getAttribute('aria-label')||e.tagName).trim().slice(0,35)+' @'+Math.round(b.top)+'-'+Math.round(b.bottom));
    }
  });
  return {navTop: Math.round(nb.top), navBot: Math.round(nb.bottom), vh: innerHeight, hidden: hidden.slice(0,8)};
})()`;
(async () => {
  for (const wh of [[360, 640], [390, 844]] as any) {
    const s = await openTelegramSession({ role: "ownerA", width: wh[0], height: wh[1] });
    console.log("=== viewport", wh.join("x"));
    for (const code of Object.keys(ZZ)) {
      await s.page.goto(`${s.base}/journals/${code}`, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(3500);
      const r: any = await s.page.evaluate(CHECK);
      if (r.hidden && r.hidden.length) console.log("  ", code, "LIST hidden under nav:", r.hidden.join(" ; "));
      const id = ZZ[code][0].id;
      await s.page.goto(`${s.base}/journals/${code}/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(4500);
      const r2: any = await s.page.evaluate(CHECK);
      if (r2.hidden && r2.hidden.length) console.log("  ", code, "DOC hidden under nav:", r2.hidden.join(" ; "));
      if (wh[0] === 390 && ["hygiene", "cold_equipment_control", "cleaning_ventilation_checklist", "pest_control", "med_books", "glass_control"].includes(code)) await s.page.screenshot({ path: SHOT + "/w390-" + code + ".png" });
    }
    await s.close();
  }
})();
