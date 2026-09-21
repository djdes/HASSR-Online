import { openSite } from "./site";
import { shot, go, probe, CLICKABLES, FIELDS } from "./lib";
import { db } from "../tg-session";
const EQ = "cmu32lpb30001pg9mro5ckqh8"; // Холодильник без журнала
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/settings/equipment", 5000);
await p.waitForFunction(`/Холодильник без журнала/.test(document.body.innerText)`, { timeout: 180000 });
await p.waitForTimeout(2000);
console.log("CLICK", JSON.stringify(await p.evaluate(CLICKABLES), null, 1).slice(0,2500));
// кнопка редактирования в строке
const rowInfo = await p.evaluate(`(()=>{const tr=[...document.querySelectorAll('tr')].find(r=>/Холодильник без журнала/.test(r.innerText));return tr?[...tr.querySelectorAll('button,a')].map(b=>b.tagName+':'+(b.innerText.trim()||b.getAttribute('aria-label')||b.getAttribute('title')||'?')+':'+(b.getAttribute('href')||'')):null})()`);
console.log("row buttons", JSON.stringify(rowInfo));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
