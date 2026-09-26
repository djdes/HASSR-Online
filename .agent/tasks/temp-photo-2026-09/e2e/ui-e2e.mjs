// UI e2e «Фото к замеру» (temp-photo-2026-09): QR-наклейка холодильника и плакат склада на 390,
// документы журналов на 1440; бесплатный и платный тариф; мок ответа диспетчера.
// Запуск: SP=<временная папка ВНЕ рабочей копии: fixture.json, vision-mock.json, uploads/> node ui-e2e.mjs
// (dev-сервер пересобирается и перезагружает страницы от любой записи внутри проекта — отсюда папка снаружи).
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ROOT = "C:/wt/tphoto";
const require = createRequire(`${ROOT}/package.json`);
const { chromium } = require("playwright-core");
const pg = require("pg");

const EXE = "C:/Users/Yaroslav/AppData/Local/ms-playwright/chromium-1232/chrome-win64/chrome.exe";
const SP = process.env.SP;
const E2E = `${ROOT}/.agent/tasks/temp-photo-2026-09/e2e`;
const EV = `${ROOT}/.agent/tasks/temp-photo-2026-09/evidence`;
const BASE = process.env.BASE ?? "http://localhost:3048";
const fx = JSON.parse(readFileSync(`${SP}/fixture.json`, "utf8"));
const env = Object.fromEntries(
  readFileSync(`${ROOT}/.env`, "utf8").split(/\r?\n/).map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, "")])
);
const db = new pg.Client({ connectionString: env.DATABASE_URL });
const FRIDGE_PHOTO = `${EV}/display-fridge-4.5.jpg`;
const UNREADABLE_PHOTO = `${EV}/display-unreadable.jpg`;
const HYGRO_PHOTO = `${EV}/display-hygro-21.5.jpg`;
const EQUIPMENT_URL = `${BASE}/equipment-fill/${fx.equipmentId}?token=${encodeURIComponent(fx.equipmentToken)}`;
const ROOM_URL = `${BASE}/room-fill/${fx.roomId}?token=${encodeURIComponent(fx.roomToken)}`;
const COLD_DOC = `${BASE}/journals/cold_equipment_control/documents/${fx.coldDocumentId}`;
const CLIMATE_DOC = `${BASE}/journals/climate_control/documents/${fx.climateDocumentId}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
function setMock(variant) {
  copyFileSync(`${E2E}/vision-mock-${variant}.json`, `${SP}/vision-mock.json`);
}
async function setPlan(plan) {
  await db.query(`UPDATE "Account" SET "subscriptionPlan"=$1 WHERE id=(SELECT "accountId" FROM "Organization" WHERE id=$2)`, [plan, fx.organizationId]);
  await db.query(`UPDATE "Organization" SET "subscriptionPlan"=$1 WHERE id=$2`, [plan, fx.organizationId]);
}
// Снимки — сначала во временную папку вне проекта (новый файл внутри проекта дёргает
// наблюдатель dev-сервера), в папку доказательств — в конце прогона.
const SHOTS = `${SP}/shots`;
mkdirSync(SHOTS, { recursive: true });
const taken = [];
async function shot(page, name, options = {}) {
  await page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: "jpeg", quality: 72, ...options });
  taken.push(name);
}
async function hydrated(page, timeout = 30_000) {
  // Гидратация: до неё обработчики ещё не навешены — ждём, пока React повесит свои свойства на кнопки.
  const ok = await page
    .waitForFunction(() => [...document.querySelectorAll("button")].some((b) => Object.keys(b).some((k) => k.startsWith("__reactProps"))), null, { timeout })
    .then(() => true, () => false);
  await page.waitForTimeout(600);
  return ok;
}
async function open(page, url) {
  // Dev-сервер выгружает неиспользуемые страницы и пересобирает их на лету; если
  // в этот момент кусок клиента не догрузился (ChunkLoadError), страница «мёртвая» —
  // открываем заново.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 240_000 });
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    if (await hydrated(page)) return;
    console.log(`open: страница не ожила, повтор ${attempt + 1}`);
  }
}
function watch(page) {
  page.on("pageerror", (error) => console.log(`pageerror: ${String(error).slice(0, 300)}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`console.error: ${message.text().slice(0, 300)}`);
  });
}
async function pickEmployee(page, name) {
  const dialog = page.getByRole("dialog");
  // Dev-сервер после компиляции может перезагрузить страницу посреди выбора —
  // тогда ждём гидратацию и выбираем заново.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      if (!(await dialog.isVisible().catch(() => false))) {
        await page.getByRole("button", { name: /Выберите своё имя|Кто снимает показания/ }).first().click({ timeout: 5_000 });
        await dialog.waitFor({ state: "visible", timeout: 2_500 });
      }
      await dialog.getByRole("button", { name: new RegExp(name) }).click({ timeout: 3_000 });
      await dialog.waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
      return;
    } catch (error) {
      console.log(`pickEmployee: попытка ${attempt + 1}: ${String(error).split(/\r?\n/)[0].slice(0, 160)}`);
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      if (!(await hydrated(page, 5_000))) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 240_000 });
        await hydrated(page);
      }
    }
  }
  throw new Error(`pickEmployee: не удалось выбрать «${name}»`);
}
async function bodyText(page) {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

async function qrFree(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "ru-RU" });
  const page = await context.newPage();
  watch(page);
  await open(page, EQUIPMENT_URL);
  await pickEmployee(page, "Иван Петров");
  const button = page.getByTestId("reading-photo-button");
  await button.waitFor({ state: "visible", timeout: 30_000 });
  const box = await button.boundingBox();
  check("390 free: у поля температуры кнопка «Фото» (не ниже 48 px)", box && box.height >= 48, JSON.stringify(box));
  const accept = await page.getByTestId("reading-photo-input").getAttribute("capture");
  check("390 free: на телефоне сразу камера (capture=environment)", accept === "environment", String(accept));
  // Сегодня уже записано (API-прогон) — поле подставлено; очищаем, как перед новым замером.
  await page.locator("#equipment-fill-temperature").fill("");
  await button.scrollIntoViewIfNeeded();
  await shot(page, "390-01-qr-photo-button");

  await page.getByTestId("reading-photo-input").setInputFiles(FRIDGE_PHOTO);
  const card = page.locator('[data-testid="reading-photo"][data-status="paid-only"]');
  await card.waitFor({ state: "visible", timeout: 60_000 });
  const text = await card.innerText();
  check("390 free: фото прикреплено к замеру", /Фото прикреплено к замеру/.test(text), text.replace(/\s+/g, " "));
  check("390 free: вместо автоввода — «Автоввод с фото — на платном тарифе»", /Автоввод с фото — на платном тарифе/.test(text));
  check("390 free: сотруднику — без ссылки на тарифы", (await page.getByTestId("reading-photo-tariffs").count()) === 0);
  const value = await page.locator("#equipment-fill-temperature").inputValue();
  check("390 free: поле температуры не заполнено автоматически", value === "", JSON.stringify(value));
  await card.scrollIntoViewIfNeeded();
  await shot(page, "390-02-qr-free-photo-attached");

  await page.locator("#equipment-fill-temperature").fill("4.5");
  await page.getByRole("button", { name: "Сохранить замер" }).click();
  await page.getByRole("heading", { name: "Записано" }).waitFor({ timeout: 60_000 });
  const done = await bodyText(page);
  check("390 free: замер записан с фото («Фото дисплея — в журнале рядом со значением»)", /Фото дисплея — в журнале рядом со значением/.test(done));
  await shot(page, "390-03-qr-free-saved");

  // Руководитель на бесплатном — та же подсказка, но со ссылкой на тарифы.
  await open(page, EQUIPMENT_URL);
  await pickEmployee(page, "Ольга Смирнова");
  await page.getByTestId("reading-photo-button").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("reading-photo-input").setInputFiles(FRIDGE_PHOTO);
  const link = page.getByTestId("reading-photo-tariffs");
  await link.waitFor({ state: "visible", timeout: 60_000 });
  check("390 free: руководителю — ссылка «Тарифы» на страницу тарифов", (await link.getAttribute("href")) === "/settings/subscription");
  await page.locator('[data-testid="reading-photo"]').scrollIntoViewIfNeeded();
  await shot(page, "390-04-qr-free-manager-tariffs", { clip: { x: 0, y: 0, width: 390, height: 844 } });
  await context.close();
}

