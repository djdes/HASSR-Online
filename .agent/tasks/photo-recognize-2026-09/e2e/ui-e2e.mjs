// AC3: «С фото» end-to-end in the real UI (dev server + vision mock), screenshots 1440 and 390.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire("C:/wt/qrforms/package.json");
const { chromium } = require("playwright-core");

const EXE = "C:/Users/Yaroslav/AppData/Local/ms-playwright/chromium-1232/chrome-win64/chrome.exe";
const BASE = "http://localhost:3042";
const EV = "C:/wt/qrforms/.agent/tasks/photo-recognize-2026-09/evidence";
const SP = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/c--www-Users-OrdersFlow/219cb6e5-0fbd-4c76-b9bc-bdaadd99e88b/scratchpad/photo-agent";
const MOCK = `${SP}/vision-mock.json`;
const MENU_PNG = `${EV}/ac1-menu-readable.png`;
const INVOICE_PNG = `${EV}/ac1-invoice.png`;
const DOCS = {
  finished: "/journals/finished_product/documents/cmugz8bay0043kw9maxsfird1",
  perishable: "/journals/perishable_rejection/documents/cmugz8be4004wkw9m4c6zxqt4",
  acceptance: "/journals/incoming_control/documents/cmugz8bag0041kw9md2gupqpx",
};
const REGULAR_ORG = "cmugz8a670000kw9mfvb6611i";
const env = Object.fromEntries(
  readFileSync("C:/wt/qrforms/.env", "utf8")
    .split(/\r?\n/)
    .map((line) => /^([A-Z_]+)=(.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"|"$/g, "")])
);
const originalMock = readFileSync(MOCK, "utf8");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const shot = (page, name) => page.screenshot({ path: `${EV}/${name}.png` });

async function login(context) {
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email: "admin@haccp.local", password: env.ADMIN_PASSWORD, json: "true" },
  });
  const session = await (await context.request.get(`${BASE}/api/auth/session`)).json();
  // Окно «Как заполнять» всплывает при первом заходе в журнал — для проверки отмечаем его прочитанным.
  for (const code of ["finished_product", "perishable_rejection", "incoming_control"]) {
    await context.request.post(`${BASE}/api/me/notices`, { data: { key: `fill-guide:${code}` } });
  }
  return session?.user;
}

async function dismissGuide(page) {
  const done = page.getByRole("button", { name: "Понятно" });
  if (await done.isVisible().catch(() => false)) await done.click();
}

async function switchOrg(context, organizationId) {
  const response = await context.request.post(`${BASE}/api/me/active-organization`, { data: { organizationId } });
  return response.status();
}

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  await dismissGuide(page);
}

