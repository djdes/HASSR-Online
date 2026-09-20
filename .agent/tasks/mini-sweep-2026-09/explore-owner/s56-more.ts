import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method()!=="GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"") + " :: " + (await r.text().catch(()=>"" )).slice(0,200)); });
await p.goto(`${s.base}/journals/complaint_register/documents/cmu45uz9g008t5k9m0zvwur6i`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(13000);
await p.locator('button[aria-label="Ещё действия"]').click();
await p.waitForTimeout(2500);
const pr: any = await probe(p);
console.log("menu: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).slice(-20).join(" / ").slice(0,700));
console.log("clicks " + JSON.stringify(await p.evaluate(CLICKABLES)).slice(-1100));
await shot(p, "more1");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
