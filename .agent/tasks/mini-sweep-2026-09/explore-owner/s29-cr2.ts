import { openTelegramSession, db } from "../tg-session";
import { shot, probe } from "./lib";
const DOC = "cmu45uz9g008t5k9m0zvwur6i", CODE = "complaint_register";
async function cfg() { const d: any = await db.journalDocument.findUnique({ where: { id: DOC } }); return JSON.stringify(d?.config).slice(0, 900); }
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method()!=="GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"")); });
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
console.log("cfg before: " + await cfg());
await p.locator('button:has-text("Добавить")').first().click();
await p.waitForTimeout(3000);
await p.locator('input[placeholder*="ФИО заявителя"]').fill("ZZ Иванов Тест");
const tas = p.locator('textarea');
await tas.nth(0).fill("ZZ реквизиты 111");
await tas.nth(1).fill("ZZ содержание жалобы");
await tas.nth(2).fill("ZZ решение");
// can we reach the submit button by scrolling inside the dialog?
const dlg = p.locator('[role="dialog"]');
const before = await dlg.evaluate(`e => ({sh: e.scrollHeight, ch: e.clientHeight, st: e.scrollTop})`);
console.log("dialog scroll metrics: " + JSON.stringify(before));
await dlg.evaluate(`e => { e.scrollTop = e.scrollHeight; }`);
await p.waitForTimeout(700);
console.log("after scroll: " + JSON.stringify(await dlg.evaluate(`e => ({st: e.scrollTop})`)));
await shot(p, "cr2-bottom");
const btn = p.locator('[role="dialog"] button:has-text("Добавить")').last();
console.log("submit box: " + JSON.stringify(await btn.boundingBox()));
await btn.click();
await p.waitForTimeout(6000);
await shot(p, "cr3-after");
const pr: any = await probe(p);
console.log("after: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,700));
console.log("cfg after: " + await cfg());
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
