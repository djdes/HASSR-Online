import { openTelegramSession } from "../tg-session";
import { shot, probe } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
console.log("user", s.user);
console.log("url after login", s.page.url());
await s.page.waitForTimeout(2500);
console.log(JSON.stringify(await probe(s.page), null, 1));
console.log("shot", await shot(s.page, "01-home"));
await s.page.goto(s.base + "/dashboard", { waitUntil: "load", timeout: 300000 });
await s.page.waitForTimeout(4000);
const p = await probe(s.page);
console.log("=== /dashboard ===");
console.log(JSON.stringify(p, null, 1));
console.log("shot", await shot(s.page, "02-dashboard-full", true));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
