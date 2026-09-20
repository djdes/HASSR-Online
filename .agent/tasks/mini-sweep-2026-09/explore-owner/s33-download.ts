import { openTelegramSession } from "../tg-session";
import { shot, probe } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("download", async d => console.log("DOWNLOAD " + d.suggestedFilename() + " url=" + d.url()));
p.on("popup", pg => console.log("POPUP " + pg.url()));
p.on("framenavigated", f => { if (f === p.mainFrame()) console.log("NAV " + f.url().slice(0,140)); });
await p.goto(s.base + "/reports", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(14000);
for (const label of ["Скачать PDF", "Скачать Excel"]) {
  const btn = p.locator(`button:has-text("${label}")`).first();
  await btn.scrollIntoViewIfNeeded();
  await p.waitForTimeout(500);
  console.log("--- click " + label);
  await btn.click();
  await p.waitForTimeout(9000);
  const pr: any = await probe(p);
  console.log("   url=" + pr.url + "  visible: " + pr.bodyText.split("\n").filter((x:string)=>x.trim()).slice(0,6).join(" / "));
  await shot(p, "dl-" + label.replace(/ /g,"_"));
}
// document print link
console.log("--- журнал: Распечатать");
await p.goto(s.base + "/journals/complaint_register/documents/cmu45uz9g008t5k9m0zvwur6i", { waitUntil: "load", timeout: 300000 });
await p.waitForTimeout(10000);
await p.locator('a[href*="/pdf"]').first().click();
await p.waitForTimeout(9000);
const pr2: any = await probe(p);
console.log("   url=" + pr2.url + " head=" + JSON.stringify(pr2.heads[0]) + " text=" + pr2.bodyText.slice(0,200));
await shot(p, "dl-doc-pdf");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
