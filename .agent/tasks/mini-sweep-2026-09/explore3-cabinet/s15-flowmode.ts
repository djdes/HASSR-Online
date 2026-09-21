import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
(async () => {
// 1) прибрать: вернуть взятую гигиену
const hy = await db.journalTaskClaim.findFirst({ where: { organizationId:"e2e-org-a", journalCode:"hygiene", status:"active", userId: "cmu2stncj0009wk9mgu2p7eq1" } });
if (hy) { await db.journalTaskClaim.update({ where: { id: hy.id }, data: { status: "released", releasedAt: new Date() } }); console.log("released hygiene", hy.id); }
const org0 = await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { taskFlowMode: true } });
console.log("MODE before:", org0?.taskFlowMode);

// 2) повторяем в manual: cleanerA с зависшей задачей берёт новую
const s = await openTelegramSession({ role: "cleanerA", width: 360, height: 640 });
const p = s.page;
await go(p, s.base + "/mini/today", 4000);
await p.waitForFunction(`!/Загружаем/.test(document.body.innerText)`, { timeout: 120000 }).catch(()=>null);
await p.waitForTimeout(2000);
const api: any = await p.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`);
console.log("stuck", JSON.stringify(api.stuckClaims), "myActive", JSON.stringify(api.myActive));
async function tryClaim(code: string, label: string) {
  const g = (await p.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`) as any).groups.find((x:any)=>x.code===code);
  const sc = g.scopes.find((y:any)=>y.availability==="available");
  const body = JSON.stringify({ journalCode: code, scopeKey: sc.scopeKey, scopeLabel: sc.scopeLabel, dateKey: api.dateKey });
  const res: any = await p.evaluate(`fetch('/api/journal-task-claims',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(async r=>({s:r.status,j:await r.text()}))`);
  console.log(label, "->", res.s, res.j.slice(0,260));
  try { const j = JSON.parse(res.j); return j.claim?.id ?? null; } catch { return null; }
}
const id1 = await tryClaim("hygiene", "manual: claim #1 при зависшей");
const id2 = await tryClaim("health_check", "manual: claim #2 при активной #1");
// 3) переключаем в race и повторяем
await db.organization.update({ where: { id: "e2e-org-a" }, data: { taskFlowMode: "race" } });
console.log("MODE -> race");
const id3 = await tryClaim("climate_control", "race: claim #3 при активных");
// чистим
for (const id of [id1,id2,id3].filter(Boolean)) await db.journalTaskClaim.update({ where: { id: id as string }, data: { status: "released", releasedAt: new Date() } });
await db.organization.update({ where: { id: "e2e-org-a" }, data: { taskFlowMode: org0?.taskFlowMode ?? "manual" } });
console.log("MODE restored:", (await db.organization.findUnique({where:{id:"e2e-org-a"},select:{taskFlowMode:true}}))?.taskFlowMode);
console.log("ERRORS", JSON.stringify(s.errors));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
