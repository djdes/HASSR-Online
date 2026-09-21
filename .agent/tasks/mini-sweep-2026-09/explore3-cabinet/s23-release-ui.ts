import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES } from "./lib";
(async () => {
const CID = "cmuax9enx0006209m12tf4w4b";
const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
const p = s.page;
await go(p, s.base + "/mini/claim/" + CID, 3000);
await p.waitForFunction(`/Вернуть задачу/.test(document.body.innerText)`, { timeout: 120000 });
await p.waitForTimeout(1200);
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>/Вернуть задачу/.test(x.innerText)).click()`);
await p.waitForTimeout(1200);
console.log("DIALOG:\n" + (await probe(p)).bodyText.slice(0,1200));
await shot(p, "23-release-dialog-vp");
await shot(p, "23-release-dialog", true);
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Вернуть задачу').click()`);
await p.waitForTimeout(3500);
console.log("after release url", p.url());
console.log("BODY:", (await probe(p)).bodyText.slice(0,400).replace(/\n/g," | "));
const r = await db.journalTaskClaim.findUnique({ where: { id: CID } });
console.log("DB:", r?.status, (r as any)?.verificationStatus);
// черновик остался?
const draft = await p.evaluate(`JSON.stringify(Object.keys(sessionStorage).filter(k=>k.indexOf('claim-draft')>=0).map(k=>[k,sessionStorage.getItem(k).slice(0,120)]))`);
console.log("DRAFTS in sessionStorage:", draft);
console.log("ERRORS", JSON.stringify(s.errors));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
