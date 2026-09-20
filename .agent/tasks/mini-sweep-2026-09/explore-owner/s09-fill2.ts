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
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
const inputs = p.locator('input[placeholder="—"]');
// 1) keyboard typing
await inputs.nth(0).click(); await p.waitForTimeout(400);
await p.keyboard.type("-20", { delay: 120 });
await p.waitForTimeout(800);
console.log("value after keyboard type:", await inputs.nth(0).inputValue());
await shot(p, "f1-keyboard");
await p.keyboard.press("Enter");
await p.waitForTimeout(4000);
console.log("DB today after enter:", await today());
const pr: any = await probe(p);
console.log("counter:", (pr.bodyText.match(/Сегодня осталось[^\n]*/)||[])[0]);
await shot(p, "f2-after-enter");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
