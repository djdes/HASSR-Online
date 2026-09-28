// Воспроизведение: владелец A → /dashboard → «Оплатить подписку» → куда уходит страница.
const path = require("node:path");
const { BASE, OUT, launch, login, quietPage, gotoHydrated, readCreds } = require("./lib.cjs");

(async () => {
  const creds = readCreds();
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
    await login(ctx, creds.orgs.A.owner.email, creds.password);
    const page = await quietPage(ctx, "probe", { pageErrors: [] });
    const t0 = Date.now();
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log(`+${Date.now() - t0}ms nav`, f.url()); });
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console", m.type(), m.text().slice(0, 300)); });
    page.on("request", (r) => { if (r.isNavigationRequest() || r.url().includes("_rsc")) console.log(`+${Date.now() - t0}ms req`, r.method(), r.url().slice(0, 120)); });
    await gotoHydrated(page, "/dashboard", "header");
    await page.waitForSelector('[data-testid="billing-pay"]', { timeout: 120000 });
    console.log("click pay");
    await page.locator('[data-testid="billing-pay"]').click();
    for (let i = 0; i < 10; i += 1) {
      await page.waitForTimeout(6000);
      console.log(`t+${(i + 1) * 6}s url=${page.url()} card=${await page.locator('[data-testid="billing-decision-card"]').count()} modal=${await page.locator('[data-testid="billing-transition-modal"]').count()}`);
    }
    await page.screenshot({ path: path.join(OUT, "shots", "probe-pay.png") });
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
