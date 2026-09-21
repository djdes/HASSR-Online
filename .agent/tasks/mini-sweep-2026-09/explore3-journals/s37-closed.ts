import { openTelegramSession, SHOT, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const id = ZZ["accident_journal"][0].id;
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  await s.page.goto(`${s.base}/journals/accident_journal/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(6000);
  await s.page.locator('button[aria-label="Ещё действия"]').first().click();
  await s.page.waitForTimeout(2000);
  await s.page.locator(':text("Закончить журнал")').first().click();
  await s.page.waitForTimeout(2000);
  await s.page.locator('[role="alertdialog"] button:has-text("Закончить журнал"), [role="dialog"] button:has-text("Закончить журнал")').last().click();
  await s.page.waitForTimeout(4000);
  const d1 = await db.journalDocument.findUnique({ where: { id }, select: { status: true } });
  console.log("status after close:", d1?.status, "url:", s.page.url());
  await s.page.goto(`${s.base}/journals/accident_journal/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(6000);
  await s.page.screenshot({ path: SHOT + "/closed-doc.png", fullPage: true });
  const ui = await s.page.evaluate(`(function(){return {body:document.body.innerText.slice(0,900), btns: Array.from(document.querySelectorAll('button')).map(function(e){return (e.textContent||'').trim()}).filter(Boolean).slice(0,25)}})()`);
  console.log("BODY:", String((ui as any).body).replace(/\n/g, " | "));
  console.log("BTNS:", (ui as any).btns.join(" / "));
  // API edits after close
  const api = await s.page.evaluate(`(async function(){
    var out={};
    var r1=await fetch('/api/journal-documents/${id}',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{rows:[{id:'x',locationName:'ZZ5 ПОСЛЕ ЗАКРЫТИЯ'}]}})});
    out.patch=r1.status+' '+(await r1.text()).slice(0,180);
    var r2=await fetch('/api/journal-documents/${id}/entries',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({employeeId:'x',date:'2027-04-02',data:{}})});
    out.entry=r2.status+' '+(await r2.text()).slice(0,180);
    return out;
  })()`);
  console.log("API after close:", JSON.stringify(api));
  const d2 = await db.journalDocument.findUnique({ where: { id }, select: { status: true, config: true } });
  console.log("status now:", d2?.status, "rows:", JSON.stringify((d2?.config as any)?.rows || []).slice(0, 300));
  await s.close();
})();
