import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe, dump, CLICKABLES } from "./lib";
import { claimScope, releaseActive } from "../explore2-staff/claimlib";
(async () => {
const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
const p = s.page;
await go(p, s.base + "/mini/today", 3000);
console.log("RELEASE", JSON.stringify(await releaseActive(p)).slice(0,200));
const c = await claimScope(p, "cold_equipment_control", "Холодильник QR E2E — Утро");
console.log("CLAIM", JSON.stringify(c.res).slice(0, 400));
const claimId = (c.res as any).j?.claim?.id;
console.log("claimId", claimId);
await go(p, s.base + "/mini/claim/" + claimId, 5000);
const pr = await probe(p);
console.log("URL", pr.url, "overflow", pr.overflow, "wide", JSON.stringify(pr.wide));
console.log("BODY:\n" + pr.bodyText);
await shot(p, "02-cold-claim", true);
const cl = await p.evaluate(CLICKABLES);
console.log("CLICKABLES", JSON.stringify(cl, null, 1));
// состояние кнопки Завершить
const st = await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Заверш/.test(x.innerText));return b?{txt:b.innerText,disabled:b.disabled}:null})()`);
console.log("SUBMIT BTN", JSON.stringify(st));
console.log("ERRORS", JSON.stringify(s.errors));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
