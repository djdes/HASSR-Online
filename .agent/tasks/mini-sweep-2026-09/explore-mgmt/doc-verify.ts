import { openTelegramSession, BASE, db } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
const DOC = "cmu45uyxc004k5k9m0bq4vwux";
async function main() {
  const s = await openTelegramSession({ role: "headA", width: 360, height: 640 });
  const p = s.page;
  const net: string[] = [];
  p.on("dialog", async (d) => { console.log("NATIVE DIALOG:", d.type(), d.message()); await d.accept(); });
  p.on("response", (r) => { if (r.request().method() !== "GET" && !/_next|auth\/session/.test(r.url())) net.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  const before = await db.journalDocumentEntry.groupBy({ by: ["verificationStatus"], where: { documentId: DOC }, _count: true });
  console.log("BEFORE DB:", JSON.stringify(before));
  await p.goto(`${BASE}/journals/hygiene/documents/${DOC}/verify`, { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(6000);
  await p.evaluate(`(function(){var b=[].slice.call(document.querySelectorAll("button")).find(function(x){return x.innerText.indexOf("Принять весь журнал")>=0}); b.scrollIntoView({block:"center"}); b.click();})()`);
  await p.waitForTimeout(2500);
  const dlg = await p.evaluate(`(function(){var d=document.querySelector("[role=dialog]");return d?d.innerText.replace(/\s+/g," "):"нет"})()`);
  console.log("DIALOG:", dlg);
  await p.screenshot({ path: SHOTS + "/docverify-confirm.png", fullPage: false });
  await p.evaluate(`(function(){var d=document.querySelector("[role=dialog]"); if(!d) return; var bs=[].slice.call(d.querySelectorAll("button")).filter(function(x){return x.innerText.indexOf("Отмена")<0 && x.innerText.trim()}); var b=bs[bs.length-1]; if(b) b.click();})()`);
  await p.waitForTimeout(10000);
  console.log("NET:", JSON.stringify(net));
  console.log("TOAST:", await p.evaluate(`(function(){var l=document.querySelector("[data-sonner-toaster]");return l?l.innerText.replace(/\s+/g," "):"нет"})()`));
  await p.screenshot({ path: SHOTS + "/docverify-after.png", fullPage: false });
  const after = await db.journalDocumentEntry.groupBy({ by: ["verificationStatus"], where: { documentId: DOC }, _count: true });
  console.log("AFTER DB:", JSON.stringify(after));
  console.log("ERRORS", JSON.stringify([...new Set(s.errors)].slice(0,5), null, 1));
  await s.close();
}
main().catch(e => { console.error(e); process.exit(1); });
