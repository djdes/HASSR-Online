import { openSite } from "./site";
import { shot, go, probe, FIELDS } from "./lib";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/capa", 5000);
await p.waitForFunction(`/Новое нарушение/.test(document.body.innerText)`, { timeout: 180000 });
await p.waitForTimeout(3000);
await p.evaluate(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Новое нарушение').click()`);
await p.waitForTimeout(2000);
console.log("DIALOG:\n" + (await probe(p)).bodyText.slice(-1500));
await shot(p, "45-capa-dialog");
console.log("FIELDS", JSON.stringify(await p.evaluate(FIELDS), null, 1));
console.log("BUTTONS", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0).map(b=>b.innerText.trim()).slice(-14)`)));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
