// Замер «до/после» по всем документам и страницам журналов.
//   node D:/wt-build/tmp-docscroll/e2e/run.cjs before   → raw/before.json + shots/before/*
//   node D:/wt-build/tmp-docscroll/e2e/run.cjs after    → raw/after.json  + shots/after/*
// Для каждого документа: телефон 390×844 (touch) в виде по умолчанию и в виде
// «Таблица», компьютер 1280×800. Прямая загрузка, пауза 3.5 с (автопрокрутка
// «к сегодня» опрашивает DOM до 3 с), затем замер: прокрутка окна, переполнение
// страницы, все горизонтальные скроллеры внутри <main>, геометрия H1 и кнопки
// «Добавить…» в шапке. Страницы журналов /journals/<code> — телефон и компьютер.
const fs = require("node:fs");
const path = require("node:path");
const { OUT, PHONE, DESKTOP, launch, readCreds, newContext, quietPage, gotoHydrated } = require("./lib.cjs");
const { measurePage } = require("./measure-lib.cjs");

const LABEL = process.argv[2] || "before";
const ONLY = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const SHOT_CODES = new Set(["climate_control", "cold_equipment_control", "hygiene", "cleaning", "health_check"]);

function verdict(m) {
  const problems = [];
  if (m.scrollX !== 0) problems.push(`scrollX=${m.scrollX}`);
  if (m.scrollY !== 0) problems.push(`scrollY=${m.scrollY}`);
  if (m.docScrollWidth > m.vw + 1) problems.push(`page scrollWidth=${m.docScrollWidth}>${m.vw}`);
  if (m.pan && /(auto|scroll)/.test(m.pan.overflowX) && m.pan.scrollWidth > m.pan.clientWidth + 1)
    problems.push(`whole sheet pans (${m.pan.scrollWidth}px)`);
  if (m.maxScrollLeft > 0) problems.push(`table scrollLeft=${m.maxScrollLeft}`);
  if (m.h1 && m.h1.left < 0) problems.push(`H1 cut left (${m.h1.left})`);
  if (m.headerAdd && m.headerAdd.left < 0) problems.push(`add button cut left (${m.headerAdd.left})`);
  if (m.outside) problems.push(`sticks out: ${m.outside.el.slice(0, 60)} (${m.outside.over}px)`);
  return problems;
}

/** Сдвинуть каждую горизонтальную рамку на 400px, замерить H1 и «Добавить…», вернуть назад. */
async function swipeFrames(page) {
  return page.evaluate(() => {
    const frames = [];
    for (const el of document.querySelectorAll("main *")) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) frames.push(el);
    }
    const before = frames.map((f) => f.scrollLeft);
    frames.forEach((f) => (f.scrollLeft = 400));
    const main = document.querySelector("main");
    const h1 = main.querySelector("h1");
    const add = [...main.querySelectorAll("button, a")].find((b) => {
      const t = (b.textContent || "").trim();
      const r = b.getBoundingClientRect();
      return /^\+?\s*Добавить/.test(t) && r.width > 0 && r.height > 0 && !b.closest("table");
    });
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10 };
    };
    const out = { moved: frames.length, h1: rect(h1), add: rect(add) };
    frames.forEach((f, i) => (f.scrollLeft = before[i]));
    return out;
  });
}

(async () => {
  const creds = readCreds();
  const docs = creds.documents.filter((d) => d.status === "active" && (!ONLY || ONLY.has(d.code)));
  const codes = [...new Set(docs.map((d) => d.code))];
  const shotsDir = path.join(OUT, "shots", LABEL);
  fs.mkdirSync(shotsDir, { recursive: true });
  fs.mkdirSync(path.join(OUT, "raw"), { recursive: true });
  const results = { label: LABEL, at: new Date().toISOString(), pageErrors: [], documents: [], journals: [] };

  const browser = await launch();
  try {
    const modes = [
      { key: "phone", viewport: PHONE, view: null },
      { key: "phoneTable", viewport: PHONE, view: "table" },
      { key: "desktop", viewport: DESKTOP, view: null },
    ];
    await Promise.all(modes.map(async (mode) => {
      const ctx = await newContext(browser, mode.viewport);
      const page = await quietPage(ctx, results);
      if (mode.view) {
        await page.addInitScript(
          ([list, v]) => {
            try {
              for (const code of list) localStorage.setItem(`journal-mobile-view:${code}`, v);
            } catch {}
          },
          [codes, mode.view],
        );
      }
      for (const doc of docs) {
        const url = `/journals/${doc.code}/documents/${doc.id}`;
        let row = { code: doc.code, mode: mode.key };
        try {
          await gotoHydrated(page, url, "main h1");
          await page.waitForTimeout(3500);
          const m = await measurePage(page);
          row = { ...row, ...m, problems: verdict(m) };
          if (mode.key !== "desktop") {
            // Человек сдвинул таблицу вбок: шапка (H1, «Добавить…») должна остаться на месте.
            row.swipe = await swipeFrames(page);
            if (row.swipe.moved > 0) {
              if (row.swipe.h1 && Math.abs(row.swipe.h1.left - (m.h1 ? m.h1.left : 0)) > 1) row.problems.push(`H1 moves with table (${row.swipe.h1.left})`);
              if (row.swipe.add && row.swipe.add.left < 0) row.problems.push(`add button cut after swipe (${row.swipe.add.left})`);
            }
          }
          if (SHOT_CODES.has(doc.code) && mode.key !== "desktop") {
            await page.screenshot({ path: path.join(shotsDir, `${doc.code}-${mode.key}.png`) });
          }
          if (SHOT_CODES.has(doc.code) && mode.key === "desktop") {
            await page.screenshot({ path: path.join(shotsDir, `${doc.code}-desktop.png`) });
          }
        } catch (err) {
          row.error = String(err && err.message).slice(0, 300);
        }
        results.documents.push(row);
        console.log(
          `${mode.key.padEnd(10)} ${doc.code.padEnd(32)} y=${row.scrollY} x=${row.scrollX} sl=${row.maxScrollLeft} pan=${row.pan ? row.pan.scrollWidth : "-"} ` +
            `${row.error ? `ERROR ${row.error}` : row.problems.length ? "✗ " + row.problems.join("; ") : "✓"}`,
        );
      }
      await ctx.close();
    }));

    // Страницы журналов (список документов).
    await Promise.all([modes[0], modes[2]].map(async (mode) => {
      const ctx = await newContext(browser, mode.viewport);
      const page = await quietPage(ctx, results);
      for (const code of codes) {
        let row = { code, mode: mode.key };
        try {
          await gotoHydrated(page, `/journals/${code}`, "main h1");
          await page.waitForTimeout(800);
          const m = await measurePage(page);
          row = { ...row, ...m, problems: verdict(m) };
        } catch (err) {
          row.error = String(err && err.message).slice(0, 300);
        }
        results.journals.push(row);
        console.log(
          `journal ${mode.key.padEnd(8)} ${code.padEnd(32)} ${row.error ? `ERROR ${row.error}` : row.problems.length ? "✗ " + row.problems.join("; ") : "✓"}`,
        );
      }
      await ctx.close();
    }));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, "raw", `${LABEL}.json`), JSON.stringify(results, null, 2));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
