const { chromium } = require("playwright");
const fs = require("fs");
const OUT = process.argv[2];
const BASE = "http://localhost:3000";
const log = [];
const note = (m) => { log.push(m); console.log(m); };

async function login(context, email, password) {
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  const res = await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { email, password, csrfToken: csrf.csrfToken, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
  });
  note(`login ${email}: ${res.status()}`);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  await login(context, "alexey@local.test", "AdminPass123!");
  const signedIn = await context.storageState();
  const page = await context.newPage();
  page.setDefaultTimeout(180000);

  // 1. Список клиентов под администратором.
  await page.goto(`${BASE}/root`, { waitUntil: "networkidle", timeout: 300000 });
  note(`header access label: ${await page.locator("[data-root-access]").innerText()}`);
  const headers = await page.locator("table thead th").allInnerTexts();
  note(`columns: ${JSON.stringify(headers)}`);
  const cafeRow = page.locator('tr[data-client-row="org-cafe"]');
  note(`cafe registered cell: ${JSON.stringify(await cafeRow.locator("[data-client-registered]").innerText())}`);
  note(`cafe row has Войти: ${await cafeRow.getByRole("button", { name: "Войти" }).count()}`);
  note(`cafe row has Пополнить: ${await cafeRow.locator('[data-balance-top-up="org-cafe"]').count()}`);
  await page.screenshot({ path: `${OUT}/01-clients-admin.png`, fullPage: false });

  // 2. Пополнение из строки списка.
  await cafeRow.locator('[data-balance-top-up="org-cafe"]').click();
  const form = page.locator("[data-balance-top-up-form]");
  await form.waitFor();
  await form.locator("[data-balance-amount]").fill("500");
  await form.locator("[data-balance-comment]").fill("Компенсация за простой");
  note(`after line: ${await form.locator("[data-balance-after]").innerText()}`);
  await page.screenshot({ path: `${OUT}/02-top-up-dialog.png` });
  await page.getByRole("button", { name: "Начислить", exact: true }).last().click();
  await page.waitForFunction(() => document.querySelector('tr[data-client-row="org-cafe"]')?.textContent?.includes("500"), null, { timeout: 60000 });
  note(`cafe row after top-up: ${JSON.stringify(await cafeRow.locator("td").nth(5).innerText())}`);
  await page.screenshot({ path: `${OUT}/03-after-top-up.png` });

  // 3. Карточка клиента: шапка, баллы, сотрудники.
  await page.goto(`${BASE}/root/organizations/org-cafe`, { waitUntil: "networkidle", timeout: 300000 });
  note(`card actions: ${JSON.stringify(await page.locator("[data-client-actions]").innerText())}`);
  note(`card header has «Регистрация»: ${(await page.locator("h1").locator("xpath=..").innerText()).includes("Регистрация")}`);
  note(`person dates: ${JSON.stringify(await page.locator("[data-person-dates]").first().innerText())}`);
  note(`top-up buttons on card: ${await page.locator('[data-balance-top-up="org-cafe"]').count()}`);
  await page.screenshot({ path: `${OUT}/04-client-card.png` });
  await page.locator("#billing").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/05-client-card-balance.png` });

  // 4. «Войти» в кабинет клиента — администратор остаётся в кабинете клиента.
  await page.locator("[data-client-actions]").getByRole("button", { name: /Войти как/ }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 300000 });
  await page.waitForLoadState("networkidle", { timeout: 300000 });
  const session = await (await context.request.get(`${BASE}/api/auth/session`)).json();
  note(`session after enter: actingAs=${session?.user?.actingAsOrganizationId} role=${session?.user?.role}`);
  await page.screenshot({ path: `${OUT}/06-impersonated-dashboard.png` });

  // 5. Телефон: карточка списка с «Войти» и «Пополнить».
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU", deviceScaleFactor: 1, storageState: signedIn });
  const p2 = await phone.newPage();
  await p2.goto(`${BASE}/root`, { waitUntil: "networkidle", timeout: 300000 });
  const card = p2.locator('li[data-client-card="org-cafe"]');
  note(`phone card text: ${JSON.stringify(await card.innerText())}`);
  note(`phone desktop table display: ${await p2.evaluate(() => getComputedStyle(document.querySelector("[data-clients-list] table")).display)}`);
  note(`phone horizontal overflow: ${await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)}`);
  await card.scrollIntoViewIfNeeded();
  await p2.screenshot({ path: `${OUT}/07-phone-clients.png` });

  fs.writeFileSync(`${OUT}/browser-check.txt`, log.join("\n") + "\n");
  await browser.close();
})().catch((e) => { console.error(e); fs.writeFileSync(`${OUT}/browser-check.txt`, log.join("\n") + "\nERROR: " + e.message + "\n"); process.exit(1); });
