// Проба в WebKit (движок Safari, ближе к iPhone владельца): климат и холодильники в виде
// «Таблица», 390×844 с касаниями. После открытия — окно сверху, рамки таблиц с первой
// колонки, страница по ширине экрана; после сдвига таблицы шапка остаётся на месте.
//   node D:/wt-build/tmp-docscroll/e2e/webkit.cjs after
const fs = require("node:fs");
const path = require("node:path");
const { OUT, PHONE, launch, readCreds, loggedInState, quietPage, gotoHydrated } = require("./lib.cjs");
const { measurePage } = require("./measure-lib.cjs");

const LABEL = process.argv[2] || "after";

(async () => {
  const creds = readCreds();
  const results = { label: LABEL, engine: "webkit", pageErrors: [], rows: [] };
  const chromium = await launch();
  const state = await loggedInState(chromium);
  await chromium.close();
  const browser = await launch("webkit");
  try {
    const ctx = await browser.newContext({
      viewport: PHONE,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
      storageState: state,
    });
    const page = await quietPage(ctx, results);
    await page.addInitScript(() => {
      try {
        for (const c of ["climate_control", "cold_equipment_control", "pest_control"]) localStorage.setItem(`journal-mobile-view:${c}`, "table");
      } catch {}
    });
    for (const code of ["climate_control", "cold_equipment_control", "pest_control"]) {
      const doc = creds.documents.find((d) => d.code === code && d.status === "active");
      await gotoHydrated(page, `/journals/${code}/documents/${doc.id}`, "main h1");
      await page.waitForTimeout(3500);
      const m = await measurePage(page);
      const swipe = await page.evaluate(() => {
        const frames = [...document.querySelectorAll(".journal-table-scroll")].filter((f) => f.scrollWidth > f.clientWidth + 1);
        frames.forEach((f) => (f.scrollLeft = 400));
        const h1 = document.querySelector("main h1").getBoundingClientRect();
        const add = [...document.querySelectorAll("main button")].find((b) => /^\+?\s*Добавить/.test((b.textContent || "").trim()) && !b.closest("table") && b.getBoundingClientRect().width > 0);
        const addR = add ? add.getBoundingClientRect() : null;
        const out = { frames: frames.length, framesScrolled: frames.map((f) => Math.round(f.scrollLeft)), h1Left: Math.round(h1.left), addLeft: addR ? Math.round(addR.left) : null };
        frames.forEach((f) => (f.scrollLeft = 0));
        return out;
      });
      const row = { code, scrollX: m.scrollX, scrollY: m.scrollY, docScrollWidth: m.docScrollWidth, maxScrollLeft: m.maxScrollLeft, h1Left: m.h1 && m.h1.left, outside: m.outside, swipe };
      results.rows.push(row);
      console.log(code.padEnd(24), JSON.stringify(row));
      await page.screenshot({ path: path.join(OUT, "shots", LABEL, `webkit-${code}.png`) });
    }
  } finally {
    await browser.close();
    fs.mkdirSync(path.join(OUT, "raw"), { recursive: true });
    fs.writeFileSync(path.join(OUT, "raw", `webkit-${LABEL}.json`), JSON.stringify(results, null, 2));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
