// E2E рассылки «КП» (сухая отправка, 390 и 1280). Запуск после seed.cjs: node e2e.cjs
// Сценарий: контакты (детсад, отель) → черновик «КП» с персональными кодами 10 % навсегда на 14 дней
// одному пользователю (кафе) и двум контактам → поля и предпросмотр (пример кода) → тест себе
// (плашка «пример») → запуск → cron → 3 письма в папке сухой отправки, у каждого своя сфера и свой
// код, ссылки через /r/, отписка и заголовки → коды в базе и в ROOT «Промокоды» с меткой рассылки →
// клик по кнопке письма → /promo/<CODE>?s= → регистрация со сферой → тариф и /order с кодом (без
// оплаты) → генератор КП: «Создать персональный код» → код в форме, в письме и в PDF → письмо 375/600.
process.env.E2E_OUT = process.env.E2E_OUT || "d:/wt/tmp-mailing2/e2e-out";
const fs = require("node:fs");
const path = require("node:path");
const { BASE, OUT, SHOTS, envValue, launch, sql, login, api } = require("../../mailing/e2e/lib.cjs");

const results = { startedAt: new Date().toISOString(), checks: [], pageErrors: [], notes: [], devReloads: 0 };
function check(name, ok, details) {
  results.checks.push({ name, ok: Boolean(ok), details: details ?? null });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, details !== undefined ? JSON.stringify(details).slice(0, 500) : "");
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
const norm = (s) => String(s ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const TITLE = "E2E КП: осень";

/** Конец срока «сегодня (МСК) + N дней», 23:59:59.999 МСК — как promoEndsAfterDays. */
function endsAfterDays(now, days) {
  const MSK = 3 * 3600_000;
  const DAY = 86_400_000;
  const midnight = Math.floor((now.getTime() + MSK) / DAY) * DAY - MSK;
  return new Date(midnight + (days + 1) * DAY - 1);
}

let clientSeq = 0;
async function newContext(browser, viewport, extra = {}) {
  clientSeq += 1;
  const ip = `10.77.${(Date.now() >> 10) % 250}.${clientSeq % 250}`;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: "ru-RU",
    reducedMotion: "reduce",
    extraHTTPHeaders: { "X-Forwarded-For": ip },
    ...extra,
  });
  await context.addInitScript(() => {
    try {
      // «Что нового» не трогаем: без записи первый визит модалку не показывает.
      window.localStorage.setItem("wesetup.cookie-consent", JSON.stringify({ accepted: true, at: Date.now() }));
      window.localStorage.setItem("wesetup-theme-mode", "light");
    } catch {}
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
  });
  return context;
}

function watchErrors(page, label) {
  page.on("pageerror", (err) => results.pageErrors.push({ page: label, message: String(err && err.message).slice(0, 300) }));
}

async function waitHydrated(page, selector, timeout) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el && Object.keys(el).some((k) => k.startsWith("__reactProps")));
    },
    selector,
    { timeout }
  );
}

