// Сквозная проверка редактора переводов: телефон (iPhone 13) и компьютер.
// Запуск: E2E_EMAIL=... E2E_PASSWORD=... [CHROMIUM_PATH=...] node e2e.cjs (нужен next dev на :3000).
const { chromium, devices } = require("playwright");
const BASE = process.env.E2E_BASE || "http://localhost:3000";
const OUT = __dirname;
const env = (name) => { const v = process.env[name]; if (!v) throw new Error(`set ${name}`); return v; };
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail: detail ?? null }); console.log(ok ? "PASS" : "FAIL", name, detail ?? ""); };

// Один вход на весь прогон: у входа лимит 5 попыток за 5 минут.
let storageState = null;
async function login(browser, options) {
  if (storageState) return browser.newContext({ ...options, storageState });
  const context = await browser.newContext(options);
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { email: env("E2E_EMAIL"), password: env("E2E_PASSWORD"), csrfToken: csrf.csrfToken, callbackUrl: `${BASE}/dashboard`, json: "true" },
  });
  storageState = await context.storageState();
  return context;
}

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const rowKeys = (page) => page.getByTestId("translation-row").evaluateAll((rows) => rows.map((row) => row.dataset.key));
const rangeText = (page) => page.getByTestId("translation-range").innerText();
async function waitRange(page, pattern) {
  await page.waitForFunction((source) => new RegExp(source).test(document.querySelector('[data-testid="translation-range"]')?.textContent ?? ""), pattern.source, { timeout: 30000 });
}
async function apiEntry(context, key) {
  const body = await (await context.request.get(`${BASE}/api/translations?q=${encodeURIComponent(key)}`)).json();
  return body.entries.find((entry) => entry.key === key);
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  // ── Телефон ──────────────────────────────────────────────────────────
  const phone = await login(browser, { ...devices["iPhone 13"] });
  const page = await phone.newPage();
  const response = await page.goto(`${BASE}/translations`, { timeout: 180000 });
  check("phone: /translations opens", response.status() === 200, response.status());
  await page.getByTestId("translation-row").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/phone-1-initial.png` });
  check("phone: no horizontal scroll", await noHorizontalScroll(page));
  // boundingBox — координаты относительно видимой области.
  const screenHeight = page.viewportSize().height;
  const firstRowTop = (await page.getByTestId("translation-row").first().boundingBox()).y;
  check("phone: first row is on the first screen", firstRowTop + 120 < screenHeight, `row at y=${Math.round(firstRowTop)} of ${screenHeight}`);
  check("phone: desktop category column hidden", !(await page.getByTestId("translation-category-navigation").isVisible()));

  await page.getByTestId("translation-section-picker").click();
  await page.getByTestId("translation-sheet-category-navigation").waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/phone-2-sections-sheet.png` });
  await page.getByTestId("translation-sheet-category-filter").fill("навиг");
  await page.waitForTimeout(300);
  const filterBoxes = await page.locator('[data-testid^="translation-filter-"]').evaluateAll((nodes) => nodes.map((node) => node.scrollWidth <= node.clientWidth));
  check("phone: filter labels are not cut", filterBoxes.every(Boolean), JSON.stringify(filterBoxes));
  check("phone: section filter narrows the list", (await page.locator('[data-testid^="translation-sheet-category-"]:not([data-testid$="filter"])').count()) <= 3);
  await page.getByTestId("translation-sheet-category-navigation").click();
  await waitRange(page, /из 446/);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/phone-3-navigation.png` });
  const navKeys = await rowKeys(page);
  check("phone: section shows 100 rows", navKeys.length === 100, navKeys.length);
  check("phone: section picker shows the section", (await page.getByTestId("translation-section-picker").innerText()).includes("Меню и навигация"));
  const navTop = (await page.getByTestId("translation-row").first().boundingBox()).y;
  check("phone: rows visible right after choosing a section", navTop > 0 && navTop + 120 < screenHeight, `row at y=${Math.round(navTop)} of ${screenHeight}`);
  check("phone: compact pagination 1 of 5", (await page.getByTestId("translation-page-compact").innerText()).trim() === "1 из 5");

  await page.getByTestId("translation-page-next").scrollIntoViewIfNeeded();
  await page.getByTestId("translation-page-next").click();
  await waitRange(page, /101–200/);
  const phoneRangeBox = await page.getByTestId("translation-range").boundingBox();
  check("phone: next page scrolls back to the list top", phoneRangeBox.y > 0 && phoneRangeBox.y < screenHeight / 2, `range at y=${Math.round(phoneRangeBox.y)}`);
  const page2Keys = await rowKeys(page);
  check("phone: next page replaces rows (still 100)", page2Keys.length === 100 && page2Keys[0] !== navKeys[0] && !page2Keys.some((key) => navKeys.includes(key)), page2Keys[0]);
  check("phone: page 2 label", (await page.getByTestId("translation-page-compact").innerText()).trim() === "2 из 5");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/phone-4-page2.png` });

  // Глобальный поиск по узбекскому тексту.
  const search = page.getByRole("searchbox", { name: "Поиск по всем переводам" });
  await search.fill("Saqlash");
  await page.locator('[data-testid="translation-row"] mark').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  const searchKeys = await rowKeys(page);
  check("phone: search by Uzbek text finds strings across sections", searchKeys.length > 0 && !(await page.getByTestId("translation-section-picker").isVisible()), `${searchKeys.length} rows, ${await rangeText(page)}`);
  check("phone: matches are highlighted", (await page.locator('[data-testid="translation-row"] mark').count()) > 0);
  await page.screenshot({ path: `${OUT}/phone-5-search.png` });

  // Правка через окно строки.
  const key = "hygiene.table.qrPosters";
  const original = (await apiEntry(phone, key)).values.en;
  await search.fill("QR-плакаты");
  await page.locator(`[data-testid="translation-row"][data-key="${key}"]`).waitFor({ timeout: 30000 });
  await page.locator(`[data-testid="translation-row"][data-key="${key}"]`).click();
  const dialog = page.getByTestId("translation-row-editor");
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/phone-6-row-editor.png` });
  check("phone: row editor shows ru/en/uz", (await dialog.locator('textarea[data-testid^="translation-input-"]').count()) === 3);
  const saveBox = await dialog.getByTestId("translation-save").boundingBox();
  check("phone: save button visible without scrolling", saveBox && saveBox.y + saveBox.height <= screenHeight && saveBox.y > 0, saveBox && `y=${Math.round(saveBox.y)}`);
  const dialogBox = await dialog.boundingBox();
  check("phone: row editor is a full-width sheet at the bottom", dialogBox.width >= 389 && Math.abs(dialogBox.y + dialogBox.height - screenHeight) <= 1, `${Math.round(dialogBox.width)}×${Math.round(dialogBox.height)} at y=${Math.round(dialogBox.y)}`);
  await dialog.getByTestId("translation-input-en").fill("QR posters (E2E)");
  await dialog.getByTestId("translation-save").click();
  await dialog.getByTestId("translation-reset-en").waitFor({ timeout: 15000 });
  const saved = await apiEntry(phone, key);
  check("phone: edit saved", saved.values.en === "QR posters (E2E)" && saved.overridden.includes("en"));
  await page.screenshot({ path: `${OUT}/phone-7-saved.png` });
  await dialog.getByTestId("translation-reset-en").click();
  await dialog.getByTestId("translation-reset-en").waitFor({ state: "detached", timeout: 15000 });
  const reset = await apiEntry(phone, key);
  check("phone: reset returns the file value", reset.values.en === original && !reset.overridden.includes("en"), original);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 10000 });
  check("phone: no horizontal scroll after the flow", await noHorizontalScroll(page));

  // ── Компьютер ────────────────────────────────────────────────────────
  const desktop = await login(browser, { viewport: { width: 1440, height: 1000 } });
  const dp = await desktop.newPage();
  await dp.goto(`${BASE}/translations`, { timeout: 180000 });
  await dp.getByTestId("translation-row").first().waitFor({ timeout: 60000 });
  check("desktop: section picker hidden, column visible", !(await dp.getByTestId("translation-section-picker").isVisible()) && (await dp.getByTestId("translation-category-navigation").isVisible()));
  await dp.getByTestId("translation-category-navigation").click();
  await waitRange(dp, /из 446/);
  await dp.getByTestId("translation-page-3").click();
  await waitRange(dp, /201–300/);
  const rangeBox = await dp.getByTestId("translation-range").boundingBox();
  check("desktop: page change brings the list top into view", rangeBox.y > 0 && rangeBox.y < 400, `range at y=${Math.round(rangeBox.y)}`);
  check("desktop: numbered pagination jumps to page 3", (await rowKeys(dp)).length === 100, await rangeText(dp));
  check("desktop: current page marked", (await dp.getByTestId("translation-page-3").getAttribute("aria-current")) === "page");
  await dp.waitForTimeout(800);
  await dp.screenshot({ path: `${OUT}/desktop-1-pagination.png` });
  check("desktop: no horizontal scroll", await noHorizontalScroll(dp));

  await dp.getByRole("searchbox", { name: "Поиск по всем переводам" }).fill("o'zbek");
  await dp.locator('[data-testid="translation-row"][data-key="settingsManagement.organizationProfile.form.languageUz"]').waitFor({ timeout: 30000 }).catch(() => {});
  await waitRange(dp, /^Строки 1–\d+ из \d+$/);
  const uzKeys = await rowKeys(dp);
  check("desktop: Uzbek apostrophe variants match (o'zbek → O‘zbekcha)", uzKeys.includes("settingsManagement.organizationProfile.form.languageUz"), uzKeys.slice(0, 3).join(", "));
  await dp.waitForTimeout(500);
  await dp.screenshot({ path: `${OUT}/desktop-2-search.png` });
  await dp.getByTestId("translation-row").first().click();
  const dd = dp.getByTestId("translation-row-editor");
  await dd.waitFor();
  const firstTitle = await dd.locator("code").first().innerText();
  await dd.getByTestId("translation-row-next").click();
  await dp.waitForTimeout(300);
  const secondTitle = await dd.locator("code").first().innerText();
  check("desktop: next row in the editor", firstTitle !== secondTitle && secondTitle === uzKeys[1], `${firstTitle} → ${secondTitle}`);
  check("desktop: previous disabled on first row only", !(await dd.getByTestId("translation-row-prev").isDisabled()));
  await dp.screenshot({ path: `${OUT}/desktop-3-row-editor.png` });
  await dp.keyboard.press("Escape");
  await dd.waitFor({ state: "detached", timeout: 10000 });

  // Ревью: строка, открытая до прихода новых результатов, не закрывается сама.
  const dsearch = dp.getByRole("searchbox", { name: "Поиск по всем переводам" });
  await dsearch.fill("hygiene.table.qrPosters");
  await dp.getByTestId("translation-row").first().click();
  await dd.waitFor({ timeout: 10000 });
  await dp.locator('[data-testid="translation-row"][data-key="hygiene.table.qrPosters"]').waitFor({ state: "attached", timeout: 30000 });
  await dp.waitForTimeout(1500);
  check("desktop: row editor opened before new results stays open", await dd.isVisible());
  await dp.keyboard.press("Escape");
  await dd.waitFor({ state: "detached", timeout: 10000 });

  // Ревью: запрос длиннее лимита API не превращается в 400 со старыми строками.
  const longQuery = "Сохранить ".repeat(30).trim();
  const longResponse = dp.waitForResponse((response) => response.url().includes("/api/translations?") && response.url().includes("q="), { timeout: 30000 });
  await dsearch.fill(longQuery);
  const longStatus = (await longResponse).status();
  check("desktop: 299-char query is searched (200, not 400)", longStatus === 200, `${longQuery.length} chars → ${longStatus}`);

  await browser.close();
  require("fs").writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify({ when: new Date().toISOString(), base: BASE, checks }, null, 2));
  const failed = checks.filter((item) => !item.ok).length;
  console.log(`${checks.length - failed}/${checks.length} PASS`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
