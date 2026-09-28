// Регрессия оболочки мини-приложения (кука ws-shell=mini): та же страница документа
// внутри приложения — таблицы прокручиваются в своих рамках, страница вбок не едет.
//   node D:/wt-build/tmp-docscroll/e2e/mini.cjs before|after
const fs = require("node:fs");
const path = require("node:path");
const { BASE, OUT, PHONE, launch, readCreds, newContext, quietPage, gotoHydrated } = require("./lib.cjs");
const { measurePage } = require("./measure-lib.cjs");

const LABEL = process.argv[2] || "after";
const CODES = ["climate_control", "cold_equipment_control", "hygiene", "pest_control", "cleaning"];

(async () => {
  const creds = readCreds();
  const results = { label: LABEL, pageErrors: [], rows: [] };
  const browser = await launch();
  try {
    const ctx = await newContext(browser, PHONE);
    const host = new URL(BASE).hostname;
    await ctx.addCookies([{ name: "ws-shell", value: "mini", domain: host, path: "/" }]);
    const page = await quietPage(ctx, results);
    await page.addInitScript((codes) => {
      try {
        for (const c of codes) localStorage.setItem(`journal-mobile-view:${c}`, "table");
      } catch {}
    }, CODES);
    for (const code of CODES) {
      const doc = creds.documents.find((d) => d.code === code && d.status === "active");
      try {
        await gotoHydrated(page, `/journals/${code}/documents/${doc.id}`, "main h1");
        await page.waitForTimeout(3500);
        const m = await measurePage(page);
        const miniRoot = await page.evaluate(() => Boolean(document.querySelector(".mini-root")));
        const row = {
          code,
          miniRoot,
          scrollX: m.scrollX,
          scrollY: m.scrollY,
          docScrollWidth: m.docScrollWidth,
          maxScrollLeft: m.maxScrollLeft,
          pan: m.pan,
          h1: m.h1,
          outside: m.outside,
          frames: m.scrollers.map((s) => ({ el: s.el.slice(0, 70), left: s.left, right: s.right, sw: s.scrollWidth, cw: s.clientWidth })),
        };
        results.rows.push(row);
        console.log(code.padEnd(26), `mini=${miniRoot} y=${m.scrollY} docW=${m.docScrollWidth} sl=${m.maxScrollLeft} frames=${m.scrollers.length} outside=${m.outside ? m.outside.el.slice(0, 50) + " " + m.outside.over : "-"}`);
        if (code === "climate_control" || code === "pest_control") {
          await page.screenshot({ path: path.join(OUT, "shots", LABEL, `mini-${code}.png`) });
        }
      } catch (err) {
        results.rows.push({ code, error: String(err && err.message).slice(0, 300) });
        console.log(code, "ERROR", String(err && err.message).slice(0, 300));
      }
    }
  } finally {
    await browser.close();
    fs.mkdirSync(path.join(OUT, "raw"), { recursive: true });
    fs.writeFileSync(path.join(OUT, "raw", `mini-${LABEL}.json`), JSON.stringify(results, null, 2));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
