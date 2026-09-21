import { openSite } from "./site";
import { shot, go, probe, FIELDS } from "./lib";
import { db } from "../tg-session";
const EQ = "cmu32lpb30001pg9mro5ckqh8";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/settings/equipment", 5000);
await p.waitForFunction(`/Холодильник без журнала/.test(document.body.innerText)`, { timeout: 180000 });
await p.waitForTimeout(2000);
await p.click('button[aria-label="Изменить оборудование «Холодильник без журнала»"]');
await p.waitForTimeout(1800);
console.log("MODAL:\n" + (await probe(p)).bodyText.slice(-1500));
await shot(p, "39-equip-modal");
console.log("FIELDS", JSON.stringify(await p.evaluate(FIELDS), null, 1));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
