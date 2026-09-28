// Шапка документа климата: описание журнала + «Добавить строку».
// Где помещается (≥640px) — в одну строку: описание слева, кнопка справа.
// На узком телефоне — кнопка под описанием во всю ширину. Плюс: шапка по ширине
// экрана и от левого края, при сдвиге таблицы вбок остаётся на месте.
//   node D:/wt-build/tmp-docscroll/e2e/header.cjs after
const fs = require("node:fs");
const path = require("node:path");
const { OUT, launch, readCreds, newContext, quietPage, gotoHydrated } = require("./lib.cjs");

const LABEL = process.argv[2] || "after";
const VIEWPORTS = [
  { key: "360", viewport: { width: 360, height: 780 } },
  { key: "390", viewport: { width: 390, height: 844 } },
  { key: "640", viewport: { width: 640, height: 900 } },
  { key: "768", viewport: { width: 768, height: 1024 } },
  { key: "1280", viewport: { width: 1280, height: 800 } },
];

(async () => {
  const creds = readCreds();
  const climate = creds.documents.find((d) => d.code === "climate_control" && d.status === "active");
  const results = { label: LABEL, pageErrors: [], rows: [] };
  const browser = await launch();
  try {
    for (const { key, viewport } of VIEWPORTS) {
      for (const view of ["table", "cards"]) {
        if (viewport.width >= 640 && view === "cards") continue;
        const ctx = await newContext(browser, viewport);
        const page = await quietPage(ctx, results);
        await page.addInitScript((v) => {
          try {
            localStorage.setItem("journal-mobile-view:climate_control", v);
          } catch {}
        }, view);
        await gotoHydrated(page, `/journals/climate_control/documents/${climate.id}`, "main h1");
        await page.waitForTimeout(3000);
        const row = await page.evaluate(() => {
          const r = (el) => {
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width) };
          };
          const bar = document.querySelector("[data-doc-toolbar-row]");
          const desc = bar ? bar.querySelector("p") : null;
          const btn = bar ? [...bar.querySelectorAll("button")].find((b) => /Добавить строку/.test(b.textContent || "")) : null;
          return { vw: window.innerWidth, docW: document.documentElement.scrollWidth, bar: r(bar), desc: r(desc), btn: r(btn), h1: r(document.querySelector("main h1")) };
        });
        const problems = [];
        if (!row.bar || !row.desc || !row.btn) problems.push("row/description/button not found");
        else {
          if (row.desc.left < 0 || row.btn.left < 0 || row.btn.right > row.vw + 0.5) problems.push("row cut by the screen edge");
          if (viewport.width >= 640) {
            const sameLine = row.btn.top < row.desc.bottom && row.desc.top < row.btn.bottom;
            if (!sameLine) problems.push("description and button are not in one line");
            if (!(row.desc.right <= row.btn.left)) problems.push("button is not to the right of the description");
          } else {
            if (!(row.btn.top >= row.desc.bottom)) problems.push("button is not under the description");
            if (row.btn.width < row.vw - 32 - 1) problems.push(`button is not full width (${row.btn.width})`);
          }
        }
        if (row.docW > row.vw + 1) problems.push(`page wider than screen (${row.docW})`);
        results.rows.push({ viewport: key, view, ...row, problems });
        console.log(`${key.padEnd(5)} ${view.padEnd(6)} desc=${JSON.stringify(row.desc)} btn=${JSON.stringify(row.btn)} ${problems.length ? "✗ " + problems.join("; ") : "✓"}`);
        if (key === "390" || key === "1280" || key === "768") {
          const bar = page.locator("[data-doc-toolbar-row]");
          if (await bar.count()) {
            await bar.first().scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(OUT, "shots", LABEL, `header-${key}-${view}.png`) });
          }
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    fs.mkdirSync(path.join(OUT, "raw"), { recursive: true });
    fs.writeFileSync(path.join(OUT, "raw", `header-${LABEL}.json`), JSON.stringify(results, null, 2));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
