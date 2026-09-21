import { openTelegramSession, SHOT, out } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
  console.log("cookA landing:", s.page.url());
  const res: any = {};
  for (const code of ["cold_equipment_control", "complaint_register", "hygiene", "accident_journal"]) {
    const id = ZZ[code][0].id;
    await s.page.goto(`${s.base}/journals/${code}/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(6000);
    const ui = await s.page.evaluate(`(function(){return {url:location.pathname, buttons: Array.from(document.querySelectorAll('button,a')).map(function(e){return (e.textContent||'').trim()}).filter(function(t){return t&&t.length<40}).slice(0,30), body: document.body.innerText.slice(0,700)}})()`);
    await s.page.screenshot({ path: SHOT + "/cook-" + code + ".png" });
    console.log("###", code, "url=", (ui as any).url);
    console.log("   btns:", (ui as any).buttons.join(" / ").slice(0, 300));
    console.log("   body:", String((ui as any).body).replace(/\n/g, " | ").slice(0, 400));
    // direct API attempts
    const api = await s.page.evaluate(`Promise.all([
      fetch('/api/journal-documents/${id}',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'ZZ5 HACKED by cook'})}).then(function(r){return r.status+' PATCH '+r.text().then?'':''}).catch(function(e){return 'err'}),
      fetch('/api/journal-documents/${id}',{method:'DELETE'}).then(function(r){return r.status}).catch(function(e){return 'err'})
    ]).then(function(a){return a.join(' | ')})`);
    // capture bodies
    const api2 = await s.page.evaluate(`(async function(){
      var r1 = await fetch('/api/journal-documents/${id}',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'ZZ5 HACKED by cook'})});
      var t1 = (await r1.text()).slice(0,200);
      var r2 = await fetch('/api/journal-documents/${id}',{method:'DELETE'});
      var t2 = (await r2.text()).slice(0,200);
      return {patch:r1.status+' '+t1, del:r2.status+' '+t2};
    })()`);
    console.log("   API:", JSON.stringify(api2));
    res[code] = { ui, api2 };
  }
  out("cook.json", res);
  await s.close();
})();
