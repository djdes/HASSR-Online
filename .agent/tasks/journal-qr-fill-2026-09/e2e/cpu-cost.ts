import { chromium } from "playwright";
const URL = "https://wesetup.ru/journal-fill/cmtk2aeje000ao9tsesj20d9z/finished_product?token=journal%3Acmtk2aeje000ao9tsesj20d9z%3Afinished_product%3Acmtk2afai00vro9tsbmh48e9n.1789885358234.PEMirZ9txw8Bu1sOfMt2LCiM-HtCR-TuNveJJPHRNqg";
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  for (const rate of [1, 6]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: "commit", timeout: 120_000 });
    await page.waitForFunction(() => (window as unknown as { __hydrated?: boolean }).__hydrated === true || document.querySelector('button[aria-pressed]') !== null, { timeout: 120_000 }).catch(() => null);
    const tPaint = await page.evaluate(() => Math.round(performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint")?.startTime ?? -1));
    // hydration: ждём, пока клик по сотруднику станет реактивным (aria-pressed меняется)
    const btn = page.locator("[aria-pressed]").first();
    let tHydrated = -1;
    for (let i = 0; i < 600; i += 1) {
      await btn.click({ timeout: 5000 }).catch(() => null);
      if ((await btn.getAttribute("aria-pressed")) === "true") { tHydrated = Date.now() - t0; break; }
      await page.waitForTimeout(100);
    }
    const m = await cdp.send("Performance.getMetrics");
    const get = (n: string) => Math.round(((m.metrics.find((x) => x.name === n)?.value ?? 0) as number) * 1000);
    console.log(`cpu x${rate}: fcp=${tPaint}ms hydrated=${tHydrated}ms script=${get("ScriptDuration")}ms task=${get("TaskDuration")}ms layout=${get("LayoutDuration")}ms jsHeap=${Math.round((m.metrics.find((x) => x.name === "JSHeapUsedSize")?.value ?? 0) / 1e6)}MB`);
    await ctx.close();
  }
  await browser.close();
})();
