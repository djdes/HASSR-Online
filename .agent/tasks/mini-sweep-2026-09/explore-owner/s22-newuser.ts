import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES, FIELDS } from "./lib";
const TAG = "ZZТест" + Date.now().toString().slice(-5);
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method() !== "GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"") + " :: " + (await r.text().catch(()=>"" )).slice(0,180)); });
await p.goto(s.base + "/settings/users", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
// --- new position
await p.locator('button:has-text("Должность")').first().click();
await p.waitForTimeout(2500);
console.log("POS DIALOG fields " + JSON.stringify(await p.evaluate(FIELDS)));
console.log("POS DIALOG clicks " + JSON.stringify(await p.evaluate(CLICKABLES)).slice(-1600));
await shot(p, "u2-position-dialog");
const pr: any = await probe(p);
console.log("dialog text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).slice(-25).join(" / "));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
