import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
(async () => {
const CID = "cmuax9enx0006209m12tf4w4b";
let r = await db.journalTaskClaim.findUnique({ where: { id: CID } });
console.log("state after empty reject:", r?.status, (r as any)?.verificationStatus, "comment=", JSON.stringify((r as any)?.verifierComment), "verifiedById", (r as any)?.verifiedById, "completedAt", r?.completedAt);
// вернём в completed, чтобы отклонить с комментарием
await db.journalTaskClaim.update({ where: { id: CID }, data: { status: "completed", completedAt: new Date(), verificationStatus: "pending", verifierComment: null } });
const s = await openTelegramSession({ role: "headA", width: 360, height: 640 });
const p = s.page;
await go(p, s.base + "/verifications", 4000);
await p.waitForTimeout(6000);
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>/Холодильник QR E2E — Утро/.test(x.innerText)&&/мин назад/.test(x.innerText)).click()`);
await p.waitForTimeout(2000);
await p.fill('input[placeholder^="Комментарий"]', "Температура 9 — перемеряй и напиши точнее, что сделал");
await p.waitForTimeout(300);
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Переделать').click()`);
await p.waitForTimeout(3000);
r = await db.journalTaskClaim.findUnique({ where: { id: CID } });
console.log("after reject with comment:", r?.status, (r as any)?.verificationStatus, JSON.stringify((r as any)?.verifierComment));
await shot(p, "11-after-reject", true);
console.log("head body head:\n" + (await probe(p)).bodyText.slice(0,900));
await s.close();
// теперь повар
const c = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
await go(c.page, c.base + "/mini/claim/" + CID, 3000);
await c.page.waitForFunction(`/переделку|Вернули|Возьми термометр/.test(document.body.innerText)`, { timeout: 120000 }).catch(()=>console.log("NO LOAD"));
await c.page.waitForTimeout(1500);
console.log("COOK BODY:\n" + (await probe(c.page)).bodyText.slice(0, 1800));
await shot(c.page, "11-cook-rejected", true);
await shot(c.page, "11-cook-rejected-vp");
console.log("FIELD VALUES", JSON.stringify(await c.page.evaluate(`[...document.querySelectorAll('input')].map(e=>e.type+':'+(e.placeholder||'')+'='+JSON.stringify(e.value)+(e.type==='checkbox'?('checked='+e.checked):''))`)));
const my: any = await c.page.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`);
console.log("MY", JSON.stringify(my).slice(0,300));
console.log("ERRORS", JSON.stringify(c.errors));
await c.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
