import { openTelegramSession, SHOT, out, db } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
const LONG = "ZZ5 " + "Очень длинное описание жалобы ".repeat(9);
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const net: any[] = [];
  s.page.on("response", async (r) => { if (r.request().method() !== "GET" && !/_next|auth/.test(r.url())) { let t = ""; try { t = (await r.text()).slice(0, 250); } catch {} net.push({ m: r.request().method(), s: r.status(), u: r.url().replace(s.base, "").slice(0, 80), t }); } });
  const id = ZZ["complaint_register"][0].id;
  for (const dateVal of ["2027-03-05", "2026-09-21"]) {
    net.length = 0;
    await s.page.goto(`${s.base}/journals/complaint_register/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(5000);
    await s.page.locator('button:has-text("Добавить")').first().click({ timeout: 20000 });
    await s.page.waitForSelector('[role="dialog"]', { timeout: 30000 });
    await s.page.waitForTimeout(1500);
    await s.page.evaluate(`(function(){
      var d=document.querySelector('[role="dialog"]');
      var set=function(e,v){var p=e.tagName==='TEXTAREA'?window.HTMLTextAreaElement:window.HTMLInputElement;var st=Object.getOwnPropertyDescriptor(p.prototype,'value').set;st.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
      var ins=d.querySelectorAll('input,textarea'); var L=${JSON.stringify(LONG)};
      ins.forEach(function(e,i){ if(e.type==='date'){ set(e, i===0? ${JSON.stringify(dateVal)} : '2027-12-31'); } else if(e.tagName==='TEXTAREA'){ set(e, i===3? L : 'ZZ5 «кавычки» <b>тег</b> & <script>alert(1)</script>'); } else { set(e, 'ЗЗ5 Иванов И.И.'); } });
    })()`);
    await s.page.waitForTimeout(600);
    await s.page.locator('[role="dialog"] button:has-text("Добавить")').last().click();
    await s.page.waitForTimeout(4000);
    const st = await s.page.evaluate(`(function(){var d=document.querySelector('[role="dialog"]');return {dlg:!!d, dlgText: d?d.innerText.slice(0,700):'', toast: Array.from(document.querySelectorAll('[data-sonner-toast]')).map(function(e){return e.innerText.trim()}).join(' || ')}})()`);
    await s.page.screenshot({ path: SHOT + "/cmp2-" + dateVal + ".png" });
    const doc = await db.journalDocument.findUnique({ where: { id }, select: { config: true } });
    console.log("### date", dateVal, JSON.stringify(st).slice(0, 600));
    console.log("   net:", JSON.stringify(net).slice(0, 600));
    console.log("   rows:", JSON.stringify((doc?.config as any)?.rows || []).slice(0, 700));
    console.log("   pageerrors:", s.errors.slice(-3));
  }
  await s.close();
})();
