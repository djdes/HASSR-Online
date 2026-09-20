import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
const DOC = "cmu8hkgnh001tic9md21uf2nx", CODE = "cold_equipment_control";
async function today() {
  const e: any = await db.journalDocumentEntry.findFirst({ where: { documentId: DOC, date: new Date("2026-09-20T00:00:00Z") } });
  return JSON.stringify(e?.values ?? e?.data);
}
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("request", r => { if (r.method() !== "GET" && !/_next/.test(r.url())) console.log("REQ " + r.method() + " " + r.url().replace(s.base,"")); });
p.on("framenavigated", f => console.log("NAV " + f.url().replace(s.base,"")));
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
console.log("DB before:", await today());
const inputs = p.locator('input[placeholder="—"]');
console.log("inForm:", await p.evaluate(`(()=>{const i=document.querySelectorAll('input[placeholder="—"]')[2]; return !!(i && i.closest('form'));})()`));
await inputs.nth(2).click(); await p.waitForTimeout(400);
await p.keyboard.type("4", { delay: 150 });
await p.waitForTimeout(600);
console.log("val before enter:", await inputs.nth(2).inputValue());
await shot(p, "h1-before-enter");
await p.keyboard.press("Enter");
await p.waitForTimeout(5000);
console.log("val after enter:", await inputs.nth(2).inputValue());
console.log("DB after enter:", await today());
await shot(p, "h2-after-enter");
// now repeat: type and blur properly to prove the field itself works
await inputs.nth(2).click(); await p.waitForTimeout(300);
await p.keyboard.type("4", { delay: 150 });
await p.locator('text=Холодильник без журнала').first().click();
await p.waitForTimeout(5000);
console.log("DB after blur:", await today());
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
