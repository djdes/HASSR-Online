// Сквозная проверка ограничителя на production-сборке (next build + next start).
// Запуск: BASE=http://127.0.0.1:3003 node e2e.cjs <phase>, фазы: limits | stats | ui | off
// Каждый сценарий — свой X-Real-IP, чтобы бюджеты не пересекались.
const { chromium } = require("playwright");
const { encode } = require("next-auth/jwt");

const BASE = process.env.BASE ?? "http://127.0.0.1:3003";
const SECRET = process.env.NEXTAUTH_SECRET;
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function get(path, headers = {}) {
  const response = await fetch(`${BASE}${path}`, { headers, redirect: "manual" });
  await response.arrayBuffer();
  return response;
}

/** `count` requests, `parallel` at a time; returns status counts and the responses. */
async function burst(count, makeRequest, parallel = 20) {
  const statuses = {};
  const responses = [];
  let next = 0;
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (next < count) {
      const index = next++;
      const response = await makeRequest(index);
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      responses[index] = response;
    }
  }));
  return { statuses, responses };
}

const visitorOf = (response) => /wesetup\.visitor=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
const IOS15 = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1";

async function limits() {
  // 3. Old iOS without Fetch Metadata: Next's RSC fetch asks for */*, a page load for text/html.
  const html = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  const rsc = await burst(200, (i) => get(`/login?_rsc=e2e${i}`, { "x-real-ip": "198.51.100.11", "user-agent": IOS15, accept: "*/*", rsc: "1" }));
  check("старый iOS: RSC-запрос (Accept */*) — фоновый бюджет: 200 запросов без 429", !rsc.statuses[429], JSON.stringify(rsc.statuses));
  const docs = await burst(101, () => get("/login", { "x-real-ip": "198.51.100.11", "user-agent": IOS15, accept: html }), 30);
  check("страницы того же адреса сохранили свой бюджет: 100 проходят, 101-я — 429", docs.statuses[429] === 1, JSON.stringify(docs.statuses));
  const curlStar = await burst(21, () => get("/login", { "x-real-ip": "198.51.100.19", "user-agent": "curl/8.5.0", accept: "*/*" }), 21);
  check("curl с Accept */* остаётся на бюджете страниц (21-й — 429)", curlStar.statuses[429] === 1, JSON.stringify(curlStar.statuses));

  // 4. Guests: a signed cookie gives each browser its own budget.
  const ip = { "x-real-ip": "198.51.100.12", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130", accept: html };
  const first = await get("/blog", ip);
  const cookieA = visitorOf(first);
  check("гостю выдана cookie посетителя", Boolean(cookieA) && /HttpOnly/i.test(first.headers.get("set-cookie")), first.headers.get("set-cookie")?.replace(/=v1\.[^;]+/, "=v1.…"));
  const rest = await burst(100, () => get("/blog", ip), 25);
  const waited = rest.responses.find((response) => response.status === 429);
  check("адрес без cookie по-прежнему упирается в лимит (100 проходят, 101-й — 429)", rest.statuses[429] === 1, JSON.stringify(rest.statuses));
  const cookieB = waited && visitorOf(waited);
  check("экран ожидания тоже выдаёт cookie", Boolean(cookieB));
  const withA = await burst(101, () => get("/blog", { ...ip, cookie: `wesetup.visitor=${cookieA}` }), 25);
  check("с cookie — свой бюджет: 100 проходят при заблокированном адресе, 101-й — 429", withA.statuses[200] === 100 && withA.statuses[429] === 1, JSON.stringify(withA.statuses));
  const retries = await burst(30, () => get("/blog", { ...ip, cookie: `wesetup.visitor=${cookieA}` }), 10);
  const withB = await burst(99, () => get("/blog", { ...ip, cookie: `wesetup.visitor=${cookieB}` }), 25);
  check("второй браузер того же адреса — независимый бюджет; повторы первого во время паузы его не съели", withB.statuses[200] === 99 && retries.statuses[429] === 30, `${JSON.stringify(withB.statuses)}, повторы ${JSON.stringify(retries.statuses)}`);
  const forged = await get("/blog", { ...ip, cookie: "wesetup.visitor=v1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA" });
  check("поддельная cookie считается по адресу (429)", forged.status === 429);
  const tool = await get("/blog", { "x-real-ip": "198.51.100.20", "user-agent": "python-requests/2.31" });
  check("скрипту cookie не выдаётся", !visitorOf(tool), String(tool.status));

  // 2. Signed-in users: every budget ×3.
  const token = await encode({ secret: SECRET, token: { id: "e2e-limit-user", sub: "e2e-limit-user", role: "owner", orgKind: "regular", isRoot: false } });
  const user = await burst(61, () => get("/blog", { "x-real-ip": "198.51.100.13", "user-agent": "curl/8.5.0", cookie: `haccp-online.session-token=${token}` }), 10);
  check("вошедший пользователь: 60 страниц (20×3) проходят, 61-я — 429", user.statuses[429] === 1 && !user.statuses[500], JSON.stringify(user.statuses));

  // A fake crawler is an ordinary client.
  const fake = await burst(101, () => get("/blog", { "x-real-ip": "198.51.100.16", "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", accept: "text/html,*/*;q=0.8" }), 20);
  check("назвался Googlebot без подтверждения DNS — обычные пороги (101-я — 429)", fake.statuses[429] === 1, JSON.stringify(fake.statuses));

  // Ordinary pages still render.
  for (const path of ["/", "/login", "/pricing", "/en", "/journals-info"]) {
    const response = await get(path, { "x-real-ip": "198.51.100.17", "user-agent": "Mozilla/5.0 Chrome/130", "sec-fetch-dest": "document" });
    check(`страница ${path} открывается`, response.status === 200, String(response.status));
  }
}

async function off() {
  const statuses = await burst(60, () => get("/blog", { "x-real-ip": "198.51.100.14", "user-agent": "curl/8.5.0" }), 10);
  check("PAGE_NAVIGATION_LIMIT=off: 60 запросов curl без 429", !statuses.statuses[429], JSON.stringify(statuses.statuses));
}

async function ui() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    // 6. The wait page opens the page by itself once the pause is over.
    await burst(21, () => get("/pricing", { "x-real-ip": "198.51.100.15", "user-agent": "curl/8.5.0" }), 21);
    const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "198.51.100.15" }, userAgent: "curl/8.5.0 e2e-headless" });
    const page = await context.newPage();
    const first = await page.goto(`${BASE}/pricing`);
    check("заблокированный адрес видит экран ожидания", first?.status() === 429, String(first?.status()));
    const started = Date.now();
    const reopened = await page.waitForResponse((response) => response.url().endsWith("/pricing") && response.request().isNavigationRequest(), { timeout: 30_000 }).catch(() => null);
    await page.waitForLoadState("domcontentloaded");
    check("после отсчёта страница открылась сама", reopened?.status() === 200 && !(await page.title()).includes("пауза"), `${reopened?.status()} через ${Math.round((Date.now() - started) / 1000)} с, «${await page.title()}»`);
    await context.close();

    await burst(21, () => get("/pricing", { "x-real-ip": "198.51.100.18", "user-agent": "curl/8.5.0" }), 21);
    const stuck = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": "198.51.100.18" }, userAgent: "curl/8.5.0 e2e-headless" });
    await stuck.addInitScript(() => sessionStorage.setItem("wesetup:page-wait", JSON.stringify({ n: 3, at: Date.now() })));
    const stuckPage = await stuck.newPage();
    await stuckPage.goto(`${BASE}/pricing`);
    await stuckPage.waitForTimeout(20_000);
    check("после 3 автоповторов подряд — только кнопка «Продолжить»", (await stuckPage.title()).includes("пауза") && (await stuckPage.isEnabled("#retry")), await stuckPage.locator("#hint").innerText());
    await stuck.close();

    // 1. The statistics page for ROOT.
    const root = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const token = await encode({ secret: SECRET, token: { id: process.env.ROOT_USER_ID, sub: process.env.ROOT_USER_ID, email: "root@local.test", role: "owner", isRoot: true, organizationId: "platform" } });
    await root.addCookies([{ name: "haccp-online.session-token", value: token, url: BASE }]);
    const rootPage = await root.newPage();
    const response = await rootPage.goto(`${BASE}/root/page-limit`);
    const summary = await rootPage.locator("[data-testid=page-limit-summary]").innerText().catch(() => "");
    check("/root/page-limit открывается для ROOT и показывает данные", response?.status() === 200 && /429/.test(summary), `${response?.status()} «${summary}»`);
    await rootPage.screenshot({ path: `${__dirname}/root-page-limit-desktop.png`, fullPage: true });
    await rootPage.setViewportSize({ width: 390, height: 844 });
    await rootPage.reload();
    const overflow = await rootPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("на телефоне страница без горизонтальной прокрутки", overflow <= 0, `лишние ${overflow}px`);
    await rootPage.screenshot({ path: `${__dirname}/root-page-limit-mobile.png`, fullPage: true });
    const guest = await browser.newContext();
    const guestResponse = await (await guest.newPage()).goto(`${BASE}/root/page-limit`);
    check("без ROOT — 404", guestResponse?.status() === 404, String(guestResponse?.status()));
  } finally {
    await browser.close();
  }
}

(async () => {
  const phase = process.argv[2];
  if (phase === "limits") await limits();
  else if (phase === "off") await off();
  else if (phase === "ui") await ui();
  else throw new Error(`unknown phase ${phase}`);
  require("node:fs").writeFileSync(`${__dirname}/e2e-${phase}.json`, JSON.stringify(results, null, 2));
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
})();
