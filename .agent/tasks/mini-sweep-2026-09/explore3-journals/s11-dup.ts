import { openTelegramSession, SHOT, out } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const res: any = {};
  for (const code of ["cleaning", "incoming_control", "incoming_raw_materials_control", "disinfectant_usage", "general_cleaning", "cleaning_ventilation_checklist"]) {
    try {
      await s.page.goto(s.base + "/journals/" + code, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(5000);
      await s.page.locator('button:has-text("Создать документ"), a:has-text("Создать документ")').first().click({ timeout: 60000 });
      await s.page.waitForSelector('[role="dialog"]', { timeout: 60000 });
      await s.page.waitForTimeout(2000);
      const ti = s.page.locator('[role="dialog"] input[type="text"], [role="dialog"] input:not([type])').first();
      if (await ti.count()) await ti.fill("ZZ5 попытка " + code);
      await s.page.locator('[role="dialog"] button:has-text("Создать")').last().click({ timeout: 30000 });
      await s.page.waitForTimeout(2800);
      await s.page.screenshot({ path: SHOT + "/dup-" + code + ".png" });
      const r = await s.page.evaluate(`(function(){
        var d=document.querySelector('[role="dialog"]');
        return { dlg: !!d, dlgText: d? d.innerText.slice(0,900):'', toast: Array.from(document.querySelectorAll('[data-sonner-toast]')).map(function(e){return e.innerText.trim()}).join(' || '), titleVal: d? (d.querySelector('input') ? d.querySelector('input').value : '') : '' };
      })()`);
      res[code] = r;
      console.log("###", code, JSON.stringify(r).slice(0, 900));
    } catch (e) { console.log("###", code, "ERR", String(e).slice(0, 120)); }
  }
  out("dup.json", res);
  await s.close();
})();
