import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES } from "./lib";
(async () => {
const cl = await db.journalTaskClaim.findMany({ where: { organizationId: "e2e-org-a", status: "active" }, include: { user: { select: { name: true } } } });
for (const c of cl) console.log("ACTIVE", c.id, c.user.name, c.journalCode, c.scopeLabel, c.dateKey.toISOString().slice(0,10), (c as any).verificationStatus);
const s = await openTelegramSession({ role: "cleanerA", width: 360, height: 640 });
const p = s.page;
await go(p, s.base + "/mini/today", 4000);
await p.waitForFunction(`!/Загружаем/.test(document.body.innerText)`, { timeout: 120000 }).catch(()=>console.log("LOADING"));
await p.waitForTimeout(2500);
const pr = await probe(p);
console.log("BODY:\n" + pr.bodyText.slice(0, 2500));
await shot(p, "14-cleaner-today-vp");
await shot(p, "14-cleaner-today", true);
console.log("CLICK", JSON.stringify(await p.evaluate(CLICKABLES), null, 1).slice(0, 2500));
const api: any = await p.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`);
console.log("stuckClaims", JSON.stringify(api.stuckClaims), "myActive", JSON.stringify(api.myActive), "dateKey", api.dateKey);
// попробуем взять новую задачу при зависшей
const g = (api.groups||[]).find((x:any)=>x.scopes.some((y:any)=>y.availability==="available"));
if (g) { const sc = g.scopes.find((y:any)=>y.availability==="available");
  const body = JSON.stringify({ journalCode: g.code, scopeKey: sc.scopeKey, scopeLabel: sc.scopeLabel, dateKey: api.dateKey });
  const res: any = await p.evaluate(`fetch('/api/journal-task-claims',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(async r=>({s:r.status,j:await r.text()}))`);
  console.log("TRY CLAIM NEW while stuck:", JSON.stringify(res).slice(0,500));
}
console.log("ERRORS", JSON.stringify(s.errors));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
