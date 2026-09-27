// Замеры шапки списка журнала и вкладок (getBoundingClientRect) + снимки.
// Запуск: node geometry.cjs <label>   (label: before | after)
// Пишет OUT/<label>/geometry.json и OUT/<label>/*.png.
const fs = require("node:fs");
const path = require("node:path");
const { OUT, launch, newContext, quietPage, gotoHydrated, sql, readCreds } = require("./lib.cjs");

const label = process.argv[2] || "before";
const dir = path.join(OUT, label);
fs.mkdirSync(dir, { recursive: true });

const PAGES = [
  { code: "cold_equipment_control", tag: "cold" },
  { code: "pest_control", tag: "pest" },
  { code: "hygiene", tag: "hygiene" },
];
const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "360", width: 360, height: 780 },
  { name: "430", width: 430, height: 932 },
  { name: "1280", width: 1280, height: 800 },
];

const { measureInPage } = require("./measure.cjs");

(async () => {
  const creds = readCreds();
  const results = { label, at: new Date().toISOString(), pageErrors: [], pages: {} };
  const browser = await launch();
  try {
    for (const theme of ["light", "dark"]) {
      await sql(`update "User" set "themePreference" = $1 where id = $2`, [theme, creds.managerId]);
      for (const vp of VIEWPORTS) {
        // Тёмная тема — только снимки 390 и 1280 холодильников.
        if (theme === "dark" && !["390", "1280"].includes(vp.name)) continue;
        const ctx = await newContext(browser, { width: vp.width, height: vp.height }, "manager");
        const page = await quietPage(ctx, results);
        for (const p of PAGES) {
          if (theme === "dark" && p.tag !== "cold") continue;
          await gotoHydrated(page, `/journals/${p.code}`, "[data-journal-list-actions]");
          const m = await page.evaluate(measureInPage);
          results.pages[`${p.tag}-${vp.name}-${theme}`] = m;
          console.log(p.tag, vp.name, theme, JSON.stringify(m.gaps), m.layout, "line:", JSON.stringify(m.line));
          if (["390", "1280"].includes(vp.name) || (theme === "light" && p.tag === "cold")) {
            // Снимок шапки: от верха страницы до первой карточки (+ немного).
            const bottom = Math.min((m.cardTop ?? vp.height) + 90, vp.height * 1.6);
            await page.screenshot({
              path: path.join(dir, `${p.tag}-${vp.name}-${theme}.png`),
              clip: { x: 0, y: 0, width: vp.width, height: Math.round(bottom) },
            });
          }
        }
        await ctx.close();
      }
    }
  } finally {
    await sql(`update "User" set "themePreference" = 'light' where id = $1`, [creds.managerId]).catch(() => {});
    await browser.close();
  }
  fs.writeFileSync(path.join(dir, "geometry.json"), JSON.stringify(results, null, 2));
  console.log("pageErrors:", results.pageErrors.length);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