async function qrPaid(browser) {
  await setPlan("paid");
  setMock("readable");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "ru-RU" });
  const page = await context.newPage();
  watch(page);
  await open(page, EQUIPMENT_URL);
  await pickEmployee(page, "Иван Петров");
  await page.getByTestId("reading-photo-button").waitFor({ state: "visible", timeout: 30_000 });
  const hint = await page.locator('[data-testid="reading-photo"]').innerText();
  check("390 paid: у кнопки — «Снимите дисплей — показание заполним сами»", /показание заполним сами/.test(hint), hint.replace(/\s+/g, " "));
  // На странице было «сегодня уже записано» — поле подставлено; очищаем, как перед новым замером.
  await page.locator("#equipment-fill-temperature").fill("");
  await page.getByTestId("reading-photo-input").setInputFiles(FRIDGE_PHOTO);
  const recognizing = page.locator('[data-testid="reading-photo"][data-status="recognizing"]');
  const sawRecognizing = await recognizing.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
  check("390 paid: «Распознаём показание… обычно 10–40 секунд»", sawRecognizing && /Распознаём показание… обычно 10–40 секунд/.test(await recognizing.innerText().catch(() => "")));
  if (sawRecognizing) {
    await recognizing.scrollIntoViewIfNeeded();
    await shot(page, "390-05-qr-paid-recognizing");
  }
  const filled = page.locator('[data-testid="reading-photo"][data-status="filled"]');
  await filled.waitFor({ state: "visible", timeout: 60_000 });
  const value = await page.locator("#equipment-fill-temperature").inputValue();
  check("390 paid: показание со снимка подставлено в поле — 4.5", value === "4.5", JSON.stringify(value));
  const mark = page.getByTestId("reading-mark");
  check("390 paid: у поля пометка «с фото — проверьте»", (await mark.innerText().catch(() => "")).includes("с фото — проверьте"));
  check("390 paid: в карточке фото — «Подставили 4.5 °C с фото — проверьте»", /Подставили 4\.5 °C с фото — проверьте/.test(await filled.innerText()));
  await page.locator("#equipment-fill-temperature").scrollIntoViewIfNeeded();
  await shot(page, "390-06-qr-paid-filled");

  // Человек может поправить: пометка уходит, число — его.
  await page.locator("#equipment-fill-temperature").fill("4.6");
  check("390 paid: после правки руками пометка «с фото — проверьте» снимается", (await page.getByTestId("reading-mark").count()) === 0);
  await page.locator("#equipment-fill-temperature").fill("4.5");

  // Нечитаемый снимок: поле пустое, подсказка — ничего не выдумано.
  setMock("unreadable");
  await page.getByRole("button", { name: "Убрать фото" }).click();
  await page.locator("#equipment-fill-temperature").fill("");
  await page.getByTestId("reading-photo-input").setInputFiles(UNREADABLE_PHOTO);
  const unreadable = page.locator('[data-testid="reading-photo"][data-status="unreadable"]');
  await unreadable.waitFor({ state: "visible", timeout: 60_000 });
  check("390 paid: нечитаемо — «Не разобрали цифры — введите вручную»", /Не разобрали цифры — введите вручную/.test(await unreadable.innerText()));
  const empty = await page.locator("#equipment-fill-temperature").inputValue();
  check("390 paid: нечитаемо — поле осталось пустым (число не выдумано)", empty === "", JSON.stringify(empty));
  check("390 paid: нечитаемо — пометки «с фото» нет", (await page.getByTestId("reading-mark").count()) === 0);
  await unreadable.scrollIntoViewIfNeeded();
  await shot(page, "390-07-qr-paid-unreadable");

  // Ввёл своё число, пока распознавали, — не затираем.
  setMock("readable");
  await page.getByTestId("reading-photo-input").setInputFiles(FRIDGE_PHOTO);
  await page.locator('[data-testid="reading-photo"][data-status="recognizing"]').waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#equipment-fill-temperature").fill("5");
  const kept = page.locator('[data-testid="reading-photo"][data-status="kept"]');
  await kept.waitFor({ state: "visible", timeout: 60_000 });
  check("390 paid: число, введённое за время распознавания, не затёрто", (await page.locator("#equipment-fill-temperature").inputValue()) === "5");
  await kept.getByRole("button", { name: "Подставить 4.5" }).click();
  check("390 paid: «Подставить 4.5» — число со снимка в поле", (await page.locator("#equipment-fill-temperature").inputValue()) === "4.5");

  await page.getByRole("button", { name: "Сохранить замер" }).click();
  await page.getByRole("heading", { name: "Записано" }).waitFor({ timeout: 60_000 });
  check("390 paid: замер с фото записан", /Фото дисплея — в журнале рядом со значением/.test(await bodyText(page)));

  // Склад: «Фото» у температуры, автоввод с термогигрометра.
  setMock("room");
  await open(page, ROOM_URL);
  await page.getByTestId("reading-photo-button").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#room-fill-temperature").fill("");
  await page.getByTestId("reading-photo-input").setInputFiles(HYGRO_PHOTO);
  await page.locator('[data-testid="reading-photo"][data-status="filled"]').waitFor({ state: "visible", timeout: 60_000 });
  const roomValue = await page.locator("#room-fill-temperature").inputValue();
  check("390 paid склад: у температуры «Фото», показание 21.5 подставлено", roomValue === "21.5", JSON.stringify(roomValue));
  await page.locator("#room-fill-humidity").fill("48");
  await page.locator("#room-fill-temperature").scrollIntoViewIfNeeded();
  await shot(page, "390-08-room-paid-filled");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByRole("heading", { name: "Записано" }).waitFor({ timeout: 60_000 });
  check("390 paid склад: замер с фото записан в бланк", /Фото дисплея — в бланке рядом со значением/.test(await bodyText(page)));
  await context.close();
}

