// UI check of office-default-login-leak-2026-11-24 on the local stand (next dev :3000, stand-seed.ts + ui-stand.ts setup).
// AC1: login with page scripts blocked (no hydration) never puts credentials into a URL; normal login works.
// AC3/AC6: office page without «Выделить офис» for an open office, a company without objects and a straggler.
// AC4: the first object opens the office. AC8: no split toggle at the office, PATCH off → 400.
// AC10: a waiter without a place starts on the first object. AC7: a new area goes to the only object.
// Output: UI_OUT or ui-check.json (+ screenshots in screens/, not in git).
const { chromium } = require("playwright");
const fs = require("node:fs");

const BASE = "http://localhost:3000";
const RAW = "/home/user/HASSR-Online/.agent/tasks/office-default-login-leak-2026-11-24/raw";
const OUT = process.env.UI_OUT || `${RAW}/ui-check.json`;
const SCREENS = `${RAW}/screens`;
const PASSWORD = "Passw0rd!";

async function login(page, email) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180000 });
    // Кнопка оживает после гидрации (useHydrated) — ждём, пока она включится.
    await page.waitForFunction(() => {
      const button = document.querySelector('form button[type="submit"]:not([hidden])');
      return Boolean(button && !button.disabled && Object.keys(button).some((key) => key.startsWith("__reactProps")));
    }, null, { timeout: 180000 }).catch(() => {});
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.click('form:not([hidden]) button[type="submit"]');
    if (await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180000 }).then(() => true).catch(() => false)) return true;
  }
  return false;
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
  const guide = page.locator('[aria-labelledby="fill-guide-title"]');
  if ((await guide.count()) > 0) await page.keyboard.press("Escape").catch(() => {});
}

async function officeState(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    return {
      allocateCard: text.includes("Выделите офис") || text.includes("Выделить офис"),
      addObjectFirst: text.includes("Сначала добавьте объект"),
      blocks: ["office-staff", "office-journals", "office-points", "office-equipment"].filter((id) => document.querySelector(`[data-point-block="${id}"]`)),
      addToOffice: Boolean(document.querySelector("[data-office-staff-add]")),
      unplacedWarning: Boolean(document.querySelector("[data-office-unplaced]")),
      createObject: Boolean(document.querySelector("[data-office-create-point]")),
      journalButtons: [...document.querySelectorAll('[data-open-at-point^="office-journals-"]')].map((el) => el.textContent.trim()),
      officePage: document.querySelector("[data-office-page]")?.getAttribute("data-office-page") ?? null,
      header: document.querySelector("header [data-current-point]")?.textContent.replace(/\s+/g, " ").trim() ?? null,
    };
  });
}

