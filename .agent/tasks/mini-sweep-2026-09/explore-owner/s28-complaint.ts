import { openTelegramSession, db } from "../tg-session";
import { shot, probe, CLICKABLES, FIELDS } from "./lib";
const DOC = "cmu45uz9g008t5k9m0zvwur6i", CODE = "complaint_register";
async function rows() {
  const e: any[] = await db.journalDocumentEntry.findMany({ where: { documentId: DOC }, orderBy: { createdAt: "asc" } });
  return e.map(x => x.id.slice(-6) + " " + JSON.stringify(x.data).slice(0,200));
}
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (r.request().method()!=="GET" && !/_next/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"") + " :: " + (await r.text().catch(()=>"" )).slice(0,150)); });
await p.goto(`${s.base}/journals/${CODE}/documents/${DOC}`, { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(12000);
console.log("DB before: " + JSON.stringify(await rows(), null, 1));
await p.locator('button:has-text("Добавить")').first().click();
await p.waitForTimeout(3000);
await shot(p, "cr1-add-dialog");
const pr: any = await probe(p);
console.log("dialog text: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).slice(-30).join(" / ").slice(0,900));
console.log("fields " + JSON.stringify(await p.evaluate(FIELDS), null, 1).slice(0,2000));
console.log("clicks " + JSON.stringify(await p.evaluate(CLICKABLES)).slice(-900));
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
