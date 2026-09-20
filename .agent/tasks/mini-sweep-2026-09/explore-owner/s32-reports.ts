import { openTelegramSession } from "../tg-session";
import { shot, probe, CLICKABLES } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("download", d => console.log("DOWNLOAD " + d.suggestedFilename() + " from " + d.url()));
p.on("popup", pg => console.log("POPUP " + pg.url()));
await p.goto(s.base + "/reports", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(14000);
const pr: any = await probe(p);
console.log("text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,1800));
const cl: string[] = await p.evaluate(CLICKABLES);
console.log("clicks:\n" + cl.join("\n").slice(0,3500));
await shot(p, "rp1-reports");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
