// E2E orgsw: переключатель организаций (выбранная слева, шестерёнка справа), бейдж (пример и описание),
// перевод организации в партнёрский кабинет → клиент в списке → оплата даёт начисление, возврат из
// партнёрского кабинета. Телефон 390 и компьютер 1280.
// Запуск (dev-сервер :3196 поднят start-dev.cjs, данные — seed.cjs): node .agent/tasks/orgsw/e2e/e2e.cjs
// Результаты — raw/e2e-results.json, снимки — evidence/*.png (в папке прогона вне проекта).
const fs = require("node:fs");
const path = require("node:path");
const { BASE, EVID, RAW, launch, sql, login, newContext, open, norm, readCreds, payResult } = require("./lib.cjs");

const results = { checks: [], pageErrors: [], robokassa: [], devReloads: 0, timings: {} };
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

/** Снимок: страница или блок; у блока липкие шапки прячем, чтобы не закрывали его верх. */
async function shot(page, file, locator = null, { hideSticky = true } = {}) {
  if (!locator || !hideSticky) {
    if (locator) {
      await page.waitForTimeout(700);
      await locator.screenshot({ path: path.join(EVID, file) });
      return;
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(EVID, file), fullPage: false });
    return;
  }
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      const pos = getComputedStyle(el).position;
      if ((pos === "fixed" || pos === "sticky") && el.getBoundingClientRect().top < 120 && !el.closest("[role=dialog]")) {
        el.setAttribute("data-e2e-hidden", el.style.visibility || "-");
        el.style.visibility = "hidden";
      }
    }
  });
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await locator.screenshot({ path: path.join(EVID, file) });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-e2e-hidden]")) {
      const prev = el.getAttribute("data-e2e-hidden");
      el.style.visibility = prev === "-" ? "" : prev;
      el.removeAttribute("data-e2e-hidden");
    }
  });
}

async function session(page) {
  const res = await page.request.get(`${BASE}/api/auth/session`, { timeout: 300000 });
  return (await res.json().catch(() => ({})))?.user ?? null;
}

/** Меню профиля: на компьютере — выпадающее меню, на телефоне — лист снизу. Возвращает контейнер. */
async function openProfileMenu(page) {
  await page.locator('button[aria-label="Профиль"]').first().click();
  // Выпадающее меню профиля (Radix) или лист снизу (vaul). Панель под пилюлей организации тоже
  // содержит переключатель, но она скрыта, пока на неё не навели, — берём только видимое.
  const container = page
    .locator('[data-slot="dropdown-menu-content"], [data-vaul-drawer]')
    .filter({ has: page.locator("[data-testid=org-switcher-row]"), visible: true })
    .first();
  await container.waitFor({ timeout: 60000 });
  await page.waitForTimeout(500);
  return container;
}

/** Геометрия строки переключателя: индикатор слева от названия, шестерёнка справа, цели ≥ 40 px. */
async function rowGeometry(row) {
  const main = row.locator("button").first();
  const indicator = row.locator("[data-testid=org-switcher-indicator]");
  const name = main.locator("span.truncate");
  const gear = row.locator("[data-testid=org-switcher-settings]");
  const [mb, ib, nb, gb] = await Promise.all([main.boundingBox(), indicator.boundingBox(), name.boundingBox(), gear.boundingBox()]);
  return {
    indicatorLeftOfName: Boolean(ib && nb && ib.x + ib.width <= nb.x + 1),
    gearRightOfName: Boolean(gb && nb && gb.x >= nb.x + nb.width - 1),
    rowHeight: mb ? Math.round(mb.height) : 0,
    gearSize: gb ? [Math.round(gb.width), Math.round(gb.height)] : null,
    gearLabel: await gear.getAttribute("aria-label"),
    nameWeight: await name.evaluate((el) => getComputedStyle(el).fontWeight),
    indicatorFilled: await indicator.evaluate((el) => getComputedStyle(el).backgroundColor),
  };
}

function row(container, orgId) {
  return container.locator(`[data-testid=org-switcher-row][data-org-id="${orgId}"]`);
}

