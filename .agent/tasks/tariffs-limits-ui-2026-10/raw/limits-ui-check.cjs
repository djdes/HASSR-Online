// Живая проверка в браузере (tariffs-limits-ui AC2, AC3): заметка в архиве «Сотрудников»,
// тост отказа при возврате из архива (следующий тариф / «Связаться» → чат), калькулятор выгоды.
// Сначала limits-scenarios.ts и по одному сотруднику в архиве у lim-std-over и lim-prem-over.
// Запуск (playwright из глобальной установки — скрипт копировать вне репозитория):
//   OUT_DIR=... node limits-ui-check.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || ".";

async function login(page, email) {
  const { csrfToken } = await (await page.request.get(`${BASE}/api/auth/csrf`)).json();
  const res = await page.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken, email, password: "TestPass123!", json: "true" } });
  return res.status();
}

async function archiveFlow(browser, email, label, shot) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  console.log(`\n=== ${label} (${email}): вход ${await login(page, email)}`);
  await page.goto(`${BASE}/settings/users`, { waitUntil: "networkidle", timeout: 180000 });
  const section = page.locator('[data-testid="archived-staff"]');
  await section.locator("button[aria-expanded]").first().click();
  const note = (await section.locator("p.rounded-2xl").first().innerText()).replace(/\s+/g, " ").trim();
  console.log(`  заметка в архиве: «${note}»`);
  await section.locator('[data-testid^="restore-"]').first().click();
  const toast = page.locator("[data-sonner-toast]").first();
  await toast.waitFor({ timeout: 20000 });
  const toastText = (await toast.innerText()).replace(/\s+/g, " ").trim();
  console.log(`  тост: «${toastText}»`);
  if (shot) await page.screenshot({ path: `${OUT}/${shot}` });
  const action = toast.locator("button[data-button], [data-action]").first();
  const actionLabel = (await action.count()) ? (await action.innerText()).trim() : "—";
  console.log(`  кнопка тоста: «${actionLabel}»`);
  if (actionLabel === "Связаться") {
    await action.click();
    const chat = page.locator('button[aria-label="Отправить"]');
    const opened = await chat.first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    console.log(`  «Связаться» открыл чат поддержки: ${opened ? "да" : "НЕТ"}`);
  }
  await ctx.close();
}

async function roi(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle", timeout: 180000 });
  const slider = page.locator("#roi-employees");
  await slider.scrollIntoViewIfNeeded();
  console.log("\n=== Калькулятор выгоды: тариф по численности");
  for (const n of [15, 25, 26, 40, 100, 120]) {
    await slider.evaluate((el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, String(value));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, n);
    await page.waitForTimeout(150);
    const tile = (await page.locator("section").filter({ has: slider }).locator("text=WeSetup в месяц").locator("..").innerText()).replace(/\s+/g, " ").trim();
    console.log(`  ${n} сотрудников: ${tile}`);
  }
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await archiveFlow(browser, "lim-std-over@example.test", "«Стандарт», 39 + архив", "limits-toast-standard.png");
  await archiveFlow(browser, "lim-prem-over@example.test", "«Премиум», 139 + архив", "limits-toast-premium.png");
  await roi(browser);
  await browser.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
