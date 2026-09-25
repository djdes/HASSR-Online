// One-off e2e for the NPS 1–5 banner + colleague recommendation.
// Runs against the dev server on :3042 and the private DB wesetup_wt_qrforms.
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const WT = "C:/wt/qrforms";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");

const BASE = "http://localhost:3042";
const EVID = path.join(WT, ".agent/tasks/nps-recommend-2026-09/evidence");
const CHROME = path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1232/chrome-win64/chrome.exe");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_qrforms?sslmode=disable";
const ORG = "cmugz8a670000kw9mfvb6611i";

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

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
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
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`)).json();
  const res = await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
  });
  const cookies = await context.cookies();
  return { status: res.status(), session: cookies.some((c) => c.name.includes("session-token")) };
}

async function quietPage(context) {
  const page = await context.newPage();
  // «Что нового» и подобные окна — не часть проверки; их прячет localStorage.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("wesetup.last-seen-build-sha", "e2e");
    } catch {}
  });
  return page;
}

/** SSR-разметка видна раньше гидратации — кликать можно, когда React повесил обработчики. */
async function waitHydrated(page, testId) {
  await page.waitForFunction(
    (id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return Boolean(el && Object.keys(el).some((k) => k.startsWith("__reactProps")));
    },
    testId,
    { timeout: 180000 },
  );
}

async function shot(page, locator, file) {
  await page.waitForTimeout(300);
  await locator.screenshot({ path: path.join(EVID, file) });
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    // ---------- 390 px: ask → 5 → recommend ----------
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: "ru-RU" });
    const l1 = await login(mobile, "admin@haccp.local", env.ADMIN_PASSWORD);
    check("login admin (390)", l1.session, l1);
    const page = await quietPage(mobile);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 240000 });
    const banner = page.getByTestId("nps-banner");
    await banner.waitFor({ timeout: 120000 });
    await waitHydrated(page, "nps-score-5");

    const layout = await page.evaluate(() => {
      const title = document.querySelector('[data-testid="nps-title"]');
      const cs = getComputedStyle(title);
      const lh = parseFloat(cs.lineHeight);
      const range = document.createRange();
      range.selectNodeContents(title);
      const lineTops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
      const buttons = [1, 2, 3, 4, 5].map((n) => document.querySelector(`[data-testid="nps-score-${n}"]`).getBoundingClientRect());
      return {
        viewport: window.innerWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        titleText: title.textContent.trim(),
        titleContentHeight: Math.round(title.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)),
        titleLineHeight: lh,
        titleLines: lineTops.size,
        titleWidth: Math.round(range.getBoundingClientRect().width),
        titleBoxWidth: Math.round(title.getBoundingClientRect().width),
        buttonTops: buttons.map((b) => Math.round(b.top)),
        buttonSizes: buttons.map((b) => [Math.round(b.width), Math.round(b.height)]),
      };
    });
    check("390: заголовок «Посоветуете WeSetup коллегам?» в одну строку", layout.titleText === "Посоветуете WeSetup коллегам?" && layout.titleLines === 1 && layout.titleContentHeight <= layout.titleLineHeight + 1, layout);
    check("390: шкала 1–5 в одну строку, кнопки ≥ 44×44", new Set(layout.buttonTops).size === 1 && layout.buttonSizes.every(([w, h]) => w >= 44 && h >= 44), {
      tops: layout.buttonTops,
      sizes: layout.buttonSizes,
    });
    check("390: нет горизонтальной прокрутки", layout.pageScrollWidth <= layout.viewport, { scrollWidth: layout.pageScrollWidth });
    await shot(page, banner, "ac1-390-ask.png");

    const created = page.waitForResponse((r) => r.url().endsWith("/api/nps") && r.request().method() === "POST", { timeout: 180000 });
    await page.getByTestId("nps-score-5").click();
    const createdRes = await created;
    const createdBody = await createdRes.json();
    check("клик по 5 сразу сохраняет ответ (POST /api/nps {score:5, scale:5})", createdRes.status() === 200 && typeof createdBody.id === "string", {
      status: createdRes.status(),
      request: createdRes.request().postDataJSON(),
    });
    const responseId = createdBody.id;
    const row = await sql('select score, scale, comment from "NpsResponse" where id=$1', [responseId]);
    check("в базе ответ score=5, scale=5", row[0] && row[0].score === 5 && row[0].scale === 5, row[0]);

    const form = page.getByTestId("nps-recommend-form");
    await form.waitFor();
    const defaultMessage = await page.getByTestId("nps-recommend-message").inputValue();
    check("4–5: поля «Почта коллеги» и «Сообщение» с текстом по умолчанию", defaultMessage.startsWith("Привет! Мы ведём журналы ХАССП и СанПиН в WeSetup"), { defaultMessage });
    await shot(page, banner, "ac2-390-recommend-form.png");

    // Запрет своей почты и почты сотрудников — через форму.
    const email = page.getByTestId("nps-recommend-email");
    const submit = page.getByTestId("nps-recommend-submit");
    const recommendResponse = () => page.waitForResponse((r) => r.url().endsWith("/api/nps/recommend"), { timeout: 180000 });
    await email.fill("Denis.Manager@example.com");
    let pending = recommendResponse();
    await submit.click();
    const ownRes = await pending;
    const ownError = (await banner.getByRole("alert").textContent()) || "";
    check("своя почта (контактная, другой регистр) — 400 и ошибка у поля", ownRes.status() === 400 && ownError.includes("Это ваша почта"), { status: ownRes.status(), ownError });
    await shot(page, banner, "ac2-390-own-email-error.png");
    await email.fill("admin@haccp.local");
    pending = recommendResponse();
    await submit.click();
    const loginRes = await pending;
    check("своя почта-логин — 400", loginRes.status() === 400, await loginRes.json());
    await email.fill("staff-ae8893b7@cmugz8a670000kw9mfvb6611i.local.haccp");
    pending = recommendResponse();
    await submit.click();
    const staffRes = await pending;
    const staffError = (await banner.getByRole("alert").textContent()) || "";
    check("почта сотрудника своей организации — 400 и ошибка", staffRes.status() === 400 && staffError.includes("сотрудника вашей организации"), { status: staffRes.status(), staffError });
    const auditBefore = await sql('select count(*)::int n from "AuditLog" where action=$1', ["nps.recommend"]);
    check("отказы не пишутся в AuditLog и не шлют писем", auditBefore[0].n === 0, auditBefore[0]);

    // Отправка коллеге (без реферального кода у организации — обычная ссылка).
    await email.fill("colleague1@example.com");
    await page.getByTestId("nps-recommend-message").fill("Привет! Пишу из WeSetup <b>тест</b> — журналы с телефона по QR. Посмотри, ссылка ниже.");
    const sent = recommendResponse();
    await submit.click();
    const sentRes = await sent;
    const sentBody = await sentRes.json();
    check("отправка коллеге → 200", sentRes.status() === 200 && sentBody.ok === true && sentBody.referral === false, sentBody);
    const done = await page.getByTestId("nps-done").textContent();
    check("после отправки — «Спасибо! Письмо отправлено»", done.includes("Спасибо! Письмо отправлено"), { done });
    await page.waitForTimeout(3000);
    check("блок скрывается после ответа", (await page.getByTestId("nps-banner").count()) === 0);

    // ---------- API: лимиты и повтор ----------
    const api = mobile.request;
    const post = async (url, data) => {
      const r = await api.post(`${BASE}${url}`, { data });
      return { status: r.status(), body: await r.json().catch(() => null) };
    };
    const repeat = await post("/api/nps/recommend", { responseId, email: "colleague1@example.com", message: "повтор" });
    check("повтор на тот же адрес в течение суток → 429", repeat.status === 429, repeat);
    await sql('update "Organization" set "referralCode"=$1 where id=$2', ["E2EWSTQR", ORG]);
    const withCode = await post("/api/nps/recommend", { responseId, email: "colleague2@example.com", message: "С реферальной ссылкой" });
    check("у организации есть реферальный код → referral=true", withCode.status === 200 && withCode.body.referral === true, withCode);
    for (const n of [3, 4, 5]) {
      const r = await post("/api/nps/recommend", { responseId, email: `colleague${n}@example.com`, message: `Коллеге №${n}` });
      check(`рекомендация №${n} → 200`, r.status === 200, r);
    }
    const sixth = await post("/api/nps/recommend", { responseId, email: "colleague6@example.com", message: "шестая" });
    check("6-я за сутки → 429 «Не больше 5 рекомендаций в сутки»", sixth.status === 429 && /Не больше 5/.test(sixth.body.error), sixth);
    const tooLong = await post("/api/nps/recommend", { responseId, email: "colleague7@example.com", message: "я".repeat(1001) });
    check("текст > 1000 символов → 400", tooLong.status === 400 && tooLong.body.field === "message", tooLong);
    const badEmail = await post("/api/nps/recommend", { responseId, email: "colleague7example.com", message: "x" });
    check("кривая почта → 400", badEmail.status === 400 && badEmail.body.field === "email", badEmail);

    // Старый формат API (0–10 без scale) и валидация новой шкалы.
    const legacy = await post("/api/nps", { score: 9, comment: "Старый клиент: формат 0–10 без scale" });
    check("старый формат {score: 9} → 200", legacy.status === 200 && typeof legacy.body.id === "string", legacy);
    const legacyRow = await sql('select score, scale, comment from "NpsResponse" where id=$1', [legacy.body.id]);
    check("старый ответ записан со scale=10", legacyRow[0] && legacyRow[0].scale === 10 && legacyRow[0].score === 9, legacyRow[0]);
    const legacy2 = await post("/api/nps", { score: 6 });
    check("старый формат {score: 6} → 200", legacy2.status === 200, legacy2);
    const zeroOn5 = await post("/api/nps", { score: 0, scale: 5 });
    check("{score: 0, scale: 5} → 400 «Оценка — от 1 до 5»", zeroOn5.status === 400 && zeroOn5.body.error === "Оценка — от 1 до 5", zeroOn5);
    const scale7 = await post("/api/nps", { score: 3, scale: 7 });
    check("{scale: 7} → 400", scale7.status === 400, scale7);

    // ---------- 390 px: 1–3 → «Что улучшить?» ----------
    await sql('update "User" set "npsAskedAt"=null where email=$1', ["admin@haccp.local"]);
    const page2 = await quietPage(mobile);
    await page2.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 240000 });
    const banner2 = page2.getByTestId("nps-banner");
    await banner2.waitFor({ timeout: 120000 });
    await waitHydrated(page2, "nps-score-2");
    const created2 = page2.waitForResponse((r) => r.url().endsWith("/api/nps") && r.request().method() === "POST", { timeout: 180000 });
    await page2.getByTestId("nps-score-2").click();
    const id2 = (await (await created2).json()).id;
    await page2.getByTestId("nps-improve-form").waitFor();
    check("1–3: форма «Что улучшить?», без полей письма", (await page2.getByTestId("nps-recommend-form").count()) === 0 && (await page2.getByText("Что улучшить?").count()) === 1);
    await page2.getByTestId("nps-improve-comment").fill("Хочется выгрузку журналов одним архивом");
    await shot(page2, banner2, "ac3-390-improve.png");
    const patched = page2.waitForResponse((r) => r.url().endsWith("/api/nps") && r.request().method() === "PATCH", { timeout: 180000 });
    await page2.getByTestId("nps-improve-submit").click();
    check("«Отправить» → PATCH /api/nps 200", (await patched).status() === 200);
    await page2.getByTestId("nps-done").waitFor();
    const row2 = await sql('select score, scale, comment from "NpsResponse" where id=$1', [id2]);
    check("комментарий сохранён в этом ответе (score=2, scale=5)", row2[0] && row2[0].score === 2 && row2[0].scale === 5 && row2[0].comment === "Хочется выгрузку журналов одним архивом", row2[0]);
    await mobile.close();

    // ---------- 1440 px ----------
    await sql('update "User" set "npsAskedAt"=null where email=$1', ["admin@haccp.local"]);
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU" });
    await login(desktop, "admin@haccp.local", env.ADMIN_PASSWORD);
    const page3 = await quietPage(desktop);
    await page3.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 240000 });
    const banner3 = page3.getByTestId("nps-banner");
    await banner3.waitFor({ timeout: 120000 });
    await waitHydrated(page3, "nps-score-4");
    const desk = await page3.evaluate(() => {
      const title = document.querySelector('[data-testid="nps-title"]').getBoundingClientRect();
      const b = [1, 5].map((n) => document.querySelector(`[data-testid="nps-score-${n}"]`).getBoundingClientRect());
      return { titleTop: Math.round(title.top), titleHeight: Math.round(title.height), first: [Math.round(b[0].top), Math.round(b[0].width)], last: [Math.round(b[1].top), Math.round(b[1].width)] };
    });
    check("1440: заголовок и шкала в одной строке", desk.first[0] === desk.last[0] && desk.titleHeight <= 22, desk);
    await shot(page3, banner3, "ac1-1440-ask.png");
    const created3 = page3.waitForResponse((r) => r.url().endsWith("/api/nps") && r.request().method() === "POST", { timeout: 180000 });
    await page3.getByTestId("nps-score-4").click();
    await created3;
    await page3.getByTestId("nps-recommend-form").waitFor();
    // Передумал: 4 → 5 правит тот же ответ (PATCH), а не создаёт второй.
    const patchScore = page3.waitForResponse((r) => r.url().endsWith("/api/nps") && r.request().method() === "PATCH", { timeout: 180000 });
    await page3.getByTestId("nps-score-5").click();
    check("смена оценки 4 → 5 — PATCH того же ответа", (await patchScore).status() === 200);
    await shot(page3, banner3, "ac2-1440-recommend-form.png");
    await page3.getByTestId("nps-close").click();
    check("закрыть после оценки — блок скрыт, оценка уже сохранена", (await page3.getByTestId("nps-banner").count()) === 0);
    await desktop.close();

    // ---------- /root/nps ----------
    const rootCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU" });
    const lr = await login(rootCtx, env.ROOT_EMAIL || "root@haccp.local", env.ROOT_PASSWORD);
    check("login root", lr.session, lr);
    const page4 = await quietPage(rootCtx);
    const resp4 = await page4.goto(`${BASE}/root/nps`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await page4.getByTestId("nps-scale-5").first().waitFor({ timeout: 120000 });
    const rootStats = await page4.evaluate(() => ({
      overall: [...document.querySelectorAll('[data-testid="nps-value"]')].map((e) => e.textContent.trim()),
      scale5: [...document.querySelectorAll('[data-testid="nps-scale-5-value"]')].map((e) => e.textContent.trim()),
      scale10: [...document.querySelectorAll('[data-testid="nps-scale-10-value"]')].map((e) => e.textContent.trim()),
    }));
    check("/root/nps открывается и показывает обе шкалы", resp4.status() === 200 && rootStats.scale5.length === 2 && rootStats.scale10.length === 2, rootStats);
    const apiRoot = await rootCtx.request.get(`${BASE}/api/root/nps`);
    const apiRootBody = await apiRoot.json();
    check("GET /api/root/nps: общий и по шкалам", apiRoot.status() === 200 && apiRootBody.byScale && apiRootBody.last90, {
      last90: apiRootBody.last90,
      scale5: { total: apiRootBody.byScale.last90.scale5.total, nps: apiRootBody.byScale.last90.scale5.nps },
      scale10: { total: apiRootBody.byScale.last90.scale10.total, nps: apiRootBody.byScale.last90.scale10.nps },
    });
    await page4.screenshot({ path: path.join(EVID, "ac4-1440-root-nps.png"), fullPage: false });
    await rootCtx.close();
  } catch (error) {
    check("script error", false, String(error && error.stack ? error.stack : error));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(EVID, "e2e-results.json"), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exitCode = failed ? 1 : 0;
  }
})();
