/**
 * Сколько текста на главных экранах кабинета (до и после сокращения).
 * Телефон (Pixel 7) и компьютер 1440×900, управляющий демо-организации.
 * Метрики: слова в <main>, слова в <main> без списков журналов (названия
 * журналов — содержимое, не «вода»), верх первой строки журналов на
 * «Сегодня» (телефон), высота плашки пробного периода.
 * Запуск: node .agent/tasks/ux-readability-2026-11/e2e/text-metrics.cjs <manager.json> <out.json>
 */
const { chromium, devices } = require("playwright");
const { readFileSync, writeFileSync } = require("node:fs");

const BASE = process.env.E2E_BASE || "http://localhost:3022";
const M = JSON.parse(readFileSync(process.argv[2], "utf8"));
const OUT = process.argv[3];
const PAGES = ["/dashboard", "/journals", "/settings/organization", "/staff", "/settings/journals"];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });
  const result = {};
  try {
    for (const [label, opts] of [["phone", { ...devices["Pixel 7"] }], ["desktop", { viewport: { width: 1440, height: 900 } }]]) {
      const ctx = await browser.newContext({ ...opts, locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 200) + 20}` } });
      const page = await ctx.newPage();
      page.setDefaultTimeout(90000);
      await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240000 });
      await page.fill('input[type="email"], input[name="email"]', M.email);
      await page.fill('input[type="password"]', M.password);
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
      result[label] = {};
      for (const path of PAGES) {
        await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 240000 });
        await page.waitForTimeout(2500);
        const metrics = await page.evaluate(() => {
          const main = document.querySelector("main");
          const count = (text) => (text || "").split(/\s+/).filter(Boolean).length;
          const words = count(main?.innerText);
          let listWords = 0;
          for (const list of main?.querySelectorAll("[data-journal-list], [data-paper-list], [data-disabled-list]") ?? []) listWords += count(list.innerText);
          const firstRow = main?.querySelector("[data-journal-list] li");
          const banner = document.querySelector('[data-testid="billing-announcement"]');
          return {
            words,
            wordsWithoutJournalLists: words - listWords,
            firstJournalRowTop: firstRow ? Math.round(firstRow.getBoundingClientRect().top + window.scrollY) : null,
            trialBannerHeight: banner ? Math.round(banner.getBoundingClientRect().height) : null,
            trialBannerWords: banner ? count(banner.innerText) : null,
            scrollWidthOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        result[label][path] = { url: page.url().replace(BASE, ""), ...metrics };
        console.log(label, path, JSON.stringify(result[label][path]));
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  writeFileSync(OUT, JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
