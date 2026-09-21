import { openSite } from "./site";
import { shot, go, probe, CLICKABLES } from "./lib";
import { db, state } from "../tg-session";
(async () => {
console.log("state.password?", typeof state.password, JSON.stringify(state.users?.ownerA));
const s = await openSite({ role: "ownerA", width: 1280, height: 900 });
await go(s.page, s.base + "/dashboard", 5000);
await s.page.waitForTimeout(6000);
console.log("URL", s.page.url());
console.log("cookies", (await s.ctx.cookies()).map(c=>c.name).join(","));
console.log("HEAD:", (await probe(s.page)).bodyText.slice(0,400).replace(/\n/g," | "));
await shot(s.page, "32-site-dashboard");
console.log("ERRORS", JSON.stringify(s.errors).slice(0,500));
await s.close();
await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