async function menuItem(page, label) {
  // До гидратации клик по сплит-кнопке может не открыть меню — пробуем ещё раз.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await dismissGuide(page);
    await page.getByRole("button", { name: /^Добавить$/ }).first().click();
    const item = page
      .locator(`[role="menuitem"]:has-text("${label}"), button:has-text("${label}")`)
      .filter({ visible: true })
      .first();
    if (await item.waitFor({ state: "visible", timeout: 6000 }).then(() => true, () => false)) {
      await item.click();
      return;
    }
    await page.screenshot({ path: `${SP}/menu-fail-${attempt}.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
  }
  throw new Error(`menu item not found: ${label}`);
}

/** Photo → «Распознать» → review; returns the review row count. */
async function recognize(page, inputTestId, file, shots = {}) {
  await page.setInputFiles(`[data-testid="${inputTestId}"]`, file);
  const dialog = page.locator('[data-testid="photo-recognize-dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-testid="photo-recognize-submit"]').waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('[data-testid="photo-recognize-submit"]')?.hasAttribute("disabled"));
  if (shots.photos) await shot(page, shots.photos);
  await page.locator('[data-testid="photo-recognize-submit"]').click();
  if (shots.progress) {
    await page.locator('[data-testid="photo-recognize-progress"]').waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(1200);
    await shot(page, shots.progress);
  }
  await page.waitForSelector('[data-testid="photo-recognize-dialog"][data-phase="review"], [data-testid="photo-recognize-dialog"][data-phase="error"], [data-testid="photo-recognize-dialog"][data-phase="empty"]', { timeout: 120_000 });
  const phase = await dialog.getAttribute("data-phase");
  if (phase !== "review") return { phase, rows: 0 };
  const rows = await page.locator('[data-testid^="photo-recognize-row-"]').count();
  if (shots.review) await shot(page, shots.review);
  return { phase, rows };
}

async function addFromReview(page) {
  await page.locator('[data-testid="photo-recognize-add"]').click();
  await page.locator('[data-testid="photo-recognize-dialog"]').waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
}

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox"] });
try {
  /* ─────────────── Desktop 1440 ─────────────── */
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const user = await login(desktop);
  check("вход (1440)", Boolean(user?.id));
  await switchOrg(desktop, REGULAR_ORG);
  const page = await desktop.newPage();

  // 1. БЖГП «Добавить списком» (общий диалог с мастер-кабинетом).
  await open(page, DOCS.finished);
  await menuItem(page, "Добавить списком");
  await page.locator('[data-testid="bulk-dish-table"]').waitFor({ timeout: 60_000 });
  check("БЖГП: кнопка «С фото» в окне «Добавить списком»", await page.locator('[data-testid="bulk-photo"]').isVisible());
  await shot(page, "e2e-1440-01-bjgp-dialog");
  let r = await recognize(page, "bulk-photo-input", MENU_PNG, {
    photos: "e2e-1440-02-photo-step",
    progress: "e2e-1440-03-recognizing",
    review: "e2e-1440-04-review-menu",
  });
  check("БЖГП: распознано 5 строк (таблица проверки)", r.phase === "review" && r.rows === 5, JSON.stringify(r));
  // Снимаем галку с «Кисель клюквенный» и правим выход у первой строки.
  await page.locator('[data-testid="photo-recognize-check-2"]').click();
  await page.locator('[data-testid="photo-recognize-yield-0"]').fill("250/20");
  const addLabel = await page.locator('[data-testid="photo-recognize-add"]').innerText();
  check("БЖГП: кнопка «Добавить 4 строки» после снятия галки", /Добавить 4 строки/.test(addLabel), addLabel);
  await addFromReview(page);
  const names = await page.$$eval('[data-testid^="bulk-name-"]', (els) => els.map((el) => el.value).filter(Boolean));
  const yield0 = await page.inputValue('[data-testid="bulk-yield-0"]');
  check(
    "БЖГП: выбранные строки попали в таблицу окна (без снятой, с правкой)",
    names.length === 4 && names[0] === "Солянка сборная мясная" && !names.includes("Кисель клюквенный") && yield0 === "250/20",
    `${names.join(" | ")} ; выход[0]=${yield0}`
  );
  await shot(page, "e2e-1440-05-bjgp-filled");
  await page.keyboard.press("Escape");

  // 2. Скоропорт «Добавить списком» → строки журнала с полями сырья.
  await open(page, DOCS.perishable);
  await menuItem(page, "Добавить списком");
  await page.locator('[data-testid="perishable-photo"]').waitFor({ timeout: 60_000 });
  await shot(page, "e2e-1440-06-perishable-dialog");
  r = await recognize(page, "perishable-photo-input", INVOICE_PNG, { review: "e2e-1440-07-perishable-review" });
  check("Скоропорт: распознано 4 позиции сырья", r.phase === "review" && r.rows === 4, JSON.stringify(r));
  await addFromReview(page);
  await page.waitForTimeout(2500); // автосохранение
  await dismissGuide(page);
  // Наименование в таблице — поле ввода (его текста нет в innerText), изготовитель/поставщик — текстом ячейки.
  const inputValues = await page.$$eval("input, textarea", (els) => els.map((el) => el.value));
  const perishableText = await page.locator("body").innerText();
  check(
    "Скоропорт: строки появились в журнале с изготовителем/поставщиком",
    (inputValues.includes("Филе куриное охл.") || perishableText.includes("Филе куриное охл.")) && perishableText.includes("ООО «Приосколье» / ООО «Северная ферма»"),
    `наименования: ${inputValues.filter((v) => /Молоко|Творог|Сметана|Филе/.test(v)).join(" | ")}`
  );
  const saved = await page.request.get(`${BASE}/api/journal-documents/cmugz8be4004wkw9m4c6zxqt4`).catch(() => null);
  const savedText = saved ? await saved.text() : "";
  check("Скоропорт: строки сохранены на сервере", savedText.includes("Филе куриное охл.") && savedText.includes("2026-09-28"), `status=${saved?.status()}`);
  await page.locator('input[value="Филе куриное охл."]').last().scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, "e2e-1440-08-perishable-rows");

  // 3. Входной контроль «Добавить несколько строк» → «С фото накладной».
  await open(page, DOCS.acceptance);
  await menuItem(page, "Добавить несколько строк");
  await page.locator('[data-testid="acceptance-photo"]').waitFor({ timeout: 60_000 });
  await shot(page, "e2e-1440-09-acceptance-dialog");
  r = await recognize(page, "acceptance-photo-input", INVOICE_PNG);
  check("Входной контроль: распознано 4 позиции", r.phase === "review" && r.rows === 4, JSON.stringify(r));
  await addFromReview(page);
  await page.waitForTimeout(2500);
  const accSaved = await (await page.request.get(`${BASE}/api/journal-documents/cmugz8bag0041kw9md2gupqpx`)).text();
  check(
    "Входной контроль: строки записаны в журнал (наименование, изготовитель, поставщик, годен до, объём)",
    accSaved.includes("Сметана 20%") && accSaved.includes("ООО «Приосколье»") && accSaved.includes("2026-10-05") && accSaved.includes("8 кг"),
    ""
  );
  const accText = await page.locator("body").innerText();
  check("Входной контроль: строки видны в таблице", accText.includes("Сметана 20%") || (await page.$$eval("input", (els) => els.some((el) => el.value === "Сметана 20%"))));
  await page.getByText("Сметана 20%").last().scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, "e2e-1440-10-acceptance-rows");

  // 4. Мастер-кабинет: создаём кабинет пула и переключаемся в него.
  const created = await desktop.request.post(`${BASE}/api/settings/master-cabinet`, {
    data: { name: "Бэк-офис Проверка", email: "backoffice.photo-e2e@example.com" },
  });
  const createdJson = await created.json();
  check("мастер-кабинет создан/найден", created.ok(), `${created.status()} ${createdJson.master?.organizationId ?? createdJson.error}`);
  const masterId = createdJson.master?.organizationId;
  check("переключение в мастер-кабинет", (await switchOrg(desktop, masterId)) === 200);
  await open(page, "/master");
  await page.locator('[data-testid="master-paste-dish"]').waitFor({ timeout: 120_000 });
  await page.locator('[data-testid="master-paste-dish"]').click();
  await page.locator('[data-testid="master-menu-table"]').waitFor();
  check("Мастер-кабинет, меню: кнопка «С фото» в таблице меню", await page.locator('[data-testid="menu-photo"]').isVisible());
  r = await recognize(page, "menu-photo-input", MENU_PNG);
  check("Мастер-кабинет, меню: распознано 5 блюд (сессия мастер-кабинета пропущена в API)", r.phase === "review" && r.rows === 5, JSON.stringify(r));
  await addFromReview(page);
  const menuNames = await page.$$eval('[data-testid^="menu-name-"]', (els) => els.map((el) => el.value).filter(Boolean));
  const menuTime = await page.inputValue('[data-testid="menu-time-3"] input, input[data-testid="menu-time-3"]').catch(() => "");
  check("Мастер-кабинет, меню: 5 строк с выходом и временем в таблице", menuNames.length === 5 && menuNames[3] === "Запеканка творожная с изюмом", `${menuNames.join(" | ")} ; время[3]=${menuTime}`);
  await shot(page, "e2e-1440-11-master-menu-filled");
  await page.keyboard.press("Escape");

  await page.locator('[data-testid="master-tab-raw"]').click();
  await page.locator('[data-testid="master-photo-product"]').waitFor({ timeout: 30_000 });
  check("Мастер-кабинет, сырьё: кнопка «С фото» рядом с «Вставить списком»", await page.locator('[data-testid="master-photo-product"]').isVisible());
  await shot(page, "e2e-1440-12-master-raw-panel");
  r = await recognize(page, "master-photo-product-input", INVOICE_PNG, { review: "e2e-1440-13-master-raw-review" });
  check("Мастер-кабинет, сырьё: 4 позиции (наименование, поставщик, изготовитель)", r.phase === "review" && r.rows === 4, JSON.stringify(r));
  await addFromReview(page);
  await page.locator('[data-testid="master-preview"]').waitFor({ timeout: 30_000 });
  const summary = await page.locator('[data-testid="master-preview-summary"]').innerText();
  check("Мастер-кабинет, сырьё: предпросмотр различий «Добавится 4»", /Добавится 4/.test(summary), summary);
  await shot(page, "e2e-1440-14-master-raw-preview");
  await page.getByRole("button", { name: "Сохранить и разослать" }).click();
  await page.locator('[data-testid="master-list-product"]').waitFor({ timeout: 30_000 });
  const listText = await page.locator('[data-testid="master-list-product"]').innerText();
  check(
    "Мастер-кабинет, сырьё: после сохранения в справочнике 4 позиции с поставщиком и изготовителем",
    listText.includes("Филе куриное охл.") && listText.includes("ООО «Приосколье»") && listText.includes("ООО «Северная ферма»"),
    listText.replace(/\s+/g, " ").slice(0, 200)
  );
  await shot(page, "e2e-1440-15-master-raw-saved");

  // «Добавить в журналы на дату» — то же окно, что БЖГП: кнопка на месте.
  await page.locator('[data-testid="master-tab-menu"]').click();
  await page.locator('[data-testid="master-brakerage-open"]').click();
  await page.locator('[data-testid="master-brakerage-dialog"]').waitFor();
  check("Мастер-кабинет «Добавить в журналы на дату»: кнопка «С фото»", await page.locator('[data-testid="master-brakerage-dialog"] [data-testid="bulk-photo"]').isVisible());
  await page.locator('[data-testid="master-brakerage-dialog"] [data-testid="bulk-photo"]').scrollIntoViewIfNeeded();
  await shot(page, "e2e-1440-16-master-brakerage");
  await desktop.close();

  /* ─────────────── Mobile 390 ─────────────── */
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: "ru-RU",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  });
  await login(mobile);
  await switchOrg(mobile, REGULAR_ORG);
  const phone = await mobile.newPage();

  await open(phone, DOCS.finished);
  await menuItem(phone, "Добавить списком");
  await phone.locator('[data-testid="bulk-dish-table"]').waitFor({ timeout: 60_000 });
  const button = await phone.locator('[data-testid="bulk-photo"]').boundingBox();
  check("390: «С фото» в БЖГП не ниже 48 px", Boolean(button && button.height >= 48), JSON.stringify(button));
  await phone.locator('[data-testid="bulk-photo"]').scrollIntoViewIfNeeded();
  await shot(phone, "e2e-390-01-bjgp-dialog");
  r = await recognize(phone, "bulk-photo-input", MENU_PNG, { photos: "e2e-390-02-photo-step", review: "e2e-390-03-review" });
  check("390: БЖГП — распознано 5 строк", r.phase === "review" && r.rows === 5, JSON.stringify(r));
  const addBox = await phone.locator('[data-testid="photo-recognize-add"]').boundingBox();
  check("390: «Добавить N строк» не ниже 48 px", Boolean(addBox && addBox.height >= 48), JSON.stringify(addBox));
  const galleryVisible = await phone.getByText("Выбрать из галереи").count();
  await addFromReview(phone);
  const phoneNames = await phone.$$eval('[data-testid^="bulk-name-"]', (els) => els.map((el) => el.value).filter(Boolean));
  check("390: строки попали в таблицу окна", phoneNames.length === 5, phoneNames.join(" | "));
  await shot(phone, "e2e-390-04-bjgp-filled");
  await phone.keyboard.press("Escape");

  // Пустой результат и ошибка — тем же окном (мок: пустой список, потом «не успели»).
  writeFileSync(MOCK, JSON.stringify({ ...JSON.parse(originalMock), raw: '{"items":[]}' }));
  await open(phone, DOCS.perishable);
  await menuItem(phone, "Добавить списком");
  await phone.locator('[data-testid="perishable-photo"]').waitFor({ timeout: 60_000 });
  await phone.locator('[data-testid="perishable-photo"]').scrollIntoViewIfNeeded();
  await shot(phone, "e2e-390-05-perishable-dialog");
  r = await recognize(phone, "perishable-photo-input", INVOICE_PNG);
  const emptyText = await phone.locator('[data-testid="photo-recognize-empty"]').innerText().catch(() => "");
  check("390: пустой результат — «Ничего не распознали»", r.phase === "empty" && /Ничего не распознали/.test(emptyText), r.phase);
  await shot(phone, "e2e-390-06-empty");
  writeFileSync(MOCK, JSON.stringify({ ...JSON.parse(originalMock), raw: "__timeout__" }));
  await phone.locator("button", { hasText: "Сфотографировать ещё раз" }).click();
  r = await recognize(phone, "perishable-photo-input", INVOICE_PNG);
  const errorText = await phone.locator('[data-testid="photo-recognize-error"]').innerText().catch(() => "");
  check("390: ошибка — понятный текст «не успели… введите вручную»", r.phase === "error" && /Не успели распознать/.test(errorText), errorText);
  await shot(phone, "e2e-390-07-error");
  writeFileSync(MOCK, originalMock);
  await phone.keyboard.press("Escape");

  // Мастер-кабинет на телефоне: кнопка в таблице меню и во «Вставить списком» сырья.
  await switchOrg(mobile, masterId);
  await open(phone, "/master");
  await phone.locator('[data-testid="master-paste-dish"]').click({ timeout: 120_000 });
  await phone.locator('[data-testid="menu-photo"]').scrollIntoViewIfNeeded();
  const menuBtn = await phone.locator('[data-testid="menu-photo"]').boundingBox();
  check("390: «С фото» в таблице меню мастер-кабинета не ниже 48 px", Boolean(menuBtn && menuBtn.height >= 48), JSON.stringify(menuBtn));
  await shot(phone, "e2e-390-08-master-menu");
  await phone.keyboard.press("Escape");
  await phone.locator('[data-testid="master-tab-raw"]').click();
  await phone.locator('[data-testid="master-photo-product"]').scrollIntoViewIfNeeded();
  const rawBtn = await phone.locator('[data-testid="master-photo-product"]').boundingBox();
  check("390: «С фото» в сырье мастер-кабинета не ниже 48 px", Boolean(rawBtn && rawBtn.height >= 48), JSON.stringify(rawBtn));
  await shot(phone, "e2e-390-09-master-raw");
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("390: без горизонтальной прокрутки", overflow <= 0, `overflow=${overflow}`);
  console.log(`gallery link on coarse pointer: ${galleryVisible}`);
  await switchOrg(mobile, REGULAR_ORG);
  await mobile.close();
} finally {
  writeFileSync(MOCK, originalMock);
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
