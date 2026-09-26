// E2E: опрос «Посоветуете WeSetup коллегам?» — просмотр по ?nps=1 и «Оставить отзыв».
// Dev-сервер :3045 (NEXT_DIST_DIR=.next-e2e), своя база wesetup_wt_nps2, SMTP пуст — письма только в логе.
// Запуск: node .agent/tasks/nps-reviews-2026-09/raw/e2e-nps-reviews.cjs
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const WT = "C:/wt/nps2";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");
const bcrypt = req("bcryptjs");

const BASE = "http://localhost:3045";
const TASK = path.join(WT, ".agent/tasks/nps-reviews-2026-09");
const EVID = path.join(TASK, "evidence");
const RESULTS = path.join(TASK, "raw/e2e-results.json");
const CHROME = path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1232/chrome-win64/chrome.exe");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_nps2?sslmode=disable";

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(WT, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);

const RUN = Date.now().toString(36);
const MANAGER = `nps-rv-${RUN}@example.com`;
const SECOND = `nps-rv2-${RUN}@example.com`;
const COOK = `nps-rv-cook-${RUN}@example.com`;
const COLLEAGUE = `colleague-${RUN}@example.com`;
const PASSWORD = "NpsReviews2026!";
const ORG_NAME = "Кафе «Ромашка»";
const DEFAULT_TEXT = "Мы ведём журналы ХАССП и СанПиН в WeSetup — заполняем с телефона по QR, проверки проходим спокойно. Советую!";
const DONE_REVIEW = "Спасибо! Отзыв отправлен на проверку, после одобрения начислим баллы";

fs.mkdirSync(EVID, { recursive: true });
const results = { run: RUN, startedAt: new Date().toISOString(), checks: [] };
function check(ac, name, ok, detail) {
  results.checks.push({ ac, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${ac}] ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
}

async function sql(text, params = []) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
}

