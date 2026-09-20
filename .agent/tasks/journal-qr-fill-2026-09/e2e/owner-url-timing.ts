import { chromium, webkit } from "playwright";
const URL = "https://wesetup.ru/journal-fill/cmtk2aeje000ao9tsesj20d9z/finished_product?token=journal%3Acmtk2aeje000ao9tsesj20d9z%3Afinished_product%3Acmtk2afai00vro9tsbmh48e9n.1789885358234.PEMirZ9txw8Bu1sOfMt2LCiM-HtCR-TuNveJJPHRNqg";
(async () => {
  for (const engine of ["chromium", "webkit"] as const) {
    const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ channel: "chrome" });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: engine === "chromium", hasTouch: true });
    const page = await ctx.newPage();
    const slow: string[] = [];
    const t0 = Date.now();
    page.on("requestfinished", async (r) => { const t = r.timing(); if (t.responseEnd > 800) slow.push(`${Math.round(t.responseEnd)}ms ${r.resourceType()} ${r.url().slice(0, 100)}`); });
    page.on("requestfailed", (r) => slow.push(`FAILED ${r.resourceType()} ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
    await page.goto(URL, { waitUntil: "commit", timeout: 120_000 });
    const tCommit = Date.now() - t0;
    await page.waitForSelector("text=Продолжить", { timeout: 120_000 }).catch(() => null);
    const tList = Date.now() - t0;
    await page.waitForLoadState("load").catch(() => null);
    const tLoad = Date.now() - t0;
    const paint = await page.evaluate(() => performance.getEntriesByType("paint").map((p) => `${p.name}=${Math.round(p.startTime)}`).join(" "));
    const blocking = await page.evaluate(() => Array.from(document.head.querySelectorAll('link[rel="stylesheet"], script:not([async]):not([defer]):not([type="module"])')).map((el) => (el as HTMLLinkElement).href || (el as HTMLScriptElement).src || "inline").slice(0, 10));
    console.log(engine, JSON.stringify({ tCommit, tList, tLoad, paint, blocking }));
    for (const s of slow) console.log("  slow:", s);
    await browser.close();
  }
})();
