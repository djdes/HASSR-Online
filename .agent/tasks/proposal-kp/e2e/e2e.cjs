// E2E КП (spec proposal-kp): ROOT-генератор (1280/390), веб-версия и PDF по подписанной ссылке,
// тестовое письмо (SMTP выключен → лог), аудит, QR-картинка для письма, письма в Chromium
// (375/600, светлая/тёмная, 3 сферы).
// Запуск: node e2e/seed.cjs && node e2e/e2e.cjs   (dev-сервер :3192 поднят, лог — DEV_LOG).
const fs = require("node:fs");
const path = require("node:path");
const { BASE, EVID, RAW, OUT, launch, sql, login, newContext, open, norm, readCreds, waitHydrated } = require("./lib.cjs");

const DEV_LOG = process.env.DEV_LOG || "d:/wt/tmp-kp/dev.log";
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

const results = { checks: [], pageErrors: [], startedAt: new Date().toISOString() };
function check(name, ok, details = {}) {
  results.checks.push({ name, ok: Boolean(ok), details });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${Object.keys(details).length ? " " + JSON.stringify(details) : ""}`);
}

function watchErrors(page, label) {
  page.on("pageerror", (err) => results.pageErrors.push({ page: label, message: String(err && err.message).slice(0, 300) }));
  page.on("console", (msg) => {
    if (msg.type() === "error" && /hydrat|did not match|server rendered/i.test(msg.text())) {
      results.pageErrors.push({ page: label, message: `console: ${msg.text().slice(0, 300)}` });
    }
  });
}

async function selectOption(page, triggerTestId, optionName) {
  await page.getByTestId(triggerTestId).click();
  await page.getByRole("option", { name: optionName }).first().click();
}

/** Дождаться нового предпросмотра после изменений формы. */
async function waitPreview(page, action) {
  const response = page.waitForResponse(
    (res) => res.url().endsWith("/api/root/proposals") && res.request().method() === "POST",
    { timeout: 300000 },
  );
  await action();
  const res = await response;
  // Поле могло ещё печататься — ждём тишины и последнего ответа.
  await page.waitForTimeout(1500);
  return res;
}

function pdfPages(buffer) {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

async function main() {
  const creds = readCreds();
  const browser = await launch();
  try {
    // ------------------------------------------------ доступ без входа
    {
      const ctx = await newContext(browser, DESKTOP);
      const page = await ctx.request.get(`${BASE}/root/proposals`, { maxRedirects: 0, timeout: 300000 });
      check("аноним: /root/proposals → 404", page.status() === 404, { status: page.status() });
      const api = await ctx.request.post(`${BASE}/api/root/proposals`, { data: { sphere: "cafe" }, timeout: 300000 });
      check("аноним: POST /api/root/proposals → 404", api.status() === 404, { status: api.status() });
      await ctx.close();
    }

    // ------------------------------------------------ ROOT-генератор, компьютер
    const ctx = await newContext(browser, DESKTOP);
    const auth = await login(ctx, creds.root, creds.password);
    check("вход ROOT", auth.session, auth);
    const page = await ctx.newPage();
    watchErrors(page, "root-proposals-1280");
    await open(page, "/root/proposals", "[data-testid=kp-form]", true);
    check("ссылка в меню ROOT", (await page.locator('a[href="/root/proposals"]').count()) > 0);
    // Первый предпросмотр (сфера по умолчанию).
    await page.waitForSelector("[data-testid=kp-pdf-frame]", { timeout: 300000 });

    await waitPreview(page, () => selectOption(page, "kp-sphere", "Кафе / Кофейня"));
    await page.getByTestId("kp-company").fill("Кафе «Ромашка»");
    await page.getByTestId("kp-recipient").fill("Анна Сергеевна");
    await waitPreview(page, () => selectOption(page, "kp-promo", /ROMASHKA10/));
    const preview = await (
      await ctx.request.post(`${BASE}/api/root/proposals`, {
        data: { sphere: "cafe", companyName: "Кафе «Ромашка»", recipientName: "Анна Сергеевна", promoCode: "ROMASHKA10" },
        timeout: 300000,
      })
    ).json();
    check("предпросмотр: тема письма с компанией", norm(preview.email.subject) === "Кафе «Ромашка»: журналы СанПиН с телефона", {
      subject: preview.email.subject,
    });
    check("предпросмотр: CTA на /promo/ROMASHKA10?s=cafe", preview.content.ctaUrl === "https://wesetup.ru/promo/ROMASHKA10?s=cafe", {
      cta: preview.content.ctaUrl,
    });
    check("предпросмотр: цена со скидкой 1 791 ₽ вместо 1 990 ₽", preview.content.price.priceRub === 1791 && preview.content.price.oldRub === 1990, preview.content.price);
    check("предпросмотр: HTML письма < 100 КБ", preview.email.bytes < 100 * 1024, { bytes: preview.email.bytes });
    check("предпросмотр: веб-ссылка /kp/<токен>", /\/kp\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(preview.webUrl), { webUrl: preview.webUrl });
    check("предпросмотр: без предупреждений (код из базы, реквизиты есть)", preview.warnings.length === 0, { warnings: preview.warnings });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(EVID, "root-proposals-1280-pdf.png"), fullPage: true });

    // Письмо в предпросмотре: 600 и 390.
    await page.getByTestId("kp-tab-email").click();
    await page.waitForSelector("[data-testid=kp-email-frame]");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(EVID, "root-proposals-1280-email-600.png"), fullPage: true });
    await page.getByTestId("kp-width-390").click();
    await page.waitForTimeout(1000);
    const frameWidth = await page.getByTestId("kp-email-frame").evaluate((el) => el.getBoundingClientRect().width);
    check("предпросмотр письма: переключатель 390", Math.round(frameWidth) === 390, { frameWidth });
    await page.screenshot({ path: path.join(EVID, "root-proposals-1280-email-390.png"), fullPage: true });
    await page.getByTestId("kp-tab-pdf").click();

    // Промокод вручную (нет в базе) — предупреждение.
    const manual = await (
      await ctx.request.post(`${BASE}/api/root/proposals`, {
        data: {
          sphere: "hotel",
          promoCode: "NEWCODE15",
          manualPromo: { kind: "percent", value: 15, lifetime: true, endsAt: null },
        },
        timeout: 300000,
      })
    ).json();
    check("код вне базы: предупреждение «создайте в Промокодах»", manual.warnings.some((w) => /нет в базе/.test(w)), { warnings: manual.warnings });
    const inactive = await (
      await ctx.request.post(`${BASE}/api/root/proposals`, { data: { sphere: "hotel", promoCode: "STARYI20" }, timeout: 300000 })
    ).json();
    check("выключенный код: предупреждение", inactive.warnings.some((w) => /отключён/.test(w)), { warnings: inactive.warnings });

    // Отправитель по умолчанию.
    await page.getByTestId("kp-sender-name").fill("Анна Петрова, менеджер WeSetup");
    await page.getByTestId("kp-sender-phone").fill("+7 900 000-00-00");
    await page.getByTestId("kp-sender-email").fill("support@wesetup.ru");
    await page.getByTestId("kp-sender-telegram").fill("@example_manager");
    const saved = page.waitForResponse((res) => res.url().endsWith("/api/root/proposals/sender") && res.request().method() === "PUT", {
      timeout: 300000,
    });
    await page.getByTestId("kp-save-sender").click();
    await saved;
    await page.waitForTimeout(500);
    const senderRow = await sql(`select value from "PlatformSetting" where key = 'proposal.sender'`);
    const savedSender = senderRow[0] ? JSON.parse(senderRow[0].value) : null;
    check("отправитель по умолчанию сохранён в PlatformSetting", savedSender && savedSender.name === "Анна Петрова, менеджер WeSetup" && savedSender.telegram === "example_manager", savedSender || {});

    // Скопировать ссылку.
    await page.getByTestId("kp-copy-link").click();
    await page.waitForSelector("[data-testid=kp-issued-link]", { timeout: 60000 });
    const webUrl = await page.getByTestId("kp-issued-link").inputValue();
    check("ссылка на веб-версию выдана", webUrl.startsWith(`${BASE}/kp/`), { webUrl: webUrl.slice(0, 80) + "…" });

    // Скачать PDF.
    const downloadPromise = page.waitForEvent("download", { timeout: 300000 });
    await page.getByTestId("kp-download").click();
    const download = await downloadPromise;
    const pdfPath = path.join(RAW, "root-download.pdf");
    await download.saveAs(pdfPath);
    const pdf = fs.readFileSync(pdfPath);
    check("«Скачать PDF»: PDF на одну страницу", pdf.subarray(0, 5).toString("latin1") === "%PDF-" && pdfPages(pdf) === 1, {
      bytes: pdf.length,
      pages: pdfPages(pdf),
      name: download.suggestedFilename(),
    });

    // Тестовое письмо (SMTP выключен → лог).
    await page.getByTestId("kp-test-email").click();
    await page.waitForTimeout(4000);
    const log = fs.existsSync(DEV_LOG) ? fs.readFileSync(DEV_LOG, "utf8") : "";
    check("тестовое письмо: в логе [kp] root test email … delivery=log", /\[kp\] root test email to=\S+ sphere=cafe promo=ROMASHKA10 delivery=log/.test(log));
    check("тестовое письмо: email.ts записал письмо в лог", /\[email\/dev\] Subject: \[тест\] Кафе «Ромашка»: журналы СанПиН с телефона/.test(log));

    const audit = await sql(
      `select action, "entityId", details from "AuditLog" where entity = 'Proposal' and "createdAt" > $1 order by "createdAt"`,
      [results.startedAt],
    );
    const actions = audit.map((row) => row.action);
    check("аудит: sender.update, link, pdf, test_email", ["proposal.sender.update", "proposal.link", "proposal.pdf", "proposal.test_email"].every((a) => actions.includes(a)), { actions });
    fs.writeFileSync(path.join(RAW, "audit.json"), JSON.stringify(audit, null, 1));
    await page.close();

    // ------------------------------------------------ ROOT-генератор, телефон
    {
      const phoneCtx = await newContext(browser, PHONE);
      await login(phoneCtx, creds.root, creds.password);
      const phonePage = await phoneCtx.newPage();
      watchErrors(phonePage, "root-proposals-390");
      await open(phonePage, "/root/proposals", "[data-testid=kp-form]", true);
      await phonePage.waitForSelector("[data-testid=kp-pdf-frame]", { timeout: 300000 });
      await phonePage.getByTestId("kp-company").fill("Детский сад № 5 «Солнышко»");
      await waitPreview(phonePage, () => selectOption(phonePage, "kp-sphere", "Школа / Детсад / Лагерь"));
      await phonePage.getByTestId("kp-tab-email").click();
      await phonePage.waitForTimeout(1500);
      await phonePage.screenshot({ path: path.join(EVID, "root-proposals-390.png"), fullPage: true });
      const overflow = await phonePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check("ROOT-генератор 390: без горизонтальной прокрутки страницы", overflow <= 1, { overflow });
      await phoneCtx.close();
    }

    // ------------------------------------------------ веб-версия
    for (const [viewport, label] of [
      [DESKTOP, "1280"],
      [PHONE, "390"],
    ]) {
      const anon = await newContext(browser, viewport);
      const web = await anon.newPage();
      watchErrors(web, `kp-web-${label}`);
      await web.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 300000 });
      await web.waitForSelector("[data-testid=kp-offer]", { timeout: 300000 });
      await web.waitForTimeout(1500);
      await web.screenshot({ path: path.join(EVID, `kp-web-${label}.png`), fullPage: true });
      const text = norm(await web.locator("main").innerText());
      check(`веб ${label}: адресат, заголовок, цена, скидка`, text.includes("Кафе «Ромашка» · Анна Сергеевна") && text.includes("для кафе и кофейни") && text.includes("1 791 ₽") && text.includes("1 990 ₽") && text.includes("−10 % по промокоду"), {});
      const cta = await web.getByTestId("kp-cta").getAttribute("href");
      check(`веб ${label}: кнопка ведёт на /promo/ROMASHKA10?s=cafe`, cta === "https://wesetup.ru/promo/ROMASHKA10?s=cafe", { cta });
      const robots = await web.locator('meta[name="robots"]').getAttribute("content");
      check(`веб ${label}: noindex`, /noindex/.test(robots || ""), { robots });
      const overflow = await web.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`веб ${label}: без горизонтальной прокрутки`, overflow <= 1, { overflow });
      if (label === "1280") {
        const href = await web.getByTestId("kp-download-pdf").getAttribute("href");
        const res = await anon.request.get(`${BASE}${href}`, { timeout: 300000 });
        const body = await res.body();
        check("веб: «Скачать PDF» отдаёт PDF файлом", res.status() === 200 && res.headers()["content-type"] === "application/pdf" && /attachment/.test(res.headers()["content-disposition"] || "") && pdfPages(body) === 1, {
          status: res.status(),
          disposition: res.headers()["content-disposition"],
          robots: res.headers()["x-robots-tag"],
        });
        fs.writeFileSync(path.join(RAW, "web-download.pdf"), body);
      }
      await anon.close();
    }

    // Подделанный токен.
    {
      const anon = await newContext(browser, PHONE);
      const bad = await anon.newPage();
      const token = webUrl.split("/kp/")[1];
      const forged = `${token.split(".")[0].slice(0, -2)}AA.${token.split(".")[1]}`;
      await bad.goto(`${BASE}/kp/${forged}`, { waitUntil: "domcontentloaded", timeout: 300000 });
      const text = norm(await bad.locator("main").innerText());
      check("подделанный токен: «Ссылка недействительна»", text.includes("Ссылка недействительна"));
      await bad.screenshot({ path: path.join(EVID, "kp-web-invalid-390.png"), fullPage: true });
      const pdfRes = await anon.request.get(`${BASE}/kp/${forged}/pdf`, { timeout: 300000 });
      check("подделанный токен: PDF → 404", pdfRes.status() === 404, { status: pdfRes.status() });
      await anon.close();
    }

    // QR-картинка для письма.
    {
      const anon = await newContext(browser, PHONE);
      const ok = await anon.request.get(`${BASE}/api/kp/qr/ROMASHKA10?s=cafe`, { timeout: 300000 });
      const png = await ok.body();
      fs.writeFileSync(path.join(RAW, "qr-ROMASHKA10-cafe.png"), png);
      check("QR для письма: PNG, кэш навсегда", ok.status() === 200 && ok.headers()["content-type"] === "image/png" && /immutable/.test(ok.headers()["cache-control"] || ""), {
        status: ok.status(),
        bytes: png.length,
      });
      const badCode = await anon.request.get(`${BASE}/api/kp/qr/${encodeURIComponent("https://evil.example")}?s=cafe`, { timeout: 300000 });
      const badSphere = await anon.request.get(`${BASE}/api/kp/qr/ROMASHKA10?s=spaceport`, { timeout: 300000 });
      check("QR для письма: произвольный текст и чужая сфера → 404", badCode.status() === 404 && badSphere.status() === 404, {
        badCode: badCode.status(),
        badSphere: badSphere.status(),
      });
      await anon.close();
    }

    // ------------------------------------------------ письма: 3 сферы × 375/600 × светлая/тёмная
    const emailCases = [
      ["restaurant", { sphere: "restaurant", companyName: "Ресторан «Прага»", recipientName: "Олег Викторович", promoCode: "ROMASHKA10" }],
      ["education", { sphere: "education", companyName: "Детский сад № 5 «Солнышко»", recipientName: "Анна Сергеевна", promoCode: "OKTYABR10" }],
      ["beauty", { sphere: "beauty", companyName: "Салон «Лиса»", recipientName: null, promoCode: null }],
    ];
    const emailSummary = [];
    for (const [name, form] of emailCases) {
      const res = await (await ctx.request.post(`${BASE}/api/root/proposals`, { data: form, timeout: 300000 })).json();
      fs.writeFileSync(path.join(RAW, `email-${name}.html`), res.email.html);
      fs.writeFileSync(path.join(RAW, `email-${name}.txt`), res.email.text);
      const hrefs = [...res.email.html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
      const relative = hrefs.filter((h) => !/^(https?:|mailto:|tel:)/.test(h));
      emailSummary.push({ name, subject: res.email.subject, preheader: res.email.preheader, bytes: res.email.bytes, links: hrefs.length, relative });
      check(`письмо ${name}: < 100 КБ, все ссылки абсолютные`, res.email.bytes < 100 * 1024 && relative.length === 0, { bytes: res.email.bytes, relative });
      check(`письмо ${name}: текстовая версия`, res.email.text.length > 500 && !/<[a-z]/i.test(res.email.text), { chars: res.email.text.length });
      for (const scheme of ["light", "dark"]) {
        for (const width of [375, 600]) {
          const mailCtx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
          // Картинки письма — с боевого домена; в рабочей копии отдаём их с локального сервера.
          await mailCtx.route(/^https:\/\/wesetup\.ru\//, async (route) => {
            const url = new URL(route.request().url());
            const local = await mailCtx.request.get(`${BASE}${url.pathname}${url.search}`, { timeout: 300000 });
            await route.fulfill({ status: local.status(), headers: local.headers(), body: await local.body() });
          });
          const mail = await mailCtx.newPage();
          await mail.setContent(res.email.html, { waitUntil: "load", timeout: 300000 });
          // Картинки грузятся через перехват с локального сервера — ждём, пока все догрузятся.
          await mail
            .waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 120000 })
            .catch(() => {});
          await mail.waitForTimeout(800);
          await mail.screenshot({ path: path.join(EVID, `email-${name}-${width}-${scheme}.png`), fullPage: true });
          const overflow = await mail.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          const images = await mail.evaluate(() => [...document.images].map((img) => ({ src: img.src, ok: img.complete && img.naturalWidth > 0, alt: img.alt })));
          check(`письмо ${name} ${width} ${scheme}: без горизонтальной прокрутки, картинки загрузились`, overflow <= 1 && images.every((img) => img.ok && img.alt), {
            overflow,
            images: images.map((img) => `${img.ok ? "ok" : "НЕТ"} ${img.src.replace(/^https:\/\/wesetup\.ru/, "")}`),
          });
          await mailCtx.close();
        }
      }
    }
    fs.writeFileSync(path.join(RAW, "emails.json"), JSON.stringify(emailSummary, null, 1));
    await ctx.close();
  } finally {
    await browser.close();
  }
  results.finishedAt = new Date().toISOString();
  results.pass = results.checks.filter((c) => c.ok).length;
  results.fail = results.checks.filter((c) => !c.ok).length;
  fs.writeFileSync(path.join(RAW, "e2e-results.json"), JSON.stringify(results, null, 1));
  console.log(`\nИтог: ${results.pass} PASS, ${results.fail} FAIL, ошибок страниц: ${results.pageErrors.length}. Выхлоп: ${OUT}`);
  process.exit(results.fail || results.pageErrors.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