async function login(context, email) {
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  await context.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken: csrf.csrfToken, email, password: fx.password, json: "true" } });
  // Подсказка «как заполнять» при первом входе в журнал — закрыта заранее.
  await context.request.post(`${BASE}/api/me/notices`, { data: { key: "fill-guide:cold_equipment_control" } }).catch(() => {});
  await context.request.post(`${BASE}/api/me/notices`, { data: { key: "fill-guide:climate_control" } }).catch(() => {});
}

async function documentChecks(browser, plan) {
  await setPlan(plan);
  setMock("readable");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  await login(context, fx.managerEmail);
  const page = await context.newPage();
  watch(page);
  await open(page, COLD_DOC);
  const understood = page.getByRole("button", { name: "Понятно" });
  if (await understood.isVisible().catch(() => false)) await understood.click();

  if (plan === "free") {
    const cell = page.getByTestId("reading-photo-cell").filter({ visible: true }).first();
    await cell.waitFor({ state: "visible", timeout: 60_000 });
    const label = await cell.getAttribute("aria-label");
    check("1440 документ: у значения замера — значок фото (из QR-формы)", /Фото замера: Холодильник №1 · \d\d\.\d\d\.\d{4} · 4\.5 °C/.test(label ?? ""), label ?? "");
    await cell.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -160));
    await shot(page, "1440-01-document-photo-in-cell");
    await cell.click();
    const lightbox = page.locator('img[alt^="Холодильник №1"]');
    await lightbox.waitFor({ state: "visible", timeout: 20_000 });
    const src = await lightbox.getAttribute("src");
    check("1440 документ: нажатие открывает снимок крупно (подпись: оборудование, дата, значение)", /^\/uploads\/readings\/[a-f0-9]{32}\.jpg$/.test(src ?? ""), src ?? "");
    const loaded = await lightbox.evaluate((img) => img.complete && img.naturalWidth > 0);
    check("1440 документ: снимок отдаётся маршрутом /uploads (загрузился)", loaded);
    await page.waitForTimeout(400);
    await shot(page, "1440-02-document-photo-lightbox");
    await page.keyboard.press("Escape");
  }

  // Кнопка камеры в документе — по правилам тарифа. Она в карточках «Сегодня».
  const ocr = page.getByTestId("display-ocr-button").filter({ visible: true }).first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await ocr.isVisible().catch(() => false)) break;
    const today = page.getByText("Сегодня", { exact: true }).filter({ visible: true }).first();
    if (await today.isVisible().catch(() => false)) await today.click();
    await page.waitForTimeout(1500);
  }
  await ocr.waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="display-ocr-button"]')?.getAttribute("data-autofill") !== "unknown", null, { timeout: 30_000 }).catch(() => {});
  const state = await ocr.getAttribute("data-autofill");
  if (plan === "free") {
    check("1440 документ free: кнопка камеры знает тариф (free, замок)", state === "free", String(state));
    await ocr.click();
    const toast = page.getByText("Автоввод с фото — на платном тарифе").filter({ visible: true }).first();
    const sawToast = await toast.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    check("1440 документ free: вместо камеры — подсказка «Автоввод с фото — на платном тарифе»", sawToast);
    const action = page.getByRole("button", { name: "Тарифы" }).filter({ visible: true }).first();
    check("1440 документ free: руководителю — кнопка «Тарифы» в подсказке", await action.isVisible().catch(() => false));
    await ocr.scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    await shot(page, "1440-03-document-free-hint");
  } else {
    check("1440 документ paid: кнопка камеры — автоввод доступен", state === "paid", String(state));
    const input = ocr.locator('xpath=preceding-sibling::input[@type="file"][1]');
    await input.setInputFiles(FRIDGE_PHOTO);
    const loading = page.getByText("Распознаём показание… обычно 10–40 секунд").filter({ visible: true }).first();
    check("1440 документ paid: «Распознаём показание… обычно 10–40 секунд»", await loading.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false));
    const success = page.getByText("Распознано 4.5 с фото — проверьте").filter({ visible: true }).first();
    const sawSuccess = await success.waitFor({ state: "visible", timeout: 60_000 }).then(() => true, () => false);
    check("1440 документ paid: число подставлено с пометкой «Распознано 4.5 с фото — проверьте»", sawSuccess);
    await ocr.scrollIntoViewIfNeeded();
    await shot(page, "1440-04-document-paid-recognized");
    await page.waitForTimeout(1500);
    const { rows } = await db.query('SELECT data FROM "JournalDocumentEntry" WHERE "documentId"=$1 AND "employeeId"=$2 ORDER BY date DESC LIMIT 1', [fx.coldDocumentId, fx.cookId]);
    const data = rows[0]?.data ?? {};
    const key = Object.keys(data.temperatures ?? {})[0];
    check('1440 документ paid: правка значения на сайте фото замера не стирает', data.temperatures?.[key] === 4.5 && Boolean(data.readingPhotos?.[key]), JSON.stringify(data));

    // Бланк склада: фото замера рядом со значением температуры.
    await open(page, CLIMATE_DOC);
    const climateCell = page.getByTestId("reading-photo-cell").filter({ visible: true }).first();
    const sawClimate = await climateCell.waitFor({ state: "visible", timeout: 60_000 }).then(() => true, () => false);
    check("1440 бланк склада: у температуры — значок фото замера", sawClimate, (await climateCell.getAttribute("aria-label").catch(() => "")) ?? "");
    if (sawClimate) {
      await climateCell.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -160));
      await shot(page, "1440-05-climate-photo-in-cell");
    }
  }
  await context.close();
}

