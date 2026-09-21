import { openSite } from "./site";
import { shot, go, probe, FIELDS } from "./lib";
import { clickText, listButtons } from "./dbl";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1400, height: 950 });
const p = s.page;
await go(p, s.base + "/settings/users", 6000);
await p.waitForFunction(`/График отпусков/.test(document.body.innerText)`, undefined, { timeout: 180000 });
await p.waitForTimeout(4000);
await clickText(p, "График отпусков"); await p.waitForTimeout(2500);
const adds = await p.evaluate(`[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Добавить'&&b.getBoundingClientRect().width>0).map(b=>JSON.stringify(b.getBoundingClientRect())+' | '+String(b.className).slice(0,60))`);
console.log("ADDs", JSON.stringify(adds, null, 1));
// последний — в панели отпусков
await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].filter(x=>x.innerText.trim()==='Добавить'&&x.getBoundingClientRect().width>0);b[b.length-1].click();})()`);
await p.waitForTimeout(2500);
console.log("AFTER:\n" + (await probe(p)).bodyText.slice(-1200));
console.log("FIELDS", JSON.stringify(await p.evaluate(FIELDS)).slice(0,1200));
await shot(p, "65-vac-add2");
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
