/**
 * Прод после выкладки, браузер, БЕЗ входа и без отправки форм:
 *  - /login без куки — кегль как раньше; с кукой «Очень крупный» — ×1,3;
 *  - высокий контраст по куке — подписи темнее;
 *  - главная с «Без анимации» — нижняя секция видна без прокрутки.
 * Скриншоты — в папку argv[2].
 * Запуск: node .agent/tasks/ux-readability-2026-11/e2e/prod-browser-check.cjs <папка> [https://wesetup.ru]
 */
const { chromium, devices } = require("playwright");
const path = require("node:path");

const OUT = process.argv[2];
const BASE = process.argv[3] || "https://wesetup.ru";
const results = [];
const check = (name, ok, details) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${details !== undefined ? ` — ${JSON.stringify(details)}` : ""}`);
};

/** Кегль первого видимого элемента с классом `text-[14px]` / `text-[15px]` / `text-sm`. */
const sample = (page) =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll("body *")].find(
      (node) => /(^|\s)(text-\[14px\]|text-\[15px\]|text-sm)(\s|$)/.test(node.getAttribute("class") ?? "") && node.getClientRects().length > 0,
    );
    if (!el) return null;
    return { cls: (el.getAttribute("class") ?? "").match(/text-\[1[45]px\]|text-sm/)?.[0], size: getComputedStyle(el).fontSize };
  });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });
  try {
    for (const [label, cookie] of [["default", null], ["xlarge-hc", "t:xlarge|c:high|m:reduce|h:on"]]) {
      const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "ru-RU", userAgent: `${devices["Pixel 7"].userAgent} WeSetup-post-deploy-check/1.0` });
      if (cookie) await ctx.addCookies([{ name: "wesetup-view", value: cookie, url: BASE }]);
      const page = await ctx.newPage();
      page.setDefaultTimeout(60000);
      await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120000 });
      await page.waitForTimeout(1200);
      const attrs = await page.evaluate(() => Object.fromEntries([...document.documentElement.attributes].filter((a) => a.name.startsWith("data-view")).map((a) => [a.name, a.value])));
      const s = await sample(page);
      console.log(label, JSON.stringify({ attrs, sample: s }));
      results.push({ label, attrs, sample: s });
      await page.screenshot({ path: path.join(OUT, `prod-login-${label}.png`) });
      if (label === "default") {
        check("прод /login без куки: обычные атрибуты", attrs["data-view-text"] === "normal" && attrs["data-view-hints"] === "on", attrs);
        globalThis.__baseSize = s;
      } else {
        const base = parseFloat(globalThis.__baseSize?.size ?? "0");
        const now = parseFloat(s?.size ?? "0");
        check("прод /login «Очень крупный»: кегль ×1,3", attrs["data-view-text"] === "xlarge" && base > 0 && Math.abs(now - base * 1.3) < 0.05, { base: globalThis.__baseSize, now: s });
        check("прод: высокий контраст и без анимации по куке", "data-view-hc" in attrs && "data-view-still" in attrs, attrs);
      }
      await ctx.close();
    }

    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU", userAgent: "Mozilla/5.0 WeSetup-post-deploy-check/1.0" });
    await desk.addCookies([{ name: "wesetup-view", value: "t:large|c:auto|m:reduce|h:on", url: BASE }]);
    const g = await desk.newPage();
    g.setDefaultTimeout(60000);
    await g.goto(`${BASE}/`, { waitUntil: "load", timeout: 120000 });
    await g.waitForTimeout(1500);
    const landing = await g.evaluate(() => {
      const sections = [...document.querySelectorAll(".landing-page > section:not(.landing-hero)")];
      const last = sections[sections.length - 1];
      return { count: sections.length, lastOpacity: last ? getComputedStyle(last).opacity : null, lastFilter: last ? getComputedStyle(last).filter : null };
    });
    check("прод: главная без анимации — нижняя секция видна сразу", landing.count > 0 && landing.lastOpacity === "1" && landing.lastFilter === "none", landing);
    await g.screenshot({ path: path.join(OUT, "prod-home-large-still.png") });
    await desk.close();
  } finally {
    await browser.close();
    const failed = results.filter((r) => r.ok === false);
    console.log(`Итого: ${results.filter((r) => r.ok === true).length} PASS, ${failed.length} FAIL`);
    if (failed.length) process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
