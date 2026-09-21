import { openTelegramSession, SHOT, out } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const PROBE = `(function(){
  var d=document.querySelector('[role="dialog"]'); if(!d) return {none:true};
  var b=d.getBoundingClientRect();
  var f=[]; d.querySelectorAll('input,select,textarea,[role="combobox"],[contenteditable=true]').forEach(function(e){
    var r=e.getBoundingClientRect(); var lab='';
    var id=e.getAttribute('id'); if(id){var l=d.querySelector('label[for="'+CSS.escape(id)+'"]'); if(l)lab=l.textContent.trim();}
    if(!lab){var p=e.parentElement; for(var i=0;i<3&&p;i++){var l2=p.querySelector('label'); if(l2){lab=l2.textContent.trim();break;} p=p.parentElement;}}
    f.push({tag:e.tagName,type:e.getAttribute('type')||'',ph:e.getAttribute('placeholder')||'',label:lab.slice(0,60),val:String(e.value||'').slice(0,40),req:e.required===true,y:Math.round(r.y),bot:Math.round(r.bottom)});
  });
  return {none:false,rect:{y:Math.round(b.y),bot:Math.round(b.bottom),h:Math.round(b.height)},vh:innerHeight,sh:d.scrollHeight,ch:d.clientHeight,
    text:d.innerText.slice(0,1200), fields:f.slice(0,25),
    btns: Array.from(d.querySelectorAll('button')).map(function(e){var r=e.getBoundingClientRect();return (e.textContent||'').trim().slice(0,25)+'@'+Math.round(r.y)+'-'+Math.round(r.bottom)}).slice(0,12)};
})()`;
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const res: any = {};
  for (const code of Object.keys(ZZ)) {
    const id = ZZ[code][0].id;
    try {
      await s.page.goto(`${s.base}/journals/${code}/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(5000);
      const cands = ["Добавить запись", "Добавить строку", "Добавить поставку", "Добавить сотрудника", "Добавить"];
      let clicked = "";
      for (const c of cands) {
        const b = s.page.locator(`button:has-text("${c}")`).first();
        if (await b.count()) { try { await b.click({ timeout: 10000 }); clicked = c; break; } catch {} }
      }
      await s.page.waitForTimeout(2500);
      const d: any = await s.page.evaluate(PROBE);
      res[code] = { clicked, d };
      await s.page.screenshot({ path: SHOT + "/add-" + code + ".png" });
      console.log("###", code, "btn=" + clicked, d.none ? "NO DIALOG (inline?)" : `rect ${d.rect.y}..${d.rect.bot} vh=${d.vh} sh=${d.sh}/${d.ch} fields=${d.fields.length}`);
      if (!d.none) { console.log("   text:", d.text.replace(/\n/g, " | ").slice(0, 400)); console.log("   fields:", d.fields.map((x: any) => `${x.label || x.ph || "(no label)"}[${x.tag}${x.type ? "/" + x.type : ""}]${x.req ? "*" : ""}`).join(", ").slice(0, 500)); console.log("   btns:", d.btns.join(", ").slice(0, 250)); }
      else console.log("   body:", (await s.page.evaluate(`document.body.innerText.slice(0,300)`) as string).replace(/\n/g, " | "));
    } catch (e) { console.log(code, "ERR", String(e).slice(0, 140)); }
  }
  out("adddlg.json", res);
  await s.close();
})();