async function login(context, email, password) {
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`, { timeout: 240000 })).json();
  const res = await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
    timeout: 240000,
  });
  const cookies = await context.cookies();
  return { status: res.status(), session: cookies.some((c) => c.name.includes("session-token")) };
}

async function quietPage(context) {
  const page = await context.newPage();
  // «Что нового» — не часть проверки.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("wesetup.last-seen-build-sha", "e2e");
    } catch {}
  });
  return page;
}

/** SSR-разметка видна раньше гидратации — кликать можно, когда React повесил обработчики. */
async function waitHydrated(page, testId, timeout = 240000) {
  await page.waitForFunction(
    (id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return Boolean(el && Object.keys(el).some((k) => k.startsWith("__reactProps")));
    },
    testId,
    { timeout },
  );
}

async function shot(locator, file) {
  await locator.page().waitForTimeout(350);
  await locator.screenshot({ path: path.join(EVID, file), animations: "disabled" });
}

/** Геометрия блока: строки заголовка, ряд шкалы, размеры кнопок, горизонтальная прокрутка. */
async function measure(page) {
  return page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const title = document.querySelector('[data-testid="nps-title"]');
    const range = document.createRange();
    range.selectNodeContents(title);
    const lineTops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
    const scores = [1, 2, 3, 4, 5].map((n) => rect(document.querySelector(`[data-testid="nps-score-${n}"]`)));
    return {
      viewport: window.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      titleText: title.textContent.trim(),
      titleLines: lineTops.size,
      scores,
      close: rect(document.querySelector('[data-testid="nps-close"]')),
      banner: rect(document.querySelector('[data-testid="nps-banner"]')),
      recommendSubmit: rect(document.querySelector('[data-testid="nps-recommend-submit"]')),
      reviewSubmit: rect(document.querySelector('[data-testid="nps-review-submit"]')),
      email: rect(document.querySelector('[data-testid="nps-recommend-email"]')),
      message: rect(document.querySelector('[data-testid="nps-recommend-message"]')),
      consent: rect(document.querySelector('[data-testid="nps-review-consent"]')),
    };
  });
}

function sameRow(rects) {
  return rects.every(Boolean) && new Set(rects.map((r) => r.y)).size === 1;
}

async function openPreview(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  const banner = page.getByTestId("nps-banner");
  await banner.waitFor({ timeout: 240000 });
  try {
    await waitHydrated(page, "nps-score-5", 90000);
  } catch {
    // Dev-сервер иногда теряет чанк, если параллельно компилирует другой
    // маршрут: страница остаётся без гидратации. Одна перезагрузка — и
    // счётчик в результатах, чтобы это было видно.
    results.hydrationRetries = (results.hydrationRetries || 0) + 1;
    console.log(`RETRY hydration on ${url}`);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
    await banner.waitFor({ timeout: 240000 });
    await waitHydrated(page, "nps-score-5");
  }
  return banner;
}

async function pickScore(page, n) {
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/nps") && r.request().method() === "POST", { timeout: 180000 });
  await page.getByTestId(`nps-score-${n}`).click();
  const res = await saved;
  const body = await res.json();
  return { status: res.status(), id: body.id };
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--use-gl=swiftshader"] });
  try {
    // ---------- Свежая организация: мгновенная регистрация руководителя ----------
    const site = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU" });
    const reg = await site.request.post(`${BASE}/api/auth/instant-register`, { data: { email: MANAGER, consent: true }, timeout: 240000 });
    const regBody = await reg.json().catch(() => null);
    check("setup", "мгновенная регистрация руководителя → новая организация и вход", reg.status() === 200 && regBody && regBody.created === true, { status: reg.status(), body: regBody });
    const [me] = await sql(
      'select u.id, u."organizationId", u."npsAskedAt", u."legalVersion", o."createdAt", o."isDemo" from "User" u join "Organization" o on o.id = u."organizationId" where u.email = $1',
      [MANAGER],
    );
    const ORG = me.organizationId;
    const hash = bcrypt.hashSync(PASSWORD, 10);
    // Анкета заполнена (иначе поверх — «Завершите регистрацию»), пароль известен для второго входа.
    await sql('update "Organization" set name = $1 where id = $2', [ORG_NAME, ORG]);
    await sql('update "User" set name = $1, phone = $2, "showWhatsNew" = false, "passwordHash" = $3 where id = $4', ["Анна Смирнова", "+79990001122", hash, me.id]);
    // Второй руководитель и повар той же организации — для «у организации уже есть отзыв» и правил показа.
    for (const [id, email, name, role] of [
      [`e2e2${RUN}`, SECOND, "Борис Второй", "manager"],
      [`e2e3${RUN}`, COOK, "Пётр Повар", "cook"],
    ]) {
      await sql(
        'insert into "User" (id, email, name, phone, "passwordHash", role, "organizationId", "journalAccessMigrated", "showWhatsNew", "legalVersion") values ($1,$2,$3,$4,$5,$6,$7,true,false,$8)',
        [id, email, name, "+79990002233", hash, role, ORG, me.legalVersion],
      );
    }
    const ageDays = (Date.now() - new Date(me.createdAt).getTime()) / 86400000;
    check("setup", "организация свежая (моложе 14 дней), не демо; npsAskedAt пуст", ageDays < 1 && me.isDemo === false && me.npsAskedAt === null, { ageDays: Number(ageDays.toFixed(4)), isDemo: me.isDemo, npsAskedAt: me.npsAskedAt });

    // ---------- AC1: без ?nps=1 блока нет, с ?nps=1 — есть; просмотр не «спросили» ----------
    const page = await quietPage(site);
    const npsPosts = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/nps") && r.method() === "POST") npsPosts.push(r.postDataJSON());
    });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 240000 });
    await page.waitForTimeout(2500);
    check("AC1", "/dashboard без ?nps=1 в свежей организации — блока нет (правила 14/90 дней на месте)", (await page.getByTestId("nps-banner").count()) === 0);

    let banner = await openPreview(page, "/dashboard?nps=1");
    let m = await measure(page);
    check("AC1", "/dashboard?nps=1 — блок «Посоветуете WeSetup коллегам?» виден руководителю свежей организации", m.titleText === "Посоветуете WeSetup коллегам?", { url: page.url() });
    check("AC4", "1440: заголовок в одну строку, шкала 1–5 в ряд", m.titleLines === 1 && sameRow(m.scores), { titleLines: m.titleLines, scores: m.scores });
    await shot(banner, "ac1-1440-preview.png");
    await page.getByTestId("nps-close").click();
    await page.waitForTimeout(1500);
    const [afterClose] = await sql('select "npsAskedAt" from "User" where id = $1', [me.id]);
    check("AC1", "крестик без ответа: блок закрыт, «не сейчас» не отправлено, npsAskedAt не изменился", (await page.getByTestId("nps-banner").count()) === 0 && npsPosts.length === 0 && afterClose.npsAskedAt === null, {
      postsToApiNps: npsPosts,
      npsAskedAt: afterClose.npsAskedAt,
    });
    banner = await openPreview(page, "/dashboard?nps=1");
    const [afterReopen] = await sql('select "npsAskedAt" from "User" where id = $1', [me.id]);
    check("AC1", "повторное открытие ?nps=1 — блок снова виден, npsAskedAt всё ещё пуст", (await banner.count()) === 1 && afterReopen.npsAskedAt === null, { npsAskedAt: afterReopen.npsAskedAt });

    // ---------- AC4: 390 px ----------
    await page.setViewportSize({ width: 390, height: 844 });
    banner = await openPreview(page, "/dashboard?nps=1");
    m = await measure(page);
    check("AC4", "390: заголовок в одну строку", m.titleLines === 1, { titleLines: m.titleLines, banner: m.banner });
    check("AC4", "390: шкала 1–5 в один ряд, кнопки ≥ 48 px", sameRow(m.scores) && m.scores.every((r) => r.h >= 48 && r.w >= 44), { scores: m.scores });
    check("AC4", "390: крестик ≥ 48 px, горизонтальной прокрутки нет", m.close.h >= 48 && m.close.w >= 48 && m.pageScrollWidth <= m.viewport, { close: m.close, scrollWidth: m.pageScrollWidth });
    await shot(banner, "ac4-390-ask.png");

    // ---------- AC2: 4 → «Оставить отзыв» (390) ----------
    const first = await pickScore(page, 4);
    const [resp1] = await sql('select score, scale from "NpsResponse" where id = $1', [first.id]);
    const [answered] = await sql('select "npsAskedAt" from "User" where id = $1', [me.id]);
    check("AC1", "после ответа (4) — ответ сохранён, npsAskedAt поставлен (как раньше)", first.status === 200 && resp1 && resp1.score === 4 && resp1.scale === 5 && answered.npsAskedAt !== null, { resp1, npsAskedAt: answered.npsAskedAt });
    await page.getByTestId("nps-recommend-form").waitFor();
    const message = page.getByTestId("nps-recommend-message");
    check("AC2", "4–5: одно поле текста с текстом по умолчанию для письма и отзыва", (await message.inputValue()) === DEFAULT_TEXT, { value: await message.inputValue() });
    m = await measure(page);
    check("AC4", "390: «Отправить коллеге» и «Оставить отзыв» ≥ 48 px, на всю ширину, без горизонтальной прокрутки", m.recommendSubmit.h >= 48 && m.reviewSubmit.h >= 48 && m.recommendSubmit.w === m.reviewSubmit.w && m.pageScrollWidth <= m.viewport, {
      recommendSubmit: m.recommendSubmit,
      reviewSubmit: m.reviewSubmit,
      email: m.email,
      scrollWidth: m.pageScrollWidth,
    });
    const labels = {
      recommend: (await page.getByTestId("nps-recommend-submit").textContent()).trim(),
      review: (await page.getByTestId("nps-review-submit").textContent()).trim(),
      consent: (await banner.locator("label", { has: page.getByTestId("nps-review-consent") }).textContent()).trim(),
      consentChecked: await page.getByTestId("nps-review-consent").isChecked(),
    };
    check("AC2", "кнопки «Отправить коллеге» и «Оставить отзыв», галка согласия с текстом из «Баланс и бонусы» (включена, как там)", labels.recommend === "Отправить коллеге" && labels.review === "Оставить отзыв" && labels.consent === "Согласен на публикацию отзыва, имени и заведения на сайте wesetup.ru и в соцсетях." && labels.consentChecked === true, labels);
    await shot(banner, "ac4-390-form.png");

    const reviewPosts = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/nps/review")) reviewPosts.push(r.postDataJSON());
    });
    await message.fill("Коротко");
    await page.getByTestId("nps-review-submit").click();
    const shortErr = (await banner.getByRole("alert").textContent()) || "";
    await message.fill(DEFAULT_TEXT);
    await page.getByTestId("nps-review-consent").uncheck();
    await page.getByTestId("nps-review-submit").click();
    const consentErr = (await banner.getByRole("alert").textContent()) || "";
    check("AC2", "короткий текст и снятая галка — понятная ошибка, запрос не уходит", shortErr.includes("от 30 символов") && consentErr.includes("Без согласия на публикацию") && reviewPosts.length === 0, { shortErr, consentErr, requests: reviewPosts.length });
    await page.getByTestId("nps-review-consent").check();
    const reviewRes = page.waitForResponse((r) => r.url().endsWith("/api/nps/review"), { timeout: 180000 });
    await page.getByTestId("nps-review-submit").click();
    const reviewResponse = await reviewRes;
    const reviewBody = await reviewResponse.json();
    const done = ((await page.getByTestId("nps-done").textContent()) || "").trim();
    check("AC2", "«Оставить отзыв» → 200 и итог «Спасибо! Отзыв отправлен на проверку, после одобрения начислим баллы»", reviewResponse.status() === 200 && reviewBody.ok === true && done === DONE_REVIEW, {
      status: reviewResponse.status(),
      request: reviewResponse.request().postDataJSON(),
      body: reviewBody,
      done,
    });
    await shot(banner, "ac2-390-review-done.png");
    await page.waitForTimeout(5600);
    check("AC2", "блок скрывается после итога", (await page.getByTestId("nps-banner").count()) === 0);

    const reviews = await sql('select id, status, rating, text, "consentPublic", "authorName", place, kind, "showOnLanding", "userId" from "CustomerReview" where "organizationId" = $1', [ORG]);
    const review = reviews[0];
    check("AC2", "в базе CustomerReview: pending, rating 4 из опроса, тот же текст, согласие, автор и заведение", reviews.length === 1 && review.id === reviewBody.reviewId && review.status === "pending" && review.rating === 4 && review.text === DEFAULT_TEXT && review.consentPublic === true && review.authorName === "Анна Смирнова" && review.place === ORG_NAME && review.kind === "text" && review.userId === me.id, review);
    const audit1 = await sql('select "entityId", details, "userId" from "AuditLog" where action = $1 and "organizationId" = $2', ["nps.review", ORG]);
    check("AC2", "AuditLog nps.review: ответ → отзыв (id отзыва и оценка, без текста)", audit1.length === 1 && audit1[0].entityId === first.id && audit1[0].details.customerReviewId === review.id && audit1[0].details.npsScore === 4 && !("text" in audit1[0].details), audit1);

    // ---------- AC2: второй отзыв при активном — не создаётся (UI, 1440) ----------
    await page.setViewportSize({ width: 1440, height: 900 });
    banner = await openPreview(page, "/dashboard?nps=1");
    const second = await pickScore(page, 5);
    await page.getByTestId("nps-recommend-form").waitFor();
    m = await measure(page);
    check("AC4", "1440: заголовок в строку со шкалой, кнопки действий в одной колонке справа", m.titleLines === 1 && sameRow(m.scores) && m.recommendSubmit.x === m.reviewSubmit.x && m.recommendSubmit.w === m.reviewSubmit.w && m.email.y === m.recommendSubmit.y, {
      recommendSubmit: m.recommendSubmit,
      reviewSubmit: m.reviewSubmit,
      email: m.email,
      message: m.message,
    });
    await shot(banner, "ac4-1440-form.png");
    const dupRes = page.waitForResponse((r) => r.url().endsWith("/api/nps/review"), { timeout: 180000 });
    await page.getByTestId("nps-review-submit").click();
    const dup = await dupRes;
    const dupBody = await dup.json();
    const dupAlert = ((await banner.getByRole("alert").textContent()) || "").trim();
    const [{ n: reviewCount }] = await sql('select count(*)::int n from "CustomerReview" where "organizationId" = $1', [ORG]);
    check("AC2", "отзыв уже на проверке → 409 «Ваш отзыв уже на проверке — дождитесь решения», второй не создан", dup.status() === 409 && dupAlert === "Ваш отзыв уже на проверке — дождитесь решения" && reviewCount === 1, { status: dup.status(), body: dupBody, alert: dupAlert, reviewCount });
    await shot(banner, "ac2-1440-review-pending.png");

    // ---------- AC3: «Отправить коллеге» — как раньше ----------
    const email = page.getByTestId("nps-recommend-email");
    await email.fill(MANAGER);
    let recRes = page.waitForResponse((r) => r.url().endsWith("/api/nps/recommend"), { timeout: 180000 });
    await page.getByTestId("nps-recommend-submit").click();
    const own = await recRes;
    const ownAlert = ((await banner.getByRole("alert").textContent()) || "").trim();
    check("AC3", "своя почта — 400 «Это ваша почта…» у поля (как раньше)", own.status() === 400 && ownAlert.startsWith("Это ваша почта"), { status: own.status(), alert: ownAlert });
    await email.fill(COLLEAGUE);
    recRes = page.waitForResponse((r) => r.url().endsWith("/api/nps/recommend"), { timeout: 180000 });
    await page.getByTestId("nps-recommend-submit").click();
    const sent = await recRes;
    const sentBody = await sent.json();
    const sentDone = ((await page.getByTestId("nps-done").textContent()) || "").trim();
    check("AC3", "«Отправить коллеге» → 200, «Спасибо! Письмо отправлено»", sent.status() === 200 && sentBody.ok === true && sentDone === "Спасибо! Письмо отправлено", {
      status: sent.status(),
      request: sent.request().postDataJSON(),
      body: sentBody,
      done: sentDone,
    });
    await page.waitForTimeout(3000);
    check("AC3", "блок скрывается через 2,5 с (как раньше)", (await page.getByTestId("nps-banner").count()) === 0);
    const invites = await sql('select email, "invitedByUserId" from "ReferralInvite" where "organizationId" = $1', [ORG]);
    const audit2 = await sql('select "entityId", details from "AuditLog" where action = $1 and "organizationId" = $2', ["nps.recommend", ORG]);
    check("AC3", "ReferralInvite и AuditLog nps.recommend записаны (кому, оценка, доставка)", invites.length === 1 && invites[0].email === COLLEAGUE && audit2.length === 1 && audit2[0].entityId === second.id && audit2[0].details.colleagueEmail === COLLEAGUE && audit2[0].details.npsScore === 5, { invites, audit2 });

    // ---------- AC2: у организации уже есть отзыв на проверке (другой руководитель, API) ----------
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const l2 = await login(other, SECOND, PASSWORD);
    const a2 = await other.request.post(`${BASE}/api/nps`, { data: { score: 5, scale: 5 } });
    const a2Body = await a2.json();
    const r2 = await other.request.post(`${BASE}/api/nps/review`, { data: { responseId: a2Body.id, text: DEFAULT_TEXT, consent: true } });
    const r2Body = await r2.json();
    const [{ n: reviewCount2 }] = await sql('select count(*)::int n from "CustomerReview" where "organizationId" = $1', [ORG]);
    check("AC2", "другой руководитель той же организации → 409 «У вашей организации уже есть отзыв на проверке…», второй не создан", l2.session && r2.status() === 409 && r2Body.error === "У вашей организации уже есть отзыв на проверке — дождитесь решения" && reviewCount2 === 1, { login: l2, status: r2.status(), body: r2Body, reviewCount: reviewCount2 });
    // Правило показа без ?nps=1 не изменилось: организации «30 дней», вопроса не было → блок сам.
    await sql(`update "Organization" set "createdAt" = now() - interval '30 days' where id = $1`, [ORG]);
    await sql('update "User" set "npsAskedAt" = null where email = $1', [SECOND]);
    const otherPage = await quietPage(other);
    const otherPosts = [];
    otherPage.on("request", (r) => {
      if (r.url().endsWith("/api/nps") && r.method() === "POST") otherPosts.push(r.postDataJSON());
    });
    const autoBanner = await openPreview(otherPage, "/dashboard");
    await otherPage.getByTestId("nps-close").click();
    await otherPage.waitForTimeout(1500);
    const [secondAsked] = await sql('select "npsAskedAt" from "User" where email = $1', [SECOND]);
    check("AC1", "без ?nps=1 правило прежнее: организация старше 14 дней → блок сам; крестик → «не сейчас», npsAskedAt поставлен", (await autoBanner.count()) === 0 && otherPosts.length === 1 && otherPosts[0].dismiss === true && secondAsked.npsAskedAt !== null, { posts: otherPosts, npsAskedAt: secondAsked.npsAskedAt });
    await sql(`update "Organization" set "createdAt" = $1 where id = $2`, [me.createdAt, ORG]);
    // 1–3 — «Что улучшить?» как раньше (общее состояние отправки переписано — проверяем и эту ветку).
    const lowBanner = await openPreview(otherPage, "/dashboard?nps=1");
    const low = await pickScore(otherPage, 2);
    await otherPage.getByTestId("nps-improve-form").waitFor();
    const noRecommend = (await otherPage.getByTestId("nps-recommend-form").count()) === 0;
    await otherPage.getByTestId("nps-improve-comment").fill("Хочется выгрузку всех журналов одним архивом");
    const patch = otherPage.waitForResponse((r) => r.url().endsWith("/api/nps") && r.request().method() === "PATCH", { timeout: 180000 });
    await otherPage.getByTestId("nps-improve-submit").click();
    const patched = await patch;
    const lowDone = ((await otherPage.getByTestId("nps-done").textContent()) || "").trim();
    const [lowRow] = await sql('select score, scale, comment from "NpsResponse" where id = $1', [low.id]);
    check("regress", "1–3 — «Что улучшить?» без письма и отзыва, комментарий сохранён (как раньше)", noRecommend && patched.status() === 200 && lowDone === "Спасибо! Учтём" && lowRow.score === 2 && lowRow.scale === 5 && lowRow.comment === "Хочется выгрузку всех журналов одним архивом", { noRecommend, status: patched.status(), done: lowDone, lowRow, banner: await lowBanner.count() });
    await other.close();

    // ---------- Повар с ?nps=1 — блока нет (только руководству) ----------
    const cook = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU" });
    const l3 = await login(cook, COOK, PASSWORD);
    const cookPage = await quietPage(cook);
    await cookPage.goto(`${BASE}/journals?nps=1`, { waitUntil: "load", timeout: 240000 });
    await cookPage.waitForTimeout(2500);
    check("AC1", "сотрудник (повар) с ?nps=1 — блока нет: показ только руководству, как раньше", l3.session && (await cookPage.getByTestId("nps-banner").count()) === 0, { login: l3, url: cookPage.url() });
    await cook.close();

    // ---------- ROOT: модерация «из опроса», /root/nps «оставил отзыв», баллы и главная ----------
    const root = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU" });
    const l4 = await login(root, env.ROOT_EMAIL, env.ROOT_PASSWORD);
    const rootPage = await quietPage(root);
    await rootPage.goto(`${BASE}/root/reviews`, { waitUntil: "domcontentloaded", timeout: 240000 });
    const card = rootPage.locator("article", { hasText: "Анна Смирнова" });
    await card.waitFor({ timeout: 240000 });
    const pills = await rootPage.getByTestId("review-from-survey").count();
    check("AC2", "модерация ROOT: отзыв на проверке с пометкой «из опроса»", l4.session && (await card.getByTestId("review-from-survey").textContent()).trim() === "из опроса" && pills === 1, { login: l4, pills });
    await shot(card, "ac2-1440-root-reviews.png");

    await rootPage.goto(`${BASE}/root/nps`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await rootPage.getByTestId("nps-value").first().waitFor({ timeout: 240000 });
    // Список — 50 последних ответов всех организаций (в базе есть и прошлые прогоны),
    // поэтому сверяем пометки с базой: «оставил отзыв» — ровно у ответов со строкой nps.review.
    const listed = await sql('select id from "NpsResponse" order by "createdAt" desc limit 50');
    const listedIds = listed.map((r) => r.id);
    const reviewedRows = await sql('select distinct "entityId" from "AuditLog" where action = $1 and "entityId" = any($2)', ["nps.review", listedIds]);
    const reviewedIds = reviewedRows.map((r) => r.entityId);
    const reviewedItem = rootPage.locator("li", { has: rootPage.getByTestId("nps-review-left") });
    const reviewedCount = await reviewedItem.count();
    const reviewedTexts = await reviewedItem.allTextContents();
    const thisRunIds = [first.id, second.id, a2Body.id, low.id];
    check("AC2", "/root/nps: «оставил отзыв» — ровно у ответов, по которым оставлен отзыв; в этом прогоне — только у ответа 4 из 5, не у письма и не у отказов", reviewedCount === reviewedIds.length && reviewedIds.includes(first.id) && !reviewedIds.includes(second.id) && !reviewedIds.includes(a2Body.id) && !reviewedIds.includes(low.id) && reviewedTexts.some((t) => t.includes("4 из 5") && t.includes(ORG_NAME)), {
      reviewedCount,
      reviewedInDb: reviewedIds.length,
      thisRunMarked: thisRunIds.filter((id) => reviewedIds.includes(id)),
      reviewedTexts,
    });
    await shot(rootPage.locator("ul").filter({ has: rootPage.getByTestId("nps-review-left") }), "ac2-1440-root-nps.png");

    const approve = await root.request.post(`${BASE}/api/root/reviews/${review.id}/approve`, { data: { kind: "text" } });
    const approveBody = await approve.json();
    const ledger = await sql('select amount, kind, "customerReviewId" from "BalanceTransaction" where "organizationId" = $1', [ORG]);
    check("AC2", "после одобрения ROOT — баллы по правилам программы (текст — 300)", approve.status() === 200 && ledger.length === 1 && ledger[0].amount === 300 && ledger[0].kind === "review_reward" && ledger[0].customerReviewId === review.id, { status: approve.status(), body: approveBody, ledger });
    // Главная — глазами гостя (без сессии).
    const guest = await browser.newContext({ locale: "ru-RU" });
    const landing = await guest.request.get(`${BASE}/`, { timeout: 300000 });
    const landingHtml = await landing.text();
    await guest.close();
    check("AC2", "одобренный отзыв из опроса — на главной (блок «Отзывы»)", landing.status() === 200 && landingHtml.includes("проверки проходим спокойно") && landingHtml.includes("Анна Смирнова"), { status: landing.status() });
    await root.close();

    // Одобренный отзыв — второй не примут (правило программы), через API опроса.
    const a3 = await site.request.post(`${BASE}/api/nps`, { data: { score: 5, scale: 5 } });
    const r3 = await site.request.post(`${BASE}/api/nps/review`, { data: { responseId: (await a3.json()).id, text: DEFAULT_TEXT, consent: true } });
    const r3Body = await r3.json();
    check("AC2", "после одобрения — «Отзыв уже принят. Спасибо!» (правила программы не менялись)", r3.status() === 409 && r3Body.error === "Отзыв уже принят. Спасибо!", { status: r3.status(), body: r3Body });
    await site.close();

    // ---------- Мини-приложение: /mini?nps=1 → главная с блоком ----------
    const mini = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      locale: "ru-RU",
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const l5 = await login(mini, MANAGER, PASSWORD);
    const miniPage = await quietPage(mini);
    const miniPosts = [];
    miniPage.on("request", (r) => {
      if (r.url().endsWith("/api/nps") && r.method() === "POST") miniPosts.push(r.postDataJSON());
    });
    await miniPage.goto(`${BASE}/mini?nps=1`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await miniPage.waitForURL((u) => u.pathname === "/dashboard" && u.searchParams.get("nps") === "1", { timeout: 240000 });
    const miniBanner = miniPage.getByTestId("nps-banner");
    await miniBanner.waitFor({ timeout: 240000 });
    await waitHydrated(miniPage, "nps-score-5");
    const inShell = await miniPage.locator("#mini-root").count();
    m = await measure(miniPage);
    check("AC1", "мини-приложение: /mini?nps=1 → /dashboard?nps=1 в оболочке, блок виден сразу", l5.session && inShell === 1 && m.titleText === "Посоветуете WeSetup коллегам?", { login: l5, url: miniPage.url(), inShell });
    check("AC4", "мини 390: заголовок в одну строку, шкала в ряд, кнопки ≥ 48 px, без прокрутки вбок", m.titleLines === 1 && sameRow(m.scores) && m.scores.every((r) => r.h >= 48) && m.close.h >= 48 && m.pageScrollWidth <= m.viewport, { titleLines: m.titleLines, scores: m.scores, close: m.close, scrollWidth: m.pageScrollWidth });
    await shot(miniBanner, "mini-390-preview.png");
    await miniPage.getByTestId("nps-close").click();
    await miniPage.waitForTimeout(1200);
    check("AC1", "мини: крестик в режиме просмотра не шлёт «не сейчас»", miniPosts.length === 0 && (await miniBanner.count()) === 0, { posts: miniPosts });
    await mini.close();

    // Форма 4–5 в оболочке мини-приложения (только вид: отзыв этого руководителя уже одобрен).
    // Новый контекст и снова вход через /mini?nps=1: жёсткая перезагрузка /dashboard в оболочке
    // после регистрации /mini-sw.js в dev уходит в цикл перезагрузок — так же на базовом коммите,
    // к задаче не относится (см. evidence.md, «Открытые вопросы»).
    const mini2 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      locale: "ru-RU",
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    await login(mini2, MANAGER, PASSWORD);
    const miniPage2 = await quietPage(mini2);
    await miniPage2.goto(`${BASE}/mini?nps=1`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await miniPage2.waitForURL((u) => u.pathname === "/dashboard" && u.searchParams.get("nps") === "1", { timeout: 240000 });
    const miniForm = miniPage2.getByTestId("nps-banner");
    await miniForm.waitFor({ timeout: 240000 });
    await waitHydrated(miniPage2, "nps-score-5");
    await pickScore(miniPage2, 5);
    await miniPage2.getByTestId("nps-recommend-form").waitFor();
    m = await measure(miniPage2);
    check("AC4", "мини 390: форма 4–5 — «Отправить коллеге» и «Оставить отзыв» ≥ 48 px, без прокрутки вбок", m.recommendSubmit.h >= 48 && m.reviewSubmit.h >= 48 && m.pageScrollWidth <= m.viewport, { recommendSubmit: m.recommendSubmit, reviewSubmit: m.reviewSubmit, scrollWidth: m.pageScrollWidth });
    await shot(miniForm, "mini-390-form.png");
    await mini2.close();
  } catch (error) {
    check("run", "сценарий дошёл до конца", false, { error: String(error && error.stack ? error.stack : error) });
  } finally {
    await browser.close();
    results.finishedAt = new Date().toISOString();
    results.summary = { total: results.checks.length, passed: results.checks.filter((c) => c.ok).length, failed: results.checks.filter((c) => !c.ok).length };
    fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.summary));
  }
})();
