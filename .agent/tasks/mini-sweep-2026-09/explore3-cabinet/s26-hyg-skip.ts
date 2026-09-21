import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
(async () => {
const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
const p = s.page;
async function release() { const my:any = await p.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`); if(!my?.claim?.id) return; await p.evaluate(`fetch('/api/journal-task-claims/${my.claim.id}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'release'})}).then(r=>r.status)`); }
async function claim(code: string) { const api:any = await p.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`); const g=api.groups.find((x:any)=>x.code===code); const sc=g.scopes.find((y:any)=>y.availability==="available"); const body=JSON.stringify({journalCode:code,scopeKey:sc.scopeKey,scopeLabel:sc.scopeLabel,dateKey:api.dateKey}); const r:any=await p.evaluate(`fetch('/api/journal-task-claims',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(async r=>({s:r.status,j:await r.text()}))`); return JSON.parse(r.j).claim?.id; }
await go(p, s.base + "/mini/today", 3000);
await release();
const hid = await claim("hygiene");
console.log("hygiene claim", hid);
await go(p, s.base + "/mini/claim/" + hid, 3000);
await p.waitForFunction(`/Завершить/.test(document.body.innerText)`, { timeout: 120000 });
await p.waitForTimeout(2000);
console.log("HYGIENE BODY:\n" + (await probe(p)).bodyText.slice(0, 2200));
await shot(p, "26-hygiene", true);
await shot(p, "26-hygiene-vp");
await release();
// skip на разрешённом журнале
const cid = await claim("complaint_register");
console.log("complaint claim", cid);
await go(p, s.base + "/mini/claim/" + cid, 3000);
await p.waitForFunction(`/Сегодня не требуется/.test(document.body.innerText)`, { timeout: 120000 });
await p.waitForTimeout(1200);
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>/Сегодня не требуется/.test(x.innerText)).click()`);
await p.waitForTimeout(1000);
console.log("SKIP PANEL:\n" + (await probe(p)).bodyText.slice(0,1400));
await shot(p, "26-skip-panel-vp");
const btn = await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Пропустить');return {disabled:b.disabled}})()`);
console.log("Пропустить disabled без причины:", JSON.stringify(btn));
await p.fill('input[placeholder^="Причина"]', "ZZ6 жалоб сегодня не было");
await p.waitForTimeout(300);
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Пропустить').click()`);
await p.waitForTimeout(3500);
console.log("after skip url", p.url());
const row = await db.journalTaskClaim.findUnique({ where: { id: cid! } });
console.log("DB:", row?.status, (row as any)?.verificationStatus, JSON.stringify(row?.completionData));
console.log("ERRORS", JSON.stringify(s.errors));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
