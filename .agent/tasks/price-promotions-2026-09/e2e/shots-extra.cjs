// Дополнительные снимки ROOT: таблица промокодов со стартовым набором (выключены) и
// «Акции» на телефоне. Запуск: node e2e/shots-extra.cjs (после e2e.cjs и seed-promo-codes).
const path = require("node:path");
const { EVID, launch, login, newContext, open, norm, readCreds } = require("./lib.cjs");

(async () => {
  const creds = readCreds();
  const browser = await launch();
  try {
    const desktop = await newContext(browser, { width: 1280, height: 900 });
    await login(desktop, creds.root, creds.password);
    const page = await desktop.newPage();
    await open(page, "/root/promo-codes", 'input[placeholder="WELCOME10"]', null, 2500);
    const table = page.locator("table").first();
    const rows = await table.locator("tbody tr").allTextContents();
    console.log("promo-codes rows:", rows.map(norm));
    await table.screenshot({ path: path.join(EVID, "root-promo-codes-starter-1280.png") });

    const phone = await newContext(browser, { width: 390, height: 844 });
    await login(phone, creds.root, creds.password);
    const mobile = await phone.newPage();
    await open(mobile, "/root/promotions", "[data-testid=promotion-form] button", null, 2500);
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    console.log("root/promotions @390 horizontal overflow px:", overflow);
    if (overflow > 0) process.exitCode = 1;
    await mobile.screenshot({ path: path.join(EVID, "root-promotions-390.png"), fullPage: true });
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
