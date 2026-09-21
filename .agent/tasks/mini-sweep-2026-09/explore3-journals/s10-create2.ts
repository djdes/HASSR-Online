import { openTelegramSession, SHOT, out, db, state } from "./lib";
import { CODES } from "./codes";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const net: any[] = [];
  s.page.on("response", async (r) => { if (r.request().method() === "POST" && /journal-documents/.test(r.url())) { let t = ""; try { t = (await r.text()).slice(0, 300); } catch {} net.push({ s: r.status(), t }); } });
  const res: any = {};
  for (const code of CODES) {
    const r: any = { code, rounds: [] };
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        net.length = 0;
        await s.page.goto(s.base + "/journals/" + code, { timeout: 300000, waitUntil: "domcontentloaded" });
        await s.page.waitForTimeout(3000);
        await s.page.locator('button:has-text("Создать документ"), a:has-text("Создать документ")').first().click({ timeout: 20000 });
        await s.page.waitForSelector('[role="dialog"]', { timeout: 40000 });
        await s.page.waitForTimeout(1800);
        const ti = s.page.locator('[role="dialog"] input[type="text"], [role="dialog"] input:not([type])').first();
        if (await ti.count()) await ti.fill("ZZ5 " + code);
        if (attempt === 1) {
          // push all dates to 2027 to dodge overlap
          await s.page.evaluate(`(function(){
            var d=document.querySelector('[role="dialog"]');
            d.querySelectorAll('input[type=date]').forEach(function(e,i){ var st=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; st.call(e, i===0?'2027-03-01':'2027-03-31'); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); });
            d.querySelectorAll('input[type=text],input:not([type])').forEach(function(e){ if(/^\d{2}\.\d{2}\.\d{4}$/.test(e.value)){ var st=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; st.call(e, e.value.slice(0,6)+'2027'); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); } });
          })()`);
          await s.page.waitForTimeout(800);
        }
        const create = s.page.locator('[role="dialog"] button:has-text("Создать")').last();
        await create.scrollIntoViewIfNeeded().catch(() => null);
        await create.click({ timeout: 20000 });
        await s.page.waitForTimeout(3500);
        // force button if appeared
        const force = s.page.locator('[role="dialog"] button:has-text("Всё равно создать")');
        let forced = false;
        if (await force.count()) { await force.first().click(); await s.page.waitForTimeout(3500); forced = true; }
        const toast = await s.page.evaluate(`Array.from(document.querySelectorAll('[data-sonner-toast],[role="status"],[role="alert"]')).map(function(e){return e.innerText.trim().slice(0,150)}).join(' || ')`);
        const dlg = await s.page.evaluate(`!!document.querySelector('[role="dialog"]')`);
        r.rounds.push({ attempt, net: JSON.parse(JSON.stringify(net)), forced, toast, dlg, url: s.page.url().replace(s.base, "") });
        const made = await db.journalDocument.findFirst({ where: { organizationId: state.orgA, title: { startsWith: "ZZ5" }, template: { code } }, select: { id: true, title: true, dateFrom: true, dateTo: true } });
        if (made) { r.doc = { id: made.id, title: made.title, from: made.dateFrom.toISOString().slice(0, 10), to: made.dateTo.toISOString().slice(0, 10) }; break; }
      }
      console.log(code, r.doc ? "OK " + r.doc.id + " " + r.doc.from + ".." + r.doc.to : "FAIL " + JSON.stringify(r.rounds.map((x: any) => [x.net.map((n: any) => n.s), x.dlg, x.toast.slice(0, 60)])));
    } catch (e) { r.err = String(e).slice(0, 200); console.log(code, "ERR", r.err.replace(/\n/g, " ").slice(0, 150)); }
    res[code] = r;
  }
  out("created2.json", res);
  await s.close();
})();
