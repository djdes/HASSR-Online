// E2E перехода на оплату (billing-cutover-2026-09). Запуск после seed.cjs:
//   node e2e.cjs            — все фазы
// Результаты: D:/wt-build/tmp-billing/out/results.json, снимки — out/shots/*.png.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const {
  WT, BASE, OUT, envValue, launch, sql, login, quietPage, gotoHydrated, shot, readCreds, hash,
} = require("./lib.cjs");

const creds = readCreds();
const PASSWORD = creds.password;
const A = creds.orgs.A, B = creds.orgs.B, C = creds.orgs.C, D = creds.orgs.D, E = creds.orgs.E;
const results = { checks: [], pageErrors: [], startedAt: new Date().toISOString() };
const DAY = 24 * 60 * 60 * 1000;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

function check(name, ok, details) {
  results.checks.push({ name, ok: Boolean(ok), details: details ?? null });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${details ? ` — ${typeof details === "string" ? details : JSON.stringify(details)}` : ""}`);
}

function save() {
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
}

async function ctxFor(browser, email, viewport = DESKTOP) {
  const ctx = await browser.newContext({ viewport, locale: "ru-RU", timezoneId: "Europe/Moscow" });
  const r = await login(ctx, email, PASSWORD);
  if (!r.session) throw new Error(`login failed for ${email}: ${JSON.stringify(r)}`);
  return ctx;
}

async function api(ctx, method, url, body) {
  const doFetch = () =>
    ctx.request.fetch(`${BASE}${url}`, {
      method,
      data: body === undefined ? undefined : body,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      timeout: 240000,
    });
  let res;
  try {
    res = await doFetch();
  } catch (error) {
    // Dev-сервер перезапускается по порогу памяти и рвёт соединение — повторяем раз.
    if (!/ECONNRESET|ECONNREFUSED|socket hang up/i.test(String(error))) throw error;
    results.devRestartRetries = (results.devRestartRetries || 0) + 1;
    await new Promise((r) => setTimeout(r, 15000));
    res = await doFetch();
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status(), data };
}

/** ROOT меняет настройки периода через API (как в /root/tariffs). */
async function setPeriod(rootCtx, { startsAt, endsAt, graceDays = 7, transitionEnabled = true }) {
  const r = await api(rootCtx, "PUT", "/api/root/billing-period", {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    graceDays,
    transitionEnabled,
  });
  if (r.status !== 200) throw new Error(`setPeriod ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function text(page, selector) {
  return (await page.locator(selector).first().innerText({ timeout: 60000 })).replace(/\s+/g, " ").trim();
}

/** Сбросить «скрыть анонс на сегодня», чтобы он снова показался. */
async function resetDismiss(page) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem("wesetup.billing-announcement.dismissed-day");
    } catch {}
  });
}