/** Шестерёнка → настройки организации одним нажатием; ждём страницу настроек нужной организации. */
async function gearToSettings(page, container, org) {
  const started = Date.now();
  await row(container, org.id).locator("[data-testid=org-switcher-settings]").click();
  await page.waitForURL(/\/settings\/organization/, { timeout: 300000 });
  await open(page, page.url(), "[data-testid=badge-card]", results);
  const user = await session(page);
  return { ms: Date.now() - started, activeOrganizationId: user?.activeOrganizationId ?? user?.organizationId ?? null };
}

async function convert(page, label, org, expect) {
  const card = page.locator("[data-testid=partner-conversion-card]");
  await card.waitFor({ timeout: 60000 });
  await shot(page, `conversion-card-${org.key}-${label}.png`, card);
  await card.locator("[data-testid=partner-conversion-open]").click();
  const dialog = page.locator('[role="dialog"]').filter({ has: page.locator("[data-testid=conversion-consequences]") });
  await dialog.waitFor({ timeout: 60000 });
  const text = norm(await dialog.locator("[data-testid=conversion-consequences]").textContent());
  const confirm = dialog.getByRole("button", { name: "Перевести", exact: true });
  const disabledBeforeAck = await confirm.isDisabled();
  await shot(page, `conversion-dialog-${org.key}-${label}.png`, dialog.locator("xpath=./div[last()]"));
  for (const [name, re] of expect) check(`${label}: окно перевода «${org.name}» — ${name}`, re.test(text), { excerpt: text.slice(0, 160) });
  check(`${label}: «Перевести» заблокирована, пока не отмечено «Понимаю»`, disabledBeforeAck);
  await dialog.locator("[data-testid=partner-conversion-ack]").check();
  await confirm.click();
  await page.waitForURL(new RegExp(`/partner/clients/${org.id}`), { timeout: 300000 });
  await open(page, page.url(), "[data-testid=client-return-card], h1", results);
}

async function assertConvertedInDb(label, org, creds) {
  const [row] = await sql(
    `select o."accountId", o."subscriptionPlan", o."subscriptionEnd", o."recurringActive",
       (select count(*)::int from "OrganizationMember" m where m."organizationId" = o.id and m."userId" = $2) as members,
       (select row_to_json(pc) from (select source, "accessLevel", "convertedByUserId", "partnerId" from "PartnerClient"
          where "organizationId" = o.id and "detachedAt" is null) pc) as link,
       (select count(*)::int from "AuditLog" a where a."organizationId" = o.id and a.action = 'partner.org_converted') as audit
     from "Organization" o where o.id = $1`,
    [org.id, creds.olgaId],
  );
  const endOk = row.subscriptionEnd && Math.abs(new Date(row.subscriptionEnd).getTime() - new Date(creds.paidUntil).getTime()) < 2000;
  check(
    `${label}: «${org.name}» вышла из аккаунта с тарифом и сроком, членство снято, привязка converted/edit, аудит`,
    row.accountId === null && row.subscriptionPlan === "paid" && endOk && row.members === 0 &&
      row.link?.source === "converted" && row.link?.accessLevel === "edit" && row.link?.convertedByUserId === creds.olgaId &&
      row.link?.partnerId === creds.partnerId && row.audit >= 1,
    { ...row, subscriptionEnd: row.subscriptionEnd },
  );
  return row;
}

