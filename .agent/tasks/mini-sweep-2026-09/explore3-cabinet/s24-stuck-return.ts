import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES } from "./lib";
(async () => {
const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
const p = s.page;
await go(p, s.base + "/mini/today", 4000);
await p.waitForFunction(`/Незавершённая задача/.test(document.body.innerText)`, { timeout: 120000 });
await p.waitForTimeout(1500);
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Вернуть').click()`);
await p.waitForTimeout(1500);
console.log("after Вернуть:", (await probe(p)).bodyText.slice(0,700).replace(/\n/g," | "));
await shot(p, "24-stuck-return-vp");
await p.waitForTimeout(2500);
console.log("later:", (await probe(p)).bodyText.slice(0,500).replace(/\n/g," | "));
const r = await db.journalTaskClaim.findUnique({ where: { id: "cmuagbulz00q7cc9m4g5zj3uo" } });
console.log("DB stuck claim:", r?.status);
// теперь берём health_check
const api: any = await p.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`);
const g = api.groups.find((x:any)=>x.code==="health_check");
const sc = g.scopes.find((y:any)=>y.availability==="available");
const body = JSON.stringify({ journalCode: "health_check", scopeKey: sc.scopeKey, scopeLabel: sc.scopeLabel, dateKey: api.dateKey });
const res: any = await p.evaluate(`fetch('/api/journal-task-claims',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(async r=>({s:r.status,j:await r.text()}))`);
const cid = JSON.parse(res.j).claim?.id;
console.log("health_check claim", res.s, cid);
await go(p, s.base + "/mini/claim/" + cid, 3000);
await p.waitForFunction(`/Завершить/.test(document.body.innerText)`, { timeout: 120000 });
await p.waitForTimeout(1500);
const pr = await probe(p);
console.log("HEALTH CLAIM BODY:\n" + pr.bodyText.slice(0,1800));
await shot(p, "24-health-claim", true);
console.log("has skip button:", /Сегодня не требуется/.test(pr.bodyText));
// прямой запрос на skip
const skip: any = await p.evaluate(`fetch('/api/journal-task-claims/${cid}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'skip',skipReason:'ZZ6 проверка запрета'})}).then(async r=>({s:r.status,j:await r.text()}))`);
console.log("DIRECT SKIP:", JSON.stringify(skip));
console.log("ERRORS", JSON.stringify(s.errors));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
