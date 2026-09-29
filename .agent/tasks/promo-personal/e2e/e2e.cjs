// E2E: персональные промокоды, скидка навсегда, ссылка /promo/CODE (spec promo-personal).
// Запуск: node e2e/seed.cjs && node --env-file=.env --import tsx e2e/seed-codes.mts && node e2e/e2e.cjs
// (dev-сервер :3191 поднят с фиктивным тестовым магазином Робокассы). Результаты —
// raw/e2e-results.json, снимки — evidence/*.png (в папке прогона вне проекта).
const fs = require("node:fs");
const path = require("node:path");
const {
  BASE,
  EVID,
  RAW,
  SERVER_LOG,
  launch,
  sql,
  login,
  newContext,
  open,
  norm,
  readCreds,
  payResult,
} = require("./lib.cjs");

const results = { checks: [], pageErrors: [], robokassa: [], devReloads: 0 };
function check(name, ok, details = {}) {
  results.checks.push({ name, ok: Boolean(ok), details });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${Object.keys(details).length ? " " + JSON.stringify(details) : ""}`);
}

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

function watchErrors(page, label) {
  page.on("pageerror", (err) => results.pageErrors.push({ page: label, message: String(err && err.message).slice(0, 300) }));
  page.on("console", (msg) => {
    if (msg.type() === "error" && /hydrat|did not match|server rendered/i.test(msg.text())) {
      results.pageErrors.push({ page: label, message: `console: ${msg.text().slice(0, 300)}` });
    }
  });
}

/** Снимок: страница целиком как есть; у блока липкие шапки прячем, чтобы не закрывали его верх. */
async function shot(page, file, locator = null) {
  if (!locator) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(EVID, file), fullPage: false });
    return;
  }
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      const pos = getComputedStyle(el).position;
      if ((pos === "fixed" || pos === "sticky") && el.getBoundingClientRect().top < 120) {
        el.setAttribute("data-e2e-hidden", el.style.visibility || "-");
        el.style.visibility = "hidden";
      }
    }
  });
  if (locator) {
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await locator.screenshot({ path: path.join(EVID, file) });
  } else {
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(EVID, file), fullPage: false });
  }
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-e2e-hidden]")) {
      const prev = el.getAttribute("data-e2e-hidden");
      el.style.visibility = prev === "-" ? "" : prev;
      el.removeAttribute("data-e2e-hidden");
    }
  });
}

/** Цена без невидимых подписей для скринридера («Без скидки: », «Со скидкой: »…). */
const visible = (text) => norm(text).replace(/^(Без скидки|Без акции|Со скидкой|По акции): /, "");

async function priceInfo(locator) {
  const el = locator.first();
  return {
    personal: await el.getAttribute("data-personal-discount"),
    source: await el.getAttribute("data-discount-source"),
    old: visible(await el.locator("[data-promo-old]").first().textContent().catch(() => "")),
    now: visible(await el.locator("[data-promo-new]").first().textContent().catch(() => "")),
    badge: norm(await el.locator("[data-personal-badge]").first().textContent().catch(() => "")),
  };
}

/** Цена в карточке «Подписка» витрины тарифов (секция «Ваш план: …»). */
function planPrice(page) {
  return page.locator("section", { has: page.locator("h2", { hasText: "Ваш план" }) }).locator("[data-testid=promo-price]").first();
}

async function orderTotal(page) {
  return norm(await page.locator('span:text-is("К оплате")').locator("xpath=following-sibling::*[1]").textContent());
}

/** «Перейти к оплате» → заглушка кассы; параметры формы оплаты из перехваченного адреса. */
async function submitOrder(page) {
  const before = results.robokassa.length;
  await page.locator("form button[type=submit]").click();
  await page.locator("#rk-stub").waitFor({ timeout: 180000 });
  const url = results.robokassa.slice(before).filter((u) => /Index\.aspx/i.test(u)).pop();
  const params = new URL(url).searchParams;
  return { invId: Number(params.get("InvId")), outSum: params.get("OutSum"), isTest: params.get("IsTest"), description: params.get("Description") };
}

function serverLog() {
  try {
    return fs.readFileSync(SERVER_LOG, "utf8");
  } catch {
    return "";
  }
}

(async () => {
  const creds = readCreds();
  const codes = creds.codes;
  const browser = await launch();
  try {
    /* ---------------------------------------------- 1. протухший код → понятная страница */
    for (const [label, viewport] of [["1280", DESKTOP], ["390", PHONE]]) {
      const ctx = await newContext(browser, viewport);
      const page = await ctx.newPage();
      watchErrors(page, `expired-${label}`);
      await open(page, "/promo/E2EOLD10?s=cafe", "[data-testid=promo-invalid] a[href='/pricing']", results);
      const title = norm(await page.locator("[data-testid=promo-invalid] h1").textContent());
      check(`${label}: /promo/E2EOLD10 → «Промокод больше не действует» и ссылка на тарифы`, /\/promo\?code=E2EOLD10$/.test(page.url()) && title === "Промокод больше не действует", { url: page.url(), title });
      await shot(page, `promo-expired-${label}.png`);
      await ctx.close();
    }
    {
      const ctx = await newContext(browser, DESKTOP);
      const page = await ctx.newPage();
      await open(page, "/promo/NOSUCH404", "[data-testid=promo-invalid]", results);
      check("неизвестный код → «Такого промокода нет»", norm(await page.locator("[data-testid=promo-invalid] h1").textContent()) === "Такого промокода нет");
      await ctx.close();
    }

    /* ------------------- 2. без входа: ссылка → регистрация со сферой → тариф с кодом → оплата */
    const guestFlows = [
      ["1280", DESKTOP, creds.guest1280, codes.guest1280],
      ["390", PHONE, creds.guest390, codes.guest390],
    ];
    const guestCtx = {};
    for (const [label, viewport, email, code] of guestFlows) {
      const ctx = await newContext(browser, viewport, results.robokassa);
      guestCtx[label] = ctx;
      const page = await ctx.newPage();
      watchErrors(page, `guest-${label}`);
      await open(page, `/promo/${code}?s=cafe`, "[data-testid=register-promo]", results);
      const url = new URL(page.url());
      const banner = norm(await page.locator("[data-testid=register-promo]").textContent());
      const sphere = await page.locator("[data-testid=register-sphere]").inputValue();
      const cookie = (await ctx.cookies()).find((c) => c.name === "wesetup.promo");
      check(`${label}: /promo/${code}?s=cafe → регистрация, сфера подставлена, плашка кода, cookie на 30 дней`,
        url.pathname === "/register" && url.searchParams.get("s") === "cafe" && sphere === "cafe" &&
          banner.startsWith(`Промокод ${code}: −10 % навсегда`) && cookie?.value === code &&
          cookie.expires * 1000 - Date.now() > 29 * 24 * 3600 * 1000,
        { url: page.url(), sphere, banner, cookie: cookie?.value });
      await shot(page, `register-promo-${label}.png`);
      await page.locator("#register-email").fill(email);
      await page.locator("[data-testid=legal-consent]").check();
      await page.getByRole("button", { name: "Создать аккаунт" }).click();
      await page.waitForURL(/\/settings\/subscription\?promo=/, { timeout: 300000 });
      await open(page, page.url(), "[data-testid=subscription-discount] [data-testid=discount-pay]", results);
      const [org] = await sql(
        'select o.id, o.type, o."accountId" from "Organization" o join "User" u on u."organizationId" = o.id where u.email = $1',
        [email],
      );
      creds[`org${label}`] = org;
      check(`${label}: организация создана со сферой «Кафе» (type=cafe)`, org?.type === "cafe", org);
      const applied = norm(await page.locator("[data-testid=promo-applied]").textContent());
      const notice = norm(await page.locator("[data-testid=promo-notice]").textContent().catch(() => ""));
      const card = await priceInfo(page.locator("[data-testid=subscription-discount] [data-testid=promo-price]"));
      const plan = await priceInfo(planPrice(page));
      check(`${label}: тариф с подставленным кодом — −199 ₽, старая цена 1 990 зачёркнута, 1 791 ₽`,
        applied.includes(`Промокод ${code} применён: −199 ₽`) && card.old === "1 990 ₽" && card.now === "1 791 ₽" &&
          plan.old === "1 990 ₽" && plan.now.startsWith("1 791 ₽") && /после оплаты она закрепится/.test(notice),
        { applied, notice, card, plan });
      await shot(page, `subscription-code-${label}.png`, page.locator("[data-testid=subscription-discount]"));
      if (label === "1280") await shot(page, `subscription-code-plan-${label}.png`, planPrice(page).locator("xpath=ancestor::*[contains(@class,'rounded-3xl')][1]"));

      await page.locator("[data-testid=discount-pay]").click();
      await page.waitForURL(/\/order\?plan=monthly&promo=/, { timeout: 180000 });
      await open(page, page.url(), "form button[type=submit]", results);
      const line = await priceInfo(page.locator("[data-testid=order-subscription-line] [data-testid=promo-price]"));
      const total = await orderTotal(page);
      check(`${label}: /order — код подставлен сам, зачёркнутая 1 990 → 1 791, к оплате 1 791 ₽`,
        line.old === "1 990 ₽" && line.now === "1 791 ₽" && line.badge === `Промокод ${code}: −10 % навсегда` && total === "1 791 ₽" &&
          (await page.getByLabel("Промокод").inputValue()) === code,
        { line, total });
      await shot(page, `order-code-${label}.png`, page.locator("[data-testid=order-subscription-line]").locator("xpath=ancestor::*[contains(@class,'rounded-3xl')][1]"));
      const pay = await submitOrder(page);
      check(`${label}: в кассу ушло 1791.00 (тестовый режим, заглушка)`, pay.outSum === "1791.00" && pay.isTest === "1", pay);
      const paid = await payResult(ctx.request, pay.invId, pay.outSum);
      check(`${label}: ResultURL /payment → OK`, paid.body === `OK${pay.invId}`, paid);
      const [order] = await sql('select status, "promoCode", "discountRub", "lifetimeDiscountId", "amountRub", description from "PaymentOrder" where id = $1', [pay.invId]);
      const [binding] = await sql('select * from "AccountLifetimeDiscount" where "accountId" = $1', [org.accountId]);
      const audit = await sql(`select action, details from "AuditLog" where action = 'promo.lifetime.bind' and "entityId" = $1`, [binding?.id ?? "-"]);
      check(`${label}: оплата с lifetime-кодом → скидка закреплена за аккаунтом (снимок −10 %, с заказа №${pay.invId}), аудит`,
        order.status === "paid" && order.promoCode === code && order.lifetimeDiscountId === null && order.discountRub === 199 &&
          binding?.code === code && binding.kind === "percent" && binding.value === 10 && binding.orderId === pay.invId &&
          !binding.revokedAt && audit.length === 1,
        { order: { ...order, amountRub: Number(order.amountRub) }, binding: binding ? { code: binding.code, value: binding.value, orderId: binding.orderId } : null, audits: audit.length });
      check(`${label}: лог «[promo] lifetime bound account=… code=${code}»`, serverLog().includes(`[promo] lifetime bound account=${org.accountId} code=${code}`));
      creds[`paid${label}`] = { orderId: pay.invId, bindingId: binding?.id };
      await page.close();
    }

    /* ------------------------ 3. следующая оплата — сама со скидкой навсегда, зачёркнутая цена */
    for (const [label, viewport] of [["1280", DESKTOP], ["390", PHONE]]) {
      const ctx = guestCtx[label];
      const page = await ctx.newPage();
      watchErrors(page, `renew-${label}`);
      await open(page, "/settings/subscription", "[data-testid=lifetime-discount]", results);
      const lifetimeText = norm(await page.locator("[data-testid=lifetime-discount]").textContent());
      const plan = await priceInfo(planPrice(page));
      check(`${label}: тариф без ввода кода — «Ваша скидка −10 % навсегда», 1 990 → 1 791`,
        lifetimeText.startsWith("Ваша скидка −10 % навсегда") && plan.old === "1 990 ₽" && plan.now.startsWith("1 791 ₽") && plan.source === "lifetime",
        { lifetimeText: lifetimeText.slice(0, 80), plan });
      await shot(page, `subscription-lifetime-${label}.png`, page.locator("[data-testid=subscription-discount]"));
      await open(page, "/order?plan=monthly", "form button[type=submit]", results);
      const line = await priceInfo(page.locator("[data-testid=order-subscription-line] [data-testid=promo-price]"));
      const total = await orderTotal(page);
      const hint = norm(await page.locator("[data-testid=lifetime-applied]").textContent());
      check(`${label}: /order без кода — зачёркнутая 1 990 → 1 791, «Ваша скидка −10 % навсегда», к оплате 1 791 ₽`,
        line.old === "1 990 ₽" && line.now === "1 791 ₽" && line.badge === "Ваша скидка −10 % навсегда" && total === "1 791 ₽" && hint.includes("применяется сама"),
        { line, total, hint });
      await shot(page, `order-lifetime-${label}.png`, page.locator("[data-testid=order-subscription-line]").locator("xpath=ancestor::*[contains(@class,'rounded-3xl')][1]"));
      if (label === "1280") {
        const pay = await submitOrder(page);
        const paid = await payResult(ctx.request, pay.invId, pay.outSum);
        const [order] = await sql('select status, "promoCode", "lifetimeDiscountId", "discountRub", description from "PaymentOrder" where id = $1', [pay.invId]);
        const bindings = await sql('select "orderId" from "AccountLifetimeDiscount" where "accountId" = $1', [creds.org1280.accountId]);
        const audits = await sql(`select count(*)::int as n from "AuditLog" where action = 'promo.lifetime.bind' and "entityId" = $1`, [creds.paid1280.bindingId]);
        check("1280: продление картой — 1791.00, заказ помечен авто-скидкой навсегда, привязка не изменилась (идемпотентно)",
          pay.outSum === "1791.00" && paid.body === `OK${pay.invId}` && order.status === "paid" && order.lifetimeDiscountId === creds.paid1280.bindingId &&
            order.promoCode === codes.guest1280 && order.discountRub === 199 && /скидка навсегда по промокоду/.test(norm(order.description)) &&
            bindings.length === 1 && bindings[0].orderId === creds.paid1280.orderId && audits[0].n === 1,
          { pay, order, bindings, audits: audits[0].n });
        // Счёт по безналу — та же скидка сама.
        await sql('update "Organization" set inn = $1, name = $2 where id = $3', ["7700000025", "Кафе «Ромашка»", creds.org1280.id]);
        const inv = await ctx.request.post(`${BASE}/api/payments/invoice`, { data: { tariffKey: "monthly" } });
        const invBody = await inv.json();
        const [invOrder] = await sql('select "amountRub", "lifetimeDiscountId", "promoCode", "paymentMethod", description from "PaymentOrder" where id = $1', [invBody.orderId ?? 0]);
        check("1280: счёт по безналу — 1 791 ₽ со скидкой навсегда (сервер)",
          inv.status() === 200 && invBody.amountRub === 1791 && invOrder?.lifetimeDiscountId === creds.paid1280.bindingId && invOrder?.paymentMethod === "invoice",
          { status: inv.status(), invBody, invOrder: invOrder ? { ...invOrder, amountRub: Number(invOrder.amountRub) } : null });
        await open(page, "/settings/subscription", "[data-testid=lifetime-discount]", results);
        await shot(page, "subscription-invoice-lifetime-1280.png", page.getByText("Оплата по безналу для юрлиц").locator("xpath=ancestor::section[1]"));
      }
      await page.close();
    }

    /* ------------------------------ 4. с входом: ссылка → тариф с кодом (своя организация) */
    for (const [label, viewport] of [["1280", DESKTOP], ["390", PHONE]]) {
      const ctx = await newContext(browser, viewport, results.robokassa);
      check(`владелец «Лавки» входит (${label})`, (await login(ctx, creds.owner, creds.password)).session);
      const page = await ctx.newPage();
      watchErrors(page, `owner-${label}`);
      await open(page, `/promo/${codes.owner}?s=cafe`, "[data-testid=subscription-discount] [data-testid=discount-pay]", results);
      const applied = norm(await page.locator("[data-testid=promo-applied]").textContent());
      const plan = await priceInfo(planPrice(page));
      check(`${label}: /promo/${codes.owner} с входом → /settings/subscription?promo=${codes.owner}, код применён`,
        new URL(page.url()).pathname === "/settings/subscription" && new URL(page.url()).searchParams.get("promo") === codes.owner &&
          applied.includes(`Промокод ${codes.owner} применён: −199 ₽`) && plan.now.startsWith("1 791 ₽"),
        { url: page.url(), applied, plan });
      await shot(page, `owner-link-subscription-${label}.png`);

      /* ------------------------------------------ 5. чужой персональный код — отказ */
      await open(page, `/settings/subscription?promo=${codes.guest390}`, "[data-testid=promo-error]", results);
      const pageError = norm(await page.locator("[data-testid=promo-error]").textContent());
      check(`${label}: чужой персональный код на странице тарифа — «выдан другой организации»`, pageError === "Этот промокод персональный — он выдан другой организации", { pageError });
      await open(page, "/order?plan=monthly", "form button[type=submit]", results);
      await page.getByLabel("Промокод").fill(codes.guest390);
      await page.getByRole("button", { name: /^(Применить|Обновить)$/ }).click();
      await page.locator("[data-testid=promo-error]").waitFor({ timeout: 60000 });
      const orderError = norm(await page.locator("[data-testid=promo-error]").textContent());
      check(`${label}: чужой персональный код на /order — отказ`, orderError === "Этот промокод персональный — он выдан другой организации" && (await orderTotal(page)) === "1 990 ₽", { orderError });
      await shot(page, `order-foreign-code-${label}.png`, page.getByText("Промокод", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]"));
      if (label === "1280") {
        const create = await ctx.request.post(`${BASE}/api/payments/robokassa/create`, {
          data: { tariffKey: "monthly", usePoints: false, promoCode: codes.guest390 },
        });
        const body = await create.json();
        check("создание заказа с чужим персональным кодом — 400, сервер отказал", create.status() === 400 && body.error === "Этот промокод персональный — он выдан другой организации", { status: create.status(), body });
        const anon = await newContext(browser, DESKTOP);
        const anonCreate = await anon.request.post(`${BASE}/api/payments/robokassa/create`, {
          data: { tariffKey: "monthly", email: `stranger-${creds.run}@example.com`, promoCode: codes.guest390 },
        });
        const anonBody = await anonCreate.json();
        check("без входа по чужой почте — тоже отказ", anonCreate.status() === 400 && /персональный/.test(anonBody.error), { status: anonCreate.status(), anonBody });
        await anon.close();
      }
      await ctx.close();
    }

    /* -------------------- 6. ROOT: коды «выгоднейший из двух», пометки, фильтр, отмена скидки */
    const rootCtx = await newContext(browser, DESKTOP);
    check("ROOT входит", (await login(rootCtx, creds.root, creds.password)).session);
    const mk = async (data) => (await rootCtx.request.post(`${BASE}/api/root/promo-codes`, { data })).status();
    await sql(`delete from "PromoCode" where code in ('E2E500','E2E5')`);
    check("ROOT API: коды E2E500 (−500 ₽) и E2E5 (−5 %)", (await mk({ code: "E2E500", kind: "fixed", value: 500 })) === 200 && (await mk({ code: "E2E5", kind: "percent", value: 5 })) === 200);

    {
      const ctx = guestCtx["390"];
      const best = async (code) =>
        (await ctx.request.post(`${BASE}/api/promo/check`, { data: { code, tariffKey: "monthly" } })).json();
      const big = await best("E2E500");
      const small = await best("E2E5");
      check("выгоднейший из двух: −500 ₽ лучше −10 % навсегда — применён код, пояснение",
        big.ok && big.applied?.source === "code" && big.applied?.discountRub === 500 && /выгоднее вашей скидки навсегда/.test(big.notice ?? ""),
        { applied: big.applied, notice: big.notice });
      check("выгоднейший из двух: −5 % хуже — осталась скидка навсегда, пояснение",
        small.ok && small.applied?.source === "lifetime" && small.applied?.discountRub === 199 && /выгоднее промокода E2E5/.test(small.notice ?? ""),
        { applied: small.applied, notice: small.notice });
      const page = await ctx.newPage();
      watchErrors(page, "best-390");
      await open(page, "/order?plan=monthly", "form button[type=submit]", results);
      await page.getByLabel("Промокод").fill("E2E500");
      await page.getByRole("button", { name: /^(Применить|Обновить)$/ }).click();
      await page.locator("[data-testid=promo-notice]").waitFor({ timeout: 60000 });
      const total = await orderTotal(page);
      check("390: /order с E2E500 при скидке навсегда — к оплате 1 490 ₽ (коды не складываются)", total === "1 490 ₽", { total });
      await shot(page, "order-best-of-two-390.png", page.locator("[data-testid=order-subscription-line]").locator("xpath=ancestor::*[contains(@class,'rounded-3xl')][1]"));
      await page.close();
    }

    const root = await rootCtx.newPage();
    watchErrors(root, "root");
    await open(root, "/root/promo-codes", "[data-testid=promo-create-form] button", results);
    const guestRow = norm(await root.locator(`[data-testid=promo-code-row][data-code="${codes.guest1280}"]`).textContent());
    check("ROOT: в списке пометки «навсегда», «персональный», метка рассылки", /навсегда/.test(guestRow) && /персональный/.test(guestRow) && /рассылка e2e-kp-2026-10/.test(guestRow), { guestRow });
    const allCount = await root.locator("[data-testid=promo-code-row]").count();
    await root.locator("[data-testid=promo-filter-personal]").click();
    const personalCount = await root.locator("[data-testid=promo-code-row]").count();
    check("ROOT: фильтр «персональные» — только персональные коды (3 из всех)", personalCount === 3 && allCount > personalCount, { allCount, personalCount });
    await shot(root, "root-promo-codes-personal-1280.png", root.locator("[data-testid=promo-codes-list]"));
    await root.locator("[data-testid=promo-filter-all]").click();
    // Правка: код E2E5 делаем персональным и «навсегда».
    await root.locator('[data-testid=promo-code-row][data-code="E2E5"]').getByRole("button", { name: "Изменить" }).click();
    const edit = root.locator("[data-testid=promo-edit-form]");
    await edit.locator("input[name=lifetime]").check();
    await edit.locator("input[name=personalEmail]").fill(`Partner-${creds.run}@Example.com`);
    await edit.locator("input[name=campaignId]").fill("e2e-edit");
    await edit.getByRole("button", { name: "Сохранить" }).click();
    await root.locator("[data-testid=promo-create-form]").waitFor({ timeout: 60000 });
    const [e2e5] = await sql('select lifetime, "personalEmail", "campaignId" from "PromoCode" where code = $1', ["E2E5"]);
    check("ROOT: правка — «навсегда», персональная почта (нижний регистр), метка рассылки", e2e5.lifetime === true && e2e5.personalEmail === `partner-${creds.run}@example.com` && e2e5.campaignId === "e2e-edit", e2e5);

    const lifetimeRows = await root.locator("[data-testid=lifetime-row]").count();
    const lifetimeText = norm(await root.locator("[data-testid=lifetime-discounts]").textContent());
    check("ROOT: раздел «Скидки навсегда» — два аккаунта, с какого заказа", lifetimeRows === 2 && lifetimeText.includes(`№${creds.paid1280.orderId}`) && lifetimeText.includes(`№${creds.paid390.orderId}`), { lifetimeRows });
    await shot(root, "root-lifetime-1280.png", root.locator("[data-testid=lifetime-discounts]"));
    await root.locator(`[data-testid=lifetime-row][data-code="${codes.guest390}"]`).getByRole("button", { name: "Отменить" }).click();
    await root.getByRole("button", { name: "Отменить скидку" }).click();
    await root.locator(`[data-testid=lifetime-row][data-code="${codes.guest390}"]`).getByText("отменена").waitFor({ timeout: 60000 });
    const [revoked] = await sql('select "revokedAt", "revokedById" from "AccountLifetimeDiscount" where id = $1', [creds.paid390.bindingId]);
    const revokeAudit = await sql(`select "userName" from "AuditLog" where action = 'promo.lifetime.revoke' and "entityId" = $1`, [creds.paid390.bindingId]);
    check("ROOT: «Отменить» с подтверждением — revokedAt, аудит, лог", Boolean(revoked.revokedAt) && revoked.revokedById && revokeAudit.length === 1 && serverLog().includes(`[promo] lifetime revoked account=${creds.org390.accountId}`), { revoked, audits: revokeAudit.length });
    await shot(root, "root-lifetime-revoked-1280.png", root.locator("[data-testid=lifetime-discounts]"));

    for (const [label, viewport] of [["390", PHONE]]) {
      const page = await rootCtx.newPage();
      await page.setViewportSize(viewport);
      await open(page, "/root/promo-codes", "[data-testid=promo-create-form] button", results);
      await shot(page, `root-promo-codes-${label}.png`);
      await page.close();
    }
    await open(root, "/root/audit", "table", results);
    check("/root/audit: «Промокод создан/изменён», «Скидка навсегда закреплена/отменена»",
      (await root.locator("text=Промокод создан").count()) > 0 && (await root.locator("text=Промокод изменён").count()) > 0 &&
        (await root.locator("text=Скидка навсегда закреплена за аккаунтом").count()) > 0 && (await root.locator("text=Скидка навсегда отменена").count()) > 0);

    /* ------------------------------------------ 7. после отмены — следующая оплата без скидки */
    {
      const page = await guestCtx["390"].newPage();
      await open(page, "/order?plan=monthly", "form button[type=submit]", results);
      const total = await orderTotal(page);
      check("после отмены: /order у аккаунта — 1 990 ₽, без скидки навсегда", total === "1 990 ₽" && (await page.locator("[data-personal-discount=true]").count()) === 0, { total });
      await page.close();
    }
    await rootCtx.close();
    for (const ctx of Object.values(guestCtx)) await ctx.close();
  } finally {
    await browser.close();
  }
  results.passed = results.checks.filter((c) => c.ok).length;
  results.failed = results.checks.filter((c) => !c.ok).length;
  results.robokassaHosts = [...new Set(results.robokassa.map((u) => new URL(u).host))];
  fs.writeFileSync(path.join(RAW, "e2e-results.json"), JSON.stringify(results, null, 2));
  console.log(`\n${results.passed} passed, ${results.failed} failed, page errors: ${results.pageErrors.length}, dev reloads: ${results.devReloads}`);
  if (results.failed > 0 || results.pageErrors.length > 0) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  results.fatal = String(err && err.stack);
  fs.writeFileSync(path.join(RAW, "e2e-results.json"), JSON.stringify(results, null, 2));
  process.exit(1);
});
