import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, dump } from "./lib";
(async () => {
const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
const p = s.page;
const pipe: any = await p.evaluate(`fetch('/api/journal-pipelines/cold_equipment_control').then(r=>r.status+' '+r.statusText).catch(e=>'ERR'+e)`);
console.log("PIPELINE cold:", pipe);
for (const code of ["cold_equipment_control","hygiene","health_check","finished_product","cleaning"]) {
  const r: any = await p.evaluate(`fetch('/api/journal-pipelines/${code}').then(async r=>({s:r.status,b:(await r.text()).slice(0,300)}))`);
  console.log("PIPE", code, JSON.stringify(r).slice(0,400));
}
const my: any = await p.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`);
const claimId = my?.claim?.id;
console.log("claim", claimId, my?.claim?.journalCode);
await go(p, s.base + "/mini/claim/" + claimId, 3000);
await p.waitForFunction(`!/Открываем задачу/.test(document.body.innerText)`, { timeout: 120000 }).catch(()=>console.log("STILL LOADING"));
await p.waitForTimeout(1500);
// вводим 9 (вне нормы 2..6)
await p.fill('input[placeholder="напр. 4"]', "9");
await p.waitForTimeout(500);
await shot(p, "04-temp9-vp");
let st = await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Заверш/.test(x.innerText));return {disabled:b.disabled}})()`);
console.log("btn after 9:", JSON.stringify(st));
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>/Заверш/.test(x.innerText)).click()`);
await p.waitForTimeout(3000);
const pr = await probe(p);
console.log("BODY after submit9:\n" + pr.bodyText);
await shot(p, "04-after9", true);
// теперь пишем корректирующее
await p.fill('input[placeholder="коротко описать"]', "Вызвал мастера, переставил продукты");
await p.waitForTimeout(400);
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>/Заверш/.test(x.innerText)).click()`);
await p.waitForTimeout(3500);
console.log("BODY after submit2:\n" + (await probe(p)).bodyText);
await shot(p, "04-after-ok", true);
await p.waitForTimeout(2500);
console.log("URL now", p.url());
const row = await db.journalTaskClaim.findUnique({ where: { id: claimId } });
console.log("DB CLAIM", JSON.stringify({status:row?.status, verificationStatus:(row as any)?.verificationStatus, completionData: row?.completionData}, null, 1));
const capa = await db.capaTicket.findMany({ where: { organizationId: "e2e-org-a" }, orderBy:{createdAt:"desc"}, take: 2, select:{title:true,priority:true,category:true,createdAt:true}});
console.log("CAPA", JSON.stringify(capa));
console.log("ERRORS", JSON.stringify(s.errors));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
