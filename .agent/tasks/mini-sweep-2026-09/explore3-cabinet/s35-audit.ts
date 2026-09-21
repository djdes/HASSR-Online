import { openSite } from "./site";
import { shot, go, probe } from "./lib";
import { db } from "../tg-session";
(async () => {
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
await go(s.page, s.base + "/settings/audit", 5000);
await s.page.waitForTimeout(8000);
const pr = await probe(s.page);
console.log("URL", pr.url);
console.log(pr.bodyText.slice(0, 5000));
await shot(s.page, "35-audit", true);
console.log("ERRORS", JSON.stringify(s.errors).slice(0,400));
await s.close(); await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
