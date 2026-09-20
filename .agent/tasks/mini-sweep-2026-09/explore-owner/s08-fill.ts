import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES, FIELDS } from "./lib";
const DOC = "cmu8hkgnh001tic9md21uf2nx", CODE = "cold_equipment_control";
async function entries() {
  const e: any[] = await db.journalDocumentEntry.findMany({ where: { documentId: DOC }, orderBy: { createdAt: "asc" } });
  return e.map(x => x.id + " " + (x.date?.toISOString?.().slice(0,10)) + " " + JSON.stringify(x.values ?? x.data).slice(0,160) + " rk=" + (x.rowKey ?? ""));
}
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
console.log("DB before:", JSON.stringify(await entries(), null, 1));
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
const inputs = p.locator('input[placeholder="—"]');
console.log("inputs:", await inputs.count());
await inputs.nth(0).click(); await p.waitForTimeout(300);
await inputs.nth(0).fill("-20");
await p.waitForTimeout(500);
await shot(p, "e1-typed");
// blur
await p.locator('body').click({ position: { x: 5, y: 300 } });
await p.waitForTimeout(4000);
console.log("after type url=" + p.url());
const pr: any = await probe(p);
console.log("text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).join(" / ").slice(0,900));
await shot(p, "e2-after-blur");
console.log("DB after:", JSON.stringify(await entries(), null, 1));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
