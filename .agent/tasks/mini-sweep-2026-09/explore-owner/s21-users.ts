import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES, FIELDS } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
await p.goto(s.base + "/settings/users", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
const pr: any = await probe(p);
console.log("text:\n" + pr.bodyText.slice(0,2500));
console.log("clicks " + JSON.stringify(await p.evaluate(CLICKABLES), null, 0).slice(0,4000));
await shot(p, "u1-users", true);
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
