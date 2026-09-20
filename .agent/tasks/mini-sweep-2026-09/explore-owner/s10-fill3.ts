import { openTelegramSession, db } from "../tg-session";
import { shot, probe } from "./lib";
const DOC = "cmu8hkgnh001tic9md21uf2nx", CODE = "cold_equipment_control";
async function today() {
  const e: any = await db.journalDocumentEntry.findFirst({ where: { documentId: DOC, date: new Date("2026-09-20T00:00:00Z") } });
  return JSON.stringify(e?.values ?? e?.data);
}
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("request", r => { if (!/_next|\.png|\.svg|\.woff/.test(r.url()) && r.method() !== "GET") console.log("REQ " + r.method() + " " + r.url().replace(s.base,"") + " " + String(r.postData()||"").slice(0,200)); });
p.on("response", async r => { if (!/_next|\.png|\.svg|\.woff/.test(r.url()) && r.request().method() !== "GET") console.log("RES " + r.status() + " " + r.url().replace(s.base,"") + " " + (await r.text().catch(()=>"")).slice(0,200)); });
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
console.log("DB today before:", await today());
const inputs = p.locator('input[placeholder="—"]');
console.log("--- step A: keyboard type then blur by clicking header title");
await inputs.nth(0).click(); await p.waitForTimeout(400);
await p.keyboard.type("-20", { delay: 120 });
await p.waitForTimeout(600);
await p.locator('text=Морозилка QR E2E').first().click();
await p.waitForTimeout(5000);
console.log("val now:", await inputs.nth(0).inputValue());
console.log("DB today after blur:", await today());
const pr: any = await probe(p);
console.log("counter:", (pr.bodyText.match(/Сегодня осталось[^\n]*/)||[])[0]);
await shot(p, "g1-after-blur");
console.log("--- step B: use minus stepper on 2nd card");
await p.getByRole("button", { name: "Уменьшить" }).nth(1).click();
await p.waitForTimeout(5000);
console.log("DB today after minus:", await today());
const pr2: any = await probe(p);
console.log("counter2:", (pr2.bodyText.match(/Сегодня осталось[^\n]*/)||[])[0]);
await shot(p, "g2-after-minus");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
