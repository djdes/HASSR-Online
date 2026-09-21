import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, CLICKABLES } from "./lib";
(async () => {
const s = await openTelegramSession({ role: "headA", width: 360, height: 640 });
const p = s.page;
console.log("landed", p.url());
await go(p, s.base + "/verifications", 4000);
await p.waitForTimeout(6000);
const pr = await probe(p);
console.log("URL", pr.url, "overflow", pr.overflow, "wide", JSON.stringify(pr.wide));
console.log("BODY:\n" + pr.bodyText);
await shot(p, "07-verifications", true);
console.log("CLICKABLES", JSON.stringify(await p.evaluate(CLICKABLES), null, 1).slice(0,3000));
console.log("ERRORS", JSON.stringify(s.errors));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
