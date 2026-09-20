import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES } from "./lib";
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
console.log("CLICKS " + JSON.stringify(await p.evaluate(CLICKABLES),null,0).slice(0,3000));
for (const view of ["Сегодня", "По оборудованию", "Таблица"]) {
  if (!(await p.getByRole("button", { name: view, exact: true }).count())) { console.log("NO BUTTON " + view); continue; }
  await p.getByRole("button", { name: view, exact: true }).click();
  await p.waitForTimeout(3500);
  const pr: any = await probe(p);
  console.log("=== view " + view + " overflow=" + pr.overflow);
  console.log("   text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,1400));
  await shot(p, "v-" + view.replace(/ /g,"_"));
  await shot(p, "v-" + view.replace(/ /g,"_") + "-full", true);
}
// undo
await p.getByRole("button", { name: "Отменить последнее изменение" }).click();
await p.waitForTimeout(5000);
console.log("DB after UNDO:", await today());
await shot(p, "v-after-undo");
await p.getByRole("button", { name: "Повторить отменённое изменение" }).click();
await p.waitForTimeout(5000);
console.log("DB after REDO:", await today());
await shot(p, "v-after-redo");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
