// Сквозная проверка редактора переводов: адрес и «Назад», фильтр «Устарели»,
// автоперевод раздела (ответы ИИ подменяются — диспетчер локально не настроен),
// «Сохранить и далее», клавиши, история правок. Телефон (iPhone 13) и компьютер.
// Запуск: E2E_EMAIL=... E2E_PASSWORD=... [CHROMIUM_PATH=...] node e2e.cjs (next dev на :3000).
const { chromium, devices } = require("playwright");
const BASE = process.env.E2E_BASE || "http://localhost:3000";
const OUT = __dirname;
const env = (name) => { const v = process.env[name]; if (!v) throw new Error(`set ${name}`); return v; };
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail: detail ?? null }); console.log(ok ? "PASS" : "FAIL", name, detail ?? ""); };

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

const rowKeys = (page) => page.getByTestId("translation-row").evaluateAll((rows) => rows.map((row) => row.dataset.key));
const params = (page) => new URL(page.url()).searchParams;
async function waitRange(page, pattern) {
  await page.waitForFunction((source) => new RegExp(source).test(document.querySelector('[data-testid="translation-range"]')?.textContent ?? ""), pattern.source, { timeout: 30000 });
}
const dialogKey = (page) => page.getByTestId("translation-row-editor").locator("code").first().innerText();
async function put(context, key, locale, value) {
  const r = await context.request.put(`${BASE}/api/translations`, { data: { key, locale, value } });
  return r.status();
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  // ── Телефон: адрес, «Назад», ссылка на строку ─────────────────────────
  const phone = await login(browser, { ...devices["iPhone 13"] });
  const page = await phone.newPage();
  const screenHeight = page.viewportSize().height;
  await page.goto(`${BASE}/translations`, { timeout: 180000 });
  await page.getByTestId("translation-row").first().waitFor({ timeout: 60000 });
  const filterCut = await page.locator('[data-testid^="translation-filter-"]').evaluateAll((nodes) => nodes.map((node) => node.scrollWidth <= node.clientWidth));
  check("phone: four filters, labels not cut", filterCut.length === 4 && filterCut.every(Boolean), JSON.stringify(filterCut));
  check("phone: no horizontal scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const firstTop = (await page.getByTestId("translation-row").first().boundingBox()).y;
  check("phone: first row on the first screen", firstTop + 80 < screenHeight, `y=${Math.round(firstTop)} of ${screenHeight}`);
  await page.screenshot({ path: `${OUT}/phone-1-initial.png` });

  await page.getByTestId("translation-section-picker").click();
  await page.getByTestId("translation-sheet-category-navigation").click();
  await waitRange(page, /из 446/);
  check("phone: section in the address", params(page).get("section") === "navigation", page.url());
  await page.getByTestId("translation-page-next").scrollIntoViewIfNeeded();
  await page.getByTestId("translation-page-next").click();
  await waitRange(page, /101–200/);
  check("phone: page in the address", params(page).get("page") === "2", page.url());
  const page2Keys = await rowKeys(page);
  await page.getByTestId("translation-row").nth(3).click();
  await page.getByTestId("translation-row-editor").waitFor();
  check("phone: open row in the address", params(page).get("key") === page2Keys[3], params(page).get("key"));
  check("phone: position counts the whole section", (await page.getByTestId("translation-row-position").innerText()).trim() === "104 из 446");
  await page.screenshot({ path: `${OUT}/phone-2-row-editor.png` });
  await page.goBack();
  await page.getByTestId("translation-row-editor").waitFor({ state: "detached", timeout: 10000 });
  check("phone: «Назад» closes the row editor and keeps page 2", !params(page).get("key") && params(page).get("page") === "2", page.url());
  await page.goBack();
  await waitRange(page, /^Строки 1–100 из 446/);
  check("phone: «Назад» again — page 1 of the section", !params(page).get("page") && params(page).get("section") === "navigation", page.url());

  await page.goto(`${BASE}/translations?section=navigation&page=3&key=${encodeURIComponent(page2Keys[0])}`);
  await page.getByTestId("translation-row-editor").waitFor({ timeout: 60000 });
  await waitRange(page, /201–300/);
  check("phone: link opens section, page and the string", (await dialogKey(page)) === page2Keys[0], await dialogKey(page));
  await page.screenshot({ path: `${OUT}/phone-3-deep-link.png` });
  await page.getByRole("button", { name: "Закрыть" }).first().click().catch(() => page.keyboard.press("Escape"));
  await page.getByTestId("translation-row-editor").waitFor({ state: "detached", timeout: 10000 });
  check("phone: closing a linked row removes it from the address", !params(page).get("key") && params(page).get("page") === "3", page.url());

  // ── Компьютер ──────────────────────────────────────────────────────────
  const desktop = await login(browser, { viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const dp = await desktop.newPage();
  const K = "hygiene.table.qrPosters";
  const before = (await (await desktop.request.get(`${BASE}/api/translations?key=${K}`)).json()).entry;

  // «Устарели»: правка en, потом правка русского исходника.
  await put(desktop, K, "en", "QR posters (stale E2E)");
  await put(desktop, K, "ru", "QR-плакаты (E2E)");
  await dp.goto(`${BASE}/translations?section=journal-hygiene`, { timeout: 180000 });
  await dp.getByTestId("translation-row").first().waitFor({ timeout: 60000 });
  await dp.getByTestId("translation-filter-stale").click();
  await waitRange(dp, /^Строки 1–1 из 1$/);
  check("desktop: «Устарели» shows only the stale string", JSON.stringify(await rowKeys(dp)) === JSON.stringify([K]) && params(dp).get("filter") === "stale", (await rowKeys(dp)).join(","));
  await dp.screenshot({ path: `${OUT}/desktop-1-stale.png` });

  // История правок и «Вернуть прежний текст».
  await dp.getByTestId("translation-row").first().click();
  const dd = dp.getByTestId("translation-row-editor");
  await dd.getByTestId("translation-history-toggle").click();
  await dd.getByTestId("translation-history-item").first().waitFor({ timeout: 15000 });
  const firstItem = await dd.getByTestId("translation-history-item").first().innerText();
  check("desktop: history shows the latest edit first (ru)", /^RU/.test(firstItem.trim()) && firstItem.includes("QR-плакаты (E2E)"), firstItem.split("\n").slice(0, 2).join(" | "));
  const enItem = dd.getByTestId("translation-history-item").filter({ hasText: "QR posters (stale E2E)" }).first();
  await enItem.getByTestId("translation-history-restore-before").click();
  check("desktop: «Вернуть прежний текст» puts the old text into a draft", (await dd.getByTestId("translation-input-en").inputValue()) === before.values.en, await dd.getByTestId("translation-input-en").inputValue());
  await dd.getByTestId("translation-copy-link").click();
  const copied = await dp.evaluate(() => navigator.clipboard.readText());
  check("desktop: «Скопировать ссылку» copies the address with the string", new URL(copied).searchParams.get("key") === K && copied.includes("filter=stale"), copied);
  await dp.screenshot({ path: `${OUT}/desktop-2-history.png` });
  await dd.getByTestId("translation-undo-en").click();
  await dp.keyboard.press("Escape");
  await dd.waitFor({ state: "detached" });
  await put(desktop, K, "ru", null);
  await put(desktop, K, "en", null);

  // «Сохранить и далее», Ctrl+Enter, Alt+↓, переход через границу страницы.
  await dp.goto(`${BASE}/translations?section=navigation`);
  await dp.getByTestId("translation-row").first().waitFor({ timeout: 60000 });
  const navKeys = await rowKeys(dp);
  await dp.getByTestId("translation-row").first().click();
  const firstEn = await dd.getByTestId("translation-input-en").inputValue();
  await dd.getByTestId("translation-input-en").fill(`${firstEn} (E2E)`);
  await dd.getByTestId("translation-input-en").press("Control+Enter");
  await dp.waitForFunction((key) => document.querySelector('[data-testid="translation-row-editor"] code')?.textContent?.replace(/​/g, "") === key, navKeys[1], { timeout: 15000 });
  const savedFirst = (await (await desktop.request.get(`${BASE}/api/translations?key=${navKeys[0]}`)).json()).entry;
  check("desktop: Ctrl+Enter saves and opens the next string", savedFirst.values.en === `${firstEn} (E2E)` && (await dialogKey(dp)) === navKeys[1], await dialogKey(dp));
  await put(desktop, navKeys[0], "en", null);
  await dd.getByTestId("translation-input-en").press("Alt+ArrowDown");
  await dp.waitForTimeout(300);
  check("desktop: Alt+↓ — next string", (await dialogKey(dp)) === navKeys[2], await dialogKey(dp));
  await dp.keyboard.press("Escape");
  await dd.waitFor({ state: "detached" });
  await dp.getByTestId("translation-row").last().click();
  check("desktop: last row of the page is 100 of 446", (await dd.getByTestId("translation-row-position").innerText()).trim() === "100 из 446");
  await dd.getByTestId("translation-save-next").click();
  await waitRange(dp, /101–200/);
  await dp.waitForFunction(() => document.querySelector('[data-testid="translation-row-position"]')?.textContent?.trim() === "101 из 446", null, { timeout: 15000 });
  check("desktop: «Далее» on the last row opens the first string of the next page", params(dp).get("page") === "2" && (await dialogKey(dp)) === (await rowKeys(dp))[0], await dialogKey(dp));
  await dp.screenshot({ path: `${OUT}/desktop-3-next-page.png` });
  await dp.keyboard.press("Escape");
  await dd.waitFor({ state: "detached" });

  // Автоперевод всего раздела: «Без перевода» по всем строкам — несколько страниц и пачек.
  let autoCalls = 0;
  let autoDelay = 150;
  const requested = new Set();
  await dp.route("**/api/translations/auto", async (route) => {
    autoCalls += 1;
    const body = route.request().postDataJSON();
    if (autoCalls === 2) return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "rate_limited" }) });
    body.keys.forEach((key) => requested.add(key));
    await new Promise((resolve) => setTimeout(resolve, autoDelay));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ translations: Object.fromEntries(body.keys.map((key) => [key, `AUTO ${key}`])), rejected: [], skipped: [] }) });
  });
  await dp.goto(`${BASE}/translations?section=all&filter=untranslated`);
  await dp.getByTestId("translation-row").first().waitFor({ timeout: 60000 });
  const scope = await (await desktop.request.get(`${BASE}/api/translations?filter=untranslated&limit=1`)).json();
  const autoLabel = await dp.getByTestId("translation-auto-batch-en").getAttribute("aria-label");
  check("desktop: auto-translate counts the whole scope, not the page", autoLabel.includes(`(${scope.candidates.en})`) && scope.total > 100, `${autoLabel}, rows ${scope.total}`);
  await dp.getByTestId("translation-auto-batch-en").click();
  await dp.getByText(/Лимит автоперевода — продолжу через/).waitFor({ timeout: 20000 });
  check("desktop: 429 — waits and shows the countdown", true);
  await dp.screenshot({ path: `${OUT}/desktop-4-auto-wait.png` });
  await dp.getByTestId("translation-auto-progress").waitFor({ state: "detached", timeout: 120000 });
  const saveAll = await dp.getByTestId("translation-save-all").innerText();
  check("desktop: every candidate of the scope got a draft", requested.size === scope.candidates.en && saveAll.includes(`(${scope.candidates.en})`), `${requested.size} keys, ${autoCalls} calls, «${saveAll}»`);
  await dp.getByTestId("translation-page-next").click();
  await waitRange(dp, /101–200/);
  const draftsOnPage2 = await dp.locator('[data-testid="translation-row"]', { hasText: "AUTO " }).count();
  check("desktop: drafts are on the other pages too", draftsOnPage2 > 0, `${draftsOnPage2} rows with drafts on page 2`);
  await dp.getByRole("button", { name: "Отменить", exact: true }).click();

  // «Остановить»: после текущей пачки.
  autoCalls = 10;
  autoDelay = 1500;
  requested.clear();
  await dp.getByTestId("translation-auto-batch-en").click();
  await dp.getByText(/Перевожу… 30 из/).waitFor({ timeout: 20000 });
  await dp.getByTestId("translation-auto-stop").click();
  await dp.getByTestId("translation-auto-progress").waitFor({ state: "detached", timeout: 30000 });
  check("desktop: «Остановить» stops after the current batch", requested.size > 0 && requested.size < scope.candidates.en, `${requested.size} of ${scope.candidates.en}`);
  await dp.screenshot({ path: `${OUT}/desktop-5-auto-stopped.png` });
  await dp.getByRole("button", { name: "Отменить", exact: true }).click().catch(() => {});

  check("desktop: no horizontal scroll", await dp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await browser.close();
  require("fs").writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify({ when: new Date().toISOString(), base: BASE, checks }, null, 2));
  const failed = checks.filter((item) => !item.ok).length;
  console.log(`${checks.length - failed}/${checks.length} PASS`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
