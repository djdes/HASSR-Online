import { openTelegramSession } from "../tg-session";
import { shot, probe, CLICKABLES } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
await p.goto(s.base + "/dashboard", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(14000);
const pr: any = await probe(p);
console.log("head=" + JSON.stringify(pr.heads[0]));
console.log("first lines: " + pr.bodyText.split("\n").slice(0,10).join(" / "));
const cl: string[] = await p.evaluate(CLICKABLES);
console.log("clicks:\n" + cl.filter(x=>x.startsWith("B ")).join("\n").slice(0,2500));
await shot(p, "dash2");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
