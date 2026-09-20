import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES, FIELDS } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method()!=="GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"") + " :: " + (await r.text().catch(()=>"" )).slice(0,200)); });
await p.goto(s.base + "/plans/new", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(13000);
const pr: any = await probe(p);
console.log("text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,1200));
console.log("fields " + JSON.stringify(await p.evaluate(FIELDS), null, 0));
console.log("clicks " + JSON.stringify(await p.evaluate(CLICKABLES), null, 0).slice(0,2000));
await shot(p, "pl1-new", true);
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
