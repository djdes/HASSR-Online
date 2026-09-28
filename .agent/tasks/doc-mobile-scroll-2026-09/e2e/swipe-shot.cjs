// Снимок после сдвига таблицы вбок (телефон, вид «Таблица»): шапка и ряд «Добавить»
// должны остаться на месте, подпись строки сетки — закреплена у края экрана.
//   node D:/wt-build/tmp-docscroll/e2e/swipe-shot.cjs cold_equipment_control after
const path = require("node:path");
const fs = require("node:fs");
const { OUT, PHONE, launch, readCreds, newContext, quietPage, gotoHydrated } = require("./lib.cjs");

(async () => {
  const code = process.argv[2] || "cold_equipment_control";
  const label = process.argv[3] || "after";
  const creds = readCreds();
  const doc = creds.documents.find((d) => d.code === code && d.status === "active");
  const browser = await launch();
  try {
    const ctx = await newContext(browser, PHONE);
    const page = await quietPage(ctx);
    await page.addInitScript((c) => {
      try {
        localStorage.setItem(`journal-mobile-view:${c}`, "table");
      } catch {}
    }, code);
    await gotoHydrated(page, `/journals/${code}/documents/${doc.id}`, "main h1");
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => {
      const frames = [...document.querySelectorAll("main *")].filter((el) => {
        const cs = getComputedStyle(el);
        return /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.querySelector("table");
      });
      // Самая широкая рамка — сетка.
      const grid = frames.sort((a, b) => b.scrollWidth - a.scrollWidth)[0];
      grid.scrollLeft = 500;
      const top = grid.getBoundingClientRect().top + window.scrollY - 260;
      window.scrollTo(0, Math.max(0, top));
      const rect = (el) => (el ? (({ left, right, top: t }) => ({ left: Math.round(left), right: Math.round(right), top: Math.round(t) }))(el.getBoundingClientRect()) : null);
      const add = [...document.querySelectorAll("main button")].find((b) => /^\+?\s*Добавить/.test((b.textContent || "").trim()) && !b.closest("table") && b.getBoundingClientRect().width > 0);
      const label = grid.querySelector("td[data-grid-label]");
      const check = grid.querySelector("td[data-grid-check]");
      return { gridScrollLeft: grid.scrollLeft, frames: frames.length, add: rect(add), label: rect(label), check: rect(check), h1: rect(document.querySelector("main h1")) };
    });
    await page.waitForTimeout(400);
    console.log(code, JSON.stringify(info));
    const dir = path.join(OUT, "shots", label);
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${code}-phoneTable-swiped.png`) });
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
