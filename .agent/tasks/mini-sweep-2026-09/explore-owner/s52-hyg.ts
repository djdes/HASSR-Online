import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES } from "./lib";
const DOC = "cmu45uyxc004k5k9m0bq4vwux", CODE = "hygiene";
const TODAY = "2026-09-21";
async function todayRows() {
  const e: any[] = await db.journalDocumentEntry.findMany({ where: { documentId: DOC, date: new Date(TODAY + "T00:00:00Z") } });
  return e.map(x=>x.employeeId + " " + JSON.stringify(x.data).slice(0,120));
}
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method()!=="GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"")); });
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(13000);
console.log("DB today before: " + JSON.stringify(await todayRows(), null, 1));
const pr: any = await probe(p);
console.log("counter: " + (pr.bodyText.match(/Сегодня осталось[^\n]*/)||[])[0]);
await shot(p, "hy1");
console.log("--- click Заполнить (first)");
await p.locator('button:has-text("Заполнить")').first().click();
await p.waitForTimeout(4000);
await shot(p, "hy2-dialog");
const pr2: any = await probe(p);
console.log("dialog: " + pr2.bodyText.split("\n").filter((x:string)=>x.trim()).slice(-30).join(" / ").slice(0,1000));
console.log("clicks " + JSON.stringify(await p.evaluate(CLICKABLES)).slice(-1300));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
