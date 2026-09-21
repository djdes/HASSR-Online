import { openSite } from "./site";
import { go, probe, shot } from "./lib";
import { listButtons } from "./dbl";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
const p = s.page;
await go(p, s.base + "/reports", 5000);
await p.waitForTimeout(9000);
const pr = await probe(p);
console.log(pr.bodyText.slice(0, 2500));
await shot(p, "84-reports", true);
console.log("BTNS", JSON.stringify(await listButtons(p)));
console.log("ERRORS", JSON.stringify(s.errors).slice(0,400));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
