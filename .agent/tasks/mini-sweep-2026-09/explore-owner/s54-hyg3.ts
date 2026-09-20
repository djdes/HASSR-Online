import { openTelegramSession, db } from "../tg-session";
import { shot, probe } from "./lib";
const DOC = "cmu45uyxc004k5k9m0bq4vwux", CODE = "hygiene";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method()!=="GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"")); });
p.on("framenavigated", f => { if (f===p.mainFrame()) console.log("NAV " + f.url().replace(s.base,"")); });
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(13000);
await p.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`); await p.waitForTimeout(1200);
const btn = p.locator('button:has-text("Заполнить")').first();
console.log("btn box " + JSON.stringify(await btn.boundingBox()));
await btn.click();
await p.waitForTimeout(6000);
const pr: any = await probe(p);
console.log("url=" + pr.url);
await shot(p, "hy5");
console.log("text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,1000));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
