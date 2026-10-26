// Живая проверка после проверки 3 (LOW-2): заметка о местах в «Сотрудники → Архив» — ссылка
// называет следующий тариф («Перейти на «Премиум»»), у «Премиума» — «Связаться», в приложении
// WeSetup — без ссылки. Нужны next dev на BASE_URL и локальная БД (lim-std-over, lim-prem-over).
// Запуск (playwright из глобальной установки): node archive-label-check.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const APP_UA = "Mozilla/5.0 WeSetupApp/1.0 (ios)";
const CASES = [
  { email: "lim-std-over@example.test", expect: "Перейти на «Премиум»", href: "/settings/subscription" },
  { email: "lim-prem-over@example.test", expect: "Связаться", href: null },
];

async function archiveNote(page) {
  await page.goto(`${BASE}/settings/users`, { waitUntil: "networkidle", timeout: 240000 });
  const toggle = page.locator("button[aria-expanded]", { hasText: "Архив" }).first();
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await toggle.getAttribute("aria-expanded")) === "true") break;
    await toggle.click();
    await page.waitForTimeout(800);
  }
  return page.evaluate(() => {
    // Только внутри раздела архива: заметка под шапкой «Сотрудников» — отдельная.
    const toggle = [...document.querySelectorAll('button[aria-expanded="true"]')].find((b) => /Архив/.test(b.textContent || ""));
    const section = toggle?.parentElement;
    const note = section ? [...section.querySelectorAll("p")].find((p) => /Места тарифа заняты/.test(p.textContent || "")) : null;
    if (!note) return null;
    const link = note.querySelector("a, button");
    return { text: (note.textContent || "").replace(/\s+/g, " ").trim(), link: link ? (link.textContent || "").trim() : null, href: link?.getAttribute("href") ?? null };
  });
}

(async () => {
  const browser = await chromium.launch();
  let ok = true;
  for (const c of CASES) {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": ip } });
    const page = await ctx.newPage();
    const { csrfToken } = await (await page.request.get(`${BASE}/api/auth/csrf`)).json();
    await page.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken, email: c.email, password: "TestPass123!", json: "true" } });
    const web = await archiveNote(page);
    const good = !!web && web.link === c.expect && web.href === c.href;
    ok = ok && good;
    console.log(`${good ? "ok  " : "FAIL"} ${c.email}: «${web?.text}» · ссылка «${web?.link}» → ${web?.href}`);
    // Тот же вход из приложения WeSetup: только факт, без ссылки.
    const cookies = await ctx.cookies();
    const appCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU", userAgent: APP_UA, extraHTTPHeaders: { "X-Forwarded-For": ip } });
    await appCtx.addCookies(cookies);
    const app = await archiveNote(await appCtx.newPage());
    const appGood = !!app && app.link === null && !/Премиум|Связаться|напишите/.test(app.text);
    ok = ok && appGood;
    console.log(`${appGood ? "ok  " : "FAIL"} ${c.email} в приложении: «${app?.text}» · ссылка ${app?.link ?? "нет"}`);
    await appCtx.close();
    await ctx.close();
  }
  console.log(`\nИТОГ: ${ok ? "ссылка называет следующий тариф, в приложении — только факт" : "есть отклонения"}`);
  await browser.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
