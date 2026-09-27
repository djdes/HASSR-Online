// Снимки «до» взамен закрытых окном «Инструкция» (pest 390, cold 360). Код «до» — через git stash.
const fs = require("node:fs");
const path = require("node:path");
const { OUT, launch, newContext, quietPage, gotoHydrated } = require("./lib.cjs");
const { measureInPage } = require("./measure.cjs");
(async () => {
  const dir = path.join(OUT, "before");
  const browser = await launch();
  try {
    for (const [code, tag, w, h] of [["pest_control", "pest", 390, 844], ["cold_equipment_control", "cold", 360, 780]]) {
      const ctx = await newContext(browser, { width: w, height: h }, "manager");
      const page = await quietPage(ctx);
      await gotoHydrated(page, `/journals/${code}`, "[data-journal-list-actions]");
      const m = await page.evaluate(measureInPage);
      if (!m.line) throw new Error("это не код «до»: нет полосы под вкладками");
      const dialogs = await page.locator('[role="dialog"]').count();
      const bottom = Math.min((m.cardTop ?? h) + 90, h * 1.6);
      await page.screenshot({ path: path.join(dir, `${tag}-${w}-light.png`), clip: { x: 0, y: 0, width: w, height: Math.round(bottom) } });
      console.log(tag, w, "gaps", JSON.stringify(m.gaps), "dialogs open:", dialogs);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
