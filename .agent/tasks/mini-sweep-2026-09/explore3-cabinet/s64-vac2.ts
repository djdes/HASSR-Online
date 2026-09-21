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
await clickText(p, "Добавить"); await p.waitForTimeout(2500);
console.log("ADD DIALOG:\n" + (await probe(p)).bodyText.slice(-1200));
console.log("FIELDS", JSON.stringify(await p.evaluate(FIELDS), null, 1));
console.log("BTNS", JSON.stringify((await listButtons(p)).slice(-10)));
await shot(p, "64-vac-add");
console.log("SELECTS", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('select')].map(s=>[...s.options].map(o=>o.text).slice(0,20))`)));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
