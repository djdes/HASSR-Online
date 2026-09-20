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
console.log("DB:", await today());
for (const view of ["По оборудованию", "Таблица", "Сегодня"]) {
  await p.locator(`button:has-text("${view}")`).first().click();
  await p.waitForTimeout(3500);
  const pr: any = await probe(p);
  console.log("=== view " + view + " overflow=" + pr.overflow);
  console.log("   text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,1500));
  await shot(p, "v-" + view.replace(/ /g,"_"));
}
// edit then undo
const inputs = p.locator('input[placeholder="—"]');
await inputs.nth(0).click(); await p.waitForTimeout(300);
await p.keyboard.press("Control+a"); await p.keyboard.type("-19", { delay: 120 });
await p.locator('text=Морозилка QR E2E').first().click();
await p.waitForTimeout(5000);
console.log("DB after edit -19:", await today());
await p.locator('button[aria-label="Отменить последнее изменение"]').click();
await p.waitForTimeout(5000);
console.log("DB after UNDO:", await today());
console.log("field0 after undo:", await inputs.nth(0).inputValue());
await shot(p, "v-after-undo");
await p.locator('button[aria-label="Повторить отменённое изменение"]').click();
await p.waitForTimeout(5000);
console.log("DB after REDO:", await today());
console.log("field0 after redo:", await inputs.nth(0).inputValue());
await shot(p, "v-after-redo");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
