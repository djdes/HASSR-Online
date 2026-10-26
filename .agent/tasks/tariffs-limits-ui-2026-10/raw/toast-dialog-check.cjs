// Живая проверка после проверки 2 (H1, AC2): отказ по местам из окна «Сотрудники → Добавить».
// Тост появляется, пока окно открыто (Radix ставит body pointer-events: none). Кнопка тоста
// должна нажиматься обычным кликом: «Стандарт»/бесплатный → страница тарифа, «Премиум» →
// чат поддержки; подпись кнопки — следующий тариф. Нужны next dev на BASE_URL, локальная БД
// с аккаунтами lim-* (limits-scenarios.ts) и должностью «Повар (проверка)».
// Запуск (playwright из глобальной установки — скрипт копировать вне репозитория):
//   node toast-dialog-check.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
// Бесплатный аккаунт после пробного закрыт окном выбора тарифа — его подпись «Подключить
// «Стандарт»» проверяет юнит-тест billing-limit-localization.
const ACCOUNTS = [
  { email: "lim-std-full@example.test", label: "Перейти на «Премиум»", expect: "pay" },
  { email: "lim-prem-full@example.test", label: "Связаться", expect: "chat" },
];
const ip = () => `198.51.100.${Math.floor(Math.random() * 200) + 20}`;

(async () => {
  const browser = await chromium.launch();
  let ok = true;
  for (const account of ACCOUNTS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Europe/Moscow", locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": ip() } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
    const { csrfToken } = await (await page.request.get(`${BASE}/api/auth/csrf`)).json();
    await page.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken, email: account.email, password: "TestPass123!", json: "true" } });
    await page.goto(`${BASE}/settings/users`, { waitUntil: "networkidle", timeout: 240000 });
    // До гидратации клик по кнопке ничего не делает — повторяем, пока не откроется окно.
    const name = page.locator('input[placeholder="Введите ФИО сотрудника"]');
    for (let attempt = 0; attempt < 4 && !(await name.isVisible()); attempt++) {
      await page.locator('button[aria-label="Добавить в «Повар (проверка)»"]').first().click({ force: true });
      await name.waitFor({ timeout: 5000 }).catch(() => {});
    }
    await name.waitFor({ timeout: 5000 });
    await name.fill("Проверка Тоста Окна");
    await page.locator('[role="dialog"] button:has-text("Добавить")').last().click();
    const toast = page.locator("[data-sonner-toast]").first();
    await toast.waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    const action = toast.locator("button[data-button]").first();
    const box = await action.boundingBox();
    const before = await page.evaluate(({ x, y }) => {
      const btn = document.querySelector("[data-sonner-toast] button[data-button]");
      const hit = document.elementFromPoint(x, y);
      const toaster = document.querySelector("[data-sonner-toaster]");
      return {
        dialogOpen: !!document.querySelector('[role="dialog"]'),
        bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
        toasterPointerEvents: toaster ? getComputedStyle(toaster).pointerEvents : null,
        toasterHeight: toaster ? Math.round(toaster.getBoundingClientRect().height) : null,
        hitIsButton: !!(btn && hit && (hit === btn || btn.contains(hit))),
        message: (document.querySelector("[data-sonner-toast] [data-title]")?.textContent || "").trim(),
        label: (btn?.textContent || "").trim(),
      };
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    // Обычный клик Playwright: падает, если кнопку перекрывает другой элемент.
    let clickError = null;
    try {
      await action.click({ timeout: 5000 });
    } catch (e) {
      clickError = e.message.split("\n")[0];
    }
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => ({
      path: location.pathname,
      dialogOpen: !!document.querySelector('[role="dialog"]:not([data-support-chat])') && !!document.querySelector('input[placeholder="Введите ФИО сотрудника"]'),
      chat: !!document.querySelector('button[aria-label="Отправить"]'),
    }));
    const fail = [];
    if (!before.dialogOpen) fail.push("окно не было открыто, когда пришёл тост");
    if (!before.hitIsButton) fail.push("кнопку тоста перекрывает другой элемент");
    if (clickError) fail.push(`клик: ${clickError}`);
    if (before.label !== account.label) fail.push(`подпись «${before.label}», ждали «${account.label}»`);
    if (account.expect === "pay" && after.path !== "/settings/subscription") fail.push(`после клика ${after.path}`);
    if (account.expect === "chat" && !after.chat) fail.push("чат не открылся");
    if (after.dialogOpen) fail.push("окно добавления осталось открытым");
    ok = ok && fail.length === 0;
    console.log(
      `${fail.length ? "FAIL" : "ok  "} ${account.email}: тост «${before.message}» · кнопка «${before.label}» · окно открыто ${before.dialogOpen} · ` +
        `body pointer-events ${before.bodyPointerEvents}, у сообщений ${before.toasterPointerEvents} (высота контейнера ${before.toasterHeight}px) · ` +
        `в точке кнопки — кнопка: ${before.hitIsButton} → после клика ${after.path}, чат ${after.chat}, окно ${after.dialogOpen}` +
        (errors.length ? ` · ошибки консоли: ${errors.join(" | ")}` : "") +
        (fail.length ? ` — ${fail.join("; ")}` : ""),
    );
    await ctx.close();
  }
  console.log(`\nИТОГ: ${ok ? "кнопка тоста нажимается поверх окна, переход верный" : "есть отклонения"}`);
  await browser.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
