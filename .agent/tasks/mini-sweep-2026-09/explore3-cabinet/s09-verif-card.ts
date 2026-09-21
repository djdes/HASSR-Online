import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES } from "./lib";
(async () => {
const s = await openTelegramSession({ role: "headA", width: 360, height: 640 });
const p = s.page;
await go(p, s.base + "/verifications", 4000);
await p.waitForTimeout(6000);
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>/Холодильник QR E2E — Утро/.test(x.innerText)&&/1 мин|сек|мин назад/.test(x.innerText)).click()`);
await p.waitForTimeout(2500);
const pr = await probe(p);
console.log("BODY:\n" + pr.bodyText);
await shot(p, "09-verif-card", true);
await shot(p, "09-verif-card-vp");
console.log("CLICKABLES", JSON.stringify(await p.evaluate(CLICKABLES), null, 1).slice(0,2500));
console.log("ERRORS", JSON.stringify(s.errors));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
