// E2E: «Баланс и бонусы» — поля отзыва без дублей, анонимный отзыв −20 %, пополнение баланса деньгами
// (spec balance-reviews-topup). Запуск: node e2e/seed.cjs && node e2e/e2e.cjs (dev-сервер :3194 поднят с
// фиктивным тестовым магазином Робокассы). Результаты — raw/e2e-results.json, снимки — evidence/*.png
// (в папке прогона вне проекта).
const fs = require("node:fs");
const path = require("node:path");
const {
  APP_UA,
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
  successUrl,
} = require("./lib.cjs");

const results = { checks: [], pageErrors: [], robokassa: [], devReloads: 0 };
function check(name, ok, details = {}) {
  results.checks.push({ name, ok: Boolean(ok), details });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${Object.keys(details).length ? " " + JSON.stringify(details) : ""}`);
}

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const REVIEW_TEXT =
  "Перешли на электронные журналы весной: повара заполняют с телефона по QR, проверка Роспотребнадзора прошла без замечаний.";

function watchErrors(page, label) {
  page.on("pageerror", (err) => results.pageErrors.push({ page: label, message: String(err && err.message).slice(0, 300) }));
  page.on("console", (msg) => {
    if (msg.type() === "error" && /hydrat|did not match|server rendered/i.test(msg.text())) {
      results.pageErrors.push({ page: label, message: `console: ${msg.text().slice(0, 300)}` });
    }
  });
}

/** Снимок блока (липкие шапки прячем) или экрана. */
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
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await locator.screenshot({ path: path.join(EVID, file) });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-e2e-hidden]")) {
      const prev = el.getAttribute("data-e2e-hidden");
      el.style.visibility = prev === "-" ? "" : prev;
      el.removeAttribute("data-e2e-hidden");
    }
  });
}

function serverLog() {
  try {
    return fs.readFileSync(SERVER_LOG, "utf8");
  } catch {
    return "";
  }
}

/** Секция раздела по заголовку h2. */
function sectionByTitle(page, title) {
  // .last(): если секции вложены, внутренняя идёт в документе позже внешней.
  return page.locator("section", { has: page.locator("h2", { hasText: title }) }).last();
}

async function balanceOf(organizationId) {
  const [row] = await sql('select "balanceRub" from "Organization" where id = $1', [organizationId]);
  return row?.balanceRub ?? null;
}

async function ledgerFor(dedupeKey) {
  return sql('select amount, kind, description from "BalanceTransaction" where "dedupeKey" = $1', [dedupeKey]);
}

async function accrualsFor(orderId) {
  const rows = await sql(
    'select kind, "baseAmountRub"::float as base, "amountRub"::float as amount, "partnerId" from "PartnerAccrual" where "paymentOrderId" = $1 order by kind',
    [orderId],
  );
  return rows;
}

/** Страница формы отзыва: подписи, предзаполнение, анонимность. */
async function reviewFormChecks(page, label, creds) {
  const section = sectionByTitle(page, "Оставьте отзыв");
  await section.waitFor({ timeout: 120000 });
  const authorLabel = norm(await page.locator("label[for=review-author]").textContent());
  const placeLabel = norm(await page.locator("label[for=review-place]").textContent());
  const author = await page.locator("#review-author").inputValue();
  const place = await page.locator("#review-place").inputValue();
  check(`${label}: у полей отзыва видимые подписи «Как вас подписать» и «Заведение и город»`,
    authorLabel === "Как вас подписать" && placeLabel === "Заведение и город" &&
      (await page.locator("label[for=review-author]").isVisible()) && (await page.locator("label[for=review-place]").isVisible()),
    { authorLabel, placeLabel });
  check(`${label}: предзаполнение без дублей — имя человека, в «Заведение и город» только город (организация названа как человек)`,
    author === creds.sameName && place === "Казань" && author !== place, { author, place });
  await shot(page, `review-form-${label}.png`, section);

  await page.locator("[data-testid=review-anonymous]").check();
  await page.waitForTimeout(300);
  const hidden = (await page.locator("#review-author").count()) === 0 && (await page.locator("#review-place").count()) === 0;
  const consent = norm(await page.locator("[data-testid=review-consent-text]").textContent());
  const tiles = {};
  for (const kind of ["text", "photo", "video"]) {
    const tile = page.locator(`[data-testid=review-tile-${kind}]`);
    tiles[kind] = {
      old: norm(await tile.locator("s").textContent()).replace(/^было /, ""),
      text: norm(await tile.textContent()),
    };
  }
  const reward = page.locator("[data-testid=review-reward]");
  const rewardOld = norm(await page.locator("[data-testid=review-reward-old]").textContent()).replace(/^было /, "");
  const rewardText = norm(await reward.textContent());
  check(`${label}: анонимно — поля имени и заведения скрыты, согласие «без имени и заведения»`,
    hidden && consent === "Согласен на публикацию текста отзыва без имени и заведения", { hidden, consent });
  check(`${label}: на плитках старая сумма зачёркнута, новая −20 %: 300 → 240, 750 → 600, 1990 → 1592`,
    tiles.text.old === "300 ₽" && tiles.text.text.includes("240 ₽") &&
      tiles.photo.old === "750 ₽" && tiles.photo.text.includes("600 ₽") &&
      tiles.video.old === "1 990 ₽" && tiles.video.text.includes("1 592 ₽"), tiles);
  check(`${label}: «Будет начислено» — 300 зачёркнуто, 240`, rewardOld === "300 ₽" && rewardText.includes("240 ₽"), { rewardOld, rewardText });
  await shot(page, `review-form-anonymous-${label}.png`, section);
}

(async () => {
  const creds = readCreds();
  const browser = await launch();
  try {
    /* ------------------------------------------------ 1. форма отзыва: подписи, без дублей, анонимно */
    const owner = await newContext(browser, DESKTOP, results.robokassa);
    check("владелец A входит (1280)", (await login(owner, creds.owner, creds.password)).session);
    const page = await owner.newPage();
    watchErrors(page, "owner-1280");
    await open(page, "/settings/balance", "[data-testid=topup-section]", results);
    await reviewFormChecks(page, "1280", creds);

    const phone = await newContext(browser, PHONE, results.robokassa);
    check("владелец A входит (390)", (await login(phone, creds.owner, creds.password)).session);
    const phonePage = await phone.newPage();
    watchErrors(phonePage, "owner-390");
    await open(phonePage, "/settings/balance", "[data-testid=topup-section]", results);
    await reviewFormChecks(phonePage, "390", creds);

    /* ------------------------------------------ 2. отправка анонимного отзыва → ROOT: «анонимно» и 240 */
    // Страницу открываем заново: dev-сервер после компиляции других маршрутов перезагружает открытые
    // вкладки, и отметка «анонимно» с шага 1 могла сброситься. Человек отмечает её и сразу пишет отзыв.
    await open(page, "/settings/balance", "[data-testid=topup-section]", results);
    await page.locator("[data-testid=review-anonymous]").check();
    await page.locator("textarea[aria-label='Текст отзыва']").fill(REVIEW_TEXT);
    check("перед отправкой: «анонимно» отмечено, полей имени и заведения нет",
      (await page.locator("[data-testid=review-anonymous]").isChecked()) && (await page.locator("#review-author").count()) === 0);
    const submitResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/balance/reviews") && r.request().method() === "POST",
      { timeout: 240000 },
    );
    await page.getByRole("button", { name: "Отправить отзыв" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Отправить" }).click();
    const submitted = await submitResponse;
    const submittedBody = submitted.request().postDataJSON();
    check("форма отправила anonymous: true, без имени и заведения и без суммы",
      submitted.status() === 200 && submittedBody.anonymous === true && !("authorName" in submittedBody) && !("place" in submittedBody) &&
        !("rewardRub" in submittedBody),
      { status: submitted.status(), keys: Object.keys(submittedBody) });
    await sectionByTitle(page, "Ваш отзыв").waitFor({ timeout: 120000 });
    const mine = norm(await sectionByTitle(page, "Ваш отзыв").textContent());
    const [review] = await sql(
      'select id, anonymous, "authorName", place, kind, status from "CustomerReview" where "userId" = $1 order by "createdAt" desc limit 1',
      [creds.ownerId],
    );
    check("отзыв отправлен анонимно: в БД anonymous, имя и заведение пустые, вид — текст, на проверке",
      review && review.anonymous === true && review.authorName === "" && review.place === "" && review.kind === "text" && review.status === "pending",
      review);
    check("карточка «Ваш отзыв» — «анонимно, без имени и заведения»", mine.includes("— анонимно, без имени и заведения"), { mine: mine.slice(0, 200) });
    check("лог [balance] review submitted … anonymous=true reward=240",
      serverLog().includes(`[balance] review submitted id=${review.id} org=${creds.organizationId} user=${creds.ownerId} kind=text anonymous=true reward=240`));

    // Отзыв «через API» с подделанными суммой и видом — сервер их не принимает.
    const ownerB = await newContext(browser, DESKTOP);
    check("владелец B входит", (await login(ownerB, creds.ownerB, creds.password)).session);
    const forged = await ownerB.request.post(`${BASE}/api/balance/reviews`, {
      data: {
        text: REVIEW_TEXT,
        authorName: "Борис Тестов",
        place: "Кофейня «Зерно», Тверь",
        anonymous: true,
        consentPublic: true,
        rating: 5,
        rewardRub: 1990,
        suggestedRewardRub: 1990,
        kind: "video",
        attachments: [],
      },
    });
    const forgedBody = await forged.json();
    check("API: подделанные rewardRub/kind игнорируются — вид по вложению (текст), к начислению 240",
      forged.status() === 200 && forgedBody.review.kind === "text" && forgedBody.review.suggestedRewardRub === 240 &&
        forgedBody.review.anonymous === true && forgedBody.review.authorName === "" && forgedBody.review.place === "",
      { status: forged.status(), review: forgedBody.review && { kind: forgedBody.review.kind, suggested: forgedBody.review.suggestedRewardRub } });

    const rootCtx = await newContext(browser, DESKTOP);
    check("ROOT входит", (await login(rootCtx, creds.root, creds.password)).session);
    const root = await rootCtx.newPage();
    watchErrors(root, "root-1280");
    await open(root, "/root/reviews", "article", results);
    const card = root.locator("article", { hasText: REVIEW_TEXT }).filter({ hasText: "Алексей Партнёрская программа" }).first();
    const cardText = norm(await card.textContent());
    check("ROOT /root/reviews: пометка «анонимно», подпись «Анонимный отзыв», к начислению 240 ₽",
      (await card.locator("[data-testid=review-anonymous-badge]").count()) === 1 && cardText.includes("Анонимный отзыв") &&
        norm(await card.locator("[data-testid=review-suggested-reward]").textContent()) === "240 ₽",
      { cardText: cardText.slice(0, 240) });
    await shot(root, "root-reviews-anonymous-1280.png", card);
    {
      const rootPhone = await rootCtx.newPage();
      await rootPhone.setViewportSize(PHONE);
      await open(rootPhone, "/root/reviews", "article", results);
      await shot(rootPhone, "root-reviews-anonymous-390.png",
        rootPhone.locator("article", { hasText: REVIEW_TEXT }).filter({ hasText: "Алексей Партнёрская программа" }).first());
      await rootPhone.close();
    }
    await card.getByRole("button", { name: "Одобрить" }).click();
    const approveDialog = root.getByRole("dialog");
    const approveTitle = norm(await approveDialog.locator("h2, h3").first().textContent());
    check("ROOT: диалог одобрения «Одобрить и начислить 240 ₽?»", approveTitle === "Одобрить и начислить 240 ₽?", { approveTitle });
    const balanceBeforeReview = await balanceOf(creds.organizationId);
    const approveResponse = root.waitForResponse((r) => r.url().includes(`/api/root/reviews/${review.id}/approve`), { timeout: 240000 });
    await approveDialog.getByRole("button", { name: "Одобрить" }).click();
    await approveResponse;
    await root.waitForTimeout(500);
    const [approved] = await sql('select status, "rewardRub" from "CustomerReview" where id = $1', [review.id]);
    const reviewLedger = await ledgerFor(`review_reward:${review.id}`);
    check("одобрение: начислено 240 ₽ (не 300), строка «Анонимный отзыв о WeSetup принят»",
      approved.status === "approved" && approved.rewardRub === 240 && reviewLedger.length === 1 && reviewLedger[0].amount === 240 &&
        reviewLedger[0].description === "Анонимный отзыв о WeSetup принят" && (await balanceOf(creds.organizationId)) === balanceBeforeReview + 240,
      { approved, reviewLedger });
    const approveAudit = await sql(`select details from "AuditLog" where action = 'review.approve' and "entityId" = $1`, [review.id]);
    check("аудит review.approve с суммой и пометкой анонимности", approveAudit.length === 1 && approveAudit[0].details.rewardRub === 240 && approveAudit[0].details.anonymous === true,
      { approveAudit });
    const forgedApprove = await rootCtx.request.post(`${BASE}/api/root/reviews/${forgedBody.review.id}/approve`, { data: {} });
    const [forgedRow] = await sql('select "rewardRub" from "CustomerReview" where id = $1', [forgedBody.review.id]);
    check("отзыв с подделанной суммой одобрен на 240 ₽ — сумма посчитана сервером", forgedApprove.status() === 200 && forgedRow.rewardRub === 240, { forgedRow });

    // Публикация на сайте — без имени и заведения, со сферой организации.
    for (const [label, viewport] of [["1280", DESKTOP], ["390", PHONE]]) {
      const guest = await newContext(browser, viewport);
      const landing = await guest.newPage();
      watchErrors(landing, `landing-${label}`);
      await open(landing, "/", "h1", results);
      const testimonials = landing.locator("section", { has: landing.locator("h2", { hasText: "Что говорят заведения" }) }).last();
      await testimonials.waitFor({ timeout: 120000 });
      const text = norm(await testimonials.textContent());
      check(`${label}: лендинг — «Анонимный отзыв» и сфера «Кафе / Кофейня», без имени и заведения`,
        text.includes("Анонимный отзыв") && text.includes("Кафе / Кофейня") && !text.includes("Алексей") && !text.includes("Казань") && !text.includes("Борис"),
        { text: text.slice(0, 300) });
      await shot(landing, `landing-anonymous-${label}.png`, testimonials);
      await guest.close();
    }

    /* ------------------------------------------------------------------ 3. пополнение картой */
    await open(page, "/settings/balance", "[data-testid=topup-section]", results);
    const topupSection = sectionByTitle(page, "Пополнить баланс");
    const presets = await topupSection.locator("[role=group] button").allTextContents();
    check("блок «Пополнить баланс»: кнопки 1 990 / 5 000 / 10 000 ₽, поле суммы, «Оплатить картой» и «Выставить счёт»",
      presets.map(norm).join("|") === "1 990 ₽|5 000 ₽|10 000 ₽" && (await page.locator("#topup-amount").count()) === 1 &&
        (await page.locator("[data-testid=topup-card]").count()) === 1 && (await page.locator("[data-testid=topup-invoice]").count()) === 1,
      { presets: presets.map(norm) });
    await topupSection.getByRole("button", { name: /^5\s000\s₽$/ }).click();
    check("выбрано 5 000 ₽ — «К оплате 5 000 ₽»", norm(await page.locator("[data-testid=topup-total]").textContent()) === "5 000 ₽");
    await shot(page, "topup-block-1280.png", topupSection);

    const balanceBeforeCard = await balanceOf(creds.organizationId);
    const before = results.robokassa.length;
    await page.locator("[data-testid=topup-card]").click();
    await page.locator("#rk-stub").waitFor({ timeout: 180000 });
    const payUrl = results.robokassa.slice(before).filter((u) => /Index\.aspx/i.test(u)).pop();
    const payParams = new URL(payUrl).searchParams;
    const cardOrderId = Number(payParams.get("InvId"));
    const outSum = payParams.get("OutSum");
    const [cardOrder] = await sql('select "tariffKey", status, "amountRub"::float as amount, "paymentMethod", "promoCode", "pointsSpent", "organizationId" from "PaymentOrder" where id = $1', [cardOrderId]);
    check("касса: 5000.00 ₽, описание «Пополнение баланса на 5 000 ₽», тестовый режим",
      outSum === "5000.00" && payParams.get("Description") === "Пополнение баланса на 5 000 ₽" && payParams.get("IsTest") === "1",
      { outSum, description: payParams.get("Description"), isTest: payParams.get("IsTest") });
    check("заказ-пополнение: tariffKey balance_topup, pending, 5000, без промокода и баллов, на организацию A",
      cardOrder && cardOrder.tariffKey === "balance_topup" && cardOrder.status === "pending" && cardOrder.amount === 5000 &&
        cardOrder.paymentMethod === "card" && cardOrder.promoCode === null && cardOrder.pointsSpent === 0 && cardOrder.organizationId === creds.organizationId,
      cardOrder);

    const paid1 = await payResult(owner.request, cardOrderId, outSum);
    const cardLedger = await ledgerFor(`topup:${cardOrderId}`);
    const balanceAfterCard = await balanceOf(creds.organizationId);
    check("ResultURL → OK; баланс вырос на 5 000, строка «Пополнение»",
      paid1.body === `OK${cardOrderId}` && cardLedger.length === 1 && cardLedger[0].kind === "topup" && cardLedger[0].amount === 5000 &&
        cardLedger[0].description === `Пополнение баланса картой, заказ №${cardOrderId} (тестовый платёж)` && balanceAfterCard === balanceBeforeCard + 5000,
      { paid1, cardLedger, balanceBeforeCard, balanceAfterCard });
    const cardAccruals = await accrualsFor(cardOrderId);
    check("партнёру начислено с пополнения: 20 % от 5 000 = 1 000 ₽",
      cardAccruals.length === 1 && cardAccruals[0].kind === "subscription" && cardAccruals[0].base === 5000 && cardAccruals[0].amount === 1000 &&
        cardAccruals[0].partnerId === creds.partnerId,
      { cardAccruals });
    check("лог [balance] topup paid org=… rub=5000 order=…",
      serverLog().includes(`[balance] topup paid org=${creds.organizationId} rub=5000 order=${cardOrderId}`));

    const paid2 = await payResult(owner.request, cardOrderId, outSum);
    check("повторное уведомление кассы — OK, но без второго зачисления и второй комиссии",
      paid2.body === `OK${cardOrderId}` && (await ledgerFor(`topup:${cardOrderId}`)).length === 1 &&
        (await balanceOf(creds.organizationId)) === balanceAfterCard && (await accrualsFor(cardOrderId)).length === 1,
      { paid2 });
    const topupAudit = await sql(`select action from "AuditLog" where "entityId" = $1 and action like 'balance.topup.%' order by "createdAt"`, [String(cardOrderId)]);
    check("аудит: balance.topup.create и balance.topup.paid", topupAudit.map((r) => r.action).join(",") === "balance.topup.create,balance.topup.paid", { topupAudit });

    const back = await owner.newPage();
    await open(back, successUrl(cardOrderId, outSum), "a[href='/settings/balance']", results);
    const backText = norm(await back.locator("main").textContent());
    check("возврат с кассы (/order): «Оплата получена», «Баланс организации пополнен», ссылка на баланс, без «подписка продлена»",
      backText.includes("Оплата получена") && backText.includes("Баланс организации пополнен") && !backText.includes("Подписка вашей организации продлена"),
      { backText: backText.slice(0, 300) });
    await shot(back, "order-return-topup-1280.png");
    await back.close();

    await open(page, "/settings/balance", "[data-testid=topup-section]", results);
    const history = sectionByTitle(page, "История начислений");
    const historyText = norm(await history.textContent());
    check("история баланса: «Пополнение баланса картой, заказ №…» +5 000 ₽",
      historyText.includes(`Пополнение баланса картой, заказ №${cardOrderId}`) && historyText.includes("+5 000 ₽"), { historyText: historyText.slice(0, 300) });
    await shot(page, "topup-history-1280.png", history);
    await shot(page, "balance-page-1280.png");

    /* -------------------------------- 4. подписка баллами из пополнения — второй комиссии партнёру нет */
    const orderPage = await owner.newPage();
    await open(orderPage, "/order?plan=monthly", "form button[type=submit]", results);
    const submitText = norm(await orderPage.locator("form button[type=submit]").textContent());
    await orderPage.locator("form button[type=submit]").click();
    await orderPage.locator("text=Оплата получена").waitFor({ timeout: 180000 });
    const [pointsOrder] = await sql(
      `select id, status, "amountRub"::float as amount, "pointsSpent" from "PaymentOrder" where "organizationId" = $1 and "tariffKey" = 'monthly' order by id desc limit 1`,
      [creds.organizationId],
    );
    const pointsAccruals = await accrualsFor(pointsOrder.id);
    check("подписка 1 990 ₽ оплачена баллами из пополнения (0 ₽ деньгами) — партнёру второго начисления нет",
      submitText === "Оплатить баллами" && pointsOrder.status === "paid" && pointsOrder.amount === 0 && pointsOrder.pointsSpent === 1990 && pointsAccruals.length === 0,
      { submitText, pointsOrder, pointsAccruals });
    const totalAccruals = await sql('select count(*)::int as n from "PartnerAccrual" where "organizationId" = $1', [creds.organizationId]);
    check("у партнёра по клиенту A одна комиссия — только с пополнения", totalAccruals[0].n === 1, totalAccruals[0]);
    await orderPage.close();

    /* ------------------------------------------------------ 5. счёт на пополнение (390) → ROOT → баланс */
    await open(phonePage, "/settings/balance", "[data-testid=topup-section]", results);
    const phoneTopup = sectionByTitle(phonePage, "Пополнить баланс");
    await shot(phonePage, "topup-block-390.png", phoneTopup);
    await phonePage.locator("#topup-amount").fill("10 000");
    check("своя сумма 10 000 — «К оплате 10 000 ₽»", norm(await phonePage.locator("[data-testid=topup-total]").textContent()) === "10 000 ₽");
    await phonePage.locator("#topup-amount").fill("499");
    await phonePage.locator("#topup-amount").blur();
    const minHint = norm(await phonePage.locator("#topup-amount-hint").textContent());
    check("поле суммы: 499 — подсказка «Минимальная сумма — 500 ₽»", minHint === "Минимальная сумма — 500 ₽", { minHint });
    await phonePage.locator("#topup-amount").fill("10000");
    const popupPromise = phone.waitForEvent("page", { timeout: 30000 }).catch(() => null);
    await phonePage.locator("[data-testid=topup-invoice]").click();
    const invoiceDialog = phonePage.getByRole("dialog");
    const invoiceTitle = norm(await invoiceDialog.locator("h2, h3").first().textContent());
    const invoiceResponse = phonePage.waitForResponse(
      (r) => r.url().endsWith("/api/balance/topup") && r.request().method() === "POST",
      { timeout: 240000 },
    );
    await invoiceDialog.getByRole("button", { name: "Выставить счёт" }).click();
    const invoiceCreated = await invoiceResponse;
    check("«Выставить счёт» → POST /api/balance/topup { method: invoice, 10000 } → 200",
      invoiceCreated.status() === 200 && invoiceCreated.request().postDataJSON().method === "invoice" &&
        invoiceCreated.request().postDataJSON().amountRub === 10000,
      { status: invoiceCreated.status(), body: invoiceCreated.request().postDataJSON() });
    const popup = await popupPromise;
    if (popup) await popup.close().catch(() => undefined);
    await phonePage.locator("[data-testid=topup-pending-invoice]").waitFor({ timeout: 120000 });
    const pendingText = norm(await phonePage.locator("[data-testid=topup-pending-invoice]").textContent());
    const [invoiceOrder] = await sql(
      `select id, status, "amountRub"::float as amount, "paymentMethod", description from "PaymentOrder" where "organizationId" = $1 and "tariffKey" = 'balance_topup' and "paymentMethod" = 'invoice' order by id desc limit 1`,
      [creds.organizationId],
    );
    check("счёт на пополнение: диалог «Выставить счёт на 10 000 ₽?», заказ-счёт pending 10 000, блок показывает действующий счёт",
      invoiceTitle === "Выставить счёт на 10 000 ₽?" && invoiceOrder && invoiceOrder.status === "pending" && invoiceOrder.amount === 10000 &&
        invoiceOrder.description === "Пополнение баланса на 10 000 ₽ (счёт)" && pendingText.includes(`Счёт № ${invoiceOrder.id} на 10 000 ₽ выставлен`),
      { invoiceTitle, invoiceOrder, pendingText: pendingText.slice(0, 200) });
    await shot(phonePage, "topup-invoice-pending-390.png", phoneTopup);
    const pdf = await phone.request.get(`${BASE}/api/payments/invoice/${invoiceOrder.id}/pdf`);
    const pdfBody = await pdf.body();
    check("PDF счёта на пополнение отдаётся", pdf.status() === 200 && pdf.headers()["content-type"] === "application/pdf" && pdfBody.subarray(0, 4).toString() === "%PDF",
      { status: pdf.status(), bytes: pdfBody.length });
    fs.writeFileSync(path.join(RAW, `invoice-topup-${invoiceOrder.id}.pdf`), pdfBody);
    const otherAmount = await phone.request.post(`${BASE}/api/balance/topup`, { data: { amountRub: 7000, method: "invoice" } });
    const otherBody = await otherAmount.json();
    check("второй счёт на другую сумму, пока действует первый, — отказ с номером действующего",
      otherAmount.status() === 409 && norm(otherBody.error).startsWith(`Уже выставлен счёт № ${invoiceOrder.id} на 10 000 ₽`), otherBody);
    const sameAmount = await phone.request.post(`${BASE}/api/balance/topup`, { data: { amountRub: 10000, method: "invoice" } });
    const sameBody = await sameAmount.json();
    check("повтор с той же суммой — тот же счёт, без нового заказа", sameAmount.status() === 200 && sameBody.orderId === invoiceOrder.id && sameBody.created === false, sameBody);
    const closing = await owner.request.get(`${BASE}/api/closing-documents/${cardOrderId}/pdf`);
    const closingBody = await closing.json().catch(() => ({}));
    check("УПД на пополнение не выпускается (аванс) — понятная причина", closing.status() === 404 && closingBody.reason === "advance", closingBody);

    {
      const sub = await phone.newPage();
      await open(sub, "/settings/subscription", "h1", results);
      const subText = norm(await sub.locator("main").textContent());
      check("/settings/subscription: счёт на пополнение не выдаётся за счёт на подписку",
        !subText.includes(`Счёт № ${invoiceOrder.id} на`) && subText.includes("Пополнение баланса на 10 000 ₽ (счёт)"),
        { hasTopupRow: subText.includes("Пополнение баланса на 10 000 ₽ (счёт)") });
      await sub.close();
    }

    // Границы суммы и способ — сервер.
    for (const [amountRub, expected] of [[499, "Минимальная сумма — 500 ₽"], [300001, "Максимальная сумма — 300 000 ₽"], [1990.5, "Сумма — целыми рублями, без копеек"]]) {
      const res = await owner.request.post(`${BASE}/api/balance/topup`, { data: { amountRub, method: "card" } });
      const body = await res.json();
      check(`API: ${amountRub} ₽ — 400 «${expected}»`, res.status() === 400 && norm(body.error) === expected, { status: res.status(), body });
    }
    {
      const res = await owner.request.post(`${BASE}/api/balance/topup`, { data: { amountRub: 300000, method: "card" } });
      const body = await res.json();
      check("API: 300 000 ₽ — граница включительно, заказ создан", res.status() === 200 && body.amountRub === 300000 && body.params.OutSum === "300000.00", { status: res.status() });
    }

    const balanceBeforeInvoice = await balanceOf(creds.organizationId);
    await open(root, `/root/organizations/${creds.organizationId}`, "table", results);
    const row = root.locator("tr", { hasText: "пополнение баланса" }).filter({ has: root.getByRole("button", { name: "Оплата поступила" }) }).first();
    await row.getByRole("button", { name: "Оплата поступила" }).click();
    const markDialog = root.getByRole("dialog");
    const markText = norm(await markDialog.textContent());
    check("ROOT «Оплата поступила»: последствия про пополнение баланса, не про подписку",
      markText.includes("Баланс организации пополнится на 10 000 ₽") && !markText.includes("Подписка организации продлится"), { markText: markText.slice(0, 300) });
    const markResponse = root.waitForResponse((r) => r.url().includes(`/api/root/orders/${invoiceOrder.id}/mark-paid`), { timeout: 240000 });
    await markDialog.getByRole("button", { name: "Да, оплата поступила" }).click();
    await markResponse;
    await root.waitForTimeout(500);
    const invoiceLedger = await ledgerFor(`topup:${invoiceOrder.id}`);
    const balanceAfterInvoice = await balanceOf(creds.organizationId);
    check("после «Оплата поступила»: +10 000 ₽ на баланс, строка «Пополнение баланса по счёту…»",
      invoiceLedger.length === 1 && invoiceLedger[0].amount === 10000 && invoiceLedger[0].description.startsWith(`Пополнение баланса по счёту, заказ №${invoiceOrder.id}`) &&
        balanceAfterInvoice === balanceBeforeInvoice + 10000,
      { invoiceLedger, balanceBeforeInvoice, balanceAfterInvoice });
    const invoiceAccruals = await accrualsFor(invoiceOrder.id);
    check("партнёру со счёта на пополнение: 20 % = 2 000 ₽ и бонус 3 000 ₽ за 2-й денежный платёж (подписка баллами не в счёт)",
      invoiceAccruals.map((a) => `${a.kind}:${a.amount}`).join(",") === "bonus:3000,subscription:2000", { invoiceAccruals });
    // Карточка «История оплат» (rounded-2xl): внутренняя шапка — тоже div со span, поэтому ищем по классу карточки.
    await shot(root, "root-org-topup-1280.png", root.locator("div.rounded-2xl", { has: root.locator("span", { hasText: "История оплат" }) }).last());
    await open(root, `/root/organizations/${creds.organizationId}`, "table", results);
    const rootBalance = root.locator("div.rounded-2xl", { has: root.locator("span", { hasText: "Баланс баллов" }) }).last();
    const rootBalanceText = norm(await rootBalance.textContent());
    check("ROOT → организация: в «Балансе баллов» строки вида «Пополнение»",
      (rootBalanceText.match(/Пополнение/g) || []).length >= 2, { rootBalanceText: rootBalanceText.slice(0, 300) });
    await shot(root, "root-org-balance-1280.png", rootBalance);
    const again = await rootCtx.request.post(`${BASE}/api/root/orders/${invoiceOrder.id}/mark-paid`);
    const againBody = await again.json();
    check("повторное «Оплата поступила» — 409, второго зачисления нет",
      again.status() === 409 && (await ledgerFor(`topup:${invoiceOrder.id}`)).length === 1 && (await balanceOf(creds.organizationId)) === balanceAfterInvoice,
      againBody);

    await open(phonePage, "/settings/balance", "[data-testid=topup-section]", results);
    const phoneHistory = norm(await sectionByTitle(phonePage, "История начислений").textContent());
    check("390: история — пополнение по счёту и картой, блок без действующего счёта",
      phoneHistory.includes(`Пополнение баланса по счёту, заказ №${invoiceOrder.id}`) && (await phonePage.locator("[data-testid=topup-pending-invoice]").count()) === 0);
    await shot(phonePage, "topup-history-390.png", sectionByTitle(phonePage, "История начислений"));
    await shot(phonePage, "balance-page-390.png");

    /* ------------------------------------------ 6. приложение WeSetup и сотрудник — блока пополнения нет */
    {
      const app = await newContext(browser, PHONE, results.robokassa, { userAgent: APP_UA });
      check("владелец A входит в приложении", (await login(app, creds.owner, creds.password)).session);
      const appPage = await app.newPage();
      watchErrors(appPage, "app-390");
      await open(appPage, "/settings/balance", "h1", results);
      await appPage.waitForTimeout(1500);
      const appText = norm(await appPage.locator("body").textContent().catch(() => ""));
      check("приложение WeSetup: та же страница «Баланс и бонусы» с балансом, но блока «Пополнить баланс» нет",
        new URL(appPage.url()).pathname === "/settings/balance" && appText.includes("Баланс организации") &&
          (await appPage.locator("[data-testid=topup-section]").count()) === 0 && !appText.includes("Пополнить баланс"),
        { url: appPage.url() });
      await shot(appPage, "app-balance-390.png");
      const res = await app.request.post(`${BASE}/api/balance/topup`, { data: { amountRub: 5000, method: "card" } });
      const body = await res.json().catch(() => ({}));
      check("приложение WeSetup: API пополнения — 403 mobile_app_payment", res.status() === 403 && body.code === "mobile_app_payment", { status: res.status(), body });
      await app.close();
    }
    {
      const cook = await newContext(browser, PHONE);
      check("повар входит", (await login(cook, creds.cook, creds.password)).session);
      const cookPage = await cook.newPage();
      await open(cookPage, "/settings/balance", "h1", results);
      await cookPage.waitForTimeout(1500);
      check("сотрудник: блока пополнения нет", (await cookPage.locator("[data-testid=topup-section]").count()) === 0);
      const res = await cook.request.post(`${BASE}/api/balance/topup`, { data: { amountRub: 5000, method: "card" } });
      check("сотрудник: API пополнения — 403", res.status() === 403, { status: res.status() });
      await cook.close();
    }

    await ownerB.close();
    await rootCtx.close();
    await phone.close();
    await owner.close();
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
