/**
 * Локальный стенд (http://localhost:3021), браузер — экраны этапа 3:
 *   телефон: калькулятор на /partners, запись на показ со временем, счёт гостю на /order;
 *   компьютер: /sanpin-2-3-2-4-4282-26, «Одним PDF» у управляющего, /root/invoices у ROOT.
 * Скриншоты — в папку из argv[2]; почта и пароль управляющего — JSON из argv[3]
 * (prepare-manager.ts). Запуск:
 *   node --env-file=.env .agent/tasks/growth-stage3-2026-11/e2e/ui-check.cjs <папка> <manager.json>
 */
const { chromium, devices } = require("playwright");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");

const BASE = "http://localhost:3021";
const OUT = process.argv[2];
const MANAGER = JSON.parse(readFileSync(process.argv[3], "utf8"));

const t0 = Date.now();
const step = (message) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${message}`);

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  step(`screenshot ${name}`);
}

/** Dev-сервер гидратирует не сразу: до гидратации клик ничего не делает — повторяем. */
async function clickUntil(page, locator, selector, attempts = 12) {
  for (let attempt = 1; ; attempt += 1) {
    await locator.click();
    const ok = await page.waitForSelector(selector, { timeout: 5000 }).then(() => true, () => false);
    if (ok) return;
    if (attempt >= attempts) throw new Error(`не появилось: ${selector}`);
  }
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
}

/** Новый управляющий сначала принимает обновлённые условия — окно без закрытия (так и задумано). */
async function acceptLegalUpdate(page) {
  const accept = page.locator('[data-testid="legal-update-accept"]');
  if (await accept.waitFor({ timeout: 15000 }).then(() => true, () => false)) {
    await page.locator('[data-testid="legal-update-modal"] input[type="checkbox"]').check();
    await accept.click();
    await page.locator('[data-testid="legal-update-modal"]').waitFor({ state: "detached", timeout: 60000 });
    step("legal update accepted");
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });
  try {
    // Свой адрес для лимита заявок (3 за 10 минут на адрес): повторные прогоны не упираются в 429.
    const forwardedFor = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
    const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": forwardedFor } });
    const page = await phone.newPage();
    page.setDefaultTimeout(60000);

    // 1. Калькулятор партнёра: 10 клиентов на «Стандарте» помесячно.
    await page.goto(`${BASE}/partners#calculator`, { waitUntil: "load", timeout: 240000 });
    const calculator = page.locator("[data-partner-calculator]");
    await calculator.scrollIntoViewIfNeeded();
    const clients = calculator.locator('input[inputmode="numeric"]').first();
    for (let attempt = 1; ; attempt += 1) {
      await clients.fill("10");
      await clients.blur();
      const total = await calculator.locator("[data-partner-calculator-total]").innerText();
      if (/138/.test(total.replace(/\s/g, ""))) break;
      if (attempt >= 12) throw new Error(`калькулятор: ${total}`);
      await page.waitForTimeout(2000);
    }
    console.log("calculator total (10 клиентов):", (await calculator.locator("[data-partner-calculator-total]").innerText()).replace(/\s+/g, " "));
    await calculator.locator("[data-partner-calculator-total]").scrollIntoViewIfNeeded();
    await shot(page, "partners-calculator-phone");

    // 2. Запись на показ: день и время.
    await page.goto(`${BASE}/pricing`, { waitUntil: "load", timeout: 240000 });
    const trigger = page.locator('[data-demo-request="pricing"]');
    await trigger.scrollIntoViewIfNeeded();
    await clickUntil(page, trigger, "[data-demo-request-dialog]");
    const dialog = page.locator("[data-demo-request-dialog]");
    // Время — радиокнопки внутри блока слотов (переключатель режима — отдельная группа).
    const times = dialog.locator('[data-demo-request-slots] [role="radio"]');
    await times.first().waitFor({ timeout: 60000 });
    console.log("slots offered on first free day:", await times.count());
    await times.nth(1).click();
    await dialog.locator("input[autocomplete=name]").fill("Анна Проверка");
    await dialog.locator("input[autocomplete=tel]").fill("9991112233");
    await dialog.locator("input[type=email]").fill("anna-ui@example.test");
    await dialog.locator("[data-demo-request-consent]").check();
    await shot(page, "demo-slot-phone");
    const posted = [];
    page.on("response", (r) => {
      if (r.url().endsWith("/api/demo-request")) posted.push(r.status());
    });
    await dialog.locator("button[type=submit]").click({ timeout: 30000 });
    await page.waitForSelector("[data-demo-request-done]", { timeout: 60000 });
    console.log("POST /api/demo-request:", posted.join(","));
    console.log("done text:", (await page.locator("[data-demo-request-done]").innerText()).replace(/\s+/g, " "));
    const ics = await page.locator("[data-demo-request-ics]").getAttribute("href");
    console.log("ics link:", ics ? ics.slice(0, 40) + "…" : "нет");
    await shot(page, "demo-booked-phone");

    // 3. Счёт гостю на /order: ИНН → название (ключа DaData на стенде нет) → почта → счёт.
    await page.goto(`${BASE}/order?plan=standard&cycle=month&points=1#invoice`, { waitUntil: "load", timeout: 240000 });
    const panel = page.locator("[data-guest-invoice]");
    await panel.scrollIntoViewIfNeeded();
    const inn = panel.locator('input[inputmode="numeric"]');
    if (!(await inn.isVisible())) await clickUntil(page, panel.locator("button[aria-expanded]"), '[data-guest-invoice] input[inputmode="numeric"]');
    for (let attempt = 1; ; attempt += 1) {
      await inn.fill("5018215599");
      await inn.blur();
      const named = await panel.locator('input[placeholder="ООО «Ромашка»"]').waitFor({ timeout: 5000 }).then(() => true, () => false);
      if (named) break;
      if (attempt >= 12) throw new Error("поле названия не появилось");
    }
    await panel.locator('input[placeholder="ООО «Ромашка»"]').fill("ООО «Проверка из браузера»");
    await panel.locator('input[type="email"]').fill("buh-ui@example.test");
    await shot(page, "guest-invoice-form-phone");
    await panel.locator('button[type="submit"]').click();
    await page.waitForSelector("[data-guest-invoice-done]", { timeout: 60000 });
    console.log("guest invoice done:", (await page.locator("[data-guest-invoice-done]").innerText()).replace(/\s+/g, " "));
    const pdfHref = await page.locator("[data-guest-invoice-done] a[href*='guest-pdf']").getAttribute("href");
    const pdf = await page.request.get(`${BASE}${pdfHref}`);
    console.log("guest invoice pdf:", pdf.status(), pdf.headers()["content-type"], (await pdf.body()).length);
    await shot(page, "guest-invoice-done-phone");
    await phone.close();

    // 4. Компьютер: страница СанПиН.
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const d = await desktop.newPage();
    d.setDefaultTimeout(60000);
    await d.goto(`${BASE}/sanpin-2-3-2-4-4282-26`, { waitUntil: "load", timeout: 240000 });
    console.log("sanpin journals:", await d.locator('[data-testid="sanpin-journals"] li').count());
    await shot(d, "sanpin-desktop");
    await d.screenshot({ path: path.join(OUT, "sanpin-desktop-full.png"), fullPage: true });

    // 5. Управляющий: «Пришла проверка» одним PDF.
    await login(d, MANAGER.email, MANAGER.password);
    await d.goto(`${BASE}/reports`, { waitUntil: "load", timeout: 240000 });
    await acceptLegalUpdate(d);
    const pdfButton = d.getByRole("button", { name: "Одним PDF" });
    await pdfButton.scrollIntoViewIfNeeded();
    await shot(d, "reports-bundle-card");
    // В кабинете постоянное соединение (/api/live) — «тишины в сети» не бывает. Ждём сам запрос
    // после клика; до гидратации клик ничего не делает — тогда повторяем.
    let response = null;
    for (let attempt = 1; attempt <= 12 && !response; attempt += 1) {
      const requested = d
        .waitForRequest((r) => r.url().includes("/api/reports/compliance-bundle") && r.url().includes("format=pdf"), { timeout: 10000 })
        .catch(() => null);
      await pdfButton.click();
      const request = await requested;
      if (request) response = await request.response();
    }
    if (!response) throw new Error("кнопка «Одним PDF» не отправила запрос");
    const bytes = await response.body();
    const merged = await PDFDocument.load(bytes);
    console.log("bundle pdf:", response.status(), response.headers()["content-type"], `${bytes.length} bytes`, `${merged.getPageCount()} pages`, response.headers()["content-disposition"]);
    await desktop.close();

    // 6. ROOT: счета гостей.
    const rootContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const r = await rootContext.newPage();
    r.setDefaultTimeout(60000);
    await login(r, process.env.ROOT_EMAIL, process.env.ROOT_PASSWORD);
    await r.goto(`${BASE}/root/invoices`, { waitUntil: "load", timeout: 240000 });
    console.log("root invoices heading:", await r.locator("h1").first().innerText());
    console.log("root invoices has browser buyer:", (await r.content()).includes("Проверка из браузера"));
    await shot(r, "root-invoices-desktop");
    await rootContext.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
