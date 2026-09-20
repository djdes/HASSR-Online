import { chromium } from "playwright";
const URL = "https://wesetup.ru/journal-fill/cmtk2aeje000ao9tsesj20d9z/finished_product?token=journal%3Acmtk2aeje000ao9tsesj20d9z%3Afinished_product%3Acmtk2afai00vro9tsbmh48e9n.1789885358234.PEMirZ9txw8Bu1sOfMt2LCiM-HtCR-TuNveJJPHRNqg";
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  for (const [name, cond] of [["no-throttle", null], ["fast-3g", { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 }], ["slow-4g", { offline: false, latency: 400, downloadThroughput: 400e3 / 8, uploadThroughput: 400e3 / 8 }]] as const) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    if (cond) { await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", cond as never); }
    let bytes = 0; page.on("response", async (r) => { try { bytes += (await r.body()).length; } catch {} });
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: "commit", timeout: 180_000 });
    await page.waitForSelector("text=Продолжить", { timeout: 180_000 }).catch(() => null);
    const tList = Date.now() - t0;
    const btn = page.locator("button[aria-pressed]").first();
    let tHydrated = -1;
    for (let i = 0; i < 900; i += 1) { await btn.click({ timeout: 3000 }).catch(() => null); if ((await btn.getAttribute("aria-pressed")) === "true") { tHydrated = Date.now() - t0; break; } await page.waitForTimeout(100); }
    await page.waitForLoadState("load").catch(() => null);
    console.log(`${name}: list=${tList}ms hydrated=${tHydrated}ms bytes=${Math.round(bytes / 1024)}KB`);
    await ctx.close();
  }
  await browser.close();
})();