(async () => {
  fs.mkdirSync(SCREENS, { recursive: true });
  const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
  const browser = await chromium.launch({ executablePath });
  const out = {};

  // AC1 — скрипты страницы заблокированы: гидрации нет, браузер отправил бы форму сам.
  for (const path of ["/login", "/register", "/mini/login"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.route("**/_next/static/chunks/**", (route) => route.abort());
    const urls = [];
    page.on("request", (request) => urls.push(request.url()));
    await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 180000 });
    await page.waitForTimeout(1500);
    const info = {};
    const form = page.locator("form:not([hidden])").first();
    info.formMethod = await form.getAttribute("method").catch(() => null);
    const submit = form.locator('button[type="submit"]').first();
    info.submitDisabledBeforeHydration = (await submit.count()) > 0 ? await submit.isDisabled() : null;
    if (path === "/login") {
      await page.fill("#email", "owner@stand.local").catch(() => {});
      await page.fill("#password", PASSWORD).catch(() => {});
      await submit.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.locator("#password").press("Enter").catch(() => {});
      await page.waitForTimeout(2500);
    } else {
      const inputs = form.locator("input:visible");
      for (let i = 0; i < Math.min(await inputs.count(), 4); i += 1) await inputs.nth(i).fill(i === 0 ? "probe@stand.local" : "Secret123").catch(() => {});
      await submit.click({ force: true, timeout: 5000 }).catch(() => {});
      await inputs.first().press("Enter").catch(() => {});
      await page.waitForTimeout(2500);
    }
    info.urlAfter = page.url();
    info.credentialsInAnyUrl = urls.some((url) => /[?&](password|email|code|pin)=/i.test(url));
    out[`AC1_noscript${path}`] = info;
    await context.close();
  }

  // AC1 — обычный вход работает.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const urls = [];
    page.on("request", (request) => urls.push(request.url()));
    const ok = await login(page, "owner@stand.local");
    out.AC1_login = { ok, landed: new URL(page.url()).pathname, credentialsInAnyUrl: urls.some((url) => /[?&](password|email)=/i.test(url)) };

    // AC3/AC6 — офис открыт (стенд «Берёзка»).
    await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await settle(page);
    out.AC3_open_office = await officeState(page);
    await page.screenshot({ path: `${SCREENS}/office-open.png`, fullPage: true });

    // AC8 — при офисе тумблера «журналы по точкам» нет, выключить через API нельзя.
    await page.goto(`${BASE}/settings/buildings`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await settle(page);
    out.AC8_toggle = {
      switches: await page.locator('[role="switch"]').count(),
      patchOff: await page.evaluate(async () => {
        const response = await fetch("/api/settings/buildings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ perLocationJournals: false }) });
        return { status: response.status, body: await response.json().catch(() => null) };
      }),
    };
    await context.close();
  }

  // AC6/AC4 — компания без объектов: страница офиса без «Выделить офис»; первый объект открывает офис.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    out.AC6_noobj_login = await login(page, "ui-office-noobj@stand.local");
    await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await settle(page);
    out.AC6_noobj = await officeState(page);
    await page.screenshot({ path: `${SCREENS}/office-noobj.png`, fullPage: true });
    out.AC4_first_object = await page.evaluate(async () => {
      const response = await fetch("/api/settings/buildings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Первый объект" }) });
      return response.status;
    });
    await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await settle(page);
    out.AC4_after_first_object = await officeState(page);
    await context.close();
  }

  // AC6 — компания с объектом, но офис не открыт: страница открывает его сама. AC7 — новый цех на объект.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    out.AC6_straggler_login = await login(page, "ui-office-straggler@stand.local");
    await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await settle(page);
    out.AC6_straggler = await officeState(page);
    await page.screenshot({ path: `${SCREENS}/office-straggler.png`, fullPage: true });
    out.AC7_new_area = await page.evaluate(async () => {
      const response = await fetch("/api/areas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Горячий цех теста" }) });
      return response.status;
    });
    await context.close();
  }

  // AC10 — официант без места: первый объект, не офис.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    out.AC10_waiter_login = await login(page, "waiter@stand.local");
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await settle(page);
    out.AC10_waiter = {
      // Линейный сотрудник уходит в мини-приложение: место — в его шапке («WESETUP · <объект>»).
      header: (await page.locator("header").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 120),
      path: new URL(page.url()).pathname,
      tasksFree: (await page.locator("text=Свободно").first().innerText().catch(() => "")).trim(),
    };
    await page.screenshot({ path: `${SCREENS}/waiter-dashboard.png` });
    await context.close();
  }

  // Тёмная тема и телефон — страница офиса компании без объектов (после первого объекта — с офисом).
  {
    const context = await browser.newContext({ ...require("playwright").devices["iPhone 13"] });
    const page = await context.newPage();
    await login(page, "owner@stand.local");
    await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await settle(page);
    out.phone_office = await officeState(page);
    await page.screenshot({ path: `${SCREENS}/office-phone.png`, fullPage: true });
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await context.addCookies([{ name: "wesetup-theme", value: "dark", url: BASE }]);
    const page = await context.newPage();
    await login(page, "owner@stand.local");
    await page.goto(`${BASE}/settings/organization/office`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await settle(page);
    out.dark_office = { ...(await officeState(page)), theme: await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-app-theme") ?? null) };
    await page.screenshot({ path: `${SCREENS}/office-dark.png`, fullPage: true });
    await context.close();
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((error) => {
  console.error("UI CHECK FAILED", String(error).slice(0, 600));
  process.exit(1);
});
