import { openTelegramSession, SHOT, out } from "./lib";
import { CODES } from "./codes";
const PROBE = `(function(){
  var d = document.querySelector('[role="dialog"]');
  if(!d) return {none:true, body: document.body.innerText.slice(0,300)};
  var b = d.getBoundingClientRect();
  var fields = [];
  d.querySelectorAll('input,select,textarea,button[role="combobox"]').forEach(function(e){
    var r = e.getBoundingClientRect();
    var lab = '';
    var id = e.getAttribute('id');
    if(id){ var l=d.querySelector('label[for="'+CSS.escape(id)+'"]'); if(l) lab=l.textContent.trim(); }
    if(!lab){ var p=e.closest('div'); if(p){ var l2=p.querySelector('label'); if(l2) lab=l2.textContent.trim(); } }
    fields.push({tag:e.tagName, type:e.getAttribute('type')||'', name:e.getAttribute('name')||'', label:lab.slice(0,50), value:(e.value!==undefined?String(e.value):'').slice(0,60), req:e.required===true||e.getAttribute('aria-required')==='true', y:Math.round(r.y), h:Math.round(r.height)});
  });
  var btns=[]; d.querySelectorAll('button').forEach(function(e){var r=e.getBoundingClientRect(); btns.push({t:(e.textContent||'').trim().slice(0,30), y:Math.round(r.y), bottom:Math.round(r.bottom), x:Math.round(r.x), right:Math.round(r.right)});});
  return {none:false, rect:{x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),bottom:Math.round(b.bottom)},
    vh: window.innerHeight, vw: window.innerWidth,
    scrollH: d.scrollHeight, clientH: d.clientHeight,
    text: d.innerText.slice(0,1200), fields: fields, btns: btns};
})()`;
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const res: any = {};
  for (const code of CODES) {
    try {
      await s.page.goto(s.base + "/journals/" + code, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(2500);
      const btn = s.page.locator('button:has-text("Создать документ"), a:has-text("Создать документ")').first();
      await btn.click({ timeout: 15000 });
      await s.page.waitForTimeout(2000);
      const d = await s.page.evaluate(PROBE);
      res[code] = d;
      await s.page.screenshot({ path: SHOT + "/dlg-" + code + ".png" });
      console.log(code, (d as any).none ? "NO DIALOG" : `rect=${JSON.stringify((d as any).rect)} vh=${(d as any).vh} fields=${(d as any).fields.length}`);
    } catch (e) { res[code] = { err: String(e).slice(0, 200) }; console.log(code, "ERR", String(e).slice(0, 120)); }
  }
  out("create-dialogs.json", res);
  out("create-dialogs-errors.json", s.errors);
  await s.close();
})();
