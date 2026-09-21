import { openSite } from "./site";
import { shot, go, probe, CLICKABLES } from "./lib";
import { db } from "../tg-session";
const DOC = "cmu8hkgnh001tic9md21uf2nx";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/journals/cold_equipment_control/documents/" + DOC, 6000);
await p.waitForTimeout(10000);
const pr = await probe(p);
console.log("URL", pr.url);
console.log(pr.bodyText.slice(0, 1500));
await shot(p, "42-cold-doc");
const btns = await p.evaluate(`[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,60)`);
console.log("BUTTONS", JSON.stringify(btns));
console.log("ERRORS", JSON.stringify(s.errors).slice(0,400));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
