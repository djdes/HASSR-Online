// E2E рассылки ROOT (390 и 1280). Запуск после seed.cjs: node e2e.cjs
// Проверяет: загрузку контактов вставкой, выбор пользователей по фильтру, сообщение во все
// каналы, тест себе, запуск → cron с лимитом скорости → статусы, письмо в папке сухой отправки с
// отпиской и заголовками, отписку (страница и one-click) → повторная рассылка пропускает адрес,
// клик → clickedAt, возврат подписки в профиле, отмену рассылки. Итог — OUT/results.json.
const fs = require("node:fs");
const path = require("node:path");
const { BASE, OUT, SHOTS, envValue, launch, sql, login, quietPage, gotoHydrated, shot, api } = require("./lib.cjs");

const results = { startedAt: new Date().toISOString(), checks: [], pageErrors: [], notes: [] };
function check(name, ok, details) {
  results.checks.push({ name, ok: Boolean(ok), details: details ?? null });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, details !== undefined ? JSON.stringify(details).slice(0, 400) : "");
}
function save() {
  results.finishedAt = new Date().toISOString();
  results.passed = results.checks.filter((c) => c.ok).length;
  results.failed = results.checks.filter((c) => !c.ok).length;
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
}

const creds = JSON.parse(fs.readFileSync(path.join(OUT, "creds.json"), "utf8"));
const ROOT_EMAIL = envValue("ROOT_EMAIL");
const ROOT_PASSWORD = envValue("ROOT_PASSWORD");
const CRON = envValue("CRON_SECRET");
const OUTBOX = envValue("MAILING_DRY_RUN_DIR");
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cron(ctx) {
  // Толчок после запуска может ещё идти — тогда проход занят; ждём и повторяем.
  for (let i = 0; i < 20; i += 1) {
    const r = await api(ctx, "GET", "/api/cron/mailing", undefined, { Authorization: `Bearer ${CRON}` });
    if (!r.body || r.body.busy !== true) return r.body;
    await sleep(2000);
  }
  return { busy: true };
}

async function recipients(campaignId) {
  return sql(
    `select id, token, email, "userId", "contactId", status, "emailStatus", "emailError", "inAppStatus", "inAppError",
            "pushStatus", "pushError", "telegramStatus", "telegramError", "emailSentAt", "clickedAt", "dryRun", "isTest"
       from "MailingRecipient" where "campaignId" = $1 order by "createdAt", id`,
    [campaignId]
  );
}

async function waitFor(fn, timeoutMs = 60000, stepMs = 1500) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return v;
    await sleep(stepMs);
  }
}

async function shiftSent() {
  await sql(`update "MailingRecipient" set "emailSentAt" = "emailSentAt" - interval '61 seconds' where "emailSentAt" is not null`);
}

let keepAlive = null;

