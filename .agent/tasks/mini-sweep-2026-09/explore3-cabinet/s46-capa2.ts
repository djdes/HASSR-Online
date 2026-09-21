import { openSite } from "./site";
import { shot, go, probe, FIELDS } from "./lib";
import { clickText, doubleClickText, listButtons } from "./dbl";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/capa", 5000);
await p.waitForFunction(`/Новое нарушение/.test(document.body.innerText)`, { timeout: 180000 });
await p.waitForTimeout(3000);
await clickText(p, "Новое нарушение");
await p.waitForTimeout(2000);
console.log("DIALOG:\n" + (await probe(p)).bodyText.slice(-1300));
await shot(p, "46-capa-dialog");
console.log("FIELDS", JSON.stringify(await p.evaluate(FIELDS), null, 1));
console.log("BUTTONS", JSON.stringify((await listButtons(p)).slice(-12)));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
