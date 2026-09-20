import { openTelegramSession } from "../tg-session";
import { shot, probe } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
await p.goto(s.base + "/journals", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(13000);
const pr: any = await probe(p);
console.log(pr.bodyText.slice(0, 3500));
await shot(p, "jr-journals", true);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
