// CLS of a page on a phone (Pixel 7 emulation), the same method before and after the deploy.
// Usage: node cls-measure.cjs <url> [runs]
const { chromium, devices } = require("/home/user/HASSR-Online/node_modules/playwright");
(async () => {
  const url = process.argv[2] || "https://wesetup.ru/";
  const runs = Number(process.argv[3] || 2);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const results = [];
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext({ ...devices["Pixel 7"] });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__cls = 0;
      window.__shifts = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          window.__cls += e.value;
          window.__shifts.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), src: (e.sources || []).map((s) => (s.node && s.node.className ? String(s.node.className).slice(0, 60) : String(s.node && s.node.nodeName))) });
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(4000);
    const r = await page.evaluate(() => ({ cls: +window.__cls.toFixed(3), shifts: window.__shifts, challenge: !!document.querySelector("[data-registration-challenge] iframe") }));
    results.push(r);
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify({ url, device: "Pixel 7", measuredAt: new Date().toISOString(), runs: results }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