/** Открыть и дождаться, пока next dev перестанет перезагружать страницу. */
async function open(page, url, selector, quietMs = 2000) {
  let navigated = false;
  const onLoad = () => (navigated = true);
  await page.goto(url.startsWith("http") ? url : `${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 300000 });
  page.on("domcontentloaded", onLoad);
  try {
    for (let i = 0; i < 6; i += 1) {
      navigated = false;
      try {
        await page.waitForSelector(selector, { timeout: 240000 });
        await waitHydrated(page, selector, 120000);
      } catch (err) {
        if (i >= 3) throw err;
        results.devReloads += 1;
        await page.waitForTimeout(4000);
        await page.reload({ waitUntil: "domcontentloaded", timeout: 300000 });
        continue;
      }
      await page.waitForTimeout(quietMs);
      if (!navigated) return;
      results.devReloads += 1;
    }
    throw new Error(`страница не успокоилась: ${url} ${selector}`);
  } finally {
    page.off("domcontentloaded", onLoad);
  }
}

async function shot(page, name, locator = null) {
  const file = path.join(SHOTS, `${name}.png`);
  if (locator) {
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await locator.screenshot({ path: file });
  } else {
    await page.waitForTimeout(500);
    await page.screenshot({ path: file, fullPage: false });
  }
  return file;
}

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function cron(ctx) {
  for (let i = 0; i < 30; i += 1) {
    const r = await api(ctx, "GET", "/api/cron/mailing", undefined, { Authorization: `Bearer ${CRON}` });
    if (!r.body || r.body.busy !== true) return r.body;
    await sleep(2000);
  }
  return { busy: true };
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

/** Текст PDF через pdf.js (как в проверках КП). */
async function pdfText(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, isEvalSupported: false, useSystemFonts: false });
  const doc = await task.promise;
  let text = "";
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    text += content.items.map((i) => i.str).join(" ") + "\n";
  }
  const pages = doc.numPages;
  await task.destroy();
  return { text: norm(text), pages };
}

/** Токен веб-версии КП → переменные (тело base64url JSON; подпись проверяет сервер). */
function kpClaims(url) {
  const token = decodeURIComponent(url.split("/kp/")[1].split("/")[0]);
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
}

let keepAlive = null;

(async () => {
  const browser = await launch();
  const root = await newContext(browser, DESKTOP);
  try {
    const rl = await login(root, ROOT_EMAIL, ROOT_PASSWORD);
    check("ROOT вошёл", rl.session, rl);

    // Прогрев маршрутов: next dev компилирует их при первом запросе и выгружает неактивные.
    const warm = [
      "/api/root/mailing/campaigns",
      "/api/root/mailing/campaigns/warm",
      "/api/root/mailing/campaigns/warm/launch",
      "/api/root/mailing/campaigns/warm/test",
      "/api/root/mailing/preview",
      "/api/root/mailing/reach",
      "/api/root/mailing/contacts",
      "/api/cron/mailing",
      "/api/root/promo-codes",
      "/api/root/proposals",
      "/api/root/proposals/personal-code",
      "/r/warm.x/0",
      "/promo/WARM10",
      "/root/mailing",
      "/root/mailing/warm",
      "/root/promo-codes",
      "/root/proposals",
      "/register",
      "/settings/subscription",
      "/order",
    ];
    for (const url of warm) {
      const r = await root.request.get(`${BASE}${url}`, { timeout: 300000, maxRedirects: 0 }).catch((e) => ({ status: () => String(e).slice(0, 60) }));
      results.notes.push(`warm ${url} → ${r.status()}`);
    }
    keepAlive = setInterval(() => {
      for (const url of warm) root.request.get(`${BASE}${url}`, { timeout: 120000, maxRedirects: 0 }).catch(() => null);
    }, 15000);

    const run = creds.run;
    const A = creds.anna;
    const kidEmail = `zav.solnyshko-${run}@example.com`;
    const hotelEmail = `hotel.volna-${run}@example.com`;

    // ------------------------------------------------ контакты: детсад и отель (как ROOT, вставкой)
    const imported = await api(root, "POST", "/api/root/mailing/contacts", {
      text: ["email;имя;компания;сфера", `${kidEmail};Мария Иванова;Детский сад №5 «Солнышко»;детсад`, `${hotelEmail};Олег Петров;Отель «Волна»;отель`].join("\n"),
      source: "E2E КП: выставка «Детство» и отели",
      basis: "Деловая переписка",
    });
    const contacts = await sql(`select id, email, sphere, company from "MarketingContact" order by email`);
    const kid = contacts.find((c) => c.email === kidEmail);
    const hotel = contacts.find((c) => c.email === hotelEmail);
    check("Контакты загружены: «детсад» → education, «отель» → hotel", imported.status === 200 && kid?.sphere === "education" && hotel?.sphere === "hotel", contacts);

    // ------------------------------------------------ черновик «КП»
    const created = await api(root, "POST", "/api/root/mailing/campaigns", {
      title: TITLE,
      kind: "kp",
      channels: { email: true, inApp: true, push: false, telegram: true },
      payload: {
        defaultSphere: "restaurant",
        promo: { mode: "personal", code: null, kind: "percent", value: 10, lifetime: true, validDays: 14 },
        attachPdf: false,
      },
      audience: { userIds: [A.id], contactIds: [kid.id, hotel.id] },
    });
    const campaignId = created.body?.campaign?.id;
    check("Черновик «КП» создан", created.status === 200 && Boolean(campaignId), created.body);

    // ------------------------------------------------ поля «КП» и предпросмотр (1280)
    const page = await root.newPage();
    watchErrors(page, "compose");
    await open(page, `/root/mailing?draft=${campaignId}`, '[data-testid="mailing-fields-kp"] [data-testid="kp-default-sphere"]');
    const kindValue = await page.getByTestId("compose-kind").inputValue();
    const personalChecked = await page.getByTestId("kp-mode-personal").isChecked();
    const value = await page.getByTestId("kp-value").inputValue();
    const days = await page.getByTestId("kp-days").inputValue();
    const lifetime = await page.getByTestId("kp-lifetime").isChecked();
    const daysHint = norm(await page.getByTestId("kp-days-hint").innerText());
    const expectedEnd = endsAfterDays(new Date(), 14);
    const endDay = new Date(expectedEnd.getTime() + 3 * 3600_000).getUTCDate();
    check(
      "Поля «КП»: персональные коды, 10 %, навсегда, 14 дней, срок «до <дата>» по Москве",
      kindValue === "kp" && personalChecked && value === "10" && days === "14" && lifetime && daysHint.includes(`до ${endDay} `) && /23:59 по Москве/.test(daysHint),
      { kindValue, personalChecked, value, days, lifetime, daysHint }
    );
    const sphereHint = norm(await page.getByTestId("mailing-fields-kp").innerText());
    check(
      "Подсказки: сфера получателя, «Вложить PDF», ссылка на отправителя и реквизиты",
      sphereHint.includes("пользователи — по организации, контакты — по колонке «сфера»") &&
        sphereHint.includes("Вложить PDF") &&
        (await page.getByTestId("kp-sender-link").getAttribute("href")) === "/root/proposals",
      sphereHint.slice(0, 300)
    );
    // Режим «Выбрать код» — список общих кодов; назад к персональным.
    await page.getByTestId("kp-mode-existing").check();
    await page.getByTestId("kp-existing-code").waitFor({ timeout: 30000 });
    const existingOptions = await page.getByTestId("kp-existing-code").locator("option").allInnerTexts();
    results.notes.push(`existing options: ${existingOptions.join(" | ")}`);
    await page.getByTestId("kp-mode-personal").check();
    await page.getByTestId("kp-value").waitFor({ timeout: 30000 });
    await page.getByTestId("mailing-fields-kp").scrollIntoViewIfNeeded();
    await shot(page, "01-kp-fields-1280", page.getByTestId("mailing-fields-kp").locator("xpath=ancestor::section[1]"));

    await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="preview-email"] iframe')), null, { timeout: 120000 });
    await page.waitForFunction(() => /пример/.test(document.querySelector('[data-testid="preview-notes"]')?.textContent ?? ""), null, { timeout: 120000 });
    const previewHtml = (await page.locator('[data-testid="preview-email"] iframe').getAttribute("srcdoc")) ?? "";
    const previewNote = norm(await page.getByTestId("preview-notes").innerText());
    check(
      "Предпросмотр: КП кафе с примером кода ROMASHKA10 и пометкой «пример — настоящий код создастся при отправке»",
      /ROMASHKA10/.test(previewHtml) && previewNote.includes("Промокод ROMASHKA10 — пример: настоящий код создастся при отправке"),
      previewNote
    );
    await shot(page, "02-kp-preview-1280", page.getByTestId("compose-preview"));
    // Предпросмотр для контакта-отеля — своя сфера и свой пример кода.
    const forOptions = await page.getByTestId("compose-preview-for").locator("option").evaluateAll((els) => els.map((e) => ({ value: e.value, text: e.textContent })));
    results.notes.push(`preview-for options: ${JSON.stringify(forOptions)}`);
    const hotelOption = forOptions.find((o) => o.value === `contact:${hotel.id}`);
    if (hotelOption) {
      await page.getByTestId("compose-preview-for").selectOption(hotelOption.value);
      await page.waitForFunction(() => /VOLNA10/.test(document.querySelector('[data-testid="preview-email"] iframe')?.getAttribute("srcdoc") ?? ""), null, { timeout: 120000 });
      const hotelHtml = (await page.locator('[data-testid="preview-email"] iframe').getAttribute("srcdoc")) ?? "";
      check("Предпросмотр для отеля: пример VOLNA10, КП для отеля", /VOLNA10/.test(hotelHtml) && /Отель «Волна»/.test(hotelHtml), null);
      await page.getByRole("button", { name: "Telegram", exact: true }).click();
      const tgPreview = norm(await page.getByTestId("preview-telegram").innerText());
      check(
        "Предпросмотр Telegram: заголовок, «Команда до 10 сотрудников — … со скидкой 10 % навсегда по промокоду VOLNA10 (код действует до …)»",
        tgPreview.includes("Предложение WeSetup для вашей команды") && /Команда до 10 сотрудников — [\d ]+ ₽\/мес со скидкой 10 % навсегда по промокоду VOLNA10 \(код действует до \d+ [а-я]+\)\. Бесплатно — все/.test(tgPreview),
        tgPreview
      );
      await shot(page, "03-kp-preview-telegram-1280", page.getByTestId("compose-preview"));
      await page.getByRole("button", { name: "Почта", exact: true }).click();
    } else {
      check("Предпросмотр для отеля: пример VOLNA10, КП для отеля", false, forOptions);
    }

    // ------------------------------------------------ тест себе: пример кода с плашкой
    await page.getByTestId("compose-test").click();
    await page.getByTestId("compose-test-result").waitFor({ timeout: 180000 });
    const testText = norm(await page.getByTestId("compose-test-result").innerText());
    check("Тест себе: письмо (сухая) и пометка про пример кода", /Почта: Отправлено \(сухая отправка\)/.test(testText) && /пример: настоящий код создастся при отправке/.test(testText), testText);
    const testRow = (await sql(`select id from "MailingRecipient" where "campaignId" = $1 and "isTest"`, [campaignId]))[0];
    const testHtmlFile = path.join(OUTBOX, campaignId, `${testRow?.id}-email.html`);
    const testHtml = fs.existsSync(testHtmlFile) ? fs.readFileSync(testHtmlFile, "utf8") : "";
    check("Тестовое письмо: плашка «Тестовое письмо. Промокод … — пример» вверху", /data-mailing-test-note[^>]*>Тестовое письмо\. Промокод [A-Z0-9-]+ — пример/.test(testHtml), testHtmlFile);
    const codesAfterTest = await sql(`select count(*)::int as n from "PromoCode" where "campaignId" = $1`, [campaignId]);
    check("Тест себе не создаёт промокодов", codesAfterTest[0].n === 0, codesAfterTest[0]);

    // ------------------------------------------------ запуск → карточка
    await page.getByTestId("compose-send-now").click();
    await page.locator('[role="dialog"]').getByRole("button", { name: "Отправить", exact: true }).click();
    await page.waitForURL(/\/root\/mailing\/[a-z0-9]+$/i, { timeout: 180000 });
    check("Запуск → карточка рассылки", page.url().endsWith(`/root/mailing/${campaignId}`), page.url());

    // ------------------------------------------------ cron разбирает очередь
    const launchedAt = new Date();
    const done = await waitFor(async () => {
      await cron(root);
      const [c] = await sql(`select status, "preparedAt", "sentCount", "lastError" from "MailingCampaign" where id = $1`, [campaignId]);
      return c.status === "done" ? c : null;
    }, 240000, 5000);
    const campaign = (await sql(`select status, "preparedAt", "sentCount", "failedCount", "lastError" from "MailingCampaign" where id = $1`, [campaignId]))[0];
    check("Cron: коды подготовлены, рассылка завершена, отправлено 3", Boolean(done) && campaign.preparedAt && campaign.sentCount === 3 && campaign.failedCount === 0, campaign);

    const recipients = await sql(
      `select id, token, email, "userId", "contactId", sphere, payload, links, "emailStatus", "inAppStatus", "telegramStatus", "dryRun"
         from "MailingRecipient" where "campaignId" = $1 and not "isTest" order by "createdAt", id`,
      [campaignId]
    );
    const byEmail = Object.fromEntries(recipients.map((r) => [r.email, r]));
    const annaRow = byEmail[A.email];
    const kidRow = byEmail[kidEmail];
    const hotelRow = byEmail[hotelEmail];
    // «endsAt» — timestamp без пояса (Prisma пишет UTC); pg прочитал бы его как местное время — берём строкой.
    const codes = await sql(
      `select code, kind, value, lifetime, to_char("endsAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "endsAt", "maxUses", active,
              "personalEmail", "organizationId", "campaignId", note
         from "PromoCode" where "campaignId" = $1 order by code`,
      [campaignId]
    );
    const codeOf = (row) => row?.payload?.promoCode;
    const rowCode = (row) => codes.find((c) => c.code === codeOf(row));
    const ends = (c) => c && Math.abs(new Date(c.endsAt).getTime() - endsAfterDays(launchedAt, 14).getTime()) < 1000;
    check(
      "Коды: 3 новых, у каждого получателя свой (ROMASHKA10, SOLNYSHKO10, VOLNA10)",
      codes.length === 3 && codeOf(annaRow) === "ROMASHKA10" && codeOf(kidRow) === "SOLNYSHKO10" && codeOf(hotelRow) === "VOLNA10",
      recipients.map((r) => [r.email, r.payload])
    );
    check(
      "Код Анны привязан к её организации, коды контактов — без привязки (одна оплата)",
      rowCode(annaRow)?.organizationId === A.orgId && !rowCode(annaRow)?.personalEmail &&
        [kidRow, hotelRow].every((r) => rowCode(r) && !rowCode(r).organizationId && !rowCode(r).personalEmail),
      codes.map((c) => [c.code, c.organizationId, c.personalEmail])
    );
    check(
      "Условия кодов: −10 % навсегда, maxUses 1, до 23:59 МСК через 14 дней, заметка и метка рассылки",
      codes.every(
        (c) => c.kind === "percent" && c.value === 10 && c.lifetime && c.maxUses === 1 && c.active && ends(c) && c.campaignId === campaignId && c.note.startsWith(`Рассылка «${TITLE}»`)
      ) && recipients.every((r) => r.payload?.promoEndsAt === endsAfterDays(launchedAt, 14).toISOString()),
      codes.map((c) => ({ code: c.code, endsAt: c.endsAt, note: c.note }))
    );
    check("Каналы: письма всем трём (сухая), Анне — колокольчик и Telegram (сухая)", recipients.every((r) => r.emailStatus === "sent" && r.dryRun) && annaRow?.inAppStatus === "sent" && annaRow?.telegramStatus === "sent", recipients.map((r) => [r.email, r.emailStatus, r.inAppStatus, r.telegramStatus]));

    // ------------------------------------------------ письма в папке сухой отправки
    const dir = path.join(OUTBOX, campaignId);
    const expect = [
      [annaRow, "cafe", "ROMASHKA10", "Кафе «Ромашка»"],
      [kidRow, "education", "SOLNYSHKO10", "Детский сад №5 «Солнышко»"],
      [hotelRow, "hotel", "VOLNA10", "Отель «Волна»"],
    ];
    const allCodes = expect.map((e) => e[2]);
    for (const [row, sphere, code, company] of expect) {
      const eml = fs.readFileSync(path.join(dir, `${row.id}-email.eml`), "utf8");
      const html = fs.readFileSync(path.join(dir, `${row.id}-email.html`), "utf8");
      const unfolded = eml.replace(/\r?\n[ \t]+/g, " ");
      const links = row.links;
      const promoLink = links.find((u) => u.includes("/promo/"));
      const webLink = links.find((u) => /\/kp\/[^/]+$/.test(u));
      const claims = webLink ? kpClaims(webLink) : null;
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
      // Почта и телефон отправителя (mailto:, tel:) — без учёта кликов, как и отписка.
      const external = hrefs.filter(
        (h) => !h.startsWith(`${BASE}/r/${row.token}/`) && !h.includes(`/unsubscribe/${row.token}`) && !/^(mailto|tel):/.test(h)
      );
      const others = allCodes.filter((c) => c !== code && html.includes(c));
      check(
        `${company}: своя сфера (${sphere}) и свой код ${code}, чужих кодов нет`,
        html.includes(code) && others.length === 0 && promoLink === `https://wesetup.ru/promo/${code}?s=${sphere}` && claims?.s === sphere && claims?.p?.c === code,
        { promoLink, sphere: claims?.s, code: claims?.p?.c, others }
      );
      check(
        `${company}: ссылки через /r/, отписка напрямую, заголовки List-Unsubscribe`,
        hrefs.length > 3 && external.length === 0 && html.includes(`/unsubscribe/${row.token}`) &&
          (unfolded.match(/^List-Unsubscribe: (.*)$/m)?.[1] ?? "").includes(`/api/mailing/unsubscribe/${row.token}`) &&
          /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m.test(unfolded),
        { hrefs: hrefs.length, external }
      );
      const subject = (unfolded.match(/^Subject: (.*)$/m)?.[1] ?? "").trim();
      results.notes.push(`${company} subject (encoded): ${subject.slice(0, 120)}`);
    }
    fs.copyFileSync(path.join(dir, `${kidRow.id}-email.html`), path.join(OUT, "kp-email-kid.html"));
    fs.copyFileSync(path.join(dir, `${kidRow.id}-email.eml`), path.join(OUT, "kp-email-kid.eml"));
    const tg = JSON.parse(fs.readFileSync(path.join(dir, `${annaRow.id}-telegram.json`), "utf8"));
    check("Telegram Анны (сухая): код и ссылка на веб-версию через /r/", /ROMASHKA10/.test(tg.text) && tg.text.includes(`${BASE}/r/${annaRow.token}/`), tg.text.slice(0, 300));
    const bell = await sql(`select title, "linkHref", items from "Notification" where "userId" = $1 and kind = 'mailing'`, [A.id]);
    check("Колокольчик Анны: «Предложение WeSetup для вашей команды» и ссылка на КП", bell.some((b) => b.title === "Предложение WeSetup для вашей команды" && (b.linkHref ?? "").includes(`/r/${annaRow.token}/`)), bell.map((b) => [b.title, b.linkHref]));

    // ------------------------------------------------ ROOT «Промокоды»
    await open(page, "/root/promo-codes", `[data-testid="promo-code-row"][data-code="ROMASHKA10"]`);
    const rowsText = {};
    for (const code of allCodes) rowsText[code] = norm(await page.locator(`[data-testid="promo-code-row"][data-code="${code}"]`).innerText());
    check(
      "ROOT «Промокоды»: 3 кода с меткой рассылки и заметкой «Рассылка «…» · компания»",
      allCodes.every((c) => rowsText[c].includes(`рассылка ${campaignId}`) && rowsText[c].includes(`Рассылка «${TITLE}»`) && rowsText[c].includes("навсегда")) &&
        rowsText.ROMASHKA10.includes("персональный") && rowsText.SOLNYSHKO10.includes("Детский сад №5 «Солнышко»"),
      rowsText
    );
    await shot(page, "04-promo-codes-1280", page.locator('[data-testid="promo-code-row"][data-code="ROMASHKA10"]').locator("xpath=ancestor::section[1]"));

    // ------------------------------------------------ клик по кнопке письма → /promo → регистрация → тариф → /order
    const click = await api(root, "GET", `/r/${kidRow.token}/0`);
    check("Кнопка письма детсада: /r/ → https://wesetup.ru/promo/SOLNYSHKO10?s=education", click.status === 307 && click.headers.location === "https://wesetup.ru/promo/SOLNYSHKO10?s=education", { status: click.status, location: click.headers.location });
    const clicked = (await sql(`select "clickedAt", "clickCount" from "MailingRecipient" where id = $1`, [kidRow.id]))[0];
    check("Клик записан у получателя", Boolean(clicked.clickedAt) && clicked.clickCount === 1, clicked);
    // Боевой домен в рабочей копии не открываем — тот же путь на стенде.
    const local = new URL(click.headers.location);
    for (const [label, viewport] of [["390", PHONE]]) {
      const guest = await newContext(browser, viewport, { isMobile: true, hasTouch: true });
      const gp = await guest.newPage();
      watchErrors(gp, `guest-${label}`);
      await open(gp, `${local.pathname}${local.search}`, "[data-testid=register-promo]");
      const url = new URL(gp.url());
      const banner = norm(await gp.locator("[data-testid=register-promo]").textContent());
      const sphere = await gp.locator("[data-testid=register-sphere]").inputValue();
      const cookie = (await guest.cookies()).find((c) => c.name === "wesetup.promo");
      check(
        `${label}: /promo/SOLNYSHKO10?s=education → регистрация: сфера «Школа / Детсад / Лагерь» подставлена, плашка кода, cookie`,
        url.pathname === "/register" && url.searchParams.get("s") === "education" && sphere === "education" && banner.includes("SOLNYSHKO10") && cookie?.value === "SOLNYSHKO10",
        { url: gp.url(), sphere, banner, cookie: cookie?.value }
      );
      await shot(gp, `05-register-promo-${label}`);
      const guestEmail = `kp-kid-${run}@example.com`;
      await gp.locator("#register-email").fill(guestEmail);
      await gp.locator("[data-testid=legal-consent]").check();
      await gp.getByRole("button", { name: "Создать аккаунт" }).click();
      await gp.waitForURL(/\/settings\/subscription\?promo=/, { timeout: 300000 });
      await open(gp, gp.url(), "[data-testid=subscription-discount] [data-testid=discount-pay]");
      const [org] = await sql('select o.type from "Organization" o join "User" u on u."organizationId" = o.id where u.email = $1', [guestEmail]);
      check(`${label}: организация создана со сферой education`, org?.type === "education", org);
      const applied = norm(await gp.locator("[data-testid=promo-applied]").textContent());
      check(`${label}: тариф — промокод SOLNYSHKO10 применён`, applied.includes("SOLNYSHKO10") && /применён/.test(applied), applied);
      await shot(gp, `06-subscription-code-${label}`, gp.locator("[data-testid=subscription-discount]"));
      await gp.locator("[data-testid=discount-pay]").click();
      await gp.waitForURL(/\/order\?plan=monthly&promo=SOLNYSHKO10/, { timeout: 180000 });
      await open(gp, gp.url(), "form button[type=submit]");
      const promoInput = await gp.getByLabel("Промокод").inputValue();
      const line = norm(await gp.locator("[data-testid=order-subscription-line]").innerText());
      check(`${label}: /order — код подставлен сам, скидка в строке подписки (оплату не отправляем)`, promoInput === "SOLNYSHKO10" && line.includes("SOLNYSHKO10"), { promoInput, line: line.slice(0, 200) });
      await shot(gp, `07-order-code-${label}`, gp.locator("[data-testid=order-subscription-line]").locator("xpath=ancestor::*[contains(@class,'rounded-3xl')][1]"));
      await guest.close();
    }

    // ------------------------------------------------ генератор КП: «Создать персональный код»
    await open(page, "/root/proposals", '[data-testid="kp-company"]');
    await page.getByTestId("kp-company").fill("Столовая «Берёзка»");
    await page.getByTestId("kp-create-code").waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="kp-create-code"]')?.hasAttribute("disabled"), null, { timeout: 60000 });
    const [codeResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/root/proposals/personal-code") && r.request().method() === "POST", { timeout: 180000 }),
      page.getByTestId("kp-create-code").click(),
    ]);
    const codeBody = await codeResponse.json().catch(() => null);
    const genCode = codeBody?.option?.code;
    check("Генератор: код создан (−10 % навсегда, по названию компании)", codeResponse.status() === 200 && genCode === "BEREZKA10", codeBody);
    await page.waitForFunction((code) => (document.querySelector('[data-testid="kp-promo"]')?.textContent ?? "").includes(code), genCode, { timeout: 60000 });
    const promoSelect = norm(await page.getByTestId("kp-promo").innerText());
    check("Генератор: код сразу выбран в форме", promoSelect.includes(`${genCode} · −10 % навсегда`), promoSelect);
    // Предпросмотр обновляется с паузой — ждём PDF с новым кодом.
    await page.waitForFunction(
      (code) => {
        const src = document.querySelector('[data-testid="kp-pdf-frame"]')?.getAttribute("src") ?? "";
        const m = src.match(/\/kp\/([^/#?]+)\/pdf/);
        if (!m) return false;
        try {
          const body = JSON.parse(atob(decodeURIComponent(m[1]).split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
          return body?.p?.c === code;
        } catch {
          return false;
        }
      },
      genCode,
      { timeout: 120000 }
    );
    const pdfSrc = await page.getByTestId("kp-pdf-frame").getAttribute("src");
    const pdfUrl = pdfSrc.split("#")[0];
    const pdfRes = await root.request.get(pdfUrl.startsWith("http") ? pdfUrl : `${BASE}${pdfUrl}`, { timeout: 240000 });
    const pdf = await pdfText(await pdfRes.body());
    check(
      "Генератор: в PDF — код, «навсегда» и срок активации, один лист",
      pdfRes.status() === 200 && pdf.pages === 1 && pdf.text.includes(genCode) && /действует до \d+ [а-я]+: при оплате до этого дня скидка остаётся навсегда/.test(pdf.text),
      { status: pdfRes.status(), pages: pdf.pages, excerpt: pdf.text.slice(pdf.text.indexOf(genCode) - 80, pdf.text.indexOf(genCode) + 160) }
    );
    await page.getByTestId("kp-tab-email").click();
    await page.waitForFunction((code) => (document.querySelector('[data-testid="kp-email-frame"]')?.getAttribute("srcdoc") ?? "").includes(code), genCode, { timeout: 60000 });
    check("Генератор: в письме КП — тот же код", true);
    await shot(page, "08-generator-code-1280");
    const [gen] = await sql(
      `select kind, value, lifetime, "maxUses", "personalEmail", "organizationId", "campaignId", note,
              to_char("endsAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "endsAt"
         from "PromoCode" where code = $1`,
      [genCode ?? "-"]
    );
    check(
      "Генератор: код без привязки, одна оплата, 14 дней, заметка «Генератор КП · Столовая «Берёзка»»",
      gen && gen.kind === "percent" && gen.value === 10 && gen.lifetime && gen.maxUses === 1 && !gen.personalEmail && !gen.organizationId && !gen.campaignId &&
        gen.note === "Генератор КП · Столовая «Берёзка»" && Math.abs(new Date(gen.endsAt).getTime() - endsAfterDays(new Date(), 14).getTime()) < 1000,
      gen
    );
    const genAudit = await sql(`select details from "AuditLog" where action = 'promo.create' and details->>'code' = $1`, [genCode ?? "-"]);
    check("Генератор: аудит promo.create (source kp-generator)", genAudit.length === 1 && genAudit[0].details.source === "kp-generator", genAudit.map((a) => a.details));

    // ------------------------------------------------ письмо 375 и 600
    const mail = await browser.newContext({ deviceScaleFactor: 1 });
    const mp = await mail.newPage();
    const html = fs.readFileSync(path.join(OUT, "kp-email-kid.html"), "utf8");
    for (const width of [375, 600]) {
      await mp.setViewportSize({ width, height: 900 });
      await mp.setContent(html, { waitUntil: "load" });
      await mp.waitForTimeout(800);
      await mp.screenshot({ path: path.join(SHOTS, `09-email-kid-${width}.png`), fullPage: true });
      const over = await overflow(mp);
      check(`Письмо детсаду на ширине ${width}: без горизонтальной прокрутки`, over <= 1, { over });
    }
    await mail.close();

    // ------------------------------------------------ телефон 390: поля «КП», предпросмотр, «Промокоды»
    const phone = await newContext(browser, PHONE, { isMobile: true, hasTouch: true });
    await login(phone, ROOT_EMAIL, ROOT_PASSWORD);
    const draft2 = await api(root, "POST", "/api/root/mailing/campaigns", {
      title: "E2E КП: для снимка 390",
      kind: "kp",
      channels: { email: true, inApp: false, push: false, telegram: false },
      payload: { defaultSphere: "restaurant", promo: { mode: "personal", code: null, kind: "percent", value: 10, lifetime: true, validDays: 14 }, attachPdf: false },
      audience: { userIds: [A.id], contactIds: [kid.id, hotel.id] },
    });
    const pp = await phone.newPage();
    watchErrors(pp, "phone");
    await open(pp, `/root/mailing?draft=${draft2.body?.campaign?.id}`, '[data-testid="mailing-fields-kp"] [data-testid="kp-default-sphere"]');
    await shot(pp, "10-kp-fields-390", pp.getByTestId("mailing-fields-kp"));
    check("390: форма «КП» без горизонтальной прокрутки", (await overflow(pp)) <= 1, { overflow: await overflow(pp) });
    await pp.waitForFunction(() => /пример/.test(document.querySelector('[data-testid="preview-notes"]')?.textContent ?? ""), null, { timeout: 120000 });
    await shot(pp, "11-kp-preview-390", pp.getByTestId("compose-preview"));
    await open(pp, "/root/promo-codes", `[data-testid="promo-code-row"][data-code="ROMASHKA10"]`);
    await shot(pp, "12-promo-codes-390");
    await open(pp, "/root/proposals", '[data-testid="kp-company"]');
    await pp.getByTestId("kp-personal-code").scrollIntoViewIfNeeded();
    await shot(pp, "13-generator-code-390", pp.getByTestId("kp-personal-code"));
    check("390: генератор без горизонтальной прокрутки", (await overflow(pp)) <= 1, { overflow: await overflow(pp) });
    await phone.close();

    // ------------------------------------------------ аудит рассылки
    const audit = await sql(`select action, count(*)::int as n from "AuditLog" where action like 'mailing.%' and "entityId" = $1 group by action order by action`, [campaignId]);
    check("Аудит рассылки: тест и запуск", ["mailing.campaign.test", "mailing.campaign.launch"].every((a) => audit.some((x) => x.action === a)), audit);
  } catch (error) {
    check("сценарий без исключений", false, String(error && error.stack ? error.stack : error).slice(0, 1500));
  } finally {
    if (keepAlive) clearInterval(keepAlive);
    save();
    await browser.close();
    console.log(`done: ${results.passed} passed, ${results.failed} failed → ${path.join(OUT, "results.json")}`);
  }
})();
