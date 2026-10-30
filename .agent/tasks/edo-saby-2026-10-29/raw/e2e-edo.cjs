// E2E ЭДО против локальной заглушки Saby (живой Saby не вызывается):
// подключение кабинета → наши организации → определение получателя по ИНН → отправка договора
// файлом → «Ждёт подписи в Saby» со ссылкой → «Обновить статусы» → «Подписан» → повтор не создаёт дубль.
//
// Запуск: dev-сервер на 3032 с SABY_DEV_BASE_URL=http://127.0.0.1:4555, затем
//   node .agent/tasks/edo-saby-2026-10-29/raw/e2e-edo.cjs
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const { createMockSaby, GOOD_CLIENT, GOOD_SECRET } = require("./mock-saby.cjs");
const { seed, readCabinetRow, ROOT_EMAIL, ROOT_PASSWORD } = require("./e2e-seed.cjs");

const BASE = process.env.E2E_BASE_URL || "http://localhost:3032";
const MOCK_PORT = 4555;
const SHOTS = process.env.E2E_SHOTS || path.join(require("os").tmpdir(), "edo-e2e-shots");
const CHROME = "C:\\Users\\Two\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`check failed: ${name} ${detail}`);
}

function whatsNewVersion() {
  const repo = path.resolve(__dirname, "../../../..");
  return execFileSync(process.execPath, ["--import", "tsx", "-e", "import('./src/lib/whats-new-notes.ts').then(m => process.stdout.write((m.whatsNewVersion ?? m.default.whatsNewVersion)()))"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

async function login(page) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForSelector("#email", { timeout: 120_000 });
      await page.fill("#email", ROOT_EMAIL);
      await page.fill("#password", ROOT_PASSWORD);
      await page.click("form button[type=submit]:visible");
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
      return;
    } catch (e) {
      console.log(`login attempt ${attempt} failed: ${e.message.split("\n")[0]}`);
      if (attempt === 6) throw e;
    }
  }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await seed();
  const mock = createMockSaby(MOCK_PORT);
  await mock.listen();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
    const host = new URL(BASE).hostname;
    await context.addCookies([{ name: "wesetup-whats-new", value: whatsNewVersion(), domain: host, path: "/" }]);
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    await login(page);

    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && page.url().includes("/root/edo")) pageErrors.push(`console: ${m.text()}`);
    });
    await page.goto(`${BASE}/root/edo`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector("[data-testid=edo-cabinet-card]", { timeout: 180_000 });
    check("страница /root/edo открылась, пункт «ЭДО» в навигации", (await page.locator('a[href="/root/edo"]').count()) > 0);
    await page.screenshot({ path: path.join(SHOTS, "01-empty.png"), fullPage: true, caret: "initial" });

    // 1. Подключение кабинета (неверный ключ → ошибка, затем верный).
    await page.fill('input[name="edo-client-id"]', GOOD_CLIENT);
    await page.fill('input[name="edo-app-secret"]', "wrong-secret");
    await page.selectOption('select[name="edo-base-url"]', `http://127.0.0.1:${MOCK_PORT}`);
    await page.click("[data-testid=edo-cabinet-save]");
    await page.waitForSelector("[data-testid=edo-cabinet-status]");
    check("неверный ключ: кабинет сохранён, но «Требует внимания»", (await page.textContent("[data-testid=edo-cabinet-status]")).includes("Требует"));
    check("причина отказа видна", (await page.textContent("[data-testid=edo-cabinet-card]")).includes("не принял ключи"));

    await page.getByRole("button", { name: "Заменить ключи" }).click();
    await page.fill('input[name="edo-client-id"]', GOOD_CLIENT);
    await page.fill('input[name="edo-app-secret"]', GOOD_SECRET);
    await page.selectOption('select[name="edo-base-url"]', `http://127.0.0.1:${MOCK_PORT}`);
    await page.click("[data-testid=edo-cabinet-save]");
    await page.waitForFunction(() => document.querySelector("[data-testid=edo-cabinet-status]")?.textContent?.includes("Готов"));
    check("верный ключ: «Готов к отправке»", true);
    const ourOrgs = await page.locator("[data-testid=edo-our-orgs] li").count();
    check("наши организации из Saby показаны", ourOrgs === 2, `${ourOrgs}`);
    const sender = await page.locator('[data-testid=edo-our-orgs] li[data-sender="true"]').textContent();
    check("ООО «БФС» подсвечено как отправитель", sender.includes("5018215599") && sender.includes("отправитель"), sender);
    check("поле защищённого ключа очищено/скрыто", (await page.locator('input[name="edo-app-secret"]').count()) === 0);

    const api = await page.request.get(`${BASE}/api/root/edo/cabinet`);
    const apiText = await api.text();
    check("API кабинета не отдаёт ключ и сессию", !apiText.includes(GOOD_SECRET) && !apiText.includes("tok-") && !apiText.includes("appSecret"));
    const rows = await readCabinetRow();
    check("в БД ключ и сессия зашифрованы", rows.length === 1 && !rows[0].appSecretEnc.includes(GOOD_SECRET) && rows[0].sessionEnc && !rows[0].sessionEnc.includes("tok-"));
    await page.screenshot({ path: path.join(SHOTS, "02-connected.png"), fullPage: true, caret: "initial" });

    // 2. Клиент → определение по ИНН.
    await page.click("[data-testid=edo-org-search]");
    await page.fill("[data-testid=edo-org-search]", "7707");
    await page.locator("[data-testid=edo-org-option]", { hasText: "Доброе кафе" }).first().click();
    await page.waitForSelector("[data-testid=edo-recipient-note]");
    const note = await page.locator("[data-testid=edo-recipient-note]").first();
    check("получатель найден по ИНН: роуминг через Контур", (await note.getAttribute("data-kind")) === "roaming" && (await note.textContent()).includes("Контур"), await note.textContent());

    // 3. Договор файлом.
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    await page.setInputFiles("[data-testid=edo-file-input]", { name: "Договор № E2E-1 29.10.2026.pdf", mimeType: "application/pdf", buffer: pdf });
    check("номер подставлен из имени файла", (await page.inputValue('input[name="edo-number"]')) === "E2E-1");
    check("дата подставлена из имени файла", (await page.inputValue('input[name="edo-date"]')) === "2026-10-29");
    await page.click("[data-testid=edo-send-submit]");
    await page.waitForSelector("[data-testid=edo-send-result]");
    const signHref = await page.locator("[data-testid=edo-send-result] [data-testid=edo-sign-link]").getAttribute("href");
    check("после отправки — ссылка «Подписать в Saby»", signHref && signHref.startsWith(`http://127.0.0.1:${MOCK_PORT}/page/doc/`), signHref);
    check("подсказка про КЭП в Saby", (await page.textContent("[data-testid=edo-send-result]")).includes("Подписать и отправить"));
    const row = page.locator("[data-testid=edo-history-row]").first();
    check("в истории — «Ждёт подписи в Saby»", (await row.locator("[data-testid=edo-status-chip]").getAttribute("data-kind")) === "draft");
    check("в истории — ссылка на подпись", (await row.locator("[data-testid=edo-sign-link]").count()) === 1);
    const written = (await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/calls`)).json()).docs;
    check("в Saby записан один ДоговорДок от БФС клиенту по реквизитам", written.length === 1 && written[0].type === "ДоговорДок" && written[0].ours.СвЮЛ.ИНН === "5018215599" && written[0].contractor.СвЮЛ.ИНН === "7707083893" && written[0].contractor.СвЮЛ.КПП === "773601001" && written[0].number === "E2E-1" && written[0].date === "29.10.2026" && written[0].files[0].name === "Договор № E2E-1 29.10.2026.pdf", JSON.stringify(written[0]));
    await page.screenshot({ path: path.join(SHOTS, "03-sent.png"), fullPage: true, caret: "initial" });

    // 4. Тот же файл ещё раз, пока черновик — перезапись того же документа, а не второй.
    await page.setInputFiles("[data-testid=edo-file-input]", { name: "Договор № E2E-1 29.10.2026.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.click("[data-testid=edo-send-submit]");
    await page.waitForFunction(() => document.querySelector("[data-testid=edo-send-result]")?.textContent?.includes("обновлён"));
    const afterRewrite = (await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/calls`)).json()).docs;
    check("повтор черновика: тот же документ перезаписан, дубля нет", afterRewrite.length === 1 && afterRewrite[0].writes === 2);
    check("в истории по-прежнему одна строка", (await page.locator("[data-testid=edo-history-row]").count()) === 1);

    // 5. Человек подписал в Saby → «Обновить статусы».
    await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/state`, { method: "POST", body: JSON.stringify({ code: 7, name: "Выполнение завершено успешно" }) });
    await page.click("[data-testid=edo-refresh]");
    await page.waitForFunction(() => document.querySelector("[data-testid=edo-history-row] [data-testid=edo-status-chip]")?.getAttribute("data-kind") === "done");
    check("после «Обновить статусы» — «Подписан»", true);

    // 6. Подписанный документ повторно не отправляется.
    await page.setInputFiles("[data-testid=edo-file-input]", { name: "Договор № E2E-1 29.10.2026.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.click("[data-testid=edo-send-submit]");
    await page.waitForSelector("[data-testid=edo-send-error]");
    check("повтор подписанного — отказ без второго документа", (await page.textContent("[data-testid=edo-send-error]")).includes("уже в Saby"));
    const finalDocs = (await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/calls`)).json()).docs;
    check("в Saby по-прежнему один документ", finalDocs.length === 1);
    await page.screenshot({ path: path.join(SHOTS, "04-signed.png"), fullPage: true, caret: "initial" });

    // 6b. Счёт и УПД из WeSetup — без файлов, выбором из списка клиента.
    await page.click("[data-testid=edo-kind-invoice]");
    await page.locator("[data-testid=edo-send-form] [role=radiogroup] button", { hasText: "Счёт №" }).first().click();
    await page.click("[data-testid=edo-send-submit]");
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=edo-history-row]").length === 2);
    await page.click("[data-testid=edo-kind-upd]");
    await page.locator("[data-testid=edo-send-form] [role=radiogroup] button", { hasText: "УПД №" }).first().click();
    await page.click("[data-testid=edo-send-submit]");
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=edo-history-row]").length === 3);
    const allDocs = (await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/calls`)).json()).docs;
    const inv = allDocs.find((d) => d.type === "СчетИсх");
    const upd = allDocs.find((d) => d.type === "ДокОтгрИсх");
    check("счёт записан как СчетИсх с PDF", inv && inv.files.length === 1 && /^Счёт № \d+ от \d{2}\.\d{2}\.\d{4}\.pdf$/.test(inv.files[0].name) && inv.files[0].size > 1000, JSON.stringify(inv?.files));
    check("УПД записан как ДокОтгрИсх с PDF", upd && upd.files.length === 1 && /^УПД № \d+ от \d{2}\.\d{2}\.\d{4}\.pdf$/.test(upd.files[0].name) && upd.files[0].size > 1000, JSON.stringify(upd?.files));
    const rowsNow = page.locator("[data-testid=edo-history-row] [data-testid=edo-status-chip]");
    check("счёт и УПД ждут подписи в Saby", (await rowsNow.nth(0).getAttribute("data-kind")) === "draft" && (await rowsNow.nth(1).getAttribute("data-kind")) === "draft");
    // Тот же счёт ещё раз — перезапись черновика, не второй документ.
    const again = await page.request.post(`${BASE}/api/root/edo/documents`, { data: { organizationId: "org-one", kind: "invoice", sourceId: inv.number } });
    const againJson = await again.json();
    check("повтор счёта по API — тот же черновик (rewritten)", again.ok() && againJson.rewritten === true && (await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/calls`)).json()).docs.length === 3);
    const foreign = await page.request.post(`${BASE}/api/root/edo/documents`, { data: { organizationId: "org-dk", kind: "invoice", sourceId: inv.number } });
    check("чужой счёт для другой организации — 400", foreign.status() === 400, String(foreign.status()));
    const missingContract = await page.request.post(`${BASE}/api/root/edo/documents`, { data: { organizationId: "org-one", kind: "contract", sourceId: "c1" } });
    check("несуществующий договор — понятная ошибка", missingContract.status() === 400 && (await missingContract.json()).error.includes("не найден"));
    // Договор, выпущенный в карточке клиента, уходит в Saby одним кликом (2026-10-30).
    const card = await (await page.request.get(`${BASE}/api/root/organizations/org-one/contracts`)).json();
    const issued = await page.request.post(`${BASE}/api/root/organizations/org-one/contracts`, { data: card.context?.defaults ?? card.defaults });
    const issuedJson = await issued.json();
    check("договор выпущен в карточке клиента", issued.ok() && /^WS-\d{4}\/\d{4}$/.test(issuedJson.contract?.number ?? ""), JSON.stringify(issuedJson).slice(0, 200));
    const contractSend = await page.request.post(`${BASE}/api/root/edo/documents`, { data: { organizationId: "org-one", kind: "contract", sourceId: issuedJson.contract?.id } });
    const docsAfter = (await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/calls`)).json()).docs;
    const contractDoc = docsAfter.find((doc) => doc.type === "ДоговорДок" && doc.number === issuedJson.contract?.number);
    check("договор из WeSetup записан в Saby как ДоговорДок с PDF", contractSend.ok() && contractDoc && contractDoc.files.length === 1 && contractDoc.files[0].name.endsWith(".pdf") && contractDoc.files[0].size > 1000, JSON.stringify(contractDoc?.files));
    await page.goto(`${BASE}/root/organizations/org-one`, { waitUntil: "load" });
    await page.waitForSelector("#documents [data-testid=client-contract-card]");
    check("в карточке клиента у договора есть кнопка «В ЭДО»", (await page.locator("#documents [data-testid=edo-send-button], #documents a[href*='saby'], #documents [data-testid=edo-sign-link]").count()) > 0);
    check("в оплатах клиента есть «В ЭДО» у счёта", (await page.locator("#billing [data-testid=edo-send-button], #billing [data-testid=edo-sign-link]").count()) > 0);
    await page.goto(`${BASE}/root/edo`, { waitUntil: "load" });
    await page.screenshot({ path: path.join(SHOTS, "04b-invoice-upd.png"), fullPage: true, caret: "initial" });

    // 7. Отключение через ConfirmDialog.
    await page.getByRole("button", { name: "Отключить" }).first().click();
    await page.waitForSelector("text=Отключить кабинет Saby?");
    await page.getByRole("dialog").getByRole("button", { name: "Отключить" }).click();
    await page.waitForSelector('input[name="edo-client-id"]');
    check("кабинет отключён, история осталась", (await page.locator("[data-testid=edo-history-row]").count()) === 4 && (await readCabinetRow()).length === 0);
    const logouts = (await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/calls`)).json()).calls.filter((c) => c.method === "logout").length;
    check("при отключении сайт вышел из сессии Saby", logouts >= 1, `${logouts}`);

    // Ошибки интерфейса на странице ЭДО (ответы 4xx/5xx от API — ожидаемые в сценарии — не считаем).
    const realErrors = pageErrors.filter((e) => !/Failed to load resource/.test(e));
    check("на странице ЭДО нет ошибок в консоли", realErrors.length === 0, realErrors.join(" | "));

    // Телефон: страница без горизонтальной прокрутки.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid=edo-cabinet-card]");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("на телефоне нет горизонтальной прокрутки", overflow <= 1, `${overflow}px`);
    await page.screenshot({ path: path.join(SHOTS, "05-mobile.png"), fullPage: true, caret: "initial" });
  } finally {
    await browser.close();
    await mock.close();
    fs.writeFileSync(path.join(__dirname, "e2e-result.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  }
  console.log(`\nALL ${results.length} CHECKS PASSED; screenshots: ${SHOTS}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
