import { openTelegramSession } from "../tg-session";
import { shot, probe, CLICKABLES } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 390, height: 844, theme: "light" });
const p = s.page;
await p.goto(s.base + "/dashboard", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
// bell
const bell = p.locator('header button').filter({ hasNotText: "" }).last();
const bells: string[] = await p.evaluate(`(()=>[...document.querySelectorAll('header button')].map(b=>(b.getAttribute('aria-label')||b.innerText||'?')+'@'+Math.round(b.getBoundingClientRect().left)))()`);
console.log("header buttons: " + JSON.stringify(bells));
await p.locator('header button').last().click();
await p.waitForTimeout(3500);
const pr: any = await probe(p);
console.log("bell panel: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).slice(0,35).join(" / ").slice(0,1200));
await shot(p, "bell1");
console.log("overflow=" + pr.overflow + " wide=" + JSON.stringify(pr.wide));
const box: any = await p.evaluate(`(()=>{const d=document.querySelector('[role="dialog"],[data-radix-popper-content-wrapper]'); if(!d) return null; const r=d.getBoundingClientRect(); return {l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),vw:window.innerWidth,vh:window.innerHeight};})()`);
console.log("panel box: " + JSON.stringify(box));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
