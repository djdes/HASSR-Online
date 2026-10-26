// Живая проверка после проверки 4 (LOW): отказ по местам в мастер-кабинете — общий тост со
// следующим тарифом; окно подтверждения «Создать мастер-кабинет?» закрывается, чтобы чат
// «Связаться» не оказался под ним; карточка «Права доступа → Мастер-кабинеты» — тот же тост.
// Ответ 402 подставляет Playwright (route.fulfill, форма как у seatLimitResponse) — база не
// меняется. Нужны next dev на BASE_URL и локальная БД.
// Запуск (playwright из глобальной установки):
//   CABINET_EMAIL=lim-std-full@example.test ACCESS_EMAIL=<владелец мастер-кабинета> node master-cabinet-check.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const VARIANTS = [
  { tier: "standard", nextTier: "premium", limit: 25, label: "Перейти на «Премиум»", expect: "pay", text: /Перейдите на «Премиум» — до 100/ },
  { tier: "premium", nextTier: null, limit: 100, label: "Связаться", expect: "chat", text: /по согласованию/ },
];
const refusal = (v) =>
  JSON.stringify({ error: "SERVER-TEXT-SHOULD-NOT-SHOW", code: "billing_free_limit", payUrl: "/settings/subscription", limit: v.limit, activeUsers: v.limit, tier: v.tier, nextTier: v.nextTier });

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 200) + 20}` } });
  const page = await ctx.newPage();
  const { csrfToken } = await (await page.request.get(`${BASE}/api/auth/csrf`)).json();
  const res = await page.request.post(`${BASE}/api/auth/callback/credentials`, { form: { csrfToken, email, password: "TestPass123!", json: "true" } });
  return { ctx, page, loggedIn: res.ok() && !(await res.text()).includes("error") };
}

async function afterToast(page, v) {
  const toast = page.locator("[data-sonner-toast][data-front='true']");
  await toast.waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
  const seen = await page.evaluate(() => ({
    text: (document.querySelector("[data-sonner-toast][data-front='true'] [data-title]")?.textContent || "").trim(),
    label: (document.querySelector("[data-sonner-toast][data-front='true'] [data-button]")?.textContent || "").trim(),
    serverText: document.body.innerText.includes("SERVER-TEXT-SHOULD-NOT-SHOW"),
    confirmOpen: [...document.querySelectorAll('[role="dialog"]')].some((d) => /Создать мастер-кабинет/.test(d.textContent || "")),
  }));
  await toast.locator("[data-button]").click({ timeout: 5000 });
  await page.waitForTimeout(v.expect === "pay" ? 4000 : 2500);
  const after = await page.evaluate(() => {
    const reach = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === el || el.contains(hit);
    };
    return { path: location.pathname, chatSendReachable: reach(document.querySelector('button[aria-label="Отправить"]')) };
  });
  const fail = [];
  if (!v.text.test(seen.text)) fail.push(`текст «${seen.text}»`);
  if (seen.label !== v.label) fail.push(`кнопка «${seen.label}»`);
  if (seen.serverText) fail.push("показан текст сервера");
  if (seen.confirmOpen) fail.push("окно подтверждения осталось открытым");
  if (v.expect === "pay" && after.path !== "/settings/subscription") fail.push(`после клика ${after.path}`);
  if (v.expect === "chat" && after.chatSendReachable !== true) fail.push(`чат недоступен (${after.chatSendReachable})`);
  return { seen, after, fail };
}

(async () => {
  const browser = await chromium.launch();
  let ok = true;
  // 1) «Настройки → Мастер-кабинет»: создание кабинета через окно подтверждения.
  for (const v of VARIANTS) {
    const { ctx, page } = await login(browser, process.env.CABINET_EMAIL);
    await page.route("**/api/settings/master-cabinet", (route) =>
      route.request().method() === "POST" ? route.fulfill({ status: 402, contentType: "application/json", body: refusal(v) }) : route.continue(),
    );
    await page.goto(`${BASE}/settings/master-cabinet`, { waitUntil: "networkidle", timeout: 240000 });
    const name = page.locator('[data-testid="master-invite-name"]');
    await name.waitFor({ timeout: 30000 });
    await name.fill("Проверка Мастер Кабинета");
    await page.locator('[data-testid="master-invite-email"]').fill("master-check@example.test");
    await page.locator('[data-testid="master-invite-submit"]').click();
    const confirm = page.locator('[role="dialog"] button', { hasText: /Создать/ }).last();
    await confirm.click({ timeout: 10000 }).catch(() => {});
    const r = await afterToast(page, v);
    ok = ok && r.fail.length === 0;
    console.log(`${r.fail.length ? "FAIL" : "ok  "} мастер-кабинет, nextTier=${v.nextTier}: «${r.seen.text}» · «${r.seen.label}» · окно подтверждения ${r.seen.confirmOpen ? "ОТКРЫТО" : "закрыто"} → ${r.after.path}, чат доступен: ${r.after.chatSendReachable}` + (r.fail.length ? ` — ${r.fail.join("; ")}` : ""));
    await ctx.close();
  }
  // 2) Карточка доступа к мастер-кабинету. В «Права доступа» (/settings/permissions) — общий тост с
  // кнопкой тарифа; в окне «Доступ» самого мастер-кабинета (/master) страница тарифа закрыта —
  // там прежний текст сервера без кнопки. Владелец, у которого кабинет — единственная организация,
  // попадает сразу в /master.
  if (process.env.ACCESS_EMAIL) {
    const v = VARIANTS[0];
    const { ctx, page, loggedIn } = await login(browser, process.env.ACCESS_EMAIL);
    if (!loggedIn) {
      console.log(`---- карточка доступа: вход ${process.env.ACCESS_EMAIL} не удался — пропуск`);
    } else {
      const fulfill = (route) =>
        route.request().method() === "POST" ? route.fulfill({ status: 402, contentType: "application/json", body: refusal(v) }) : route.continue();
      await page.route("**/api/settings/master-cabinets/access", fulfill);
      await page.route("**/api/master/access", fulfill);
      await page.goto(`${BASE}/settings/permissions`, { waitUntil: "networkidle", timeout: 240000 });
      const inCabinet = new URL(page.url()).pathname.startsWith("/master");
      if (inCabinet) await page.locator('[data-testid="master-access"]').click({ timeout: 30000 });
      const block = page.locator('[data-testid="cabinet-access"]').first();
      await block.waitFor({ timeout: 30000 });
      await block.locator('[data-testid="cabinet-access-invite"]').click();
      await block.locator('[data-testid="cabinet-access-invite-name"]').fill("Проверка Доступа");
      await block.locator('[data-testid="cabinet-access-invite-email"]').fill("access-check@example.test");
      await block.locator('[data-testid="cabinet-access-invite-submit"]').click();
      if (inCabinet) {
        const toast = page.locator("[data-sonner-toast][data-front='true']");
        await toast.waitFor({ timeout: 15000 });
        await page.waitForTimeout(500);
        const seen = await page.evaluate(() => ({
          text: (document.querySelector("[data-sonner-toast][data-front='true'] [data-title]")?.textContent || "").trim(),
          button: !!document.querySelector("[data-sonner-toast][data-front='true'] [data-button]"),
        }));
        const good = seen.text === "SERVER-TEXT-SHOULD-NOT-SHOW" && !seen.button;
        ok = ok && good;
        console.log(`${good ? "ok  " : "FAIL"} окно «Доступ» в мастер-кабинете: прежний текст сервера «${seen.text}», кнопки ${seen.button ? "ЕСТЬ" : "нет"} (страница тарифа отсюда закрыта)`);
      } else {
        const r = await afterToast(page, v);
        ok = ok && r.fail.length === 0;
        console.log(`${r.fail.length ? "FAIL" : "ok  "} «Права доступа»: «${r.seen.text}» · «${r.seen.label}» → ${r.after.path}` + (r.fail.length ? ` — ${r.fail.join("; ")}` : ""));
      }
    }
    await ctx.close();
  }
  console.log(`\nИТОГ: ${ok ? "отказ по местам в мастер-кабинете — общий тост, кнопка ведёт куда нужно" : "есть отклонения"}`);
  await browser.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