(async () => {
  const browser = await launch();
  const rootCtx = await browser.newContext();
  const rl = await login(rootCtx, envValue("ROOT_EMAIL"), envValue("ROOT_PASSWORD"));
  if (!rl.session) throw new Error("root login failed");
  try {
    // ------------------------------------------------------------ phase 1: анонс (дефолтные даты)
    await sql(`delete from "PlatformSetting" where key = 'billing.free-period'`);
    const ownerA = await ctxFor(browser, A.owner.email);
    {
      const page = await quietPage(ownerA, "ownerA-dashboard", results);
      await gotoHydrated(page, "/dashboard", "header");
      await page.waitForSelector('[data-testid="billing-announcement"]', { timeout: 120000 });
      const t = await text(page, '[data-testid="billing-announcement"]');
      check("анонс руководителю: даты и цена из настроек/тарифа",
        t.includes("С 1 по 10 октября подписка «до 10 сотрудников» бесплатна для всех.") &&
        t.includes("С 11 октября — 1 990 ₽/мес или бесплатный тариф на 1 сотрудника") && t.includes("Подробнее"), t);
      const href = await page.locator('[data-testid="billing-announcement"] a').first().getAttribute("href");
      check("«Подробнее» ведёт на /settings/subscription", href === "/settings/subscription", href);
      await shot(page, "01-announcement-owner-1280");
      // Закрывается на день.
      await page.locator('[data-testid="billing-announcement"] button[aria-label="Скрыть до завтра"]').click();
      await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
      await page.waitForTimeout(4000);
      check("анонс закрывается на день", (await page.locator('[data-testid="billing-announcement"]').count()) === 0);
      await resetDismiss(page);
      await page.close();
    }
    const ownerAPhone = await ctxFor(browser, A.owner.email, PHONE);
    {
      const page = await quietPage(ownerAPhone, "ownerA-dashboard-390", results);
      await gotoHydrated(page, "/dashboard", "header");
      await page.waitForSelector('[data-testid="billing-announcement"]', { timeout: 120000 });
      await shot(page, "02-announcement-owner-390");
      await page.close();
    }
    const cookEmail = A.staff[0].email;
    const cookA = await ctxFor(browser, cookEmail, DESKTOP);
    const cookAPhone = await ctxFor(browser, cookEmail, PHONE);
    {
      const s0 = await api(cookA, "GET", "/api/auth/session");
      check("сессия повара до перехода активна", s0.data?.user?.id === A.staff[0].id, s0.data?.user?.id ?? null);
    }
    {
      // Повар кабинет сайта не видит: «Журналы» ведут в мини-приложение
      // (/mini/today) — анонс ему показываем в профиле мини-приложения.
      const page = await quietPage(cookAPhone, "cookA-mini-me", results);
      await page.goto(`${BASE}/mini/me`, { waitUntil: "domcontentloaded", timeout: 240000 });
      await page.waitForSelector('[data-testid="billing-announcement"]', { timeout: 180000 });
      const t = await text(page, '[data-testid="billing-announcement"]');
      check("анонс видит и повар — в профиле мини-приложения, без ссылки на тариф",
        t.includes("бесплатна для всех") && (await page.locator('[data-testid="billing-announcement"] a').count()) === 0, t);
      await shot(page, "03-announcement-cook-mini-390");
      await page.close();
    }
    const ownerC = await ctxFor(browser, C.owner.email);
    {
      const page = await quietPage(ownerC, "ownerC-dashboard", results);
      await gotoHydrated(page, "/dashboard", "header");
      await page.waitForTimeout(3000);
      check("оплатившим анонс не показывается", (await page.locator('[data-testid="billing-announcement"]').count()) === 0);
      await page.close();
    }
    {
      const page = await quietPage(ownerAPhone, "ownerA-mini-me", results);
      await page.goto(`${BASE}/mini/me`, { waitUntil: "domcontentloaded", timeout: 240000 });
      await page.waitForSelector('[data-testid="billing-announcement"]', { timeout: 180000 });
      const t = await text(page, '[data-testid="billing-announcement"]');
      check("анонс в профиле мини-приложения", t.includes("бесплатна для всех"), t);
      await shot(page, "04-announcement-mini-profile-390");
      await page.close();
    }

    // ------------------------------------------------------------ phase 1b: идёт период
    const now = Date.now();
    await setPeriod(rootCtx, { startsAt: new Date(now - 1 * DAY), endsAt: new Date(now + 9 * DAY) });
    {
      const page = await quietPage(ownerA, "ownerA-subscription-period", results);
      await gotoHydrated(page, "/settings/subscription", "header");
      const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      check("в периоде: «Подписка — бесплатно по …», без окна", /Ваш план: Подписка — бесплатно по \d+ \S+/.test(body) &&
        (await page.locator('[data-testid="billing-transition-modal"]').count()) === 0);
      await shot(page, "05-in-period-subscription-1280");
      await page.close();
    }
    const ownerD = await ctxFor(browser, D.owner.email);
    {
      const r = await api(ownerD, "POST", "/api/staff", { jobPositionId: D.positionId, fullName: "Лев Пекарь" });
      check("в периоде лимита нет: второй+ сотрудник добавляется", r.status === 200 && r.data?.user?.id, r.status);
    }

    // ------------------------------------------------------------ phase 2: период кончился, идёт грейс
    const n2 = Date.now();
    await setPeriod(rootCtx, { startsAt: new Date(n2 - 12 * DAY), endsAt: new Date(n2 - 1 * DAY) });
    {
      const page = await quietPage(ownerA, "ownerA-modal", results);
      await gotoHydrated(page, "/dashboard", "header");
      await page.waitForSelector('[data-testid="billing-transition-modal"]', { timeout: 120000 });
      const t = await text(page, '[data-testid="billing-transition-modal"]');
      check("окно руководителю: «Бесплатный период подписки закончился»", t.includes("Бесплатный период подписки закончился") && !/оплаченн/i.test(t), t.slice(0, 160));
      check("в окне: 4 сотрудника, бесплатный — 1", t.includes("4 сотрудника") && t.includes("бесплатный тариф — 1 сотрудник"));
      check("окно блокирующее: нет «Закрыть» и «Решу позже»",
        (await page.locator('[data-testid="billing-transition-modal"] button[aria-label="Закрыть"]').count()) === 0 &&
        !t.includes("Решу позже"));
      await shot(page, "06-modal-owner-1280");
      await page.close();
    }
    {
      const page = await quietPage(ownerAPhone, "ownerA-modal-390", results);
      await gotoHydrated(page, "/dashboard", "header");
      await page.waitForSelector('[data-testid="billing-transition-modal"]', { timeout: 120000 });
      await shot(page, "07-modal-owner-390");
      await page.close();
    }
    {
      // Главная повара — «Сегодня» мини-приложения: окна нет, работа идёт.
      const page = await quietPage(cookAPhone, "cookA-today", results);
      await page.goto(`${BASE}/journals`, { waitUntil: "domcontentloaded", timeout: 240000 });
      await page.waitForURL(/\/mini\/today/, { timeout: 180000 });
      await page.waitForTimeout(6000);
      check("у повара окна нет, работа не блокируется («Сегодня»)", (await page.locator('[data-testid="billing-transition-modal"]').count()) === 0, page.url());
      await shot(page, "08-cook-today-no-modal-390");
      await page.goto(`${BASE}/mini/me`, { waitUntil: "domcontentloaded", timeout: 240000 });
      await page.waitForSelector('[data-testid="billing-staff-notice"]', { timeout: 180000 });
      check("повару — тонкая плашка «Руководитель выбирает тариф», без окна",
        (await page.locator('[data-testid="billing-transition-modal"]').count()) === 0);
      await shot(page, "08b-cook-profile-notice-390");
      await page.close();
    }
    {
      // Страница кабинета, открытая поваром в оболочке мини-приложения, — тоже без окна.
      const page = await quietPage(cookA, "cookA-desktop", results);
      await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 240000 });
      await page.waitForTimeout(8000);
      check("у повара на сайте окна нет", (await page.locator('[data-testid="billing-transition-modal"]').count()) === 0, page.url());
      await page.close();
    }
    {
      const page = await quietPage(ownerA, "ownerA-pay", results);
      await gotoHydrated(page, "/dashboard", "header");
      await page.waitForSelector('[data-testid="billing-pay"]', { timeout: 120000 });
      await page.locator('[data-testid="billing-pay"]').click({ timeout: 240000 });
      await page.waitForURL(/\/settings\/subscription/, { timeout: 180000 });
      await page.waitForSelector('[data-testid="billing-decision-card"]', { timeout: 180000 });
      const payHref = await page.locator('[data-testid="billing-decision-card"] [data-testid="billing-pay"]').getAttribute("href");
      check("«Оплатить» ведёт на оплату (/settings/subscription → /order?plan=monthly)", payHref === "/order?plan=monthly", payHref);
      check("на странице тарифа окна нет — там карточка", (await page.locator('[data-testid="billing-transition-modal"]').count()) === 0);
      await shot(page, "09-pay-subscription-page-1280");
      await page.close();
    }

    // Лимит бесплатного на всех путях (организация B: владелец один).
    const ownerB = await ctxFor(browser, B.owner.email);
    {
      const r = await api(ownerB, "POST", "/api/staff", { jobPositionId: B.positionId, fullName: "Второй Сотрудник" });
      check("POST /api/staff → 402 «Бесплатный тариф — 1 сотрудник»", r.status === 402 && r.data?.code === "billing_free_limit" &&
        /Бесплатный тариф — 1 сотрудник\. Оплатите подписку/.test(r.data?.error ?? ""), r);
      const bulk = await api(ownerB, "POST", "/api/staff/bulk", { rows: [{ fullName: "Иван Иванов", positionName: "Повар" }] });
      check("импорт списком: строка упёрлась в лимит", bulk.status === 200 && bulk.data?.created === 0 && bulk.data?.billingLimit?.code === "billing_free_limit", bulk.data);
      const inv = await api(ownerB, "POST", "/api/users/invite", { name: "Пригл Почтой", email: `bc-inv-${creds.run}@example.com`, role: "cook" });
      check("приглашение по почте → 402", inv.status === 402 && inv.data?.code === "billing_free_limit", inv.status);
      const tg = await api(ownerB, "POST", "/api/users/invite/tg", { name: "Пригл Телеграм", role: "cook" });
      check("приглашение в Telegram → 402", tg.status === 402 && tg.data?.code === "billing_free_limit", tg.status);
      const jt = await api(ownerB, "POST", "/api/staff/join-token", {});
      const token = jt.data?.token;
      const join = token
        ? await api(rootCtx, "POST", `/api/join/${token}`, { fullName: "Самозапись Повар", phone: "+79995550011", jobPositionId: B.positionId, password: "Joiner2026!" })
        : { status: 0 };
      check("самозапись по QR → 402, текст «попросите руководителя»", join.status === 402 && /Попросите руководителя/.test(join.data?.error ?? ""), { jt: jt.status, join: join.status });
      const comm = await api(ownerB, "POST", "/api/settings/brakerage-commission/finished_product/members", { fullName: "Член Комиссии" });
      check("сторонняя комиссия в тариф не входит — добавляется", comm.status === 200 || comm.status === 201, comm.status);
      // Неактивная заготовка (как из TasksFlow): включение, пароль, приглашение.
      const pendingId = `pend${creds.run}`;
      await sql(`insert into "User" (id, email, name, "passwordHash", role, "organizationId", "isActive", "journalAccessMigrated") values ($1,$2,$3,'', 'cook', $4, false, true)`,
        [pendingId, `pending-${creds.run}@example.com`, "Ожидающий Сотрудник", B.orgId]);
      const act = await api(ownerB, "PUT", `/api/users/${pendingId}`, { isActive: true });
      check("включение неактивного (PUT /api/users) → 402", act.status === 402, act.status);
      const cr = await api(ownerB, "POST", `/api/staff/${pendingId}/credentials`, { loginSuffix: `pend${creds.run}`.slice(0, 12), password: "Pending2026!" });
      check("выдача пароля неактивному → 402", cr.status === 402, cr.status);
      const raw = crypto.randomBytes(24).toString("base64url");
      await sql(`insert into "InviteToken" (id, "userId", "tokenHash", "expiresAt") values ($1,$2,$3, now() + interval '3 days')`,
        [`it${creds.run}`, pendingId, crypto.createHash("sha256").update(raw).digest("hex")]);
      const acc = await api(rootCtx, "POST", `/api/invite/${raw}/accept`, { password: "Accept2026!" });
      check("принятие приглашения → 402, без активации", acc.status === 402 && /Попросите руководителя/.test(acc.data?.error ?? ""), acc.status);
      const [pend] = await sql(`select "isActive" from "User" where id = $1`, [pendingId]);
      check("заготовка осталась неактивной", pend && pend.isActive === false);
    }
    {
      // UI: добавить второго на бесплатном — понятная ошибка с кнопкой «Оплатить».
      const page = await quietPage(ownerB, "ownerB-add", results);
      await gotoHydrated(page, "/settings/users", "header");
      await page.locator('button[aria-label="Добавить в «Повар»"]').first().click({ force: true, timeout: 120000 });
      const input = page.locator('input[placeholder="Введите ФИО сотрудника"]');
      await input.waitFor({ timeout: 120000 });
      await input.fill("Второй Сотрудник");
      await page.locator('[role="dialog"] button:has-text("Добавить")').last().click();
      const toastLoc = page.locator("[data-sonner-toast]").filter({ hasText: "Бесплатный тариф — 1 сотрудник" });
      await toastLoc.first().waitFor({ timeout: 60000 });
      const hasPay = await toastLoc.first().locator('button:has-text("Оплатить")').count();
      check("UI: ошибка «Бесплатный тариф — 1 сотрудник. Оплатите подписку…» с кнопкой «Оплатить»", hasPay > 0);
      await shot(page, "10-free-limit-error-1280");
      await page.close();
    }

    // Оплаченная организация (C) — не трогается.
    {
      const page = await quietPage(ownerC, "ownerC-after", results);
      await gotoHydrated(page, "/dashboard", "header");
      await page.waitForTimeout(3000);
      check("оплаченной подписке окна нет", (await page.locator('[data-testid="billing-transition-modal"]').count()) === 0);
      await page.close();
      const r = await api(ownerC, "POST", "/api/staff", { jobPositionId: C.positionId, fullName: "Новый Бармен" });
      check("оплаченной подписке лимит не мешает", r.status === 200, r.status);
    }

    // «Перейти на бесплатный» → выбор → подтверждение (телефон 390).
    {
      const page = await quietPage(ownerAPhone, "ownerA-go-free", results);
      await gotoHydrated(page, "/dashboard", "header");
      await page.waitForSelector('[data-testid="billing-go-free"]', { timeout: 120000 });
      await page.locator('[data-testid="billing-go-free"]').click();
      await page.waitForSelector(`[data-testid="billing-keep-${A.owner.id}"]`, { timeout: 60000 });
      const checked = await page.locator(`[data-testid="billing-keep-${A.owner.id}"]`).getAttribute("aria-checked");
      check("по умолчанию остаётся сам руководитель", checked === "true", checked);
      await shot(page, "11-choose-who-stays-390");
      await page.locator('[data-testid="billing-next"]').click();
      await page.waitForSelector('[data-testid="billing-archive-list"]', { timeout: 60000 });
      const list = await text(page, '[data-testid="billing-archive-list"]');
      check("подтверждение: кто уйдёт в архив", list.includes("3 сотрудника") && list.includes("Пётр Повар"), list);
      await shot(page, "12-confirm-free-390");
      await page.locator('[data-testid="billing-confirm-free"]').click();
      await page.locator("[data-sonner-toast]").filter({ hasText: "Готово: бесплатный тариф" }).first().waitFor({ timeout: 60000 });
      const gone = await page
        .locator('[data-testid="billing-transition-modal"]')
        .waitFor({ state: "detached", timeout: 30000 })
        .then(() => true)
        .catch(() => false);
      check("после выбора окно исчезло", gone);
      await page.waitForTimeout(1500);
      await shot(page, "13-after-free-390");
      await page.close();
    }
    {
      const rows = await sql(`select id, name, "isActive", "archivedAt" is not null as archived from "User" where "organizationId" = $1 order by "createdAt"`, [A.orgId]);
      const owner = rows.find((r) => r.id === A.owner.id);
      const others = rows.filter((r) => r.id !== A.owner.id);
      check("в архиве остальные, владелец активен", owner?.isActive === true && others.length === 3 && others.every((r) => !r.isActive && r.archived), rows);
      const [acc] = await sql(`select a."subscriptionPlan" as acc, o."subscriptionPlan" as org from "Organization" o join "Account" a on a.id = o."accountId" where o.id = $1`, [A.orgId]);
      check("тариф free на аккаунте и организации", acc.acc === "free" && acc.org === "free", acc);
      const audit = await sql(`select action, details from "AuditLog" where "organizationId" = $1 and action like 'billing.%'`, [A.orgId]);
      check("запись в журнале действий", audit.some((r) => r.action === "billing.transition.manual_free" && r.details?.archivedCount === 3), audit.map((r) => r.action));
      const tg = await sql(`select kind, status from "TelegramLog" where "organizationId" = $1 and kind like 'billing.%'`, [A.orgId]);
      results.telegramAfterManual = tg;
    }
    {
      // Повар из архива: открытая сессия гаснет, новый вход не проходит.
      const sessionAfter = await api(cookA, "GET", "/api/auth/session");
      check("открытая сессия архивного повара завершена", !sessionAfter.data || !sessionAfter.data.user, sessionAfter.data);
      const page = await quietPage(cookA, "cookA-archived", results);
      await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 240000 });
      await page.waitForTimeout(3000);
      check("архивный повар уходит на вход", /\/login|\/mini(\?|$)/.test(page.url()), page.url());
      await page.close();
      const fresh = await browser.newContext();
      const r = await login(fresh, cookEmail, PASSWORD);
      check("повар из архива не входит", r.session === false, r);
      await fresh.close();
    }
    {
      // Возврат из архива без оплаты — понятный отказ.
      const page = await quietPage(ownerA, "ownerA-restore-blocked", results);
      await gotoHydrated(page, "/settings/users", "header");
      await page.locator('[data-testid="archived-staff"] > button').click();
      const restoreBtn = page.locator(`[data-testid="restore-${A.staff[0].id}"]`);
      await restoreBtn.waitFor({ timeout: 60000 });
      await restoreBtn.click();
      const toastLoc = page.locator("[data-sonner-toast]").filter({ hasText: "Бесплатный тариф — 1 сотрудник" });
      await toastLoc.first().waitFor({ timeout: 60000 });
      check("вернуть из архива на бесплатном нельзя (понятная ошибка)", true);
      await shot(page, "14-restore-blocked-1280");
      await page.close();
    }

    // ------------------------------------------------------------ phase 3: грейс истёк → ежедневная задача
    const n3 = Date.now();
    await setPeriod(rootCtx, { startsAt: new Date(n3 - 20 * DAY), endsAt: new Date(n3 - 8 * DAY) });
    const cronSecret = envValue("CRON_SECRET");
    const dry = await api(rootCtx, "GET", `/api/cron/billing-transition?dryRun=1&secret=${encodeURIComponent(cronSecret)}`);
    results.cronDryRun = dry.data;
    const cron1 = await (await rootCtx.request.get(`${BASE}/api/cron/billing-transition`, { headers: { Authorization: `Bearer ${cronSecret}` }, timeout: 240000 })).json();
    results.cron1 = cron1;
    check("задача: автопереход D и тихий бесплатный E", cron1.enforced === true && cron1.autoFree === 1 && cron1.silentFree === 1 && cron1.failed === 0,
      { autoFree: cron1.autoFree, silentFree: cron1.silentFree, reminded: cron1.reminded, failed: cron1.failed });
    {
      const rows = await sql(`select id, "isActive", "archivedAt" is not null as archived from "User" where "organizationId" = $1`, [D.orgId]);
      const owner = rows.find((r) => r.id === D.owner.id);
      const others = rows.filter((r) => r.id !== D.owner.id);
      check("грейс истёк: остался владелец, остальные в архиве", owner?.isActive === true && others.length >= 2 && others.every((r) => !r.isActive && r.archived), rows.length);
      const [d] = await sql(`select a."subscriptionPlan" as plan from "Organization" o join "Account" a on a.id = o."accountId" where o.id = $1`, [D.orgId]);
      const [e] = await sql(`select a."subscriptionPlan" as plan from "Organization" o join "Account" a on a.id = o."accountId" where o.id = $1`, [E.orgId]);
      check("тарифы после задачи: D free, E free", d.plan === "free" && e.plan === "free", { d, e });
      const auditD = await sql(`select action from "AuditLog" where "organizationId" = $1 and action = 'billing.transition.auto_free'`, [D.orgId]);
      const auditE = await sql(`select action from "AuditLog" where "organizationId" = $1 and action = 'billing.transition.silent_free'`, [E.orgId]);
      check("аудит автоперехода и тихого перехода", auditD.length === 1 && auditE.length === 1);
      const [c] = await sql(`select count(*)::int as active from "User" where "organizationId" = $1 and "isActive" and "archivedAt" is null`, [C.orgId]);
      check("оплаченная C не тронута", c.active >= 5, c);
    }
    const cron2 = await (await rootCtx.request.get(`${BASE}/api/cron/billing-transition`, { headers: { Authorization: `Bearer ${cronSecret}` }, timeout: 240000 })).json();
    results.cron2 = cron2;
    check("повторный запуск ничего не меняет", cron2.autoFree === 0 && cron2.silentFree === 0 && cron2.failed === 0, { autoFree: cron2.autoFree, silentFree: cron2.silentFree });
    {
      const page = await quietPage(rootCtx, "root-tariffs", results);
      await page.setViewportSize(DESKTOP);
      await gotoHydrated(page, "/root/tariffs", '[data-testid="root-billing-period"] button');
      const paid = Number(await text(page, '[data-testid="billing-count-paid"]'));
      const free = Number(await text(page, '[data-testid="billing-count-free"]'));
      const waiting = Number(await text(page, '[data-testid="billing-count-waiting"]'));
      const auto = Number(await text(page, '[data-testid="billing-count-auto"]'));
      check("ROOT: счётчики по состояниям", paid >= 1 && free >= 4 && waiting === 0 && auto >= 1, { paid, free, waiting, auto });
      await page.locator('[data-testid="root-billing-period"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, "shots", "15-root-tariffs-1280.png"), fullPage: true });
      await page.close();
    }

    // ------------------------------------------------------------ phase 4: оплата возвращает сотрудников
    {
      const [order] = await sql(
        `insert into "PaymentOrder" (email, "tariffKey", "amountRub", description, status, "isTest", "organizationId", "userId", "paidAt")
         values ($1, 'monthly', 1990, 'Подписка на 30 дн.', 'paid', true, $2, $3, now()) returning id`,
        [A.owner.email, A.orgId, A.owner.id],
      );
      const out = execFileSync(process.execPath, ["--env-file=.env", "--import", "tsx", path.join(__dirname, "pay.mts"), String(order.id)], { cwd: WT, encoding: "utf8", timeout: 300000 });
      results.payment = out.trim().split("\n").slice(-3);
      const [acc] = await sql(`select a."subscriptionPlan" as plan, a."subscriptionEnd" as "end" from "Organization" o join "Account" a on a.id = o."accountId" where o.id = $1`, [A.orgId]);
      check("оплата продлевает и аккаунт: paid до +30 дней", acc.plan === "paid" && new Date(acc.end).getTime() > Date.now() + 25 * DAY, acc);
      const page = await quietPage(ownerA, "ownerA-restore-paid", results);
      await gotoHydrated(page, "/settings/users", "header");
      await page.locator('[data-testid="archived-staff"] > button').click();
      const restoreBtn = page.locator(`[data-testid="restore-${A.staff[1].id}"]`);
      await restoreBtn.waitFor({ timeout: 60000 });
      await restoreBtn.click();
      await page.locator("[data-sonner-toast]").filter({ hasText: "возвращён из архива" }).first().waitFor({ timeout: 60000 });
      const [u] = await sql(`select "isActive", "archivedAt" from "User" where id = $1`, [A.staff[1].id]);
      check("после оплаты сотрудник возвращается из архива", u.isActive === true && u.archivedAt === null, u);
      await page.waitForTimeout(2000);
      await shot(page, "16-restored-after-payment-1280");
      await page.close();
      const dash = await quietPage(ownerA, "ownerA-paid-dashboard", results);
      await gotoHydrated(dash, "/dashboard", "header");
      await dash.waitForTimeout(3000);
      check("после оплаты окна нет", (await dash.locator('[data-testid="billing-transition-modal"]').count()) === 0);
      await dash.close();
    }
  } catch (error) {
    results.fatal = String(error && error.stack ? error.stack : error);
    console.error(error);
  } finally {
    save();
    await browser.close();
    const failed = results.checks.filter((c) => !c.ok).length;
    console.log(`\n${results.checks.length - failed}/${results.checks.length} PASS, page errors: ${results.pageErrors.length}${results.fatal ? ", FATAL" : ""}`);
    process.exit(failed || results.fatal ? 1 : 0);
  }
})();