async function documentMobile(browser) {
  // Карточки на телефоне: миниатюра фото рядом с полем (вкладка «Сегодня»).
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "ru-RU" });
  await login(context, fx.managerEmail);
  const page = await context.newPage();
  watch(page);
  await open(page, COLD_DOC);
  const thumb = page.getByTestId("reading-photo-thumb").filter({ visible: true }).first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await thumb.isVisible().catch(() => false)) break;
    const today = page.getByText("Сегодня", { exact: true }).filter({ visible: true }).first();
    if (await today.isVisible().catch(() => false)) await today.click();
    await page.waitForTimeout(1500);
  }
  const saw = await thumb.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
  check("390 документ: в карточке «Сегодня» — миниатюра фото рядом с полем", saw);
  if (saw) {
    await thumb.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -200));
    await shot(page, "390-09-document-card-thumb");
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("390 документ: нет горизонтальной прокрутки", overflow <= 1, `overflow=${overflow}`);
  await context.close();
}

async function main() {
  await db.connect();
  // Повторные прогоны не должны упираться в суточный лимит распознаваний тестовой организации.
  await db.query(`DELETE FROM "AuditLog" WHERE "organizationId"=$1 AND action='ai.vision_extract'`, [fx.organizationId]);
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--use-gl=swiftshader", "--no-sandbox"] });
  try {
    await setPlan("free");
    setMock("readable");
    await qrFree(browser);
    await documentChecks(browser, "free");
    await qrPaid(browser);
    await documentChecks(browser, "paid");
    await documentMobile(browser);
  } finally {
    await browser.close();
    await setPlan(process.env.FINAL_PLAN ?? "free");
    await db.end();
    for (const name of taken) copyFileSync(`${SHOTS}/${name}.jpg`, `${EV}/${name}.jpg`);
  }
  const passed = results.filter((r) => r.ok).length;
  const summary = `${passed}/${results.length} PASS`;
  console.log(summary);
  writeFileSync(
    `${EV}/ui-e2e.txt`,
    [`UI e2e «Фото к замеру» — ${new Date().toISOString()} — ${summary}`, "", ...results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`)].join("\n") + "\n"
  );
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
