/**
 * Локальный стенд (http://localhost:3021): окно «Покажите мне за 15 минут»
 * на /pricing (телефон и компьютер), отправка заявки, страницы /avtozapolnenie,
 * /security и /root/funnel под ROOT. Скриншоты — в папку из argv[2].
 * Запуск: node --env-file=.env .agent/tasks/growth-stage2-2026-11/e2e/ui-check.cjs <папка>
 */
const { chromium, devices } = require("playwright");
const path = require("node:path");

const BASE = "http://localhost:3021";
const OUT = process.argv[2];

const t0 = Date.now();
const step = (message) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${message}`);

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  step(`screenshot ${name}`);
}

(async () => {
  // У проекта своя версия Playwright — браузер берём предустановленный.
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });
  try {
    // Телефон: окно заявки на /pricing.
    const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "ru-RU" });
    const page = await phone.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`${BASE}/pricing?utm_source=yandex&utm_medium=cpc&utm_campaign=e2e`, { waitUntil: "load", timeout: 240000 });
    // Dev-сервер гидратирует страницу не сразу: до гидратации клик кнопки
    // ничего не делает — повторяем, пока окно не откроется.
    const trigger = page.locator('[data-demo-request="pricing"]');
    await trigger.scrollIntoViewIfNeeded();
    for (let attempt = 1; ; attempt += 1) {
      await trigger.click();
      const opened = await page.waitForSelector("[data-demo-request-dialog]", { timeout: 5000 }).then(() => true, () => false);
      if (opened) break;
      if (attempt >= 12) throw new Error("окно заявки не открылось");
    }
    await shot(page, "demo-dialog-phone");
    const dialog = page.locator("[data-demo-request-dialog]");
    await dialog.locator("button[type=submit]").click();
    console.log("empty submit error:", await dialog.locator("[role=alert]").innerText());
    await dialog.locator("input[autocomplete=name]").fill("Анна Проверка");
    await dialog.locator("input[autocomplete=tel]").fill("9991112233");
    await dialog.getByText("Завтра", { exact: true }).click();
    await dialog.locator("textarea").fill("Датчики в холодильниках");
    await dialog.locator("button[type=submit]").click();
    console.log("no consent error:", await dialog.locator("[role=alert]").innerText());
    await dialog.locator("[data-demo-request-consent]").check();
    // Ответ сервера ловим событием: ожидание ответа вместе с кликом в dev-режиме
    // зависало, хотя запрос уходил (см. журнал dev-сервера).
    const posted = [];
    page.on("response", (r) => {
      if (r.url().endsWith("/api/demo-request")) posted.push(r.status());
    });
    await dialog.locator("button[type=submit]").click({ timeout: 30000 });
    await page.waitForSelector("[data-demo-request-done]", { timeout: 60000 });
    console.log("POST /api/demo-request:", posted.join(","));
    await shot(page, "demo-done-phone");
    await phone.close();

    // Компьютер: страницы.
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const d = await desktop.newPage();
    d.setDefaultTimeout(60000);
    for (const [url, name] of [["/avtozapolnenie", "autofill-desktop"], ["/security", "security-desktop"]]) {
      await d.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 240000 });
      await shot(d, name);
      await d.screenshot({ path: path.join(OUT, `${name}-full.png`), fullPage: true });
    }
    // Видео отдаётся статикой.
    const video = await d.request.get(`${BASE}/landing/video/autofill-ru.mp4`);
    console.log("video:", video.status(), video.headers()["content-type"], (await video.body()).length);

    // ROOT: вход и воронка.
    await d.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240000 });
    await d.fill('input[type="email"], input[name="email"]', process.env.ROOT_EMAIL);
    await d.fill('input[type="password"]', process.env.ROOT_PASSWORD);
    await Promise.all([d.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), d.click('button[type="submit"]')]);
    await d.goto(`${BASE}/root/funnel`, { waitUntil: "load", timeout: 240000 });
    console.log("funnel heading:", await d.locator("h1").first().innerText());
    console.log("channels:", (await d.locator('[data-testid="funnel-channels"] tbody tr td:first-child').allInnerTexts()).join(" | "));
    await shot(d, "root-funnel-desktop");
    await d.goto(`${BASE}/root/service-requests`, { waitUntil: "load", timeout: 240000 });
    console.log("service requests has demo:", (await d.content()).includes("Показ WeSetup за 15 минут"));
    await shot(d, "root-service-requests");
    await desktop.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
