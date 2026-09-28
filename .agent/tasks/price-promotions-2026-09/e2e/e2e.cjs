// E2E: акции с зачёркнутой ценой и промокоды поверх акции (spec price-promotions-2026-09).
// Запуск: node e2e/e2e.cjs  (после seed.cjs; dev-сервер :3172 поднят).
// Результаты — raw/e2e-results.json, снимки — evidence/*.png (в папке прогона).
const fs = require("node:fs");
const path = require("node:path");
const {
  BASE,
  EVID,
  RAW,
  FAKE_PASSWORD2,
  launch,
  sql,
  login,
  newContext,
  open,
  md5,
  norm,
  readCreds,
} = require("./lib.cjs");

const results = { checks: [], pageErrors: [], robokassa: [], devReloads: 0 };
function check(name, ok, details = {}) {
  // details — отдельным полем: в ответах API есть свой «ok», он не должен
  // перетирать итог проверки.
  results.checks.push({ name, ok: Boolean(ok), details });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${Object.keys(details).length ? " " + JSON.stringify(details) : ""}`);
}

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

/** «2026-09-28T21:00» по Москве (UTC+3) со сдвигом в минутах. */
function mskInput(offsetMinutes = 0) {
  return new Date(Date.now() + 3 * 3600_000 + offsetMinutes * 60_000).toISOString().slice(0, 16);
}

function watchErrors(page, label) {
  page.on("pageerror", (err) => results.pageErrors.push({ page: label, message: String(err && err.message).slice(0, 300) }));
  // Расхождение гидратации React пишет в console.error, а не бросает.
  page.on("console", (msg) => {
    if (msg.type() === "error" && /hydrat|did not match|server rendered/i.test(msg.text())) {
      results.pageErrors.push({ page: label, message: `console: ${msg.text().slice(0, 300)}` });
    }
  });
}

/**
 * Снимок карточки вокруг локатора (ближайший предок с rounded-3xl). Липкие шапки на
 * время снимка прячем — иначе они перекрывают верх карточки.
 */
async function shotCard(locator, file) {
  const card = locator.locator("xpath=ancestor::*[contains(@class,'rounded-3xl')][1]");
  const target = (await card.count()) > 0 ? card.first() : locator.first();
  const page = target.page();
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      const pos = getComputedStyle(el).position;
      if ((pos === "fixed" || pos === "sticky") && el.getBoundingClientRect().top < 120) {
        el.setAttribute("data-e2e-hidden", el.style.visibility || "-");
        el.style.visibility = "hidden";
      }
    }
  });
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await target.screenshot({ path: path.join(EVID, file) });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-e2e-hidden]")) {
      const prev = el.getAttribute("data-e2e-hidden");
      el.style.visibility = prev === "-" ? "" : prev;
      el.removeAttribute("data-e2e-hidden");
    }
  });
}

async function promoInfo(locator) {
  const el = locator.first();
  return {
    active: await el.getAttribute("data-promo-active"),
    old: norm(await el.locator("[data-promo-old]").first().textContent().catch(() => "")),
    now: norm(await el.locator("[data-promo-new]").first().textContent().catch(() => "")),
    badge: norm(await el.locator("[data-promo-badge]").first().textContent().catch(() => "")),
  };
}

function promoOk(info, oldRub, newRub) {
  return (
    info.active === "true" &&
    info.old.includes(oldRub) &&
    info.now.includes(newRub) &&
    /^−20 % до \d{1,2} [а-я]+/.test(info.badge)
  );
}

async function payResult(request, invId, outSum) {
  const res = await request.post(`${BASE}/payment`, {
    form: { OutSum: outSum, InvId: String(invId), SignatureValue: md5(`${outSum}:${invId}:${FAKE_PASSWORD2}`) },
    timeout: 300000,
  });
  return { status: res.status(), body: (await res.text()).trim() };
}

(async () => {
  const creds = readCreds();
  // Чистый лист для повторного прогона: заказы, акции, e2e-коды, история акций.
  await sql('delete from "PartnerAccrual"').catch(() => undefined);
  await sql('delete from "BalanceTransaction" where "paymentOrderId" is not null').catch(() => undefined);
  await sql('delete from "PaymentOrder"');
  await sql('delete from "PricePromotion"');
  await sql(`delete from "PromoCode" where code like 'E2E%'`);
  await sql(`delete from "AuditLog" where entity = 'PricePromotion'`);
  const browser = await launch();
  try {
    /* ------------------------------------------------ 1. ROOT создаёт акцию «сейчас» */
    const rootCtx = await newContext(browser, DESKTOP);
    check("ROOT входит", (await login(rootCtx, creds.root, creds.password)).session);
    const root = await rootCtx.newPage();
    watchErrors(root, "root");
    await open(root, "/root/promotions", "[data-testid=promotion-form] button", results);
    const form = root.locator("[data-testid=promotion-form]");
    await form.locator("input[name=title]").fill("Осенняя скидка");
    await form.locator("input[name=percent]").fill("20");
    await form.locator("input[name=startsAt]").fill(mskInput(-5));
    await form.locator("input[name=endsAt]").fill(mskInput(7 * 24 * 60));
    await form.locator("input[name=note]").fill("e2e: акция на сейчас");
    const preview = await promoInfo(form.locator("[data-testid=promo-price]"));
    check("превью в форме: 1 990 → 1 592, плашка", promoOk(preview, "1 990 ₽", "1 592 ₽"), preview);
    await form.getByRole("button", { name: "Создать акцию" }).click();
    await root.locator("[data-testid=promotions-running] [data-testid=promotion-row]").first().waitFor({ timeout: 120000 });
    // ::text — как лежит в базе (UTC); pg без этого читает timestamp как местное время.
    const [promotion] = await sql('select id, title, percent, active, "startsAt"::text as starts_utc, "endsAt"::text as ends_utc from "PricePromotion" order by "createdAt" desc limit 1');
    results.promotionId = promotion.id;
    check("акция в БД: 20 %, включена, окно (UTC в базе)", promotion.percent === 20 && promotion.active === true, {
      startsUtc: promotion.starts_utc,
      endsUtc: promotion.ends_utc,
    });
    const nowCard = await promoInfo(root.locator("[data-testid=promotions-now] [data-testid=promo-price]"));
    check("ROOT «Сейчас на сайте» — зачёркнутая 1 990 и 1 592", promoOk(nowCard, "1 990 ₽", "1 592 ₽"), nowCard);
    await root.waitForTimeout(800);
    await root.screenshot({ path: path.join(EVID, "root-promotions-running-1280.png") });

    /* ------------------------------------------- 2. витрины в период акции (1280 и 390) */
    for (const [label, viewport] of [["1280", DESKTOP], ["390", PHONE]]) {
      const anon = await newContext(browser, viewport);
      const page = await anon.newPage();
      watchErrors(page, `anon-${label}`);
      await open(page, "/", "#pricing", results);
      const hero = page.locator('a[aria-label="Перейти к тарифам"]:visible [data-testid=promo-price]');
      const heroInfo = await promoInfo(hero);
      check(`лендинг ${label}: первый экран — зачёркнутая и новая`, promoOk(heroInfo, "1 990 ₽", "1 592 ₽"), heroInfo);
      await page.locator('a[aria-label="Перейти к тарифам"]:visible').first().screenshot({ path: path.join(EVID, `landing-hero-${label}.png`) });
      const card = page.locator("#pricing [data-testid=promo-price]").first();
      const cardInfo = await promoInfo(card);
      check(`лендинг ${label}: карточка «Подписка»`, promoOk(cardInfo, "1 990 ₽", "1 592 ₽"), cardInfo);
      await shotCard(card, `landing-plan-card-${label}.png`);
      // Калькулятор оборудования: подписка в итоге тоже по акции.
      await page.getByRole("button", { name: "Подобрать оборудование" }).click();
      const calc = await promoInfo(page.locator("#equipment-calculator [data-testid=promo-price]"));
      check(`лендинг ${label}: калькулятор оборудования`, promoOk(calc, "1 990 ₽", "1 592 ₽"), calc);
      const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
      check(`лендинг ${label}: JSON-LD цена = цена по акции`, /"price":"1592"/.test(ld) && /"priceValidUntil"/.test(ld));

      await open(page, "/pricing", "h1", results);
      const pricingCards = page.locator("main [data-testid=promo-price][data-promo-active=true]");
      const intro = await promoInfo(page.locator("main p [data-testid=promo-price]"));
      check(`/pricing ${label}: текст — зачёркнутая и новая`, intro.active === "true" && intro.old.includes("1 990 ₽") && intro.now.includes("1 592 ₽"), intro);
      const monthlyCard = await promoInfo(pricingCards.nth(1));
      check(`/pricing ${label}: карточки «Подписка» и «+ оборудование»`, (await pricingCards.count()) >= 3 && promoOk(monthlyCard, "1 990 ₽", "1 592 ₽"), {
        count: await pricingCards.count(),
        ...monthlyCard,
      });
      await shotCard(pricingCards.nth(1), `pricing-card-${label}.png`);
      const roi = page.locator("section:has(#roi-employees) [data-testid=promo-price]");
      const roiInfo = await promoInfo(roi);
      check(`/pricing ${label}: ROI-калькулятор (15 сотрудников)`, roiInfo.active === "true", roiInfo);
      await anon.close();

      const ownerCtx = await newContext(browser, viewport, results.robokassa);
      check(`владелец входит (${label})`, (await login(ownerCtx, creds.owner, creds.password)).session);
      const owner = await ownerCtx.newPage();
      watchErrors(owner, `owner-${label}`);
      await open(owner, "/settings/subscription", "h1", results);
      const planCard = owner.locator("[data-testid=promo-price][data-promo-active=true]").first();
      const planInfo = await promoInfo(planCard);
      check(`/settings/subscription ${label}: карточка «Подписка»`, promoOk(planInfo, "1 990 ₽", "1 592 ₽"), planInfo);
      await shotCard(planCard, `settings-plan-card-${label}.png`);
      const stat = owner.locator("section:has-text('Как считается стоимость')").last();
      const statInfo = await promoInfo(stat.locator("[data-testid=promo-price][data-promo-active=true]").last());
      check(`/settings/subscription ${label}: «В месяц» за 6 сотрудников`, promoOk(statInfo, "1 990 ₽", "1 592 ₽"), statInfo);
      await stat.scrollIntoViewIfNeeded();
      await stat.screenshot({ path: path.join(EVID, `settings-how-${label}.png`) });

      await open(owner, "/order?plan=monthly", "form button[type=submit]", results);
      const line = await promoInfo(owner.locator("[data-testid=order-subscription-line] [data-testid=promo-price]"));
      check(`/order ${label}: строка подписки — зачёркнутая и новая`, promoOk(line, "1 990 ₽", "1 592 ₽"), line);
      const total = norm(await owner.locator('span:text-is("К оплате")').locator("xpath=following-sibling::*[1]").textContent());
      check(`/order ${label}: к оплате 1 592 ₽`, total === "1 592 ₽", { total });
      await shotCard(owner.locator("[data-testid=order-subscription-line]"), `order-${label}.png`);
      await ownerCtx.close();
    }

    // Ночная тема лендинга — та же карточка, для проверки контраста плашки.
    {
      const dark = await newContext(browser, DESKTOP, [], { theme: "dark" });
      const page = await dark.newPage();
      watchErrors(page, "anon-dark");
      await open(page, "/", "#pricing", results);
      const card = page.locator("#pricing [data-testid=promo-price]").first();
      check("лендинг, ночная тема: карточка «Подписка»", promoOk(await promoInfo(card), "1 990 ₽", "1 592 ₽"));
      await shotCard(card, "landing-plan-card-dark-1280.png");
      await page.locator('a[aria-label="Перейти к тарифам"]:visible').first().screenshot({ path: path.join(EVID, "landing-hero-dark-1280.png") });
      await dark.close();
    }

    /* ----------------------------------- 3. ROOT создаёт промокод, стартовый набор виден */
    await open(root, "/root/promo-codes", 'input[placeholder="WELCOME10"]', results);
    await root.getByLabel("Код", { exact: true }).fill("E2E10");
    await root.getByLabel("Процент", { exact: true }).fill("10");
    await root.getByRole("button", { name: "Создать", exact: true }).click();
    await root.locator("td:has-text('E2E10')").first().waitFor({ timeout: 60000 });
    check("ROOT создал промокод E2E10 (−10 %)", true);

    /* ------------------------------ 4. промокод поверх акции на /order и оплата (1280) */
    const ownerCtx = await newContext(browser, DESKTOP, results.robokassa);
    await login(ownerCtx, creds.owner, creds.password);
    const owner = await ownerCtx.newPage();
    watchErrors(owner, "owner-pay");
    await open(owner, "/order?plan=monthly", "form button[type=submit]", results);
    await owner.getByLabel("Промокод").fill("e2e10");
    await owner.getByRole("button", { name: "Применить" }).click();
    await owner.locator("text=Промокод E2E10 применён").waitFor({ timeout: 60000 });
    const promoTotal = norm(await owner.locator('span:text-is("К оплате")').locator("xpath=following-sibling::*[1]").textContent());
    const promoLine = norm(await owner.locator("li:has-text('Промокод E2E10')").textContent());
    check("/order: промокод −10 % от цены по акции: 1 592 − 159 = 1 433", promoTotal === "1 433 ₽" && promoLine.includes("−159 ₽"), {
      promoTotal,
      promoLine,
    });
    await shotCard(owner.locator("[data-testid=order-subscription-line]"), "order-promo-code-1280.png");
    await owner.locator("form button[type=submit]").click();
    await owner.locator("#rk-stub").waitFor({ timeout: 120000 });
    const payUrl = results.robokassa.filter((u) => /Index\.aspx/i.test(u)).pop();
    const params = new URL(payUrl).searchParams;
    const invId = Number(params.get("InvId"));
    const receipt = JSON.parse(params.get("Receipt") || "{}");
    check("к оплате в Робокассу ушло 1433.00 (заглушка, наружу не ходили)", params.get("OutSum") === "1433.00" && params.get("IsTest") === "1", {
      OutSum: params.get("OutSum"),
      IsTest: params.get("IsTest"),
      Description: params.get("Description"),
    });
    check("чек Робокассы — итоговая сумма", receipt.items?.[0]?.sum === 1433, { receipt });
    const [order] = await sql(
      'select id, "amountRub", "baseRub", "promotionId", "promotionPercent", "promotionDiscountRub", "promoCode", "discountRub", description, status from "PaymentOrder" where id = $1',
      [invId],
    );
    results.order = order;
    check(
      "заказ: база 1990, акция −20 % (−398), промокод E2E10 −159, сумма 1433",
      Number(order.amountRub) === 1433 &&
        order.baseRub === 1990 &&
        order.promotionId === results.promotionId &&
        order.promotionPercent === 20 &&
        order.promotionDiscountRub === 398 &&
        order.promoCode === "E2E10" &&
        order.discountRub === 159 &&
        /акция «Осенняя скидка» −20 %; промокод E2E10: −159 ₽/.test(norm(order.description)),
      { description: order.description },
    );
    const paid = await payResult(ownerCtx.request, invId, "1433.00");
    check("ResultURL (наш /payment, подпись тестовым паролем) → OK", paid.body === `OK${invId}`, paid);
    const [after] = await sql('select status from "PaymentOrder" where id = $1', [invId]);
    check("заказ оплачен", after.status === "paid", after);

    /* ---------------------------------------------- 5. учёт использований в ROOT */
    await open(root, "/root/promo-codes", 'input[placeholder="WELCOME10"]', results);
    const e2eRow = norm(await root.locator("tr:has-text('E2E10')").textContent());
    const e2eUses = norm(await root.locator("tr:has-text('E2E10') td").nth(3).textContent());
    check("ROOT промокоды: у E2E10 одна оплата", e2eUses === "1", { e2eRow, e2eUses });
    await root.locator("tr:has-text('E2E10')").screenshot({ path: path.join(EVID, "root-promo-codes-uses-1280.png") });
    await open(root, "/root/promotions", "[data-testid=promotion-form] button", results);
    const statText = norm(await root.locator("[data-testid=promotion-row]").first().textContent());
    check("ROOT акции: «Оплат по акции: 1 · скидка клиентам 398 ₽»", /Оплат по акции: 1 · скидка клиентам 398 ₽/.test(statText), { statText });

    /* ------------------------ 6. API: сверка цены, лимит после достройки, «только новым» */
    const check1 = await (await ownerCtx.request.post(`${BASE}/api/promo/check`, { data: { code: "E2E10", tariffKey: "monthly" } })).json();
    check("/api/promo/check: скидка от цены по акции", check1.ok === true && check1.discountRub === 159 && check1.offerRub === 1592, check1);
    const stale = await ownerCtx.request.post(`${BASE}/api/payments/robokassa/create`, {
      data: { tariffKey: "monthly", usePoints: false, expectedGrossRub: 1990 },
    });
    const staleBody = await stale.json();
    check("create: страница со старой ценой → 409 price-changed, заказ не создан", stale.status() === 409 && staleBody.code === "price-changed", {
      status: stale.status(),
      ...staleBody,
    });

    const mkCode = async (data) =>
      (await rootCtx.request.post(`${BASE}/api/root/promo-codes`, { data })).status();
    check("ROOT API: E2EONE (лимит 1) и E2ENEW (только новым)", (await mkCode({ code: "E2EONE", kind: "fixed", value: 300, maxUses: 1 })) === 200 && (await mkCode({ code: "E2ENEW", kind: "percent", value: 15, newClientsOnly: true })) === 200);
    const one = await ownerCtx.request.post(`${BASE}/api/payments/robokassa/create`, { data: { tariffKey: "monthly", usePoints: false, promoCode: "E2EONE" } });
    const oneBody = await one.json();
    check("оплата с E2EONE: 1592 − 300 = 1292", one.status() === 200 && oneBody.amountRub === 1292, { status: one.status(), amountRub: oneBody.amountRub });
    await payResult(ownerCtx.request, oneBody.invId, "1292.00");
    // Новый клиент дозаполнил профиль → статус completed. Раньше счётчик кода смотрел
    // только на paid, и лимит «1» после этого снова пускал.
    await sql(`update "PaymentOrder" set status = 'completed', "completedAt" = now() where id = $1`, [oneBody.invId]);
    const exhausted = await (await ownerCtx.request.post(`${BASE}/api/promo/check`, { data: { code: "E2EONE", tariffKey: "monthly" } })).json();
    check("лимит считается и по completed-заказам", exhausted.ok === false && /максимальное число раз/.test(exhausted.message), exhausted);
    // «Только новым» смотрит на НЕ тестовые оплаты (как было): тестовая касса в e2e
    // даёт isTest=true, поэтому одну оплату помечаем боевой — как в проде.
    await sql(`update "PaymentOrder" set "isTest" = false where id = $1`, [invId]);
    const notNew = await (await ownerCtx.request.post(`${BASE}/api/promo/check`, { data: { code: "E2ENEW", tariffKey: "monthly" } })).json();
    check("«только новым»: у организации уже есть оплаты", notNew.ok === false && /только для новых/.test(notNew.message), notNew);
    const anonCtx = await newContext(browser, DESKTOP);
    const byEmail = await anonCtx.request.post(`${BASE}/api/payments/robokassa/create`, {
      data: { tariffKey: "monthly", email: creds.owner, promoCode: "E2ENEW" },
    });
    const byEmailBody = await byEmail.json();
    check("«только новым» без входа, по почте постоянного клиента — отказ", byEmail.status() === 400 && /только для новых/.test(byEmailBody.error), {
      status: byEmail.status(),
      ...byEmailBody,
    });
    const fresh = await anonCtx.request.post(`${BASE}/api/payments/robokassa/create`, {
      data: { tariffKey: "monthly", email: `pr-new-${creds.run}@example.com`, promoCode: "E2ENEW", expectedGrossRub: 1592 - 239 },
    });
    const freshBody = await fresh.json();
    check("«только новым» для новой почты: 1592 − 15 % (239) = 1353", fresh.status() === 200 && freshBody.amountRub === 1353, {
      status: fresh.status(),
      amountRub: freshBody.amountRub,
    });
    await anonCtx.close();

    /* ------------------------------------------ 7. акция в прошлом — обычная цена */
    await open(root, "/root/promotions", "[data-testid=promotion-form] button", results);
    await root.locator("[data-testid=promotions-running] [data-testid=promotion-row]").first().getByRole("button", { name: "Изменить" }).click();
    await form.locator("input[name=startsAt]").fill(mskInput(-10 * 24 * 60));
    await form.locator("input[name=endsAt]").fill(mskInput(-24 * 60));
    await form.getByRole("button", { name: "Сохранить акцию" }).click();
    await root.locator("[data-testid=promotions-finished] [data-testid=promotion-row]").first().waitFor({ timeout: 120000 });
    await root.waitForTimeout(800);
    check("ROOT: акция ушла в «Прошедшие», сейчас акций нет", norm(await root.locator("[data-testid=promotions-now]").textContent()).includes("Акций нет"));
    const history = norm(await root.locator("[data-testid=promotions-history]").textContent());
    check("ROOT: история — создана и изменена (конец по МСК)", /Создана «Осенняя скидка»/.test(history) && /Изменена «Осенняя скидка».*конец/.test(history), {
      history: history.slice(0, 300),
    });
    await root.screenshot({ path: path.join(EVID, "root-promotions-past-1280.png"), fullPage: true });
    await open(root, "/root/audit", "table", results);
    check("/root/audit: «Акция создана» / «Акция изменена»", (await root.locator("text=Акция создана").count()) > 0 && (await root.locator("text=Акция изменена").count()) > 0);

    for (const [label, viewport] of [["1280", DESKTOP], ["390", PHONE]]) {
      const anon = await newContext(browser, viewport);
      const page = await anon.newPage();
      watchErrors(page, `anon-past-${label}`);
      await open(page, "/", "#pricing", results);
      const active = await page.locator("[data-testid=promo-price][data-promo-active=true]").count();
      const cardText = norm(await page.locator("#pricing").textContent());
      check(`прошедшая акция: лендинг ${label} — обычная цена`, active === 0 && cardText.includes("1 990 ₽") && !cardText.includes("1 592"), { active });
      await shotCard(page.locator("#pricing a[href='/order?plan=monthly']").first(), `landing-plan-card-past-${label}.png`);
      await open(page, "/pricing", "h1", results);
      check(`прошедшая акция: /pricing ${label}`, (await page.locator("[data-testid=promo-price][data-promo-active=true]").count()) === 0);
      await anon.close();
    }
    await open(owner, "/settings/subscription", "h1", results);
    check("прошедшая акция: /settings/subscription", (await owner.locator("[data-testid=promo-price][data-promo-active=true]").count()) === 0);
    await open(owner, "/order?plan=monthly", "form button[type=submit]", results);
    const pastTotal = norm(await owner.locator('span:text-is("К оплате")').locator("xpath=following-sibling::*[1]").textContent());
    check("прошедшая акция: /order к оплате 1 990 ₽, без зачёркивания", pastTotal === "1 990 ₽" && (await owner.locator("[data-promo-active=true]").count()) === 0, { pastTotal });
    const regular = await ownerCtx.request.post(`${BASE}/api/payments/robokassa/create`, {
      data: { tariffKey: "monthly", usePoints: false, expectedGrossRub: 1990 },
    });
    const regularBody = await regular.json();
    const [regularOrder] = await sql('select "amountRub", "baseRub", "promotionId", "promotionDiscountRub" from "PaymentOrder" where id = $1', [regularBody.invId]);
    check("прошедшая акция: заказ на 1990 без акции", Number(regularOrder.amountRub) === 1990 && regularOrder.promotionId === null && regularOrder.promotionDiscountRub === 0, {
      ...regularOrder,
      amountRub: Number(regularOrder.amountRub),
    });
    await ownerCtx.close();
    await rootCtx.close();
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
