import { openTelegramSession, SHOT, out, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const LONG = "ZZ5 " + "Очень длинное описание жалобы ".repeat(9);
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const id = ZZ["complaint_register"][0].id;
  await s.page.goto(`${s.base}/journals/complaint_register/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(5000);
  await s.page.locator('button:has-text("Добавить")').first().click({ timeout: 20000 });
  await s.page.waitForSelector('[role="dialog"]', { timeout: 30000 });
  await s.page.waitForTimeout(1500);
  const d = s.page.locator('[role="dialog"]');
  // fill by label
  const setByLabel = async (label: string, val: string) => {
    const el = d.locator(`label:has-text("${label}")`).first();
    const forId = await el.getAttribute("for");
    if (forId) { await s.page.locator(`#${CSS_ESC(forId)}`).fill(val); return "by-for"; }
    return "no-for";
  };
  const CSS_ESC = (x: string) => x.replace(/([:.\[\]#])/g, "\$1");
  const dump = async () => await s.page.evaluate(`(function(){var d=document.querySelector('[role="dialog"]');return Array.from(d.querySelectorAll('input,textarea')).map(function(e){return (e.id||'')+'|'+(e.type||e.tagName)+'|'+e.value})})()`);
  console.log("before:", await dump());
  // fill sequentially via DOM
  await s.page.evaluate(`(function(){
    var d=document.querySelector('[role="dialog"]');
    var set=function(e,v){var p=e.tagName==='TEXTAREA'?window.HTMLTextAreaElement:window.HTMLInputElement;var st=Object.getOwnPropertyDescriptor(p.prototype,'value').set;st.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
    var ins=d.querySelectorAll('input,textarea');
    var L=${JSON.stringify(LONG)};
    ins.forEach(function(e,i){
      if(e.type==='date'){ set(e, i===0? '2026-09-21' : '2027-12-31'); }
      else if(e.tagName==='TEXTAREA'){ set(e, i===3? L : '<script>alert(1)</script> «кавычки» & <b>жирный</b>'); }
      else { set(e, 'ЗЗ5 Иванов И.И. "Тест" <script>'); }
    });
  })()`);
  await s.page.waitForTimeout(800);
  console.log("after fill:", await dump());
  await s.page.screenshot({ path: SHOT + "/cmp-filled.png" });
  await s.page.locator('[role="dialog"] button:has-text("Добавить")').last().click();
  await s.page.waitForTimeout(3500);
  console.log("dialog after save:", await s.page.evaluate(`!!document.querySelector('[role="dialog"]')`));
  await s.page.reload({ timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(5000);
  await s.page.screenshot({ path: SHOT + "/cmp-cards.png", fullPage: true });
  const cards = await s.page.evaluate(`document.body.innerText.slice(0,2500)`);
  console.log("CARDS TEXT:", cards);
  const doc = await db.journalDocument.findUnique({ where: { id }, select: { config: true } });
  out("cmp-config.json", doc?.config);
  console.log("DB config:", JSON.stringify(doc?.config).slice(0, 1500));
  const entries = await db.journalDocumentEntry.findMany({ where: { documentId: id } });
  console.log("entries:", entries.length, JSON.stringify(entries).slice(0, 500));
  await s.close();
})();