/** Оплата директором организации после перевода → начисление партнёру. */
async function payAsDirector(browser, viewport, label, org, email, creds) {
  const ctx = await newContext(browser, viewport, results.robokassa);
  const page = await ctx.newPage();
  watchErrors(page, `director-${label}`);
  const auth = await login(ctx, email, creds.password);
  check(`${label}: директор «${org.name}» вошёл`, auth.session, auth);
  await open(page, "/order?plan=monthly", "form button[type=submit]", results);
  const before = results.robokassa.length;
  await page.locator("form button[type=submit]").first().click();
  await page.locator("#rk-stub").waitFor({ timeout: 180000 });
  const url = results.robokassa.slice(before).filter((u) => /Index\.aspx/i.test(u)).pop();
  const params = new URL(url).searchParams;
  const invId = Number(params.get("InvId"));
  const outSum = params.get("OutSum");
  const paid = await payResult(ctx.request, invId, outSum);
  const [order] = await sql('select status, "organizationId", "amountRub", "lifetimeDiscountId" from "PaymentOrder" where id = $1', [invId]);
  check(
    `${label}: оплата картой «${org.name}» после перевода — ${outSum} ₽, без скидки навсегда аккаунта Ольги`,
    paid.body === `OK${invId}` && order.status === "paid" && order.organizationId === org.id && outSum === "1990.00" && !order.lifetimeDiscountId,
    { invId, outSum, paid, order: { ...order, amountRub: Number(order.amountRub) } },
  );
  // Начисление создаётся сразу после подтверждения кассы (completePaidOrder → accrueForPaidOrder).
  let accruals = [];
  for (let i = 0; i < 20 && accruals.length === 0; i += 1) {
    accruals = await sql('select kind, "amountRub", "partnerId", status from "PartnerAccrual" where "paymentOrderId" = $1', [invId]);
    if (accruals.length === 0) await page.waitForTimeout(1000);
  }
  check(
    `${label}: платёж «${org.name}» дал начисление партнёру — 20 % = 398 ₽`,
    accruals.length === 1 && accruals[0].kind === "subscription" && Number(accruals[0].amountRub) === 398 && accruals[0].partnerId === creds.partnerId,
    { accruals: accruals.map((a) => ({ ...a, amountRub: Number(a.amountRub) })) },
  );
  await ctx.close();
  return invId;
}

async function returnFlow(page, label, org, creds) {
  const card = page.locator("[data-testid=client-return-card]");
  await card.waitFor({ timeout: 60000 });
  await card.locator("[data-testid=client-return-open]").click();
  const dialog = page.locator('[role="dialog"]').filter({ has: page.locator("[data-testid=conversion-consequences]") });
  await dialog.waitFor({ timeout: 60000 });
  const text = norm(await dialog.textContent());
  check(`${label}: окно возврата «${org.name}» — комиссия прекратится, снова владелец, места`,
    /вознаграждение с будущих оплат организации начисляться не будет/.test(text) && /Вы снова владелец/.test(text) && /Активных сотрудников в вашем аккаунте станет/.test(text),
    { excerpt: text.slice(0, 200) });
  await shot(page, `return-dialog-${org.key}-${label}.png`, dialog.locator("xpath=./div[last()]"));
  await dialog.getByRole("button", { name: "Сделать моей", exact: true }).click();
  await page.locator("[data-testid=client-return-done]").waitFor({ timeout: 120000 });
  await shot(page, `return-done-${org.key}-${label}.png`, page.locator("[data-testid=client-return-done]").locator("xpath=ancestor::section[1]"));
  const [row] = await sql(
    `select o."accountId",
       (select role from "OrganizationMember" m where m."organizationId" = o.id and m."userId" = $2) as role,
       (select row_to_json(pc) from (select "detachedAt", "detachedBy" from "PartnerClient" where "organizationId" = o.id
          order by "attachedAt" desc limit 1) pc) as link,
       (select count(*)::int from "AuditLog" a where a."organizationId" = o.id and a.action = 'partner.org_returned') as audit
     from "Organization" o where o.id = $1`,
    [org.id, creds.olgaId],
  );
  check(`${label}: «${org.name}» снова в личном аккаунте Ольги, она владелец, сопровождение завершено (партнёром), аудит`,
    row.accountId === creds.accountId && row.role === "owner" && Boolean(row.link?.detachedAt) && row.link?.detachedBy === "partner" && row.audit === 1,
    row);
  // «Открыть организацию» — переключение и дашборд.
  await page.getByRole("button", { name: "Открыть организацию" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 300000 });
  await open(page, page.url(), 'button[aria-label="Профиль"]', results);
  const user = await session(page);
  check(`${label}: «Открыть организацию» — активна «${org.name}»`, user?.activeOrganizationId === org.id, { active: user?.activeOrganizationId });
}

