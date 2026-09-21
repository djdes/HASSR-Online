import { openTelegramSession, SHOT, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const id = ZZ["accident_journal"][0].id;
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const rows = async () => { const d = await db.journalDocument.findUnique({ where: { id }, select: { config: true } }); return ((d?.config as any)?.rows || []).length; };
  console.log("rows before:", await rows());
  await s.page.goto(`${s.base}/journals/accident_journal/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(6000);
  await s.page.locator('button:has-text("Добавить")').first().click({ timeout: 20000 });
  await s.page.waitForSelector('[role="dialog"]', { timeout: 30000 });
  await s.page.waitForTimeout(1500);
  await s.page.evaluate(`(function(){
    var d=document.querySelector('[role="dialog"]');
    var set=function(e,v){var p=e.tagName==='TEXTAREA'?window.HTMLTextAreaElement:window.HTMLInputElement;var st=Object.getOwnPropertyDescriptor(p.prototype,'value').set;st.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
    d.querySelectorAll('input,textarea').forEach(function(e){ if(e.type==='date') set(e,'2027-04-02'); else if(e.type==='time') set(e,'13:45'); else set(e,'ZZ5 авария проверка'); });
  })()`);
  await s.page.waitForTimeout(600);
  const btn = s.page.locator('[role="dialog"] button:has-text("Добавить")').last();
  const box = await btn.boundingBox();
  console.log("submit box:", JSON.stringify(box));
  // double tap fast
  await btn.click({ timeout: 20000 });
  await btn.click({ timeout: 3000 }).catch((e) => console.log("2nd click:", String(e).slice(0, 60)));
  await s.page.waitForTimeout(4000);
  console.log("rows after double tap:", await rows());
  const d = await db.journalDocument.findUnique({ where: { id }, select: { config: true } });
  console.log("rows:", JSON.stringify((d?.config as any)?.rows || []).slice(0, 700));
  await s.page.reload({ timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(6000);
  await s.page.screenshot({ path: SHOT + "/acc-cards.png", fullPage: true });
  console.log("body:", (await s.page.evaluate(`document.body.innerText.slice(0,900)`) as string).replace(/\n/g, " | "));
  await s.close();
})();
