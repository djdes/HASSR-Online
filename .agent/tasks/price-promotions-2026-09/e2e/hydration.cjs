// Проверка гидратации в период акции: консольные ошибки React («hydrat…», «did not match»)
// на всех витринах с зачёркнутой ценой. Акцию создаёт ROOT через API, в конце — удаляет.
// Запуск: node e2e/hydration.cjs  (после seed.cjs)
const fs = require("node:fs");
const path = require("node:path");
const { BASE, RAW, launch, login, newContext, open, readCreds } = require("./lib.cjs");

function mskInput(offsetMinutes = 0) {
  return new Date(Date.now() + 3 * 3600_000 + offsetMinutes * 60_000).toISOString().slice(0, 16);
}

(async () => {
  const creds = readCreds();
  const browser = await launch();
  const report = { pages: [], consoleErrors: [], pageErrors: [] };
  let promotionId = null;
  const rootCtx = await newContext(browser, { width: 1280, height: 900 });
  try {
    await login(rootCtx, creds.root, creds.password);
    // Конец в полночь по Москве — плашка «до D месяца» без времени.
    const endDay = mskInput(3 * 24 * 60).slice(0, 10);
    const created = await rootCtx.request.post(`${BASE}/api/root/promotions`, {
      data: { title: "Проверка гидратации", percent: 15, startsAt: mskInput(-5), endsAt: `${endDay}T00:00` },
    });
    promotionId = (await created.json()).promotion?.id ?? null;
    report.created = created.status();

    const targets = [
      { ctx: "anon", url: "/", sel: "#pricing" },
      { ctx: "anon", url: "/pricing", sel: "h1" },
      { ctx: "owner", url: "/settings/subscription", sel: "h1" },
      { ctx: "owner", url: "/order?plan=monthly", sel: "form button[type=submit]" },
      { ctx: "root", url: "/root/promotions", sel: "[data-testid=promotion-form] button" },
    ];
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const anon = await newContext(browser, viewport);
      const owner = await newContext(browser, viewport);
      await login(owner, creds.owner, creds.password);
      const root = await newContext(browser, viewport);
      await login(root, creds.root, creds.password);
      const contexts = { anon, owner, root };
      for (const target of targets) {
        const page = await contexts[target.ctx].newPage();
        const label = `${target.url} @${viewport.width}`;
        page.on("console", (msg) => {
          if (msg.type() === "error" && /hydrat|did not match|server rendered/i.test(msg.text())) {
            report.consoleErrors.push({ page: label, text: msg.text().slice(0, 400) });
          }
        });
        page.on("pageerror", (err) => report.pageErrors.push({ page: label, message: String(err.message).slice(0, 300) }));
        await open(page, target.url, target.sel, null, 2500);
        const badges = await page.locator("[data-promo-badge]").allTextContents();
        report.pages.push({ page: label, activePrices: await page.locator("[data-promo-active=true]").count(), badge: badges[0] ?? null });
        await page.close();
      }
      await anon.close();
      await owner.close();
      await root.close();
    }
  } finally {
    if (promotionId) {
      const del = await rootCtx.request.delete(`${BASE}/api/root/promotions/${promotionId}`);
      report.deleted = del.status();
    }
    await rootCtx.close();
    await browser.close();
  }
  fs.writeFileSync(path.join(RAW, "hydration.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.consoleErrors.length || report.pageErrors.length || report.pages.some((p) => p.activePrices === 0)) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
