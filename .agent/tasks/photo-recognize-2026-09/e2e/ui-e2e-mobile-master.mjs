// AC3 (390): «С фото» в мастер-кабинете на телефоне — таблица меню и сырьё.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire("C:/wt/qrforms/package.json");
const { chromium } = require("playwright-core");

const EXE = "C:/Users/Yaroslav/AppData/Local/ms-playwright/chromium-1232/chrome-win64/chrome.exe";
const BASE = "http://localhost:3042";
const EV = "C:/wt/qrforms/.agent/tasks/photo-recognize-2026-09/evidence";
const REGULAR_ORG = "cmugz8a670000kw9mfvb6611i";
const env = Object.fromEntries(
  readFileSync("C:/wt/qrforms/.env", "utf8")
    .split(/\r?\n/)
    .map((line) => /^([A-Z_]+)=(.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"|"$/g, "")])
);
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function clickUntil(page, trigger, target, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.locator(trigger).click();
    if (await page.locator(target).waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false)) return true;
    await page.waitForTimeout(1500);
  }
  return false;
}

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox"] });
try {
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: "ru-RU",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  });
  const csrf = await (await mobile.request.get(`${BASE}/api/auth/csrf`)).json();
  await mobile.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email: "admin@haccp.local", password: env.ADMIN_PASSWORD, json: "true" },
  });
  await mobile.request.post(`${BASE}/api/me/active-organization`, { data: { organizationId: REGULAR_ORG } });
  const status = await (await mobile.request.get(`${BASE}/api/settings/master-cabinet`)).json();
  const masterId = status?.master?.organizationId;
  check("мастер-кабинет пула найден", Boolean(masterId), masterId);
  const switched = await mobile.request.post(`${BASE}/api/me/active-organization`, { data: { organizationId: masterId } });
  check("переключение в мастер-кабинет (390)", switched.status() === 200);

  const phone = await mobile.newPage();
  await phone.goto(`${BASE}/master`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await phone.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
  const menuPanelBtn = await phone.locator('[data-testid="master-photo-dish"]').boundingBox();
  check("390: «С фото» на вкладке меню мастер-кабинета не ниже 48 px", Boolean(menuPanelBtn && menuPanelBtn.height >= 48), JSON.stringify(menuPanelBtn));
  await phone.locator('[data-testid="master-photo-dish"]').scrollIntoViewIfNeeded();
  await phone.screenshot({ path: `${EV}/e2e-390-08-master-menu-panel.png` });

  const opened = await clickUntil(phone, '[data-testid="master-paste-dish"]', '[data-testid="master-menu-table"]');
  check("390: таблица меню открылась", opened);
  await phone.locator('[data-testid="menu-photo"]').scrollIntoViewIfNeeded();
  const menuBtn = await phone.locator('[data-testid="menu-photo"]').boundingBox();
  check("390: «С фото» в таблице меню мастер-кабинета не ниже 48 px", Boolean(menuBtn && menuBtn.height >= 48), JSON.stringify(menuBtn));
  await phone.screenshot({ path: `${EV}/e2e-390-09-master-menu-table.png` });
  await phone.keyboard.press("Escape");

  await phone.locator('[data-testid="master-tab-raw"]').click();
  await phone.locator('[data-testid="master-photo-product"]').waitFor({ timeout: 30_000 });
  await phone.locator('[data-testid="master-photo-product"]').scrollIntoViewIfNeeded();
  const rawBtn = await phone.locator('[data-testid="master-photo-product"]').boundingBox();
  check("390: «С фото» в сырье мастер-кабинета не ниже 48 px", Boolean(rawBtn && rawBtn.height >= 48), JSON.stringify(rawBtn));
  await phone.screenshot({ path: `${EV}/e2e-390-10-master-raw.png` });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("390: без горизонтальной прокрутки", overflow <= 0, `overflow=${overflow}`);
  await mobile.request.post(`${BASE}/api/me/active-organization`, { data: { organizationId: REGULAR_ORG } });
  await mobile.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
