// Смоук правок по сканам 98–99 на локальном dev (порт 3027, база wesetup_pscope).
//   node .agent/tasks/point-scope-ui-2026-10-28/e2e/smoke.cjs <ids.json>
// Пишет снимки и результат в .agent/tasks/point-scope-ui-2026-10-28/raw/.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = "http://localhost:3027";
const RAW = path.join(__dirname, "..", "raw");
const ids = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
fs.mkdirSync(RAW, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function login(context, email) {
  const page = await context.newPage();
  const csrf = await (await page.request.get(`${BASE}/api/auth/csrf`)).json();
  const response = await page.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password: ids.password, json: "true", callbackUrl: `${BASE}/home` },
  });
  if (!response.ok()) throw new Error(`login ${email}: ${response.status()}`);
  return page;
}

async function setPoint(context, buildingId) {
  await context.addCookies([{ name: "wesetup.building", value: `${ids.org}:${buildingId}`, url: BASE }]);
}

// Кабинет всё время опрашивает сервер (чат, уведомления) — «сеть затихла» не наступает.
async function go(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 300000 });
  await page.locator("main").first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(2000);
}

async function shot(page, url, file) {
  await go(page, url);
  await page.screenshot({ path: path.join(RAW, file), fullPage: true });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:/Users/Two/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  // «Что нового» не мешает снимкам.
  await context.addCookies([{ name: "wesetup-whats-new", value: "trbvln", url: BASE }]);
  const page = await login(context, ids.owner);
  await setPoint(context, ids.garden);

  // AC1: переключатель скрыт на страницах компании и остаётся на страницах точки.
  for (const url of ["/home", "/settings/organization", "/settings/master-cabinet", "/settings/buildings"]) {
    await go(page, `${url}`);
    check(`AC1 нет переключателя точки: ${url}`, (await page.locator("[data-current-point]").count()) === 0);
  }
  for (const url of ["/settings/equipment", "/settings/areas", "/settings/qr-posters"]) {
    await go(page, `${url}`);
    check(`AC1 переключатель на странице точки: ${url}`, (await page.locator("[data-current-point]").count()) === 1);
  }

  // AC2: офиса нет в «Точках и помещениях», тумблер журналов по точкам на месте.
  await shot(page, "/settings/buildings", "buildings.png");
  const body = await page.locator("main").innerText();
  check("AC2 офиса нет в списке точек", (await page.locator("[data-building-office]").count()) === 0);
  check("AC2 торговые точки в списке", body.includes("д/с №68") && body.includes("Гимназия №14"));
  check("AC2 тумблер «журналы по точкам» на месте", (await page.locator("button[role=switch], [role=switch]").count()) >= 1);

  // AC3: кнопки QR на «Цехах».
  await shot(page, "/settings/areas", "areas.png");
  check("AC3 кнопки QR на цехах", (await page.locator("[data-equipment-qr]").count()) === 3);

  // AC4: наклейки оборудования и помещений — только точки (д/с №68 + общий склад).
  await shot(page, "/settings/qr-posters?kind=equipment&layout=sheet", "qr-equipment-garden.png");
  let text = await page.locator("main").innerText();
  check("AC4 наклейки: оборудование своей точки", text.includes("ШХ-1 Сад") && text.includes("ШХ-3 Сад") && text.includes("Ларь общий"));
  check("AC4 наклейки: нет оборудования другой точки", !text.includes("ШХ-1 Школа") && !text.includes("ШХ-2 Школа"));
  await shot(page, "/settings/qr-posters?kind=rooms&layout=sheet", "qr-rooms-garden.png");
  text = await page.locator("main").innerText();
  check("AC4 помещения своей точки", text.includes("Склад овощей") && !text.includes("Склад гимназии"));

  // AC5: общий экран — хаб точки и счётчики по точке.
  await shot(page, "/settings/qr-posters", "qr-overview-garden.png");
  text = await page.locator("main").innerText();
  const stickers = text.match(/Наклейки на оборудование\s*(\d+)/);
  const rooms = text.match(/Наклейки на склады и помещения\s*(\d+)/);
  check("AC5 счётчик оборудования по точке", stickers && stickers[1] === "4", stickers ? stickers[1] : "нет счётчика");
  check("AC5 счётчик помещений по точке", rooms && rooms[1] === "2", rooms ? rooms[1] : "нет счётчика");
  const hubHref = await page.locator("a[href*='/journal-fill/']").first().getAttribute("href").catch(() => null);
  check("AC5 ссылка QR «Все журналы» найдена", Boolean(hubHref), hubHref ?? "");

  // Другая точка в шапке — другие объекты.
  await setPoint(context, ids.school);
  await go(page, `/settings/qr-posters?kind=equipment&layout=sheet`);
  text = await page.locator("main").innerText();
  check("AC4 при «Гимназии» — её оборудование", text.includes("ШХ-1 Школа") && !text.includes("ШХ-1 Сад"));

  // AC7: мастер-кабинеты — оба кабинета, точка в «Садах», добавление в «Школы».
  await setPoint(context, ids.garden);
  await shot(page, "/settings/master-cabinet", "master-before.png");
  const cards = page.locator("[data-testid=master-cabinet-card]");
  check("AC7 видны оба кабинета", (await cards.count()) === 2);
  text = await page.locator("main").innerText();
  check("AC7 нет «Кода справочника» на главном экране", !text.includes("Код справочника") && !text.includes("КОД СПРАВОЧНИКА"));
  const gardensCard = page.locator(`[data-cabinet-id='${ids.gardens}']`);
  const schoolsCard = page.locator(`[data-cabinet-id='${ids.schools}']`);
  check("AC7 д/с №68 в «Садах»", (await gardensCard.innerText()).includes("д/с №68"));
  check("AC7 оператор «Садов» виден", (await gardensCard.innerText()).includes("Карина Оператор"));
  await schoolsCard.locator("[data-testid=master-add-point]").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(RAW, "master-add-menu.png"), fullPage: false });
  const gardenOption = page.locator(`[data-point-option='${ids.garden}']`);
  check("AC7 точка из другого кабинета недоступна", (await gardenOption.getAttribute("data-disabled")) !== null);
  await page.locator(`[data-point-option='${ids.school}']`).click();
  const connected = await schoolsCard
    .locator("[data-testid=master-point-row]", { hasText: "Гимназия №14" })
    .waitFor({ timeout: 60000 })
    .then(() => true, () => false);
  check("AC7 гимназия подключена к «Школам»", connected);
  await page.screenshot({ path: path.join(RAW, "master-after-connect.png"), fullPage: true });
  // Отключить — через ConfirmDialog.
  await schoolsCard.locator("[data-testid=master-disconnect]").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(RAW, "master-disconnect-confirm.png"), fullPage: false });
  await page.getByRole("button", { name: "Отключить", exact: true }).last().click();
  const disconnected = await schoolsCard
    .locator("[data-testid=master-point-row]")
    .waitFor({ state: "detached", timeout: 60000 })
    .then(() => true, () => false);
  check("AC7 гимназия отключена", disconnected && !(await schoolsCard.innerText()).includes("Гимназия №14"));
  // Владелец управляет людьми блоком «Права доступа».
  check("AC7 владелец: блок операторов с приглашением", (await gardensCard.locator("[data-testid=cabinet-access]").count()) === 1);

  // Руководитель (не владелец): видит кабинеты, приглашает только в подключённый.
  const managerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  await managerContext.addCookies([{ name: "wesetup-whats-new", value: "trbvln", url: BASE }]);
  const managerPage = await login(managerContext, ids.manager);
  await go(managerPage, `/settings/master-cabinet`);
  await managerPage.waitForTimeout(800);
  await managerPage.screenshot({ path: path.join(RAW, "master-manager.png"), fullPage: true });
  check("AC7 руководитель видит оба кабинета", (await managerPage.locator("[data-testid=master-cabinet-card]").count()) === 2);
  check(
    "AC7 руководитель может пригласить оператора в «Сады»",
    (await managerPage.locator(`[data-cabinet-id='${ids.gardens}'] [data-testid=master-invite-open]`).count()) === 1
  );

  // Телефон: страница мастер-кабинета без горизонтальной прокрутки.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU", isMobile: true });
  await phone.addCookies([{ name: "wesetup-whats-new", value: "trbvln", url: BASE }]);
  const phonePage = await login(phone, ids.owner);
  await go(phonePage, `/settings/master-cabinet`);
  await phonePage.waitForTimeout(800);
  await phonePage.screenshot({ path: path.join(RAW, "master-phone.png"), fullPage: true });
  const overflow = await phonePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("телефон: без горизонтальной прокрутки", overflow <= 1, `лишние px: ${overflow}`);

  fs.writeFileSync(path.join(RAW, "smoke-result.json"), JSON.stringify({ hubHref, results }, null, 1));
  await browser.close();
  const failed = results.filter((item) => !item.ok).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
