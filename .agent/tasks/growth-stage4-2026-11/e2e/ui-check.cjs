/**
 * Локальный стенд (production-сборка, `next start`), браузер — этап 4:
 *  1. телефон: чек-лист на /sanpin-2-3-2-4-4282-26 — 4 «да», 3 «нет», итог,
 *     окно записи на показ с пробелами в «Что важно показать» (без отправки);
 *  2. управляющий: отзыв в «Баланс и бонусы» (/settings/balance#review) с отметкой «показать цифры»;
 *  3. ROOT: «Кого попросить об отзыве» → «Попросить отзыв» (письмо — в
 *     локальный приёмник SMTP), повтор через API — 409; одобрение отзыва;
 *  4. без входа: главная и /pricing — отзыв с цифрами заведения.
 * Скриншоты — в папку argv[2]; почта и пароль управляющего — JSON argv[3]
 * (prepare-manager.ts этапа 3); id кандидата — argv[4] (prepare-local.ts).
 * Запуск: node --env-file=.env .agent/tasks/growth-stage4-2026-11/e2e/ui-check.cjs <папка> <manager.json> <candidateId>
 */
const { chromium, devices } = require("playwright");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const BASE = process.env.E2E_BASE || "http://localhost:3022";
const OUT = process.argv[2];
const MANAGER = JSON.parse(readFileSync(process.argv[3], "utf8"));
const CANDIDATE_ID = process.argv[4];

const t0 = Date.now();
const step = (message) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${message}`);
const shot = async (page, name, fullPage = false) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  step(`screenshot ${name}`);
};

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });
  try {
    // 1. Телефон: чек-лист.
    const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 200) + 20}` } });
    const page = await phone.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`${BASE}/sanpin-2-3-2-4-4282-26`, { waitUntil: "load", timeout: 240000 });
    const checklist = page.locator('[data-testid="sanpin-checklist"]');
    await checklist.scrollIntoViewIfNeeded();
    const questions = checklist.locator("ol > li");
    console.log("questions:", await questions.count());
    const noAt = new Set([0, 3, 6]);
    for (let index = 0; index < 7; index += 1) {
      await questions.nth(index).getByRole("radio", { name: noAt.has(index) ? "Нет" : "Да" }).click();
    }
    const result = page.locator('[data-testid="sanpin-checklist-result"]');
    await result.waitFor();
    console.log("verdict:", (await result.locator("p").first().innerText()).trim());
    console.log("gaps:", (await result.locator("ul > li").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").slice(0, 60)).join(" | "));
    await result.scrollIntoViewIfNeeded();
    await shot(page, "checklist-result-phone");
    await result.locator('[data-demo-request="sanpin-checklist"]').click();
    const dialog = page.locator("[data-demo-request-dialog]");
    await dialog.waitFor();
    console.log("demo topic:", await dialog.locator("textarea").inputValue());
    await dialog.locator("textarea").scrollIntoViewIfNeeded();
    await shot(page, "checklist-demo-dialog-phone");
    await phone.close();

    // 2. Управляющий: отзыв с цифрами.
    const managerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const m = await managerContext.newPage();
    m.setDefaultTimeout(60000);
    await login(m, MANAGER.email, MANAGER.password);
    // Форма отзыва — «Баланс и бонусы» (/settings/balance#review), как в письме «Попросить отзыв».
    await m.goto(`${BASE}/settings/balance#review`, { waitUntil: "load", timeout: 240000 });
    // Поле отзыва по подписи: форма перерисовывается после загрузки баланса, fill сам дождётся.
    const text = m.getByRole("textbox", { name: "Текст отзыва" });
    await text.fill("Ведём все журналы с телефона: гигиена, холодильники и бракераж заполняются за минуты, а к проверке всё собирается одним файлом.");
    await m.locator('[data-testid="review-show-stats"]').check();
    await shot(m, "review-form-desktop");
    await m.getByRole("button", { name: "Отправить отзыв" }).last().click();
    await m.getByRole("dialog").getByRole("button", { name: "Отправить отзыв" }).click();
    await m.getByText("Отзыв отправлен на проверку").first().waitFor({ timeout: 60000 });
    step("review submitted");
    await managerContext.close();

    // 3. ROOT: кого попросить, повтор — 409, одобрение.
    const rootContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const r = await rootContext.newPage();
    r.setDefaultTimeout(60000);
    await login(r, process.env.ROOT_EMAIL, process.env.ROOT_PASSWORD);
    await r.goto(`${BASE}/root/reviews`, { waitUntil: "load", timeout: 240000 });
    // В main: при потоковой отрисовке готовый фрагмент на миг лежит ещё и в скрытом div.
    const candidates = r.getByRole("main").getByTestId("review-request-candidates");
    await candidates.waitFor();
    console.log("candidates:", (await candidates.locator("li").allInnerTexts()).map((row) => row.replace(/\s+/g, " ").slice(0, 120)).join(" | "));
    const row = candidates.locator("li", { hasText: "Кафе «Проверка отзывов»" });
    await row.locator('[data-testid="review-request-button"]').click();
    await row.getByText("Письмо отправлено").waitFor({ timeout: 60000 });
    await shot(r, "root-review-request-sent");
    const again = await r.request.post(`${BASE}/api/root/reviews/request`, { data: { organizationId: CANDIDATE_ID } });
    console.log("repeat request:", again.status(), JSON.stringify(await again.json()));
    await r.getByRole("main").getByTestId("review-show-stats-badge").first().waitFor();
    await r.getByRole("button", { name: "Одобрить" }).first().click();
    await r.getByRole("dialog").getByRole("button", { name: "Одобрить" }).click();
    await r.waitForTimeout(2000);
    await shot(r, "root-review-approved");
    await rootContext.close();

    // 4. Без входа: главная и /pricing.
    const guest = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const g = await guest.newPage();
    g.setDefaultTimeout(60000);
    for (const [url, name] of [["/", "home-testimonials"], ["/pricing", "pricing-testimonials"]]) {
      await g.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 240000 });
      // Видимый: при потоковой отрисовке фрагмент на миг лежит и в скрытом div.
      const stats = g.locator('[data-testid="testimonial-stats"] >> visible=true').first();
      await stats.waitFor({ timeout: 60000 });
      await stats.scrollIntoViewIfNeeded();
      await g.mouse.wheel(0, -200);
      // На главной секции проявляются при прокрутке — ждём конца анимации.
      await g.waitForTimeout(1500);
      console.log(`${url} stats:`, ((await stats.textContent()) ?? "").replace(/\s+/g, " ").trim(), "| visible:", await stats.isVisible());
      await shot(g, name);
    }
    await guest.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