/** Прогрев маршрутов dev-сервера (первая компиляция — минуты), без побочных эффектов. */
async function warmUp(browser, creds, orgs) {
  const ctx = await newContext(browser, DESKTOP, results.robokassa);
  const started = Date.now();
  await login(ctx, creds.partnerEmail, creds.password);
  const get = (url) => ctx.request.get(`${BASE}${url}`, { timeout: 600000 }).then((r) => r.status()).catch((e) => String(e).slice(0, 80));
  const post = (url, data) => ctx.request.post(`${BASE}${url}`, { data, timeout: 600000 }).then((r) => r.status()).catch((e) => String(e).slice(0, 80));
  const statuses = {};
  for (const url of ["/dashboard", "/settings/organization", "/partner", `/partner/clients/${orgs.home.id}`, "/b/aaaaaaaaaa", "/b/aaaaaaaaaa/badge.svg", "/order?plan=monthly", "/api/settings/badge"]) {
    statuses[url] = await get(url);
  }
  // Роуты перевода и возврата: намеренно неверные запросы — отказ без изменений (409/404).
  statuses["POST partner-client"] = await post("/api/settings/organization/partner-client", { organizationId: "warm-up" });
  statuses["POST return"] = await post(`/api/partner/clients/${orgs.home.id}/return`, {});
  results.timings.warmUpMs = Date.now() - started;
  results.warmUp = statuses;
  console.log("warm-up", JSON.stringify(statuses));
  await ctx.close();
}

