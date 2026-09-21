import { openSite } from "./site";
import { shot, go, probe, FIELDS } from "./lib";
import { listButtons } from "./dbl";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/losses/new", 6000);
await p.waitForTimeout(12000);
console.log("url", p.url());
console.log((await probe(p)).bodyText.slice(0, 1500));
console.log("BTNS", JSON.stringify(await listButtons(p)));
await shot(p, "53-loss-new", true);
console.log("ERRORS", JSON.stringify(s.errors).slice(0,400));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
