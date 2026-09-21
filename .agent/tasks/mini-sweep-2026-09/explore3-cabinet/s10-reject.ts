import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES } from "./lib";
(async () => {
const s = await openTelegramSession({ role: "headA", width: 360, height: 640 });
const p = s.page;
await go(p, s.base + "/verifications", 4000);
await p.waitForTimeout(6000);
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>/Холодильник QR E2E — Утро/.test(x.innerText)&&/мин назад/.test(x.innerText)).click()`);
await p.waitForTimeout(2000);
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Переделать').click()`);
await p.waitForTimeout(2000);
console.log("BODY after Переделать:\n" + (await probe(p)).bodyText.slice(0, 2500));
await shot(p, "10-reject-dialog", true);
await shot(p, "10-reject-dialog-vp");
console.log("CLICK", JSON.stringify(await p.evaluate(CLICKABLES), null, 1).slice(0,2000));
console.log("FIELDS", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('input,textarea')].map(e=>e.tagName+' '+(e.placeholder||'')+' '+JSON.stringify(e.value))`)));
console.log("ERRORS", JSON.stringify(s.errors));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
