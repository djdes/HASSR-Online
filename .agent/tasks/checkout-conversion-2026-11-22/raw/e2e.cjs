// Стенд: next dev на :3000, база haccp_smoke (stand-setup.ts). Скриншоты /order на 390 px.
// node .agent/tasks/checkout-conversion-2026-11-22/raw/e2e.cjs
const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "shots");
const URL = `${BASE}/order?plan=premium&cycle=year&points=1`;
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

// Баннер cookie стенда перекрывает кнопку на скриншотах — закрываем, как сделал бы человек.
async function dismissCookies(page) {
  const ok = page.getByRole("button", { name: "OK", exact: true });
  if (await ok.isVisible().catch(() => false)) await ok.click();
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

(async () => {
  require("fs").mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });

  // ---------------------------------------------------------------- гость
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU" });
  const page = await guest.newPage();
  const tracked = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/checkout/track")) tracked.push(request.postDataJSON());
  });
  await page.goto(URL, { waitUntil: "networkidle", timeout: 180_000 });
  await dismissCookies(page);
  await page.screenshot({ path: path.join(OUT, "01-guest-card.png"), fullPage: true });
  const summary = page.getByTestId("order-summary");
  check("AC1 чек виден", await summary.isVisible());
  const summaryText = (await summary.innerText()).replace(/[  ]/g, " ");
  check("AC1 итог и «≈ в месяц»", /К оплате/.test(summaryText) && /≈ .* в месяц/.test(summaryText), summaryText.replace(/\n/g, " | "));
  const border = await summary.evaluate((el) => getComputedStyle(el).borderTopWidth);
  check("AC10 чек без рамки", border === "0px", `border ${border}`);
  const promoBox = await page.getByTestId("order-promo").boundingBox();
  check("AC2 промокод свёрнут в строку ≤ 48 px", promoBox && promoBox.height <= 48, `height ${promoBox?.height}`);
  check("AC3 список «Способ оплаты» у гостя", await page.getByTestId("order-method").isVisible());
  const payText = await page.getByTestId("order-pay").innerText();
  check("AC5 сумма на кнопке", /Перейти к оплате · /.test(payText), payText);
  check("AC10 нет горизонтальной прокрутки (карта)", await noHorizontalScroll(page));

  // промокод: раскрыть, неверный код
  await page.getByTestId("promo-open").click();
  await page.getByPlaceholder("Промокод").fill("NOSUCHCODE");
  await page.getByRole("button", { name: "Применить" }).click();
  await page.getByTestId("promo-error").waitFor({ timeout: 30_000 });
  const promoOpenBox = await page.getByTestId("order-promo").boundingBox();
  await page.getByTestId("order-promo").screenshot({ path: path.join(OUT, "02-promo-error.png") });
  check("AC2 поле промокода в одну строку + короткая ошибка", promoOpenBox && promoOpenBox.height <= 90, `height ${promoOpenBox?.height}`);

  // почта гостя → запись оформления
  await page.locator("#order-email").fill("guest.e2e@example.ru");
  await page.locator("#order-email").blur();
  await page.waitForTimeout(4000);
  check("AC6 гость ввёл почту — запись оформления", tracked.some((body) => body?.email === "guest.e2e@example.ru"), JSON.stringify(tracked[0] ?? null));

  // способ оплаты → счёт
  await page.getByTestId("order-method").click();
  await page.getByRole("option", { name: /Счёт для юрлица/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "03-guest-invoice.png"), fullPage: true });
  check("AC3 счёт вместо карты", (await page.locator("[data-invoice-panel=guest]").count()) === 1 && (await page.getByTestId("order-pay").count()) === 0);
  check("AC10 нет горизонтальной прокрутки (счёт)", await noHorizontalScroll(page));
  await guest.close();

  // ----------------------------------------------------- руководитель без ИНН
  const manager = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU" });
  const mpage = await manager.newPage();
  await mpage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  const login = await mpage.evaluate(async () => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "manager@stand.test", password: "Test12345!" }),
    });
    return response.status;
  });
  check("вход руководителя", login === 200, `status ${login}`);
  await mpage.goto(`${URL}#invoice`, { waitUntil: "networkidle", timeout: 180_000 });
  await dismissCookies(mpage);
  await mpage.waitForTimeout(800);
  await mpage.screenshot({ path: path.join(OUT, "04-org-invoice-no-inn.png"), fullPage: true });
  check("AC4 без ИНН — поле ИНН в форме счёта", (await mpage.locator("[data-invoice-panel=org] input[inputmode=numeric]").count()) === 1);
  await mpage.locator("[data-invoice-panel=org] input[inputmode=numeric]").fill("7707083893");
  await mpage.locator("[data-invoice-panel=org] input[inputmode=numeric]").blur();
  await mpage.waitForTimeout(1500);
  const nameInput = mpage.getByPlaceholder("ООО «Ромашка»");
  if (await nameInput.count()) await nameInput.fill("ООО «Тестовое кафе»");
  await mpage.locator("[data-invoice-submit]").click();
  await mpage.locator("[data-invoice-done]").waitFor({ timeout: 60_000 });
  await mpage.screenshot({ path: path.join(OUT, "05-org-invoice-done.png"), fullPage: true });
  const doneText = await mpage.locator("[data-invoice-done]").innerText();
  check("AC5 счёт выставлен: номер, скачать", /Счёт № \d+/.test(doneText) && /Скачать PDF/.test(doneText), doneText.replace(/\n/g, " | "));
  const pdfHref = await mpage.locator("[data-invoice-done] a").first().getAttribute("href");
  const pdf = await mpage.evaluate(async (href) => {
    const response = await fetch(href);
    return { status: response.status, type: response.headers.get("content-type") };
  }, pdfHref);
  check("AC5 PDF скачивается", pdf.status === 200 && pdf.type === "application/pdf", JSON.stringify(pdf));
  await mpage.getByRole("button", { name: "Отправить на другую почту" }).click();
  await mpage.getByPlaceholder("buh@company.ru").fill("buh@stand.test");
  const sendResponse = mpage.waitForResponse((response) => response.url().includes("/send"), { timeout: 60_000 });
  await mpage.getByRole("button", { name: "Отправить", exact: true }).click();
  const sent = await sendResponse;
  await mpage.waitForTimeout(500);
  // Без SMTP (стенд) транспорт отвечает «не отправлено» → 502 и сообщение в форме;
  // с SMTP — 200 и «Отправили на …». Сама попытка видна в логе dev-сервера.
  const smtp = Boolean(process.env.SMTP_HOST);
  check(
    "AC5 отправка на другую почту (до почтового транспорта)",
    smtp ? sent.status() === 200 && (await mpage.locator("[data-invoice-sent]").count()) === 1 : sent.status() === 502 && (await mpage.locator("[data-invoice-done] [role=alert]").count()) === 1,
    `status ${sent.status()}${smtp ? "" : " (SMTP на стенде не настроен)"}`,
  );
  await mpage.locator("[data-invoice-done]").screenshot({ path: path.join(OUT, "06-org-invoice-sent.png") });
  await manager.close();

  await browser.close();
  require("fs").writeFileSync(path.join(__dirname, "e2e-results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
