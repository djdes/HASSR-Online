// Клиентская навигация: журнал → документ → другой документ (меню крошки) → «Назад»,
// затем журнал холодильников → его документ. Телефон 390×844 (touch, вид «Таблица») и
// компьютер 1280×800. Перед каждым переходом страница и таблица специально
// сдвинуты (окно вниз, рамка таблицы вбок) — проверяем, что новый экран открывается
// сверху слева, а не наследует прокрутку.
//   node D:/wt-build/tmp-docscroll/e2e/nav.cjs before|after
const fs = require("node:fs");
const path = require("node:path");
const { OUT, PHONE, DESKTOP, launch, readCreds, newContext, quietPage, gotoHydrated, waitHydrated } = require("./lib.cjs");
const { measurePage } = require("./measure-lib.cjs");

const LABEL = process.argv[2] || "before";

function verdict(m) {
  const problems = [];
  if (m.scrollX !== 0) problems.push(`scrollX=${m.scrollX}`);
  if (m.scrollY !== 0) problems.push(`scrollY=${m.scrollY}`);
  if (m.docScrollWidth > m.vw + 1) problems.push(`page scrollWidth=${m.docScrollWidth}`);
  if (m.pan && /(auto|scroll)/.test(m.pan.overflowX) && m.pan.scrollWidth > m.pan.clientWidth + 1)
    problems.push(`whole sheet pans (${m.pan.scrollWidth}px)`);
  if (m.maxScrollLeft > 0) problems.push(`table scrollLeft=${m.maxScrollLeft}`);
  if (m.h1 && m.h1.left < 0) problems.push(`H1 cut left (${m.h1.left})`);
  if (m.headerAdd && m.headerAdd.left < 0) problems.push(`add button cut left (${m.headerAdd.left})`);
  return problems;
}

/** Сдвинуть всё, что можно: окно вниз, каждый горизонтальный скроллер — вбок. */
async function disturb(page) {
  await page.waitForLoadState("load").catch(() => {});
  const run = () => page.evaluate(() => {
    window.scrollTo(0, 900);
    let moved = 0;
    for (const el of document.querySelectorAll("main *")) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
        el.scrollLeft = 300;
        moved += 1;
      }
    }
    return { scrollY: window.scrollY, moved };
  });
  try {
    return await run();
  } catch {
    // Страница ещё переходила (dev-сервер дособирал чанк) — повторяем один раз.
    await page.waitForTimeout(2000);
    return run();
  }
}

async function waitDoc(page, docId) {
  await page.waitForURL((url) => url.pathname.endsWith(`/documents/${docId}`), { timeout: 240000 });
  await waitHydrated(page, "main h1");
  await page.waitForTimeout(3500);
}

async function openDocCrumbAndPick(page, phone, titleRe) {
  const crumbs = page.locator('nav[aria-label="Хлебные крошки"]');
  const last = crumbs.locator("button").last();
  await last.click();
  if (phone) {
    await page.getByRole("dialog").getByRole("button", { name: titleRe }).first().click();
  } else {
    await page.getByRole("menuitem", { name: titleRe }).first().click();
  }
}

(async () => {
  const creds = readCreds();
  const climate = creds.documents.find((d) => d.code === "climate_control" && d.status === "active");
  const climateAug = creds.documents.find((d) => d.code === "climate_control" && d.status === "closed");
  const cold = creds.documents.find((d) => d.code === "cold_equipment_control");
  const results = { label: LABEL, at: new Date().toISOString(), pageErrors: [], steps: [] };
  const browser = await launch();
  try {
    for (const [key, viewport] of [["phoneTable", PHONE], ["desktop", DESKTOP]]) {
      const phone = key !== "desktop";
      const ctx = await newContext(browser, viewport);
      const page = await quietPage(ctx, results);
      await page.addInitScript(() => {
        try {
          for (const c of ["climate_control", "cold_equipment_control"]) localStorage.setItem(`journal-mobile-view:${c}`, "table");
        } catch {}
      });
      const step = async (name, extra = {}) => {
        const m = await measurePage(page);
        const row = { mode: key, step: name, ...extra, url: m.url, scrollX: m.scrollX, scrollY: m.scrollY, maxScrollLeft: m.maxScrollLeft, docScrollWidth: m.docScrollWidth, pan: m.pan, h1: m.h1, headerAdd: m.headerAdd, scrollers: m.scrollers.map((s) => ({ el: s.el.slice(0, 60), scrollLeft: s.scrollLeft, scrollWidth: s.scrollWidth, clientWidth: s.clientWidth })) };
        row.problems = name.startsWith("back") ? [] : verdict(m);
        results.steps.push(row);
        console.log(`${key.padEnd(10)} ${name.padEnd(34)} y=${m.scrollY} x=${m.scrollX} sl=${m.maxScrollLeft} ${row.problems.length ? "✗ " + row.problems.join("; ") : "✓"}`);
        return m;
      };
      try {
        // 1. Журнал → документ (ссылка карточки, клиентская навигация).
        await gotoHydrated(page, "/journals/climate_control", "main h1");
        await page.waitForTimeout(1000);
        await page.evaluate(() => window.scrollTo(0, 300));
        await page.locator(`main a[href="/journals/climate_control/documents/${climate.id}"]`).first().click();
        await waitDoc(page, climate.id);
        await step("journal → document");
        await page.screenshot({ path: path.join(OUT, "shots", LABEL, `nav-${key}-1-doc.png`) });

        // 2. Документ → другой документ (меню крошки документа), после сдвига.
        const d1 = await disturb(page);
        await openDocCrumbAndPick(page, phone, /август 2026/);
        await waitDoc(page, climateAug.id);
        await step("document → other document", { disturbedBefore: d1 });
        await page.screenshot({ path: path.join(OUT, "shots", LABEL, `nav-${key}-2-other-doc.png`) });

        // 3. «Назад» — стандартное поведение браузера, только фиксируем.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.goBack();
        await waitDoc(page, climate.id);
        await step("back → document");

        // 4. Прямая загрузка журнала холодильников → его документ (клиентская навигация).
        await disturb(page);
        await gotoHydrated(page, "/journals/cold_equipment_control", "main h1");
        await page.waitForTimeout(1000);
        await step("direct → journal page");
        await page.evaluate(() => window.scrollTo(0, 300));
        await page.locator(`main a[href="/journals/cold_equipment_control/documents/${cold.id}"]`).first().click();
        await waitDoc(page, cold.id);
        await step("journal → document (cold)");
      } catch (err) {
        results.steps.push({ mode: key, error: String(err && err.message).slice(0, 400) });
        console.log(key, "ERROR", String(err && err.message).slice(0, 400));
        await page.screenshot({ path: path.join(OUT, "shots", LABEL, `nav-${key}-error.png`) }).catch(() => {});
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    fs.mkdirSync(path.join(OUT, "raw"), { recursive: true });
    fs.writeFileSync(path.join(OUT, "raw", `nav-${LABEL}.json`), JSON.stringify(results, null, 2));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
