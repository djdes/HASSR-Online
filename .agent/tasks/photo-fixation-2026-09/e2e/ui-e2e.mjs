// UI e2e «Фотофиксация показаний» (photo-fixation-2026-09): QR-наклейки холодильной и морозильной
// камер и плакат склада на телефоне (390), настройка «Строгость журналов» на компьютере (1440).
// Мок ответа диспетчера — $SP/vision-mock.json (WESETUP_VISION_MOCK_FILE), пауза 2.5 с.
// Запуск: SP=<папка ВНЕ рабочей копии: fixture.json, img/> node ui-e2e.mjs
// (dev-сервер перезагружает открытые страницы от любой записи внутри проекта — поэтому всё временное снаружи).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ROOT = "C:/wt/photofix";
const require = createRequire(`${ROOT}/package.json`);
const { chromium } = require("playwright-core");
const pg = require("pg");

const EXE = "C:/Users/Yaroslav/AppData/Local/ms-playwright/chromium-1232/chrome-win64/chrome.exe";
const SP = process.env.SP;
const BASE = process.env.BASE ?? "http://localhost:3054";
const fx = JSON.parse(readFileSync(`${SP}/fixture.json`, "utf8"));
const env = Object.fromEntries(
  readFileSync(`${ROOT}/.env`, "utf8").split(/\r?\n/).map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, "")])
);
const db = new pg.Client({ connectionString: env.DATABASE_URL });
const IMG = `${SP}/img`;
const FRIDGE_URL = `${BASE}/equipment-fill/${fx.fridgeId}?token=${encodeURIComponent(fx.fridgeToken)}`;
const FREEZER_URL = `${BASE}/equipment-fill/${fx.freezerId}?token=${encodeURIComponent(fx.freezerToken)}`;
const ROOM_URL = `${BASE}/room-fill/${fx.roomId}?token=${encodeURIComponent(fx.roomToken)}`;
const SETTINGS_URL = `${BASE}/settings/compliance`;
const SETTING_KEY = `org-reading-photo:${fx.organizationId}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
function setMock(reading) {
  writeFileSync(`${SP}/vision-mock.json`, JSON.stringify({ reading: JSON.stringify(reading) }));
}
async function setPlan(plan) {
  await db.query(`UPDATE "Account" SET "subscriptionPlan"=$1 WHERE id=(SELECT "accountId" FROM "Organization" WHERE id=$2)`, [plan, fx.organizationId]);
  await db.query(`UPDATE "Organization" SET "subscriptionPlan"=$1 WHERE id=$2`, [plan, fx.organizationId]);
}
async function clearEntries() {
  await db.query(`DELETE FROM "JournalDocumentEntry" WHERE "documentId" = ANY($1)`, [[fx.coldDocumentId, fx.climateDocumentId]]);
}
async function entryData(documentId) {
  const { rows } = await db.query(`SELECT data FROM "JournalDocumentEntry" WHERE "documentId"=$1 AND "employeeId"=$2 ORDER BY date DESC LIMIT 1`, [documentId, fx.cookId]);
  return rows[0]?.data ?? null;
}
const SHOTS = `${SP}/shots`;
mkdirSync(SHOTS, { recursive: true });
async function shot(page, name, options = {}) {
  await page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: "jpeg", quality: 70, animations: "disabled", ...options });
}
async function hydrated(page, timeout = 30_000) {
  const ok = await page
    .waitForFunction(() => [...document.querySelectorAll("button")].some((b) => Object.keys(b).some((k) => k.startsWith("__reactProps"))), null, { timeout })
    .then(() => true, () => false);
  await page.waitForTimeout(500);
  return ok;
}
async function open(page, url) {
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
  for (let attempt = 0; attempt < 6; attempt += 1) {
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
      await hydrated(page, 5_000);
    }
  }
  throw new Error(`pickEmployee: не удалось выбрать «${name}»`);
}
async function inViewport(locator) {
  await locator.page().waitForTimeout(1200); // плавная прокрутка к кнопке
  const box = await locator.boundingBox();
  const height = locator.page().viewportSize()?.height ?? 0;
  const ok = Boolean(box && box.y >= 0 && box.y + box.height <= height + 1); // доли пикселя у нижнего края
  if (!ok) console.log(`inViewport: box=${JSON.stringify(box)} scrollY=${await locator.page().evaluate(() => window.scrollY)} doc=${await locator.page().evaluate(() => document.documentElement.scrollHeight)}`);
  return ok;
}
async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
const primaryCard = (page) => page.locator('[data-testid="reading-photo"][data-variant="primary"]');
// Незаконченный замер (снимок без «Сохранить») форма хранит черновиком и восстанавливает —
// «Начать заново» сбрасывает его.
async function startFresh(page) {
  const note = page.getByText("Восстановили введённое после обновления страницы.");
  if (!(await note.isVisible().catch(() => false))) return false;
  const reloaded = page.waitForEvent("load", { timeout: 120_000 }).catch(() => {});
  await page.getByRole("button", { name: "Начать заново" }).click();
  await reloaded;
  await hydrated(page);
  return true;
}

await db.connect();
await setPlan("paid");
await clearEntries();
await db.query(`DELETE FROM "PlatformSetting" WHERE key=$1`, [SETTING_KEY]);
await db.query(`DELETE FROM "AuditLog" WHERE "organizationId"=$1 AND action='ai.vision_extract'`, [fx.organizationId]);

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--use-gl=swiftshader"] });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "ru-RU" });
const page = await phone.newPage();
watch(page);

// ─── 1. Холодильная камера: имя → PIN → «Сфотографируйте показание» ──────────
await open(page, FRIDGE_URL);
await pickEmployee(page, "Мария Иванова");
await page.getByLabel("PIN").fill(fx.cookPin);
await page.getByRole("button", { name: "Войти" }).click();
await primaryCard(page).waitFor({ state: "visible", timeout: 30_000 });
{
  const button = page.getByTestId("reading-photo-button");
  const box = await button.boundingBox();
  check("390 холодильник: после PIN главная кнопка «Сфотографируйте показание» во всю ширину", (await button.innerText()).includes("Сфотографируйте показание") && box && box.height >= 56 && box.width >= 330, JSON.stringify(box));
  check("390: на телефоне сразу камера (capture=environment)", (await page.getByTestId("reading-photo-input").getAttribute("capture")) === "environment");
  check("390: рядом — «Ввести вручную»", await page.getByTestId("reading-manual-button").isVisible());
  check("390: поля температуры и «Сохранить» ещё нет — одно главное действие", (await page.locator("#equipment-fill-temperature").count()) === 0 && (await page.getByTestId("equipment-fill-save").count()) === 0);
  check("390: подсказка платного тарифа — цифры впишем сами", /цифры впишем сами/.test(await page.getByTestId("reading-photo-hint").innerText()));
  check("390: «Обслуживание / Ремонт» остаются", await page.getByTestId("equipment-status-service").isVisible());
  check("390: без горизонтальной прокрутки", await noHorizontalScroll(page));
  await shot(page, "390-01-photo-first");
}

// ─── 2. Снимок → распознаём (поля нет) → число с пометкой → одно нажатие ────
setMock({ device: "digital", seen: "цифры 4, точка, 2", value: 4.2, unit: "C", confidence: "high" });
await page.getByTestId("reading-photo-input").setInputFiles(`${IMG}/led-4.2.jpg`);
await page.locator('[data-testid="reading-photo"][data-status="recognizing"]').waitFor({ timeout: 30_000 });
check("390: пока распознаём — карточка фото «Распознаём показание…», поля ещё нет", (await page.locator("#equipment-fill-temperature").count()) === 0 && /Распознаём показание/.test(await page.getByTestId("reading-photo-status").innerText()));
await shot(page, "390-02-recognizing");
await page.locator("#equipment-fill-temperature").waitFor({ timeout: 60_000 });
{
  const value = await page.locator("#equipment-fill-temperature").inputValue();
  check("390: показание с фото само вписалось в поле (4.2)", value === "4.2", value);
  check("390: пометка «с фото — проверьте»", /с фото — проверьте/.test(await page.getByTestId("reading-mark").innerText()));
  const save = page.getByTestId("equipment-fill-save");
  check("390: одно нажатие — «Всё верно — сохранить»", (await save.innerText()).includes("Всё верно — сохранить") && (await save.isEnabled()));
  check("390: кнопка «Всё верно — сохранить» сама на экране (прокрутили к ней)", await inViewport(save));
  check("390: главной кнопки больше нет, фото — карточкой под полем", (await primaryCard(page).count()) === 0 && (await page.locator('[data-testid="reading-photo"][data-status="filled"]').isVisible()));
  await shot(page, "390-03-recognized");
  await save.click();
  await page.getByRole("heading", { name: "Записано" }).waitFor({ timeout: 60_000 });
  const done = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check("390: «Записано» — «Фото показания — в журнале рядом со значением»", /Температура 4\.2°C сохранена в журнал/.test(done) && /Фото показания — в журнале рядом со значением/.test(done));
  await shot(page, "390-04-saved");
  const data = await entryData(fx.coldDocumentId);
  const photos = Object.values(data?.readingPhotos ?? {});
  check("БД: замер 4.2 и фотофиксация в записи журнала", Object.values(data?.temperatures ?? {}).includes(4.2) && photos.length === 1 && /^\/uploads\/readings\/[a-f0-9]{32}\.jpg$/.test(String(photos[0])), JSON.stringify(data));
}

// ─── 3. Морозильная камера, стрелочный термометр: без повторного PIN, −19 ────
setMock({ device: "dial", seen: "стрелка между 10 и 20 синей шкалы, ближе к 20", value: -18.6, unit: "C", confidence: "high" });
await open(page, FREEZER_URL);
await primaryCard(page).waitFor({ state: "visible", timeout: 30_000 });
check("390 морозильная: соседняя наклейка — сразу «Сфотографируйте показание», без PIN", (await page.getByLabel("PIN").count()) === 0);
await page.getByTestId("reading-photo-input").setInputFiles(`${IMG}/dial-freezer.jpg`);
await page.locator("#equipment-fill-temperature").waitFor({ timeout: 60_000 });
{
  const value = await page.locator("#equipment-fill-temperature").inputValue();
  check("390 стрелочный термометр: −18.6 → −19 (до градуса) в поле", value === "-19", value);
  check("390 стрелочный: в норме −22…−18, «Всё верно — сохранить» на экране", (await page.getByTestId("equipment-fill-save").innerText()).includes("Всё верно — сохранить") && (await inViewport(page.getByTestId("equipment-fill-save"))));
  await shot(page, "390-05-dial-recognized");
  await page.getByTestId("equipment-fill-save").click();
  await page.getByRole("heading", { name: "Записано" }).waitFor({ timeout: 60_000 });
  check("390 морозильная: записано −19 с фото", /Температура -19°C сохранена в журнал/.test(await page.locator("body").innerText()));
}

// ─── 4. Нечитаемый снимок: поле пустое («−» морозилки), ввод руками ─────────
setMock({ device: "other", seen: "цифры закрыты бликом", value: null, unit: null, confidence: "low" });
await page.getByRole("button", { name: "Записать ещё замер" }).click();
await primaryCard(page).waitFor({ state: "visible", timeout: 10_000 });
check("390: «Записать ещё замер» — снова со снимка", await page.getByTestId("reading-photo-button").isVisible());
await page.getByTestId("reading-photo-input").setInputFiles(`${IMG}/blurry.jpg`);
await page.locator('[data-testid="reading-photo"][data-status="unreadable"]').waitFor({ timeout: 60_000 });
{
  const value = await page.locator("#equipment-fill-temperature").inputValue();
  check("390 нечитаемо: «Не разобрали цифры — введите вручную», поле без выдуманного числа", /Не разобрали цифры — введите вручную/.test(await page.getByTestId("reading-photo-status").innerText()) && (value === "-" || value === ""), JSON.stringify(value));
  check("390 нечитаемо: обычная «Сохранить замер», фото уже прикреплено", (await page.getByTestId("equipment-fill-save").innerText()).includes("Сохранить замер"));
  await shot(page, "390-06-unreadable");
}

// ─── 5. Склад: «Ввести вручную» — по старинке ───────────────────────────────
await open(page, ROOM_URL);
await primaryCard(page).waitFor({ state: "visible", timeout: 30_000 });
check("390 склад: тоже начинается со снимка; влажности до ввода нет", (await page.locator("#room-fill-humidity").count()) === 0);
await page.getByTestId("reading-manual-button").click();
await page.locator("#room-fill-temperature").waitFor({ timeout: 10_000 });
{
  const focused = await page.evaluate(() => document.activeElement?.id ?? "");
  check("390 склад: «Ввести вручную» — поле температуры в фокусе (клавиатура)", focused === "room-fill-temperature", focused);
  check("390 склад: маленькая «Фото» у поля остаётся", (await page.getByTestId("reading-photo-button").innerText()).trim() === "Фото");
  await page.locator("#room-fill-temperature").fill("21");
  await page.locator("#room-fill-humidity").fill("50");
  check("390 склад: обычная «Сохранить»", (await page.getByTestId("room-fill-save").innerText()).trim() === "Сохранить");
  await shot(page, "390-07-manual");
  await page.getByTestId("room-fill-save").click();
  await page.getByRole("heading", { name: "Записано" }).waitFor({ timeout: 60_000 });
  const data = await entryData(fx.climateDocumentId);
  check("БД: склад записан вручную, без фото", !data?.readingPhotos && JSON.stringify(data?.measurements ?? {}).includes("21"), JSON.stringify(data));
}

// ─── 6. Бесплатный тариф: снимок — фотофиксация, цифры — руками ─────────────
await setPlan("free");
await clearEntries();
await open(page, FRIDGE_URL);
await primaryCard(page).waitFor({ state: "visible", timeout: 30_000 });
check("390 бесплатный: подсказка — фото в журнал, цифры введёте сами", /цифры введёте сами/.test(await page.getByTestId("reading-photo-hint").innerText()));
await page.getByTestId("reading-photo-input").setInputFiles(`${IMG}/led-4.2.jpg`);
await page.locator('[data-testid="reading-photo"][data-status="paid-only"]').waitFor({ timeout: 60_000 });
check("390 бесплатный: фото прикреплено, «Автоввод с фото — на платном тарифе», поле пустое", (await page.locator("#equipment-fill-temperature").inputValue()) === "" && /Автоввод с фото — на платном тарифе/.test(await page.locator('[data-testid="reading-photo"]').innerText()));
await shot(page, "390-08-free");
await setPlan("paid");

// ─── 7. Настройка руководителя (1440) ───────────────────────────────────────
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
{
  const csrf = await (await desk.request.get(`${BASE}/api/auth/csrf`, { timeout: 240_000 })).json();
  await desk.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken: csrf.csrfToken, email: fx.managerEmail, password: fx.password, json: "true" }, timeout: 240_000 });
}
const admin = await desk.newPage();
watch(admin);
// Dev-сервер компилирует маршрут при первом обращении (и снова — после простоя) и перезагружает
// открытую страницу: прогреваем PATCH настроек безвредным запросом прямо перед нажатиями.
async function warmSettingsApi() {
  await desk.request.patch(`${BASE}/api/settings/compliance`, { data: { lockPastDayEdits: false }, timeout: 240_000 });
  await admin.waitForTimeout(1500);
}
await open(admin, SETTINGS_URL);
const block = admin.getByTestId("reading-photo-settings");
await block.waitFor({ timeout: 60_000 });
{
  const enabled = admin.getByTestId("reading-photo-enabled");
  const required = admin.getByTestId("reading-photo-required");
  check("1440 настройки: «Фотофиксация показаний» включена по умолчанию", (await enabled.getAttribute("aria-checked")) === "true");
  check("1440 настройки: «Фото обязательно» выключено по умолчанию", (await required.getAttribute("aria-checked")) === "false");
  await block.scrollIntoViewIfNeeded();
  await admin.waitForTimeout(300);
  const card = block.locator("xpath=ancestor::div[contains(@class,'rounded-3xl')][1]");
  await shot(admin, "1440-01-settings", { clip: await card.boundingBox() });
  await warmSettingsApi();
  await required.click();
  await admin.getByText("Фото обязательно: без снимка температуру по QR не сохранить").waitFor({ timeout: 30_000 });
  const { rows } = await db.query(`SELECT value FROM "PlatformSetting" WHERE key=$1`, [SETTING_KEY]);
  check("1440: включили «Фото обязательно» — сохранено", (await required.getAttribute("aria-checked")) === "true" && rows[0]?.value === '{"enabled":true,"required":true}', rows[0]?.value);
  await shot(admin, "1440-02-required-on", { clip: await card.boundingBox() });
}

// ─── 8. Телефон: фото обязательно ───────────────────────────────────────────
await clearEntries();
await open(page, FRIDGE_URL);
{
  // Снимок из шага 6 не сохраняли — черновик: сразу поле и карточка фото, без главной кнопки.
  const restored = (await page.getByText("Восстановили введённое после обновления страницы.").isVisible().catch(() => false)) &&
    (await page.locator("#equipment-fill-temperature").count()) === 1 &&
    (await page.locator('[data-testid="reading-photo"]').getAttribute("data-variant")) !== "primary";
  check("390 черновик: незаконченный замер со снимком восстановлен — поле и фото сразу", restored);
  await startFresh(page);
}
await primaryCard(page).waitFor({ state: "visible", timeout: 30_000 });
check("390 обязательно: «Ввести вручную» нет, подсказка «Без фото замер не сохранить»", (await page.getByTestId("reading-manual-button").count()) === 0 && /Без фото замер не сохранить/.test(await page.getByTestId("reading-photo-hint").innerText()));
await shot(page, "390-09-required");
await page.getByTestId("equipment-status-service").click();
check("390 обязательно: «Обслуживание» — сохранить можно без фото", await page.getByTestId("equipment-fill-save").isEnabled());
await page.getByTestId("equipment-status-service").click();
{
  // Уже записанное сегодня значение: поле сразу, фото — маленькой кнопкой, без фото «Сохранить» неактивна.
  const api = await phone.request.post(`${BASE}/api/equipment-fill/${fx.fridgeId}`, { data: { token: fx.fridgeToken, employeeId: fx.cookId, pin: fx.cookPin, status: "service" }, headers: { "x-forwarded-for": "10.7.0.9" } });
  check("API: «Обслуживание» при «Фото обязательно» — 200", api.status() === 200, String(api.status()));
  await clearEntries();
  await open(page, FREEZER_URL);
  await startFresh(page);
  await primaryCard(page).waitFor({ state: "visible", timeout: 30_000 });
  setMock({ device: "dial", seen: "стрелка между 10 и 20 синей шкалы, ближе к 20", value: -18.6, unit: "C", confidence: "high" });
  await page.getByTestId("reading-photo-input").setInputFiles(`${IMG}/dial-freezer.jpg`);
  await page.locator("#equipment-fill-temperature").waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Убрать фото" }).click();
  const reason = await page.getByTestId("qr-save-reason").innerText().catch(() => "");
  check("390 обязательно: убрали фото — «Сохранить» неактивна, «Нужно фото показания»", reason.includes("Нужно фото показания") && !(await page.getByTestId("equipment-fill-save").isEnabled()), reason);
  check("390 обязательно: у маленькой «Фото» — «Фото обязательно — без снимка замер не сохранить»", /Фото обязательно — без снимка замер не сохранить/.test(await page.getByTestId("reading-photo-hint").innerText()));
  await shot(page, "390-10-required-no-photo");
}

// ─── 9. Выключили — кнопок фото нет ─────────────────────────────────────────
{
  await warmSettingsApi();
  await admin.getByTestId("reading-photo-enabled").click();
  await admin.getByText("Фотофиксация выключена").waitFor({ timeout: 30_000 });
  check("1440: выключили фотофиксацию — «Фото обязательно» скрыто", (await admin.getByTestId("reading-photo-required").count()) === 0);
  await shot(admin, "1440-03-off", { clip: await admin.getByTestId("reading-photo-settings").locator("xpath=ancestor::div[contains(@class,'rounded-3xl')][1]").boundingBox() });
  await clearEntries();
  await open(page, ROOM_URL);
  await startFresh(page);
  await page.locator("#room-fill-temperature").waitFor({ timeout: 30_000 });
  check("390 выключено: ни «Сфотографируйте показание», ни «Фото» — сразу поля, как раньше", (await page.getByTestId("reading-photo").count()) === 0 && (await page.locator("#room-fill-humidity").isVisible()) && (await page.getByTestId("room-fill-save").isVisible()));
  await shot(page, "390-11-off");
  // Вернуть по умолчанию.
  await admin.getByTestId("reading-photo-enabled").click();
  await admin.waitForTimeout(1500);
}

await browser.close();
await clearEntries();
await db.query(`DELETE FROM "PlatformSetting" WHERE key=$1`, [SETTING_KEY]);
await db.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
writeFileSync(`${SP}/ui-e2e.json`, JSON.stringify(results, null, 2));
process.exitCode = failed.length ? 1 : 0;
