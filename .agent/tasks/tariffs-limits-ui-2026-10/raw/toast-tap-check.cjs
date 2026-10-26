// Живая проверка после проверки 3 (MEDIUM-1): сообщение поверх открытого окна «Добавить сотрудника»
// (подсказка «Введите ФИО» — окно по замыслу остаётся открытым) пропускает тап и свайп насквозь:
// окно не закрывается, введённое не теряется. Кнопка действия переднего сообщения при этом
// нажимается — это проверяет toast-dialog-check.cjs. Нужны next dev на BASE_URL и локальная БД.
// Запуск (playwright из глобальной установки): EMAIL=lim-std-full@example.test POSITION="Повар (проверка)" node toast-tap-check.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const POS = process.env.POSITION || "";

async function openAddDialog(page) {
  const btn = page.locator(POS ? `button[aria-label="Добавить в «${POS}»"]` : 'button[aria-label^="Добавить в «"]').first();
  const name = page.locator('input[placeholder="Введите ФИО сотрудника"]');
  for (let attempt = 0; attempt < 5 && !(await name.isVisible()); attempt++) {
    await btn.click({ force: true });
    await name.waitFor({ timeout: 5000 }).catch(() => {});
  }
  await name.waitFor({ timeout: 5000 });
  return name;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 200) + 20}` } });
  const page = await ctx.newPage();
  const { csrfToken } = await (await page.request.get(`${BASE}/api/auth/csrf`)).json();
  await page.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken, email: process.env.EMAIL, password: "TestPass123!", json: "true" } });
  let ok = true;
  for (const [width, height] of [[390, 844], [375, 667], [1280, 800]]) {
    for (const gesture of ["tap", "swipe"]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${BASE}/settings/users`, { waitUntil: "networkidle", timeout: 240000 });
      const name = await openAddDialog(page);
      await name.fill("Я");
      await page.locator('[role="dialog"] button:has-text("Добавить")').last().click();
      const toast = page.locator("[data-sonner-toast]").first();
      await toast.waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);
      const info = await page.evaluate(() => {
        const t = document.querySelector("[data-sonner-toast]");
        const r = t.getBoundingClientRect();
        const x = Math.round(r.x + r.width / 2);
        const y = Math.round(r.y + r.height - 10);
        const hit = document.elementFromPoint(x, y);
        return {
          x,
          y,
          text: (t.querySelector("[data-title]")?.textContent || "").trim(),
          pointerEvents: getComputedStyle(t).pointerEvents,
          hit: hit ? (hit.closest("[data-sonner-toast]") ? "сообщение" : hit.closest('[role="dialog"]') ? "окно" : hit.tagName.toLowerCase()) : null,
        };
      });
      if (gesture === "tap") {
        await page.mouse.click(info.x, info.y);
      } else {
        await page.mouse.move(info.x, info.y);
        await page.mouse.down();
        await page.mouse.move(info.x + 60, info.y, { steps: 5 });
        await page.mouse.move(info.x + 160, info.y, { steps: 5 });
        await page.mouse.up();
      }
      await page.waitForTimeout(900);
      const open = await name.isVisible();
      const value = open ? await name.inputValue() : null;
      const good = open && value === "Я" && info.pointerEvents === "none";
      ok = ok && good;
      console.log(
        `${good ? "ok  " : "FAIL"} ${width}×${height} ${gesture === "tap" ? "тап" : "свайп"} по сообщению «${info.text}» (pointer-events ${info.pointerEvents}, в точке — ${info.hit}): ` +
          `окно ${open ? "открыто" : "ЗАКРЫЛОСЬ"}${value !== null ? `, ФИО «${value}»` : ""}`,
      );
      await page.keyboard.press("Escape").catch(() => {});
    }
  }
  console.log(`\nИТОГ: ${ok ? "тап и свайп по сообщению окно не закрывают" : "есть отклонения"}`);
  await browser.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
