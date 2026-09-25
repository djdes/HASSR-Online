// E2E run 2: NPS recommendation through the shared inviteColleague + balance invite regression.
// Dev server :3042, private DB wesetup_wt_qrforms, only example.com addresses, SMTP empty (dev log).
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const WT = "C:/wt/qrforms";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");

const BASE = "http://localhost:3042";
const TASK = path.join(WT, ".agent/tasks/nps-recommend-2026-09");
const EVID = path.join(TASK, "evidence");
const CHROME = path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1232/chrome-win64/chrome.exe");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_qrforms?sslmode=disable";
const ORG = "cmugz8a670000kw9mfvb6611i";
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(WT, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
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
  await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
  });
  return (await context.cookies()).some((c) => c.name.includes("session-token"));
}
async function hydrated(page, testId) {
  await page.waitForFunction(
    (id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return Boolean(el && Object.keys(el).some((k) => k.startsWith("__reactProps")));
    },
    testId,
    { timeout: 180000 },
  );
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  try {
    // ---------- NPS 390: 5 → форма → отказы → отправка ----------
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: "ru-RU" });
    check("login admin", await login(mobile, "admin@haccp.local", env.ADMIN_PASSWORD));
    const page = await mobile.newPage();
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 240000 });
    const banner = page.getByTestId("nps-banner");
    await banner.waitFor({ timeout: 120000 });
    await hydrated(page, "nps-score-5");
    const layout = await page.evaluate(() => {
      const title = document.querySelector('[data-testid="nps-title"]');
      const range = document.createRange();
      range.selectNodeContents(title);
      const tops = [1, 2, 3, 4, 5].map((n) => Math.round(document.querySelector(`[data-testid="nps-score-${n}"]`).getBoundingClientRect().top));
      return { titleLines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size, scaleRows: new Set(tops).size, scrollWidth: document.documentElement.scrollWidth };
    });
    check("390: заголовок 1 строка, шкала 1 ряд, без горизонтальной прокрутки", layout.titleLines === 1 && layout.scaleRows === 1 && layout.scrollWidth <= 390, layout);

    const created = page.waitForResponse((r) => r.url().endsWith("/api/nps") && r.request().method() === "POST", { timeout: 180000 });
    await page.getByTestId("nps-score-5").click();
    const responseId = (await (await created).json()).id;
    check("оценка 5 сохранена по клику", typeof responseId === "string", { responseId });
    await page.getByTestId("nps-recommend-form").waitFor();

    const email = page.getByTestId("nps-recommend-email");
    const submit = page.getByTestId("nps-recommend-submit");
    const recommend = () => page.waitForResponse((r) => r.url().endsWith("/api/nps/recommend"), { timeout: 180000 });
    const attempt = async (address) => {
      await email.fill(address);
      const pending = recommend();
      await submit.click();
      const res = await pending;
      const alert = res.status() === 200 ? "" : ((await banner.getByRole("alert").textContent().catch(() => "")) || "");
      return { status: res.status(), body: await res.json(), alert };
    };
    const own = await attempt("Denis.Manager@example.com");
    check("своя контактная почта → 400 у поля", own.status === 400 && own.alert.includes("Это ваша почта"), own);
    const staff = await attempt("staff-ae8893b7@cmugz8a670000kw9mfvb6611i.local.haccp");
    check("почта сотрудника своей организации → 400", staff.status === 400 && staff.alert.includes("сотрудника вашей организации"), staff);
    const registered = await attempt("root@haccp.local");
    check("уже зарегистрирован в WeSetup → 409 (общая проверка)", registered.status === 409 && registered.alert.includes("уже зарегистрирован"), registered);
    await page.waitForTimeout(200);
    await banner.screenshot({ path: path.join(EVID, "ac2-390-registered-error.png") });

    await email.fill("colleague1@example.com");
    await page.getByTestId("nps-recommend-message").fill("Привет! Пишу из WeSetup <b>тест</b> — журналы с телефона по QR. Посмотри, ссылка ниже.");
    const sentP = recommend();
    await submit.click();
    const sent = await sentP;
    const sentBody = await sent.json();
    check("отправка коллеге → 200", sent.status() === 200 && sentBody.ok === true, sentBody);
    check("«Спасибо! Письмо отправлено»", ((await page.getByTestId("nps-done").textContent()) || "").includes("Спасибо! Письмо отправлено"));
    await page.waitForTimeout(3000);
    check("блок скрыт после отправки", (await page.getByTestId("nps-banner").count()) === 0);

    const org = (await sql('select "referralCode" from "Organization" where id=$1', [ORG]))[0];
    check("ensureReferralCode выдал код организации (ссылка всегда реферальная)", /^[A-Z0-9]{8}$/.test(org.referralCode || ""), org);
    const invite1 = await sql('select email, "invitedByUserId" from "ReferralInvite" where "organizationId"=$1 and email=$2', [ORG, "colleague1@example.com"]);
    check("рекомендация записана в ReferralInvite (видна в «Баланс и бонусы»)", invite1.length === 1, invite1[0]);

    // ---------- NPS API: общие лимиты + добавки опроса ----------
    const api = mobile.request;
    const post = async (url, data) => {
      const r = await api.post(`${BASE}${url}`, { data });
      return { status: r.status(), body: await r.json().catch(() => null) };
    };
    const repeat = await post("/api/nps/recommend", { responseId, email: "colleague1@example.com", message: "повтор" });
    check("повтор на тот же адрес → 429 (общий антиспам)", repeat.status === 429 && /уже отправляли приглашение/.test(repeat.body.error), repeat);
    for (const n of [2, 3, 4, 5]) {
      const r = await post("/api/nps/recommend", { responseId, email: `colleague${n}@example.com`, message: `Коллеге №${n}` });
      check(`рекомендация №${n} → 200`, r.status === 200, r);
    }
    const sixth = await post("/api/nps/recommend", { responseId, email: "colleague6@example.com", message: "шестая" });
    check("6-я за сутки → 429 «Не больше 5 рекомендаций в сутки»", sixth.status === 429 && /Не больше 5/.test(sixth.body.error), sixth);
    const long = await post("/api/nps/recommend", { responseId, email: "colleague7@example.com", message: "я".repeat(1001) });
    check("текст > 1000 символов → 400 (message)", long.status === 400 && long.body.field === "message", long);
    const bad = await post("/api/nps/recommend", { responseId, email: "colleague7example.com", message: "x" });
    check("кривая почта → 400 (email)", bad.status === 400 && bad.body.field === "email", bad);
    const audit = await sql('select details, "entityId" from "AuditLog" where action=$1 and "organizationId"=$2 order by "createdAt"', ["nps.recommend", ORG]);
    check(
      "AuditLog nps.recommend: 5 строк, кому и оценка, без текста письма",
      audit.length === 5 && audit.every((a) => a.entityId === responseId && a.details.colleagueEmail && a.details.npsScore === 5 && !JSON.stringify(a.details).includes("Коллеге")),
      audit.map((a) => a.details),
    );

    // ---------- «Баланс и бонусы»: форма работает как раньше ----------
    const overview = await (await api.get(`${BASE}/api/balance`)).json();
    const listed = overview.invites.map((i) => i.email);
    check("GET /api/balance: рекомендации из опроса в списке приглашений", [1, 2, 3, 4, 5].every((n) => listed.includes(`colleague${n}@example.com`)), listed);
    const bOk = await post("/api/balance/referrals", { email: "friend.balance@example.com", message: "Пара слов от себя" });
    check("баланс: приглашение → 200 { ok, invites }", bOk.status === 200 && bOk.body.ok === true && bOk.body.invites.some((i) => i.email === "friend.balance@example.com"), {
      status: bOk.status,
      invites: bOk.body && bOk.body.invites && bOk.body.invites.length,
    });
    const bOwn = await post("/api/balance/referrals", { email: "admin@haccp.local" });
    check("баланс: свой адрес → 400 «Это ваш собственный адрес»", bOwn.status === 400 && bOwn.body.error === "Это ваш собственный адрес", bOwn);
    const bReg = await post("/api/balance/referrals", { email: "root@haccp.local" });
    check("баланс: зарегистрирован → 409 «…бонуса не будет»", bReg.status === 409 && bReg.body.error === "Этот адрес уже зарегистрирован в WeSetup — бонуса не будет", bReg);
    const bRepeat = await post("/api/balance/referrals", { email: "friend.balance@example.com" });
    check("баланс: повтор → 429", bRepeat.status === 429 && bRepeat.body.error === "На этот адрес уже отправляли приглашение сегодня", bRepeat);
    const bBad = await post("/api/balance/referrals", { email: "nope" });
    check("баланс: кривая почта → 400 «Укажите корректный адрес…»", bBad.status === 400 && bBad.body.error === "Укажите корректный адрес электронной почты", bBad);
    const bLong = await post("/api/balance/referrals", { email: "friend.long@example.com", message: "я".repeat(501) });
    check("баланс: сообщение > 500 → 400 как раньше", bLong.status === 400 && bLong.body.error === "Укажите корректный адрес электронной почты", bLong);
    await mobile.close();

    // ---------- «Баланс и бонусы» 1440: отправка через форму + список ----------
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU" });
    await login(desktop, "admin@haccp.local", env.ADMIN_PASSWORD);
    const bp = await desktop.newPage();
    await bp.goto(`${BASE}/settings/balance`, { waitUntil: "domcontentloaded", timeout: 240000 });
    const input = bp.getByPlaceholder("почта коллеги");
    await input.waitFor({ timeout: 180000 });
    await bp.waitForFunction(() => {
      const el = document.querySelector('input[placeholder="почта коллеги"]');
      return Boolean(el && Object.keys(el).some((k) => k.startsWith("__reactProps")));
    }, null, { timeout: 180000 });
    await input.fill("friend.ui@example.com");
    await bp.getByPlaceholder("Пара слов от себя — необязательно").fill("Попробуй — с QR заполнять удобно");
    const section = bp.locator("section, div").filter({ has: input }).last();
    await bp.getByRole("button", { name: "Отправить" }).first().click();
    const dialog = bp.getByRole("dialog");
    await dialog.waitFor({ timeout: 30000 });
    const uiSend = bp.waitForResponse((r) => r.url().endsWith("/api/balance/referrals"), { timeout: 180000 });
    await dialog.getByRole("button", { name: "Отправить" }).click();
    const uiRes = await uiSend;
    check("баланс UI: форма → подтверждение → 200", uiRes.status() === 200, { status: uiRes.status() });
    await bp.getByText("friend.ui@example.com").first().waitFor({ timeout: 30000 });
    const rows = await bp.locator("li").filter({ hasText: "@example.com" }).allTextContents();
    check("баланс UI: в списке и форма баланса, и рекомендации из опроса", rows.some((t) => t.includes("friend.ui@example.com")) && rows.some((t) => t.includes("colleague1@example.com")), rows.slice(0, 8));
    await bp.getByText("friend.ui@example.com").first().scrollIntoViewIfNeeded();
    await bp.waitForTimeout(400);
    const list = bp.locator("ul").filter({ hasText: "friend.ui@example.com" }).first();
    await list.screenshot({ path: path.join(EVID, "balance-1440-invites.png") });
    void section;
    await desktop.close();
  } catch (error) {
    check("script error", false, String(error && error.stack ? error.stack : error));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(TASK, "raw/e2e-results-run2.json"), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exitCode = failed ? 1 : 0;
  }
})();
