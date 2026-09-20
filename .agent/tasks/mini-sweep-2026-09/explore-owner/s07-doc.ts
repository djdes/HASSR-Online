import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES, FIELDS } from "./lib";
const DOC = process.env.DOC!;
const CODE = process.env.CODE!;
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
const pr: any = await probe(p);
console.log("url=" + pr.url + " head=" + JSON.stringify(pr.heads[0]));
console.log("overflow=" + pr.overflow);
console.log("clicks " + JSON.stringify(await p.evaluate(CLICKABLES), null, 0).slice(0,4000));
console.log("fields " + JSON.stringify(await p.evaluate(FIELDS), null, 0).slice(0,2500));
console.log("text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,2000));
await shot(p, "d1-" + CODE);
await shot(p, "d1-" + CODE + "-full", true);
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
