// Live check of series A through the browser (local `next dev`, Playwright).
// AC6: saving the exchange with «Товары и блюда» does not connect organizations to the cabinet menu;
// AC4: the cabinet owner gets a bell about a new request from another company;
// AC5 (UI): the window, the card and the confirmation page say "the exchange is running" — the
//   server's `running: true` answer is substituted in the browser here (the server side is
//   proven by background-check.ts);
// AC3: ROOT sends himself the sample letters from «Рассылка».
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3000";
const OUT = __dirname;
// The dev server was started with its output in raw/next-dev.log; only the letter lines are kept (next-dev-letters.log).
const DEVLOG = path.join(__dirname, "next-dev.log");
const stamp = Date.now().toString(36);
const log = [];
const say = (label, value) => {
  const line = `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
  log.push(line);
  console.log(line);
};
const sql = (query) =>
  execSync(`su postgres -c "psql -d haccp_online -tA -F '|' -c \\"${query.replace(/"/g, '\\\\\\"')}\\""`, { encoding: "utf8" }).trim();

async function api(page, method, url, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text.slice(0, 160) };
      }
      return { status: res.status, json };
    },
    { method, url, body },
  );
}
async function register(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 240000 });
  await page.fill("#register-email", email);
  await page.check('[data-testid="legal-consent"]');
  await page.waitForTimeout(2500);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 240000 });
  return page;
}
async function login(browser, email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"], #email', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 240000 });
  return page;
}
const profile = (page, name, inn, phone) =>
  api(page, "POST", "/api/profile/complete", {
    organizationName: name, phone, sphere: "restaurant", ownershipKind: "private", locationsCount: 1, inn,
    name: "Владелец", newPassword: "Passw0rd-1", asEmployee: false,
  });
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, name), type: "jpeg", quality: 74, ...opts });
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const open = async (page, url) => {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 240000 });
  await page.waitForTimeout(1500);
};
const switchTo = async (page, id) => {
  await api(page, "POST", "/api/me/active-organization", { organizationId: id });
  await page.reload({ waitUntil: "networkidle" });
};
/** Ответ сервера «обмен идёт» — подставляется в браузере только для показа вида (сервер проверен отдельно). */
const runningAnswer = (extra = {}) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ ok: true, running: true, ...extra }),
});

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const root = await login(browser, "root@local.test", process.env.ROOT_PASSWORD);

    // ---- owner: two organizations of one account, products in the first
    const owner = await register(browser, `own-${stamp}@example.com`);
    say("profile", (await profile(owner, "Сеть Обед", "5001000073", "+79168880044")).status);
    const orgA = (await api(owner, "GET", "/api/organizations")).json.organizations[0];
    for (const name of ["Молоко 3,2 %", "Курица охлаждённая"]) await api(owner, "POST", "/api/products", { name, unit: "kg", kind: "raw" });
    const created = await api(owner, "POST", "/api/organizations", { name: "Обед на Арбате", sphere: "restaurant" });
    say("second organization created", created.status);
    const orgB = (await api(owner, "GET", "/api/organizations")).json.organizations.find((o) => o.name === "Обед на Арбате");
    await switchTo(owner, orgA.id);

    // ---- AC6: the window says the menu and raw materials connect separately; saving does not connect them
    await open(owner, "/settings/master-cabinet");
    await tid(owner, "exchange-card").waitFor({ timeout: 60000 });
    await tid(owner, "exchange-configure").click();
    await tid(owner, "exchange-dialog").waitFor({ timeout: 30000 });
    await owner.waitForTimeout(1200);
    const orgBox = owner.locator(`[data-testid="exchange-organization"][data-organization-id="${orgB.id}"]`);
    if (!(await orgBox.isChecked())) await orgBox.check({ force: true });
    const products = tid(owner, "exchange-kind-products");
    if (!(await products.isChecked())) await products.check({ force: true });
    await tid(owner, "exchange-menu-note").waitFor({ timeout: 10000 });
    say("menu note in the window", await tid(owner, "exchange-menu-note").innerText());
    await shot(owner, "01-dialog-menu-note.jpg");
    await tid(owner, "exchange-submit").click();
    await tid(owner, "exchange-result").waitFor({ timeout: 120000 });
    say("result in the window", (await tid(owner, "exchange-result").innerText()).replace(/\n+/g, " | "));
    await tid(owner, "exchange-done").click().catch(() => null);
    say(
      "after saving: organizations connected to the cabinet menu (linkedServiceCode set)",
      sql(`select count(*) from "Organization" where id in ('${orgA.id}','${orgB.id}') and "linkedServiceCode" is not null`),
    );
    say("after saving: products of the second organization", sql(`select string_agg(name, ', ' order by name) from "Product" where "organizationId"='${orgB.id}' and "isActive"`));

    // ---- AC5 (UI): the window and the card when the exchange runs longer than 8 s
    await owner.route("**/api/settings/directory-exchange", (route) =>
      route.request().method() === "PUT" ? route.fulfill(runningAnswer({ summary: { organizations: [], notes: [] } })) : route.continue(),
    );
    await owner.route("**/api/settings/directory-exchange/sync", (route) => route.fulfill(runningAnswer()));
    await open(owner, "/settings/master-cabinet");
    await tid(owner, "exchange-card").waitFor({ timeout: 60000 });
    await tid(owner, "exchange-configure").click();
    await tid(owner, "exchange-dialog").waitFor({ timeout: 30000 });
    await owner.waitForTimeout(1000);
    await tid(owner, "exchange-submit").click();
    await tid(owner, "exchange-running").waitFor({ timeout: 30000 });
    say("window, exchange running", await tid(owner, "exchange-running").innerText());
    await shot(owner, "02-dialog-running.jpg");
    await tid(owner, "exchange-done").click().catch(() => null);
    await owner.waitForTimeout(800);
    await tid(owner, "exchange-sync").click();
    const toast = owner.locator("[data-sonner-toast]").last();
    await toast.waitFor({ timeout: 15000 });
    say("card, sync running (toast)", await toast.innerText());
    await shot(owner, "03-card-sync-running.jpg");
    await owner.unrouteAll({ behavior: "ignoreErrors" });

    // ---- AC4: a request from another company — bell for the cabinet owner
    await open(owner, "/settings/master-cabinet");
    await tid(owner, "exchange-card").waitFor({ timeout: 60000 });
    await owner.waitForTimeout(1500);
    // Кабинет уже создан сохранением обмена — код виден сразу; иначе его выдаёт кнопка.
    if ((await tid(owner, "exchange-cabinet-code-value").count()) === 0) await tid(owner, "exchange-cabinet-code-get").click();
    await tid(owner, "exchange-cabinet-code-value").waitFor({ timeout: 60000 });
    const code = (await tid(owner, "exchange-cabinet-code-value").innerText()).trim();
    const req = await register(browser, `req-${stamp}@example.com`);
    await profile(req, "Кафе Сосед", "5001000080", "+79168880055");
    const invoice = await api(req, "POST", "/api/payments/invoice", { plan: "standard", cycle: "month", points: 1 });
    say("requester pays the tariff", (await api(root, "POST", `/api/root/orders/${invoice.json.orderId}/mark-paid`)).status);
    const sent = await api(req, "POST", "/api/settings/directory-exchange/requests", { code, mode: "link", kinds: ["products"] });
    say("request sent", sent.status);
    const requestId = sent.json?.request?.id;
    await owner.waitForTimeout(3000);
    const bell = await api(owner, "GET", "/api/notifications");
    const incoming = [...(bell.json?.unread ?? []), ...(bell.json?.read ?? [])].find((n) => n.kind === "directory_exchange.request_incoming");
    say("bell row for the cabinet owner", incoming ? { title: incoming.title, linkHref: incoming.linkHref, items: incoming.items } : bell.json);
    say(
      "telegram attempt logged (owner has no Telegram here — expected none)",
      sql(`select count(*) from "TelegramLog" where kind='directory_exchange.request_incoming' and "dedupeKey"='directory_exchange.request_incoming:${requestId}'`),
    );
    say("letter to the cabinet owner in the dev log", fs.readFileSync(DEVLOG, "utf8").includes("Запрос на обмен справочниками от «Кафе Сосед»"));
    await open(owner, "/dashboard");
    const bellButton = owner.locator('button[aria-label*="ведомлен"]').first();
    if (await bellButton.count()) {
      await bellButton.click();
      await owner.waitForTimeout(1200);
      await shot(owner, "04-owner-bell.jpg");
    } else {
      say("bell button", "not found by selector — row checked through the API above");
    }

    // ---- AC5 (UI): the confirmation page when the first exchange runs in the background
    await owner.route(`**/api/exchange-requests/${requestId}`, (route) =>
      route.request().method() === "POST" ? route.fulfill(runningAnswer({ status: "approved" })) : route.continue(),
    );
    await open(owner, `/exchange-request/${requestId}`);
    await tid(owner, "exchange-request-card").waitFor({ timeout: 60000 });
    await tid(owner, "exchange-request-approve").click();
    await tid(owner, "exchange-request-approve-confirm").click();
    await tid(owner, "exchange-request-running").waitFor({ timeout: 30000 });
    say("confirmation page, exchange running", await tid(owner, "exchange-request-running").innerText());
    await shot(owner, "05-confirmation-running.jpg", { fullPage: true });
    await owner.unrouteAll({ behavior: "ignoreErrors" });

    // ---- AC3: ROOT → «Рассылка» → sample letters
    await open(root, "/root/mailing");
    await tid(root, "exchange-letters-card").scrollIntoViewIfNeeded();
    await tid(root, "exchange-letters-send").click();
    await tid(root, "exchange-letters-result").waitFor({ timeout: 60000 });
    say("ROOT sample letters result", (await tid(root, "exchange-letters-result").innerText()).replace(/\n+/g, " | "));
    await tid(root, "exchange-letters-card").screenshot({ path: path.join(OUT, "06-root-sample-letters.jpg"), type: "jpeg", quality: 80 });
    const devLog = fs.readFileSync(DEVLOG, "utf8");
    say("dev log has both sample subjects", ["[Проверка] Запрос на обмен справочниками", "[Проверка] Запрос на обмен справочниками подтверждён"].map((s) => devLog.includes(s)));
    say("non-root calling the ROOT route", (await api(owner, "POST", "/api/root/directory-exchange/test-letters")).status);
  } catch (error) {
    say("SCRIPT ERROR", String(error && error.stack ? error.stack : error));
  } finally {
    fs.writeFileSync(path.join(OUT, "series-a-live.log"), log.join("\n") + "\n");
    await browser.close();
  }
})();