(async () => {
  const creds = readCreds();
  const orgs = Object.fromEntries(Object.entries(creds.orgs).map(([key, org]) => [key, { ...org, key }]));
  const browser = await launch();
  try {
    await warmUp(browser, creds, orgs);
    /* ============================================================== 1280 */
    {
      const label = "1280";
      const ctx = await newContext(browser, DESKTOP, results.robokassa);
      const page = await ctx.newPage();
      watchErrors(page, "olga-1280");
      const auth = await login(ctx, creds.partnerEmail, creds.password);
      check("1280: Ольга вошла", auth.session, auth);
      // Детерминированный старт: активна своя компания (прошлый прогон мог оставить другую).
      await ctx.request.post(`${BASE}/api/me/active-organization`, { data: { organizationId: orgs.home.id }, timeout: 300000 });
      await open(page, "/dashboard", 'button[aria-label="Профиль"]', results);

      // --- AC1: переключатель
      let menu = await openProfileMenu(page);
      const homeRow = await rowGeometry(row(menu, orgs.home.id));
      const otherRow = await rowGeometry(row(menu, orgs.romashka.id));
      check("1280: выбранная — слева заполненный круг и жирное название, шестерёнка справа",
        homeRow.indicatorLeftOfName && homeRow.gearRightOfName && Number(homeRow.nameWeight) >= 600 &&
          homeRow.indicatorFilled !== "rgba(0, 0, 0, 0)" && (await row(menu, orgs.home.id).getAttribute("data-active")) === "true",
        homeRow);
      check("1280: невыбранная — пустой круг той же колонкой, обычное начертание, aria-label шестерёнки",
        otherRow.indicatorLeftOfName && otherRow.gearRightOfName && Number(otherRow.nameWeight) < 600 &&
          otherRow.indicatorFilled === "rgba(0, 0, 0, 0)" && otherRow.gearLabel === `Настройки ${orgs.romashka.name}` &&
          otherRow.rowHeight >= 40 && otherRow.gearSize?.[0] >= 40 && otherRow.gearSize?.[1] >= 40,
        otherRow);
      const labels = await menu.locator("[data-testid=org-switcher-settings]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      check("1280: шестерёнка у каждой организации, «Партнёрский кабинет» на месте",
        labels.length === 6 && (await menu.getByText("Партнёрский кабинет").count()) === 1, { labels });
      await shot(page, "switcher-1280.png", menu, { hideSticky: false });

      const nav = await gearToSettings(page, menu, orgs.romashka);
      results.timings.gearToSettings1280 = nav.ms;
      check("1280: шестерёнка «Ромашки» — одно нажатие: переключение и /settings/organization «Ромашки»",
        nav.activeOrganizationId === orgs.romashka.id && new URL(page.url()).pathname === "/settings/organization" &&
          (await page.locator(`input[value="${orgs.romashka.name}"]`).count()) >= 1,
        nav);
      await shot(page, "settings-org-top-1280.png");

      // --- AC2: бейдж
      const badge = page.locator("[data-testid=badge-card]");
      const description = norm(await badge.locator("[data-testid=badge-description]").textContent());
      const sentences = description.split(/[.!?](\s|$)/).filter((s) => s && s.trim().length > 3).length;
      const previewSrc = await badge.locator("[data-testid=badge-preview]").getAttribute("src");
      const caption = norm(await badge.locator("[data-testid=badge-example] figcaption").textContent());
      const embed = await badge.locator("[data-testid=badge-embed]").inputValue();
      const code = (embed.match(/\/b\/([a-z0-9]{10})/) || [])[1];
      const beforeEnable = code ? (await ctx.request.get(`${BASE}/b/${code}`, { timeout: 300000 })).status() : null;
      check("1280: бейдж — живой пример (картинка с процентом «Ромашки») и описание в 1–2 фразы",
        previewSrc?.startsWith("data:image/svg+xml") && decodeURIComponent(previewSrc).includes("93% за 30 дней") &&
          /93%/.test(caption) && sentences <= 2 && /сайт/.test(description) && /30 дней/.test(description),
        { description, sentences, caption });
      check("1280: до включения — готовые ссылка и код, но ничего не опубликовано (страница 404), переключатель «Выключен»",
        Boolean(code) && beforeEnable === 404 && norm(await badge.locator("[data-testid=badge-switch-label]").textContent()) === "Выключен",
        { code, beforeEnable });
      await shot(page, "badge-preview-1280.png", badge);
      await page.bringToFront();
      await badge.locator("[data-testid=badge-enable-copy]").click();
      await badge.locator("[data-testid=badge-copy-code]").waitFor({ timeout: 60000 });
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
      const afterEnable = (await ctx.request.get(`${BASE}/b/${code}`, { timeout: 300000 })).status();
      const svg = await ctx.request.get(`${BASE}/b/${code}/badge.svg`, { timeout: 300000 });
      check("1280: «Включить и скопировать код» — одно нажатие: включён, код в буфере, страница и картинка открываются",
        norm(await badge.locator("[data-testid=badge-switch-label]").textContent()) === "Включён" && clip === embed &&
          afterEnable === 200 && svg.status() === 200,
        { afterEnable, svg: svg.status(), clipMatches: clip === embed });
      await shot(page, "badge-enabled-1280.png", badge);
      await badge.locator("[data-testid=badge-switch]").click();
      await page.waitForFunction(() => document.querySelector("[data-testid=badge-switch-label]")?.textContent === "Выключен", null, { timeout: 60000 });
      const afterDisable = (await ctx.request.get(`${BASE}/b/${code}`, { timeout: 300000 })).status();
      const [badgeRow] = await sql('select "badgeEnabled", "badgeCode" from "Organization" where id = $1', [orgs.romashka.id]);
      check("1280: выключение одним переключателем — страница снова 404, код сохранён",
        afterDisable === 404 && badgeRow.badgeEnabled === false && badgeRow.badgeCode === code, { afterDisable, badgeRow });

      // --- AC3: перевод «Ромашки»
      await page.evaluate(() => window.scrollTo(0, 0));
      await convert(page, label, orgs.romashka, [
        ["срок остаётся у организации", /Подписка оплачена до .* этот срок остаётся у организации/],
        ["автопродление с карты выключится", /Автопродление с вашей карты для этой организации выключится/],
        ["скидка навсегда остаётся на аккаунте", new RegExp(`скидка навсегда \\(${creds.lifetimeCode}\\) остаётся на вашем аккаунте`)],
        ["места: было/станет", /больше не занимают места в вашем аккаунте: было \d+, станет \d+/],
        ["вознаграждение по правилам", /20 % от каждой оплаты подписки в течение 12 мес/],
        ["доступ через «Открыть кабинет»", /Открыть кабинет/],
        ["дальше — «Передать клиенту»", /Передать клиенту/],
      ]);
      await shot(page, "partner-client-romashka-1280.png");
      await assertConvertedInDb(label, orgs.romashka, creds);
      const afterConvert = await session(page);
      check("1280: после перевода активна домашняя организация", afterConvert?.activeOrganizationId === orgs.home.id, { active: afterConvert?.activeOrganizationId });
      check("1280: карточка клиента — «Передать клиенту» и «Сделать моей организацией»",
        (await page.getByRole("button", { name: "Передать клиенту" }).count()) === 1 && (await page.locator("[data-testid=client-return-card]").count()) === 1);

      await open(page, "/partner", "table, [data-testid=overview-clients], h1", results);
      const overviewRow = page.locator("tr, li, a").filter({ hasText: orgs.romashka.name }).first();
      check("1280: «Ромашка» в списке клиентов партнёрского кабинета с пометкой «не передана клиенту»",
        (await overviewRow.count()) === 1 && /не передана клиенту/.test(norm(await overviewRow.textContent())));
      await shot(page, "partner-overview-1280.png");

      // В партнёрском кабинете меню «Профиль» — только выход; переключатель — в кабинете организации.
      await open(page, "/dashboard", 'button[aria-label="Профиль"]', results);
      menu = await openProfileMenu(page);
      check("1280: «Ромашки» больше нет в списке моих организаций", (await row(menu, orgs.romashka.id).count()) === 0);
      await page.keyboard.press("Escape");

      // Оплата директором → начисление партнёру; возврат оплаченной — отказ.
      await payAsDirector(browser, DESKTOP, label, orgs.romashka, creds.managerRomashka, creds);
      await open(page, `/partner/clients/${orgs.romashka.id}`, "[data-testid=client-return-card]", results);
      const blocked = norm(await page.locator("[data-testid=conversion-blockers]").textContent().catch(() => ""));
      check("1280: вернуть оплаченную клиентом «Ромашку» нельзя — причина на карточке", /уже оплачивали/.test(blocked), { blocked });
      const accrualText = norm(await page.getByText("Начисления по клиенту").locator("xpath=ancestor::section[1]").textContent());
      check("1280: начисление видно в карточке клиента", /398/.test(accrualText), { excerpt: accrualText.slice(0, 200) });
      await shot(page, "partner-client-accrual-1280.png");

      // Своя компания (домашняя, из неё заявка, ИНН партнёра) — перевести нельзя.
      await open(page, "/dashboard", 'button[aria-label="Профиль"]', results);
      menu = await openProfileMenu(page);
      await gearToSettings(page, menu, orgs.home);
      const homeBlockers = norm(await page.locator("[data-testid=conversion-blockers]").textContent().catch(() => ""));
      check("1280: своя компания — отказ с понятными причинами (заявка партнёра, ИНН)",
        /подана заявка партнёра/.test(homeBlockers) && /ИНН организации совпадает/.test(homeBlockers), { homeBlockers });
      await shot(page, "conversion-blocked-home-1280.png", page.locator("[data-testid=partner-conversion-card]"));

      // Перевод и возврат «Колоска».
      menu = await openProfileMenu(page);
      await gearToSettings(page, menu, orgs.kolosok);
      await convert(page, label, orgs.kolosok, [["баллы остаются у организации", /Баллы на балансе организации \(500 ₽\) остаются у неё/]]);
      await assertConvertedInDb(label, orgs.kolosok, creds);
      await returnFlow(page, label, orgs.kolosok, creds);
      menu = await openProfileMenu(page);
      check("1280: после возврата «Колосок» снова в моих организациях и выбран", (await row(menu, orgs.kolosok.id).getAttribute("data-active")) === "true");
      await shot(page, "switcher-after-return-1280.png", menu, { hideSticky: false });
      await page.keyboard.press("Escape");
      await ctx.close();
    }

    /* ============================================================== 390 */
    {
      const label = "390";
      const ctx = await newContext(browser, PHONE, results.robokassa);
      const page = await ctx.newPage();
      watchErrors(page, "olga-390");
      const auth = await login(ctx, creds.partnerEmail, creds.password);
      check("390: Ольга вошла", auth.session, auth);
      await open(page, "/dashboard", 'button[aria-label="Профиль"]', results);

      let sheet = await openProfileMenu(page);
      const activeId = (await session(page))?.activeOrganizationId;
      const activeRow = await rowGeometry(row(sheet, activeId));
      const otherRow = await rowGeometry(row(sheet, orgs.berezka.id));
      check("390: в листе выбранная слева (круг с галочкой, жирное), шестерёнка справа",
        activeRow.indicatorLeftOfName && activeRow.gearRightOfName && Number(activeRow.nameWeight) >= 600 &&
          activeRow.indicatorFilled !== "rgba(0, 0, 0, 0)",
        activeRow);
      check("390: цели нажатия ≥ 40 px (строка и шестерёнка), aria-label «Настройки …»",
        otherRow.rowHeight >= 40 && otherRow.gearSize?.[0] >= 40 && otherRow.gearSize?.[1] >= 40 && otherRow.gearLabel === `Настройки ${orgs.berezka.name}`,
        otherRow);
      await shot(page, "switcher-390.png", sheet, { hideSticky: false });

      const nav = await gearToSettings(page, sheet, orgs.berezka);
      results.timings.gearToSettings390 = nav.ms;
      check("390: шестерёнка «Берёзки» — одно нажатие: переключение и настройки «Берёзки»",
        nav.activeOrganizationId === orgs.berezka.id && new URL(page.url()).pathname === "/settings/organization", nav);
      await shot(page, "settings-org-top-390.png");
      const badge = page.locator("[data-testid=badge-card]");
      const previewSrc = await badge.locator("[data-testid=badge-preview]").getAttribute("src");
      check("390: бейдж — пример с процентом и описание",
        previewSrc?.startsWith("data:image/svg+xml") && decodeURIComponent(previewSrc).includes("% за 30 дней") &&
          norm(await badge.locator("[data-testid=badge-description]").textContent()).length > 40);
      await shot(page, "badge-preview-390.png", badge);

      await page.evaluate(() => window.scrollTo(0, 0));
      await convert(page, label, orgs.berezka, [
        ["срок остаётся у организации", /этот срок остаётся у организации/],
        ["вознаграждение по правилам", /20 % от каждой оплаты подписки/],
      ]);
      await shot(page, "partner-client-berezka-390.png");
      await assertConvertedInDb(label, orgs.berezka, creds);
      await open(page, "/partner", "h1", results);
      check("390: «Берёзка» в списке клиентов", (await page.getByText(orgs.berezka.name).count()) >= 1);
      await shot(page, "partner-overview-390.png");

      await payAsDirector(browser, PHONE, label, orgs.berezka, creds.managerBerezka, creds);
      await open(page, `/partner/clients/${orgs.berezka.id}`, "h1", results);
      await shot(page, "partner-client-accrual-390.png", page.getByText("Начисления по клиенту").locator("xpath=ancestor::section[1]"));

      // Перевод и возврат «Уюта» на телефоне.
      await open(page, "/dashboard", 'button[aria-label="Профиль"]', results);
      sheet = await openProfileMenu(page);
      await gearToSettings(page, sheet, orgs.uyut);
      await page.evaluate(() => window.scrollTo(0, 0));
      await convert(page, label, orgs.uyut, [["доступ через партнёрский кабинет", /Открыть кабинет/]]);
      await assertConvertedInDb(label, orgs.uyut, creds);
      await shot(page, "partner-client-uyut-390.png");
      await returnFlow(page, label, orgs.uyut, creds);
      sheet = await openProfileMenu(page);
      check("390: после возврата «Уют» в листе организаций и выбран", (await row(sheet, orgs.uyut.id).getAttribute("data-active")) === "true");
      await shot(page, "switcher-after-return-390.png", sheet, { hideSticky: false });
      await ctx.close();
    }
  } catch (error) {
    check("сценарий дошёл до конца", false, { error: String(error && error.stack).slice(0, 1500) });
  } finally {
    await browser.close();
    results.pageErrorsCount = results.pageErrors.length;
    fs.writeFileSync(path.join(RAW, "e2e-results.json"), JSON.stringify(results, null, 2));
    const failed = results.checks.filter((c) => !c.ok).length;
    console.log(`\nИтого: ${results.checks.length - failed}/${results.checks.length} PASS, ошибок страниц: ${results.pageErrors.length}`);
    process.exit(failed ? 1 : 0);
  }
})();
