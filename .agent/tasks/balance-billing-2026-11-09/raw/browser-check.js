const { chromium } = require("playwright");
const fs = require("fs");
const OUT = process.argv[2];
const BASE = "http://localhost:3000";
const log = [];
const note = (m) => { log.push(m); console.log(m); };
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  const res = await context.request.post(`${BASE}/api/auth/callback/credentials`, { form: { email: "cafe-owner@local.test", password: "AdminPass123!", csrfToken: csrf.csrfToken, json: "true" }, maxRedirects: 0 });
  note(`login: ${res.status()}`);
  // Тестовый пользователь ещё не принимал оферту — принимаем, как в окне «Мы обновили условия».
  note(`legal accept: ${(await context.request.post(`${BASE}/api/legal/accept`, { data: { consent: true } })).status()}`);
  const page = await context.newPage();
  page.setDefaultTimeout(240000);

  await page.goto(`${BASE}/settings/balance`, { waitUntil: "networkidle", timeout: 300000 });
  const detail = page.locator("[data-balance-detail]");
  await detail.waitFor();
  note(`detail headers: ${JSON.stringify(await detail.locator("thead th").allInnerTexts())}`);
  note(`detail totals: ${JSON.stringify(await detail.locator("[data-balance-totals]").innerText())}`);
  const rows = await detail.locator("tbody tr").allInnerTexts();
  rows.forEach((r) => note(`  row: ${JSON.stringify(r)}`));
  await detail.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/01-balance-detail.png` });

  await page.goto(`${BASE}/settings/subscription`, { waitUntil: "networkidle", timeout: 300000 });
  const card = page.locator("[data-auto-renew-card]");
  await card.waitFor();
  await card.scrollIntoViewIfNeeded();
  note(`card state: ${await card.getAttribute("data-auto-renew-enabled")}`);
  note(`card status: ${JSON.stringify(await card.locator("[data-auto-renew-status]").innerText())}`);
  note(`card links: ${JSON.stringify(await card.locator("a").allInnerTexts())}`);
  await page.screenshot({ path: `${OUT}/02-auto-renew-on.png` });

  await card.locator("[data-auto-renew-switch]").click();
  await page.waitForFunction(() => document.querySelector("[data-auto-renew-card]")?.getAttribute("data-auto-renew-enabled") === "off");
  await page.waitForTimeout(2500);
  note(`after toggle: ${await card.getAttribute("data-auto-renew-enabled")} — ${JSON.stringify(await card.locator("[data-auto-renew-status]").innerText())}`);
  await page.screenshot({ path: `${OUT}/03-auto-renew-off.png` });
  // Обратно включаем.
  await card.locator("[data-auto-renew-switch]").click();
  await page.waitForFunction(() => document.querySelector("[data-auto-renew-card]")?.getAttribute("data-auto-renew-enabled") === "on");
  await page.waitForTimeout(2000);
  note(`toggled back: ${await card.getAttribute("data-auto-renew-enabled")}`);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU", storageState: await context.storageState() });
  const p2 = await phone.newPage();
  await p2.goto(`${BASE}/settings/balance`, { waitUntil: "networkidle", timeout: 300000 });
  await p2.locator("[data-balance-detail]").scrollIntoViewIfNeeded();
  note(`phone overflow: ${await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)}`);
  await p2.screenshot({ path: `${OUT}/04-phone-balance-detail.png` });
  fs.writeFileSync(`${OUT}/browser-check.txt`, log.join("\n") + "\n");
  await browser.close();
})().catch((e) => { console.error(e); fs.writeFileSync(`${OUT}/browser-check.txt`, log.join("\n") + "\nERROR: " + e.message + "\n"); process.exit(1); });
