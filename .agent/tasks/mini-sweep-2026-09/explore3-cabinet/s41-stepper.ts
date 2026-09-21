import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
(async () => {
const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
const p = s.page;
async function release() { const my:any = await p.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`); if(my?.claim?.id) await p.evaluate(`fetch('/api/journal-task-claims/${my.claim.id}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'release'})}).then(r=>r.status)`); }
await go(p, s.base + "/mini/today", 3000);
await release();
const api:any = await p.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`);
const g=api.groups.find((x:any)=>x.code==="cold_equipment_control");
for (const label of ["Холодильник QR E2E — Вечер","Морозилка QR E2E — Вечер"]) {
  await release();
  const sc=g.scopes.find((y:any)=>y.scopeLabel===label);
  const body=JSON.stringify({journalCode:"cold_equipment_control",scopeKey:sc.scopeKey,scopeLabel:sc.scopeLabel,dateKey:api.dateKey});
  const r:any=await p.evaluate(`fetch('/api/journal-task-claims',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(async r=>({s:r.status,j:await r.text()}))`);
  const cid = JSON.parse(r.j).claim?.id;
  await go(p, s.base + "/mini/claim/" + cid, 3000);
  await p.waitForFunction(`/Температура/.test(document.body.innerText)`, { timeout: 120000 });
  await p.waitForTimeout(1800);
  const norm = await p.evaluate(`(()=>{const d=[...document.querySelectorAll('div')].find(x=>/норма/.test(x.innerText)&&x.children.length===0);return d?d.innerText:null})()`);
  await p.evaluate(`[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Увеличить').click()`);
  await p.waitForTimeout(500);
  const plus = await p.evaluate(`document.querySelector('input[placeholder="напр. 4"]').value`);
  // очистить и минус
  await p.fill('input[placeholder="напр. 4"]', "");
  await p.waitForTimeout(300);
  await p.evaluate(`[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Уменьшить').click()`);
  await p.waitForTimeout(500);
  const minus = await p.evaluate(`document.querySelector('input[placeholder="напр. 4"]').value`);
  console.log(label, "| norm:", norm, "| после «+» из пустого:", plus, "| после «−» из пустого:", minus);
}
await release();
console.log("ERRORS", JSON.stringify(s.errors).slice(0,300));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