(async () => {
  const browser = await launch();
  const root = await browser.newContext({ viewport: DESKTOP, locale: "ru-RU" });
  try {
    const rl = await login(root, ROOT_EMAIL, ROOT_PASSWORD);
    check("ROOT вошёл", rl.session, rl);

    // Прогрев: next dev компилирует маршрут при первом запросе и может
    // перезагрузить открытую страницу посреди шага. В проде этого нет.
    const warm = [
      "/api/root/mailing/campaigns",
      "/api/root/mailing/campaigns/warm",
      "/api/root/mailing/campaigns/warm/launch",
      "/api/root/mailing/campaigns/warm/cancel",
      "/api/root/mailing/campaigns/warm/retry",
      "/api/root/mailing/campaigns/warm/test",
      "/api/root/mailing/preview",
      "/api/root/mailing/reach",
      "/api/root/mailing/settings",
      "/api/root/mailing/suppression",
      "/api/root/mailing/suppression/warm",
      "/api/root/mailing/contacts",
      "/api/root/mailing/contacts/preview",
      "/api/root/mailing/contacts/warm",
      "/api/root/mailing/contacts/delete",
      "/api/root/mailing/audience/users",
      "/api/cron/mailing",
      "/api/mailing/unsubscribe/warm.x",
      "/api/notifications/marketing",
      "/r/warm.x/0",
      "/unsubscribe/warm.x",
      "/root/mailing/warm",
      "/root/mailing",
      "/settings/notifications",
      "/mini/me",
    ];
    for (const url of warm) {
      const r = await root.request.get(`${BASE}${url}`, { timeout: 300000, maxRedirects: 0 }).catch((e) => ({ status: () => String(e).slice(0, 60) }));
      results.notes.push(`warm ${url} → ${r.status()}`);
    }
    // next dev выгружает неактивные маршруты (буфер ~5) и потом компилирует
    // их заново — HMR при этом может перезагрузить открытую страницу. Держим
    // их «живыми» фоновыми запросами на всё время прогона.
    keepAlive = setInterval(() => {
      for (const url of warm) root.request.get(`${BASE}${url}`, { timeout: 120000, maxRedirects: 0 }).catch(() => null);
    }, 15000);
    const A = creds.users.a;
    const C = creds.users.c;
    const D = creds.users.d;

    // ------------------------------------------------ контакты вставкой
    const page = await quietPage(root, "mailing", results);
    await gotoHydrated(page, "/root/mailing?tab=contacts", '[data-testid="contacts-paste"]');
    check("Предупреждение 38-ФЗ над загрузкой", await page.getByTestId("law-warning").isVisible(), {
      text: (await page.getByTestId("law-warning").innerText()).slice(0, 160),
    });
    const paste = [
      "email;имя;компания;сфера;город;теги",
      "ivan.e2e@example.com;Иван Петров;Кафе «Лето»;кафе;Казань;выставка",
      "olga.e2e@example.com;Ольга Морозова;Ресторан «Бриз»;restaurant;Сочи;",
      "IVAN.e2e@example.com;Дубль Ивана;;;;",
      "blocked@example.com;Из стоп-листа;;;;",
      "плохой-адрес;Без собаки;;;;",
      `${A.email};Анна (как контакт);;;;`,
    ].join("\n");
    await page.getByTestId("contacts-paste").fill(paste);
    await page.getByTestId("contacts-source").fill("E2E выгрузка 29.09");
    await page.getByTestId("contacts-basis").fill("Деловая переписка");
    await page.getByTestId("contacts-preview-button").click();
    await page.getByTestId("contacts-preview-summary").waitFor({ timeout: 120000 });
    const summary = await page.getByTestId("contacts-preview-summary").innerText();
    check(
      "Предпросмотр: новые 3, стоп-лист 1, дубль 1, плохой 1",
      /Новых:\s*3/.test(summary) && /стоп-листе:\s*1/.test(summary) && /Дублей в файле:\s*1/.test(summary) && /Плохих адресов:\s*1/.test(summary),
      summary.replace(/\s+/g, " ")
    );
    await page.getByTestId("contacts-import").scrollIntoViewIfNeeded();
    await shot(page, "01-contacts-preview-1280", true);
    await page.getByTestId("contacts-commit").click();
    await waitFor(async () => (await sql(`select count(*)::int as n from "MarketingContact"`))[0].n === 3, 60000);
    const contacts = await sql(`select email, source, basis, sphere, tags, status from "MarketingContact" order by email`);
    check("Загружено 3 контакта с источником и основанием", contacts.length === 3 && contacts.every((c) => c.source && c.basis), contacts);
    check("Сфера из названия «кафе» → cafe", contacts.find((c) => c.email === "ivan.e2e@example.com")?.sphere === "cafe");
    await page.getByTestId("contacts-row").first().waitFor({ timeout: 60000 });
    await page.getByTestId("contacts-select-all-found").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="contacts-selected-count"]')?.textContent === "3", null, { timeout: 30000 });
    check("Контакты: выбраны все найденные (3)", true);

    // ------------------------------------------------ пользователи по фильтру
    await page.getByTestId("mailing-tab-users").click();
    await page.getByTestId("users-filter-sphere").click();
    await page.getByRole("option", { name: "Кафе / Кофейня" }).click();
    await page.waitForFunction(() => /Найдено:\s*2/.test(document.querySelector('[data-testid="users-found"]')?.textContent ?? ""), null, { timeout: 60000 });
    check("Фильтр «Кафе / Кофейня» → 2 руководителя", true);
    await page.getByTestId("users-select-all-found").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="users-selected-count"]')?.textContent === "2", null, { timeout: 30000 });
    // Добавить пекарню поиском.
    await page.getByTestId("users-filter-sphere").click();
    await page.getByRole("option", { name: "Все сферы" }).click();
    await page.getByTestId("users-filter-search").fill("Колос");
    await page.waitForFunction(() => /Найдено:\s*1/.test(document.querySelector('[data-testid="users-found"]')?.textContent ?? ""), null, { timeout: 60000 });
    await page.getByTestId("users-row").first().locator('input[type="checkbox"]').check();
    await page.waitForFunction(() => document.querySelector('[data-testid="users-selected-count"]')?.textContent === "3", null, { timeout: 30000 });
    check("Выбрано 3 пользователя (2 по фильтру + поиск)", true);
    await page.getByTestId("users-filter-search").fill("");
    await page.waitForTimeout(1500);
    await shot(page, "02-users-1280", false);

    // ------------------------------------------------ составление: все каналы
    await page.getByTestId("mailing-tab-compose").click();
    await page.getByTestId("compose-title").fill("E2E: осенние новости");
    await page.locator('input[name="subject"]').fill("{имя}, новое в WeSetup");
    await page
      .locator('textarea[name="body"]')
      .fill("Здравствуйте, {имя}!\n\nДля {компания} подготовили **новые журналы** и [тарифы](https://wesetup.ru/pricing).\nОтветим на вопросы в чате.");
    await page.locator('input[name="buttonText"]').fill("Открыть кабинет");
    await page.locator('input[name="buttonUrl"]').fill("/dashboard");
    for (const ch of ["inApp", "push", "telegram"]) {
      const box = page.getByTestId(`channel-${ch}`).locator('input[type="checkbox"]');
      if (!(await box.isChecked())) await box.check();
    }
    // Охват пересчитывается с паузой после выбора — ждём итог для всех 6 выбранных.
    await page
      .waitForFunction(() => /Дойдёт до \d+ из 5/.test(document.querySelector('[data-testid="channel-email-reach"]')?.textContent ?? ""), null, { timeout: 60000 })
      .catch(() => null);
    const reach = {};
    for (const ch of ["email", "inApp", "push", "telegram"]) reach[ch] = await page.getByTestId(`channel-${ch}-reach`).innerText();
    check("Охват: почта 5, колокольчик 3, push 1, Telegram 1", /Дойдёт до 5 из 5/.test(reach.email) && /Дойдёт до 3/.test(reach.inApp) && /Дойдёт до 1 из 3/.test(reach.push) && /Дойдёт до 1 из 3/.test(reach.telegram), reach);
    check("Push: честно про Firebase", /Firebase не настроен/.test(await page.getByTestId("channel-push").innerText()));
    check("Предупреждение про отдельный адрес отправки", await page.getByTestId("sender-warning").isVisible(), (await page.getByTestId("sender-warning").innerText()).slice(0, 200));
    check("Плашка сухой отправки", await page.getByTestId("dry-run-notice").isVisible());
    await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="preview-email"] iframe')), null, { timeout: 90000 });
    const previewHtml = await page.locator('[data-testid="preview-email"] iframe').getAttribute("srcdoc");
    check("Предпросмотр письма с переменными и отпиской", /Иван Петров/.test(previewHtml ?? "") && /unsubscribe/.test(previewHtml ?? ""));
    await shot(page, "03-compose-1280", true);

    // ------------------------------------------------ тест себе
    await page.getByTestId("compose-test").click();
    await page.getByTestId("compose-test-result").waitFor({ timeout: 120000 });
    const testText = await page.getByTestId("compose-test-result").innerText();
    check("Тест себе: письмо (сухая), колокольчик, push/Telegram честно пропущены", /Почта:\s*Отправлено \(сухая отправка\)/.test(testText) && /Колокольчик:\s*Отправлено/.test(testText) && /Push:\s*Пропущено/.test(testText) && /Telegram:\s*Пропущено/.test(testText), testText.replace(/\s+/g, " "));
    const draftId = (await sql(`select id from "MailingCampaign" where title = 'E2E: осенние новости'`))[0]?.id;
    const testRows = await sql(`select id, "emailStatus" from "MailingRecipient" where "campaignId" = $1 and "isTest"`, [draftId]);
    check("Тест записан отдельной строкой (isTest)", testRows.length === 1 && testRows[0].emailStatus === "sent", testRows);
    const testEml = path.join(OUTBOX, draftId, `${testRows[0]?.id}-email.eml`);
    check("Тестовое письмо — файл в папке сухой отправки", fs.existsSync(testEml), testEml);

    // ------------------------------------------------ скорость: 2 письма в минуту
    await page.getByTestId("mailing-tab-history").click();
    await page.getByTestId("rate-per-minute").fill("2");
    await page.getByTestId("rate-save").click();
    await waitFor(async () => (await sql(`select value from "PlatformSetting" where key = 'mailing.settings'`))[0]?.value?.includes('"perMinute":2'), 30000);
    check("Скорость сохранена: 2 в минуту", true);
    await shot(page, "04-history-draft-1280", true);

    // ------------------------------------------------ запуск
    await page.getByTestId("mailing-tab-compose").click();
    await page.getByTestId("compose-send-now").click();
    await page.locator('[role="dialog"]').getByRole("button", { name: "Отправить", exact: true }).click();
    await page.waitForURL(/\/root\/mailing\/[a-z0-9]+$/i, { timeout: 120000 });
    const campaignId = page.url().split("/").pop();
    check("Запуск → карточка рассылки", campaignId === draftId, page.url());
    const afterNudge = await waitFor(async () => {
      const rows = await recipients(campaignId);
      return rows.filter((r) => !r.isTest && r.emailStatus === "sent").length >= 2 ? rows : null;
    }, 90000);
    const real = (afterNudge ?? []).filter((r) => !r.isTest);
    check("Толчок после запуска: ушло ровно 2 письма (лимит 2/мин), 3 ждут", real.filter((r) => r.emailStatus === "sent").length === 2 && real.filter((r) => r.emailStatus === "queued").length === 3, real.map((r) => [r.email, r.emailStatus]));
    const c1 = await cron(root);
    check("Cron в ту же минуту: писем 0, лимит «minute»", c1 && c1.busy === false && c1.sent?.email === 0 && c1.limitedBy === "minute", c1);
    await shiftSent();
    const c2 = await cron(root);
    check("Cron через минуту: ещё 2 письма", c2 && c2.sent?.email === 2, c2);
    await shiftSent();
    const c3 = await cron(root);
    check("Cron: последнее письмо, рассылка завершена", c3 && c3.sent?.email === 1 && (c3.finishedCampaigns ?? []).includes(campaignId), c3);
    const done = (await recipients(campaignId)).filter((r) => !r.isTest);
    const byEmail = Object.fromEntries(done.map((r) => [r.email, r]));
    const anna = byEmail[A.email];
    check("Анна: почта, колокольчик, push и Telegram — отправлены (сухая)", anna?.emailStatus === "sent" && anna?.inAppStatus === "sent" && anna?.pushStatus === "sent" && anna?.telegramStatus === "sent" && anna?.dryRun, anna);
    check("Вера: push пропущен — Firebase не настроен", byEmail[C.email]?.pushStatus === "skipped" && /Firebase/.test(byEmail[C.email]?.pushError ?? ""), byEmail[C.email]);
    check("Глеб: письмо на контактную почту, Telegram не привязан", byEmail[D.contactEmail]?.emailStatus === "sent" && byEmail[D.contactEmail]?.telegramStatus === "skipped", byEmail[D.contactEmail]);
    check("Контакт с почтой Анны не задвоился", done.filter((r) => r.email === A.email).length === 1, done.map((r) => r.email));
    const status = (await sql(`select status, "sentCount", "queuedCount" from "MailingCampaign" where id = $1`, [campaignId]))[0];
    check("Рассылка «Завершена», отправлено 5", status.status === "done" && status.sentCount === 5 && status.queuedCount === 0, status);
    const bell = await sql(`select title, items from "Notification" where "userId" = $1 and kind = 'mailing'`, [A.id]);
    check("Колокольчик Анны: заголовок с именем", bell.some((b) => b.title === "Анна Смирнова, новое в WeSetup"), bell.map((b) => b.title));

    // ------------------------------------------------ письма в папке
    const dir = path.join(OUTBOX, campaignId);
    const emls = fs.readdirSync(dir).filter((f) => f.endsWith("-email.eml") && !f.startsWith(testRows[0].id));
    check("В папке сухой отправки 5 писем рассылки (.eml) + тест себе", emls.length === 5 && fs.existsSync(testEml), emls);
    const ivanRow = byEmail["ivan.e2e@example.com"];
    const eml = fs.readFileSync(path.join(dir, `${ivanRow.id}-email.eml`), "utf8");
    fs.copyFileSync(path.join(dir, `${ivanRow.id}-email.eml`), path.join(OUT, "sample-email.eml"));
    fs.copyFileSync(path.join(dir, `${ivanRow.id}-email.html`), path.join(OUT, "sample-email.html"));
    const unfolded = eml.replace(/\r?\n[ \t]+/g, " ");
    const lu = unfolded.match(/^List-Unsubscribe: (.*)$/m)?.[1] ?? "";
    check("Заголовок List-Unsubscribe: https + mailto", lu.includes(`${BASE}/api/mailing/unsubscribe/${ivanRow.token}`) && /mailto:/.test(lu), lu);
    check("Заголовок List-Unsubscribe-Post: One-Click", /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m.test(unfolded));
    const html = fs.readFileSync(path.join(dir, `${ivanRow.id}-email.html`), "utf8");
    check("В письме ссылка «Отписаться» и ссылки через /r/", html.includes(`/unsubscribe/${ivanRow.token}`) && html.includes(`/r/${ivanRow.token}/0`), null);
    check("Переменные в письме контакта: имя и компания", html.includes("Здравствуйте, Иван Петров!") && html.includes("Кафе «Лето»"), null);
    check("Push и Telegram — .json в папке, наружу не ушли", fs.existsSync(path.join(dir, `${anna.id}-push.json`)) && fs.existsSync(path.join(dir, `${anna.id}-telegram.json`)));

    // ------------------------------------------------ клик
    const click = await api(root, "GET", `/r/${ivanRow.token}/0?to=https://evil.example`);
    check("Клик → 307 на сохранённый адрес, параметр игнорируется", click.status === 307 && click.headers.location === "https://wesetup.ru/pricing", { status: click.status, location: click.headers.location });
    const clicked = (await sql(`select "clickedAt", "clickCount" from "MailingRecipient" where id = $1`, [ivanRow.id]))[0];
    check("clickedAt записан", Boolean(clicked.clickedAt) && clicked.clickCount === 1, clicked);
    const bad = await api(root, "GET", `/r/${ivanRow.token}/9`);
    check("Неизвестный номер ссылки → на главную", bad.status === 307 && bad.headers.location === "/", bad.headers.location);
    const forged = await api(root, "GET", `/r/${ivanRow.id}.AAAAAAAAAAAAAAAAAAAAAA/0`);
    check("Поддельный токен → на главную", forged.status === 307 && forged.headers.location === "/", forged.headers.location);

    // ------------------------------------------------ карточка
    await gotoHydrated(page, `/root/mailing/${campaignId}`, '[data-testid="card-filters"] button');
    check("Карточка: кликнули 1", /Кликнули по ссылке:\s*1/.test(await page.getByTestId("card-clicks").innerText()));
    await shot(page, "05-card-1280", true);

    // ------------------------------------------------ отписка: страница и one-click
    const anon = await browser.newContext({ viewport: PHONE, locale: "ru-RU" });
    const up = await quietPage(anon, "unsubscribe", results);
    await gotoHydrated(up, `/unsubscribe/${ivanRow.token}`, '[data-testid="unsubscribe-button"]');
    await shot(up, "06-unsubscribe-390", true);
    await up.getByTestId("unsubscribe-button").click();
    await up.getByTestId("unsubscribe-done").waitFor({ timeout: 60000 });
    await shot(up, "07-unsubscribe-done-390", true);
    const ivanStop = (await sql(`select reason, "campaignId" from "EmailSuppression" where email = 'ivan.e2e@example.com'`))[0];
    const ivanContact = (await sql(`select status from "MarketingContact" where email = 'ivan.e2e@example.com'`))[0];
    check("Страница отписки → стоп-лист (unsubscribed) и контакт «отписался»", ivanStop?.reason === "unsubscribed" && ivanStop?.campaignId === campaignId && ivanContact?.status === "unsubscribed", { ivanStop, ivanContact });
    const oneClick = await anon.request.post(`${BASE}/api/mailing/unsubscribe/${anna.token}`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: "List-Unsubscribe=One-Click",
      timeout: 120000,
    });
    const annaUser = (await sql(`select "marketingOptOut" from "User" where id = $1`, [A.id]))[0];
    check("One-click POST без страницы → marketingOptOut пользователя", oneClick.status() === 200 && annaUser.marketingOptOut === true, { status: oneClick.status(), annaUser });
    const getUnsub = await api(anon, "GET", `/api/mailing/unsubscribe/${anna.token}`);
    check("GET по ссылке из заголовка ничего не меняет — ведёт на страницу", getUnsub.status === 307 && (getUnsub.headers.location ?? "").startsWith("/unsubscribe/"), getUnsub.headers.location);
    await anon.close();

    // ------------------------------------------------ повторная рассылка пропускает отписавшихся
    await api(root, "PUT", "/api/root/mailing/settings", { perMinute: 20, perDay: 300 });
    const audience = await sql(`select audience from "MailingCampaign" where id = $1`, [campaignId]);
    const created = await api(root, "POST", "/api/root/mailing/campaigns", {
      title: "E2E: повторная",
      kind: "message",
      channels: { email: true, inApp: true, push: false, telegram: false },
      payload: { subject: "Ещё раз, {имя}", body: "Короткое напоминание.", buttonText: "", buttonUrl: "", fallbacks: { name: "коллеги", company: "", sphere: "" } },
      audience: { userIds: audience[0].audience.userIds, contactIds: audience[0].audience.contactIds },
    });
    const second = created.body.campaign.id;
    const launched = await api(root, "POST", `/api/root/mailing/campaigns/${second}/launch`, { mode: "now" });
    check("Повторная рассылка запущена", launched.status === 200, launched.body?.stats ?? launched.body);
    await sleep(3000);
    await cron(root);
    await waitFor(async () => (await sql(`select status from "MailingCampaign" where id = $1`, [second]))[0].status === "done", 90000);
    const secondRows = Object.fromEntries((await recipients(second)).map((r) => [r.email, r]));
    check("Повторная: отписавшийся контакт пропущен", secondRows["ivan.e2e@example.com"]?.emailStatus === "skipped", secondRows["ivan.e2e@example.com"]);
    // Отписка останавливает рекламу во всех каналах (решение владельца, 38-ФЗ ст. 18).
    check("Повторная: Анна отписалась — ни письма, ни колокольчика", secondRows[A.email]?.emailStatus === "skipped" && /стоп-лист|Отписался/.test(secondRows[A.email]?.emailError ?? "") && secondRows[A.email]?.inAppStatus === "skipped", secondRows[A.email]);
    check("Повторная: остальные письма ушли", secondRows["olga.e2e@example.com"]?.emailStatus === "sent", secondRows["olga.e2e@example.com"]);

    // ------------------------------------------------ стоп-лист
    await gotoHydrated(page, "/root/mailing?tab=stoplist", '[data-testid="stoplist-add"]');
    await page.getByTestId("stoplist-row").first().waitFor({ timeout: 60000 });
    const stopText = await page.getByTestId("mailing-stoplist-tab").innerText();
    check("Стоп-лист: заблокированный вручную и отписавшиеся", stopText.includes("blocked@example.com") && stopText.includes("ivan.e2e@example.com") && stopText.includes(A.email), null);
    await page.getByTestId("stoplist-email").fill("manual.e2e@example.com");
    await page.getByTestId("stoplist-add").click();
    await waitFor(async () => (await sql(`select 1 from "EmailSuppression" where email = 'manual.e2e@example.com'`)).length === 1, 30000);
    check("Стоп-лист: добавлен адрес вручную", true);
    await shot(page, "08-stoplist-1280", true);

    // ------------------------------------------------ возврат подписки в профиле
    const mgr = await browser.newContext({ viewport: DESKTOP, locale: "ru-RU" });
    const ml = await login(mgr, A.email, creds.password);
    check("Руководитель Анна вошла", ml.session, ml);
    const np = await quietPage(mgr, "notifications", results);
    await gotoHydrated(np, "/settings/notifications", '[data-testid="marketing-toggle"]');
    await np.waitForFunction(() => /Письма о новых возможностях/.test(document.querySelector('[data-testid="marketing-email"]')?.textContent ?? ""), null, { timeout: 60000 });
    await np.waitForFunction(() => document.querySelector('[data-testid="marketing-toggle"]')?.getAttribute("aria-checked") === "false", null, { timeout: 60000 });
    check("Профиль: «Новости и предложения на почту» выключены после отписки", true);
    await np.getByTestId("marketing-email").scrollIntoViewIfNeeded();
    await shot(np, "09-notifications-off-1280", false);
    // Переключатель меняется сразу (оптимистично) — ждём ответ сервера.
    const [patched] = await Promise.all([
      np.waitForResponse((r) => r.url().includes("/api/notifications/marketing") && r.request().method() === "PATCH", { timeout: 120000 }),
      np.getByTestId("marketing-toggle").click(),
    ]);
    check("Профиль: PATCH переключателя — 200", patched.status() === 200, patched.status());
    await np.waitForFunction(() => document.querySelector('[data-testid="marketing-toggle"]')?.getAttribute("aria-checked") === "true", null, { timeout: 60000 });
    const annaBack = (await sql(`select "marketingOptOut" from "User" where id = $1`, [A.id]))[0];
    const annaStop = await sql(`select reason from "EmailSuppression" where email = $1`, [A.email]);
    check("Профиль: подписка возвращена (optOut снят, стоп-лист очищен)", annaBack.marketingOptOut === false && annaStop.length === 0, { annaBack, annaStop });
    await shot(np, "10-notifications-on-1280", false);
    await np.setViewportSize(PHONE);
    await np.getByTestId("marketing-email").scrollIntoViewIfNeeded();
    await shot(np, "11-notifications-390", false);
    await mgr.close();
    // Тот же переключатель — в профиле мини-приложения (П-3: зеркало сайта).
    const mini = await browser.newContext({ viewport: PHONE, locale: "ru-RU", isMobile: true, hasTouch: true });
    await login(mini, A.email, creds.password);
    const mp = await quietPage(mini, "mini-me", results);
    try {
      await gotoHydrated(mp, "/mini/me", '[data-testid="marketing-toggle"]');
      await mp.waitForFunction(() => document.querySelector('[data-testid="marketing-toggle"]')?.getAttribute("aria-checked") === "true", null, { timeout: 60000 });
      await mp.getByTestId("marketing-email-mini").scrollIntoViewIfNeeded();
      await shot(mp, "11b-mini-profile-390", false);
      check("Мини-приложение: переключатель в профиле, включён", true);
    } catch (error) {
      check("Мини-приложение: переключатель в профиле, включён", false, String(error).slice(0, 300));
    }
    await mini.close();

    // ------------------------------------------------ отмена
    const third = await api(root, "POST", "/api/root/mailing/campaigns", {
      title: "E2E: на отмену",
      kind: "message",
      channels: { email: true, inApp: false, push: false, telegram: false },
      payload: { subject: "Будет отменено", body: "Не должно уйти.", buttonText: "", buttonUrl: "", fallbacks: { name: "", company: "", sphere: "" } },
      audience: { userIds: [creds.users.b.id], contactIds: [] },
    });
    const thirdId = third.body.campaign.id;
    const at = new Date(Date.now() + 3 * 3600_000 + 3 * 3600_000).toISOString().slice(0, 16);
    const sched = await api(root, "POST", `/api/root/mailing/campaigns/${thirdId}/launch`, { mode: "schedule", scheduledAt: at });
    check("Запланирована (время по Москве)", sched.status === 200 && sched.body?.campaign?.status === "scheduled", sched.body?.campaign ?? sched.body);
    await gotoHydrated(page, `/root/mailing/${thirdId}`, '[data-testid="card-cancel"]');
    await page.getByTestId("card-cancel").click();
    await page.locator('[role="dialog"]').getByRole("button", { name: "Отменить рассылку" }).click();
    await waitFor(async () => (await sql(`select status from "MailingCampaign" where id = $1`, [thirdId]))[0].status === "cancelled", 60000);
    const cancelledRows = await recipients(thirdId);
    check("Отмена: рассылка «Отменена», получатель «отменено», письмо не ушло", cancelledRows.every((r) => r.status === "cancelled" && r.emailStatus === "skipped" && !r.emailSentAt), cancelledRows.map((r) => [r.status, r.emailStatus, r.emailError]));
    await cron(root);
    const stillCancelled = await recipients(thirdId);
    check("Cron после отмены ничего не отправил", stillCancelled.every((r) => !r.emailSentAt));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("card-counters").waitFor({ timeout: 60000 });
    await shot(page, "12-card-cancelled-1280", false);

    // ------------------------------------------------ телефон 390
    const phone = await browser.newContext({ viewport: PHONE, locale: "ru-RU", isMobile: true, hasTouch: true });
    await login(phone, ROOT_EMAIL, ROOT_PASSWORD);
    const pp = await quietPage(phone, "phone", results);
    for (const [tab, name, sel] of [
      ["compose", "13-compose-390", '[data-testid="compose-title"]'],
      ["users", "14-users-390", '[data-testid="users-filter-search"]'],
      ["contacts", "15-contacts-390", '[data-testid="contacts-paste"]'],
      ["history", "16-history-390", '[data-testid="rate-save"]'],
      ["stoplist", "17-stoplist-390", '[data-testid="stoplist-add"]'],
    ]) {
      await gotoHydrated(pp, `/root/mailing?tab=${tab}`, sel);
      await pp.waitForTimeout(1500);
      await shot(pp, name, false);
      const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`390: вкладка ${tab} без горизонтального скролла`, overflow <= 1, { overflow });
    }
    await gotoHydrated(pp, `/root/mailing/${campaignId}`, '[data-testid="card-filters"] button');
    await pp.waitForTimeout(1000);
    await shot(pp, "18-card-390", false);
    const cardOverflow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("390: карточка рассылки без горизонтального скролла", cardOverflow <= 1, { cardOverflow });
    await phone.close();

    // ------------------------------------------------ аудит
    const audit = await sql(`select action, count(*)::int as n from "AuditLog" where action like 'mailing.%' group by action order by action`);
    check(
      "Аудит: загрузка, тест, запуск, план, отмена, стоп-лист, настройки, отписка",
      ["mailing.contacts.import", "mailing.campaign.test", "mailing.campaign.launch", "mailing.campaign.schedule", "mailing.campaign.cancel", "mailing.suppression.add", "mailing.settings.update", "mailing.unsubscribe", "mailing.optin"].every((a) => audit.some((x) => x.action === a)),
      audit
    );
  } catch (error) {
    check("сценарий без исключений", false, String(error && error.stack ? error.stack : error).slice(0, 1500));
  } finally {
    if (keepAlive) clearInterval(keepAlive);
    save();
    await browser.close();
    console.log(`done: ${results.passed} passed, ${results.failed} failed → ${path.join(OUT, "results.json")}`);
  }
})();
