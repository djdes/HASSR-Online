import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method()!=="GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"") + " :: " + (await r.text().catch(()=>"" )).slice(0,200)); });
await p.goto(s.base + "/dashboard", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
console.log("--- Выборочно");
await p.locator('button:has-text("Выборочно")').click();
await p.waitForTimeout(3500);
const pr: any = await probe(p);
console.log("dialog: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).slice(0,40).join(" / ").slice(0,1200));
await shot(p, "cd1-selective");
const box: any = await p.evaluate(`(()=>{const d=document.querySelector('[role="dialog"]'); if(!d) return null; const r=d.getBoundingClientRect(); return {l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),vw:innerWidth,vh:innerHeight, sh:d.scrollHeight, ch:d.clientHeight};})()`);
console.log("dialog box " + JSON.stringify(box));
await p.keyboard.press("Escape"); await p.waitForTimeout(1500);
console.log("--- Закрыть день");
await p.locator('button:has-text("Закрыть день")').click();
await p.waitForTimeout(4000);
const pr2: any = await probe(p);
console.log("after close-day: " + pr2.bodyText.split("\n").filter((x:string)=>x.trim()).slice(0,25).join(" / ").slice(0,1000));
await shot(p, "cd2-closeday");
const box2: any = await p.evaluate(`(()=>{const d=document.querySelector('[role="dialog"]'); if(!d) return null; const r=d.getBoundingClientRect(); return {t:Math.round(r.top),h:Math.round(r.height),vh:innerHeight, sh:d.scrollHeight, ch:d.clientHeight, txt:d.innerText.slice(0,400)};})()`);
console.log("dialog2 " + JSON.stringify(box2));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
