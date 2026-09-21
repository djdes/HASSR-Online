import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
(async () => {
const ORIG = "Europe/Moscow";
console.log("UTC now", new Date().toISOString(), "| Honolulu:", new Date().toLocaleString("ru-RU",{timeZone:"Pacific/Honolulu"}));
await db.organization.update({ where: { id: "e2e-org-a" }, data: { timezone: "Pacific/Honolulu" } });
console.log("tz set to Pacific/Honolulu");
try {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
  const p = s.page;
  await go(p, s.base + "/mini/today", 4000);
  await p.waitForFunction(`!/Загружаем/.test(document.body.innerText)`, { timeout: 120000 }).catch(()=>null);
  await p.waitForTimeout(2500);
  const api: any = await p.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`);
  console.log("TODAY dateKey =", api.dateKey);
  console.log("HEAD of screen:", (await probe(p)).bodyText.slice(0,260).replace(/\n/g," | "));
  await shot(p, "17-tz-today-vp");
  // берём задачу
  const g = api.groups.find((x:any)=>x.code==="climate_control");
  const sc = g.scopes.find((y:any)=>y.availability==="available");
  const body = JSON.stringify({ journalCode: "climate_control", scopeKey: sc.scopeKey, scopeLabel: sc.scopeLabel, dateKey: api.dateKey });
  const res: any = await p.evaluate(`fetch('/api/journal-task-claims',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(async r=>({s:r.status,j:await r.text()}))`);
  const cid = JSON.parse(res.j).claim?.id;
  console.log("claim scopeKey", sc.scopeKey);
  const row = await db.journalTaskClaim.findUnique({ where: { id: cid } });
  console.log("DB dateKey =", row?.dateKey.toISOString(), "| scopeKey", row?.scopeKey);
  await s.close();

  const h = await openTelegramSession({ role: "headA", width: 360, height: 640 });
  await go(h.page, h.base + "/verifications", 4000);
  await h.page.waitForFunction(`/ЖДУТ ПРОВЕРКИ/i.test(document.body.innerText)`, { timeout: 120000 }).catch(()=>null);
  await h.page.waitForTimeout(2000);
  const vb = (await probe(h.page)).bodyText;
  console.log("VERIF head:", vb.slice(0,300).replace(/\n/g," | "));
  console.log("VERIF has Склад сухих утро:", /Склад сухих продуктов/.test(vb));
  await shot(h.page, "17-tz-verif", true);
  await go(h.page, h.base + "/control-board", 4000);
  await h.page.waitForTimeout(6000);
  const cb = (await probe(h.page)).bodyText;
  console.log("CONTROL-BOARD:", cb.slice(0, 1200).replace(/\n/g," | "));
  await shot(h.page, "17-tz-cb", true);
  await go(h.page, h.base + "/team", 4000);
  await h.page.waitForTimeout(5000);
  console.log("TEAM:", (await probe(h.page)).bodyText.slice(0, 1200).replace(/\n/g," | "));
  await shot(h.page, "17-tz-team", true);
  console.log("HEAD ERRORS", JSON.stringify(h.errors));
  await h.close();
  if (cid) { await db.journalTaskClaim.deleteMany({ where: { id: cid } }); console.log("deleted test claim"); }
} finally {
  await db.organization.update({ where: { id: "e2e-org-a" }, data: { timezone: ORIG } });
  console.log("tz RESTORED:", (await db.organization.findUnique({where:{id:"e2e-org-a"},select:{timezone:true}}))?.timezone);
}
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
