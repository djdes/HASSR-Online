// E2E: цены услуг заменены на «Свяжитесь с нами», окно с крупным телефоном.
// Запуск из корня worktree: node .agent/tasks/service-prices-contact-2026-10-29/raw/e2e-service-prices.mjs
// Сервер: next dev -p 3033 на локальной БД wesetup_svcprice.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.E2E_BASE ?? "http://localhost:3033";
const EXE = "C:\\Users\\Two\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe";
const OUT = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(OUT, "screens");
mkdirSync(SHOTS, { recursive: true });

const WHATS_NEW = process.env.WHATS_NEW_VERSION ?? "10bwcnc";
const USER = { email: "dk-owner@test.local", password: "Test-12345" };
const PHONE = "8 (925) 305-80-77";
const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

/** Где на странице услуги (там не должно быть «₽») и где тарифы (там «₽» обязан быть). */
const PAGES = [
  { route: "/uslugi", auth: false, trigger: '[data-testid="uslugi-contact-journals-setup"]', services: ["article[id]"], tariffs: [] },
  { route: "/", auth: false, trigger: '[data-testid="tariff-ppk-contact"]', services: ['[data-testid="tariff-ppk"]', "ppkRow"], tariffs: ['[data-testid="tariff-card-standard"]', '[data-testid="tariff-card-premium"]'] },
  { route: "/pricing", auth: false, trigger: '[data-testid="tariff-ppk-contact"]', services: ['[data-testid="tariff-ppk"]', "ppkRow"], tariffs: ['[data-testid="tariff-card-standard"]', '[data-testid="tariff-card-premium"]'] },
  { route: "/settings/services", auth: true, trigger: '[data-testid="service-contact-journals-setup"]', services: ["[data-service-card]", "main"], tariffs: [] },
  { route: "/inspection/experts", auth: true, trigger: '[data-testid="inspection-experts-contact"]', services: ["[data-inspection-experts]"], tariffs: [] },
  { route: "/production-control", auth: true, trigger: '[data-testid="ppk-individual-contact"]', services: ['[data-testid="ppk-individual-order"]'], tariffs: [] },
  { route: "/settings/subscription", auth: true, trigger: '[data-testid="tariff-ppk-contact"]', services: ['[data-testid="tariff-ppk"]'], tariffs: ['[data-testid="tariff-card-standard"]', '[data-testid="tariff-card-premium"]'] },
];

const results = [];
const record = (entry) => {
  results.push(entry);
  console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.check}${entry.detail ? ` — ${entry.detail}` : ""}`);
};

async function login(context) {
  const page = await context.newPage();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForSelector("#email", { timeout: 120_000 });
      await page.fill("#email", USER.email);
      await page.fill("#password", USER.password);
      await page.click('form button[type="submit"]');
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
      await page.close();
      return;
    } catch (error) {
      console.log(`login attempt ${attempt} failed: ${String(error).slice(0, 160)}`);
    }
  }
  throw new Error("login failed");
}

/** Тексты областей услуг: «₽» и суммы в них быть не должно. */
async function serviceTexts(page, selectors) {
  return page.evaluate((list) => {
    const texts = [];
    for (const selector of list) {
      if (selector === "ppkRow") {
        const row = [...document.querySelectorAll('[data-testid="tariff-table"] tr')].find((tr) =>
          /ППК под ваш объект/.test(tr.textContent ?? ""),
        );
        texts.push({ selector, found: Boolean(row), text: row?.textContent ?? "" });
        continue;
      }
      const nodes = [...document.querySelectorAll(selector)];
      texts.push({ selector, found: nodes.length > 0, count: nodes.length, text: nodes.map((node) => node.textContent ?? "").join(" | ") });
    }
    return texts;
  }, selectors);
}

async function checkDialog(page, label, shotName) {
  const dialog = page.locator("[data-contact-us-dialog]");
  await dialog.waitFor({ state: "visible", timeout: 30_000 });
  const phone = dialog.locator("[data-contact-phone]");
  await phone.waitFor({ state: "visible", timeout: 10_000 });
  // Окно доезжает анимацией — ждём, пока размер перестанет меняться.
  await page.waitForTimeout(450);
  const info = await page.evaluate(() => {
    const el = document.querySelector("[data-contact-us-dialog] [data-contact-phone]");
    const box = el.getBoundingClientRect();
    const number = el.querySelector("span > span:last-child");
    const dialogBox = document.querySelector("[data-contact-us-dialog]").getBoundingClientRect();
    return {
      text: el.textContent,
      href: el.getAttribute("href"),
      fontSize: parseFloat(getComputedStyle(number).fontSize),
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      dialog: { left: dialogBox.left, right: dialogBox.right },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      telegram: document.querySelector("[data-contact-us-dialog] [data-contact-telegram]")?.getAttribute("href"),
      email: document.querySelector("[data-contact-us-dialog] [data-contact-email]")?.getAttribute("href"),
      chat: Boolean(document.querySelector("[data-contact-us-dialog] [data-contact-chat]")),
    };
  });
  const fits =
    info.box.left >= -1 &&
    info.box.right <= info.viewport.width + 1 &&
    info.box.bottom <= info.viewport.height + 1 &&
    info.dialog.left >= -1 &&
    info.dialog.right <= info.viewport.width + 1;
  record({
    check: `${label}: окно контактов — крупный телефон`,
    ok:
      info.text.includes(PHONE) &&
      info.href === "tel:+79253058077" &&
      info.fontSize >= 24 &&
      fits &&
      info.telegram === "https://t.me/wesetupbot" &&
      info.email?.startsWith("mailto:support@wesetup.ru") &&
      info.chat,
    detail: `font ${info.fontSize}px, phone box ${Math.round(info.box.left)}–${Math.round(info.box.right)} of ${info.viewport.width}, tg ${info.telegram}`,
  });
  await page.screenshot({ path: path.join(SHOTS, `${shotName}-dialog.png`) });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
}

async function checkPage(context, spec, viewport, label) {
  const page = await context.newPage();
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const response = await page.goto(`${BASE}${spec.route}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  const status = response?.status() ?? 0;
  const trigger = page.locator(spec.trigger).first();
  try {
    await trigger.waitFor({ state: "attached", timeout: 180_000 });
  } catch {
    record({ check: `${label}: кнопка «Свяжитесь с нами»`, ok: false, detail: `HTTP ${status}, url ${page.url()}` });
    await page.screenshot({ path: path.join(SHOTS, `${label.replace(/[^a-z0-9]+/gi, "_")}-missing.png`), fullPage: false });
    await page.close();
    return;
  }
  // Гидрация: кнопка — клиентская, клик до неё теряется.
  await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  if (label.includes("mini")) {
    const miniRoot = await page.evaluate(() => Boolean(document.getElementById("mini-root")));
    record({ check: `${label}: страница в оболочке Mini App (#mini-root)`, ok: miniRoot, detail: page.url() });
  }

  const texts = await serviceTexts(page, spec.services);
  for (const entry of texts) {
    const leaked = /₽|руб\.|\bот\s?\d[\d\s\u00a0]*\d{3}/u.test(entry.text);
    record({
      check: `${label}: нет цены в ${entry.selector}`,
      ok: entry.found && !leaked,
      detail: entry.found ? (leaked ? entry.text.match(/.{0,40}(₽|руб\.|от\s?\d[\d\s\u00a0]*\d{3}).{0,20}/u)?.[0] : `ok${entry.count ? ` (${entry.count})` : ""}`) : "не найдено",
    });
  }
  for (const selector of spec.tariffs) {
    const text = await page.locator(selector).first().textContent();
    record({ check: `${label}: цена тарифа на месте ${selector}`, ok: /₽/.test(text ?? ""), detail: (text ?? "").match(/[\d\s\u00a0]+₽/u)?.[0]?.trim() });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  record({ check: `${label}: без горизонтальной прокрутки страницы`, ok: overflow <= 1, detail: `scrollWidth − innerWidth = ${overflow}` });

  await trigger.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, `${label.replace(/[^a-z0-9]+/gi, "_")}.png`) });
  await trigger.click();
  await checkDialog(page, label, label.replace(/[^a-z0-9]+/gi, "_"));

  if (spec.route === "/settings/services") {
    // «Чат на сайте»: окно закрывается, открывается чат поддержки (событие шины).
    await page.evaluate(() => {
      window.__chatOpened = 0;
      window.addEventListener("wesetup:support-chat-open", () => {
        window.__chatOpened += 1;
      });
    });
    await trigger.click();
    await page.locator("[data-contact-us-dialog] [data-contact-chat]").click();
    await page.locator("[data-contact-us-dialog]").waitFor({ state: "hidden", timeout: 10_000 });
    await page.waitForFunction(() => window.__chatOpened > 0, null, { timeout: 5_000 }).catch(() => null);
    const chatOpened = await page.evaluate(() => window.__chatOpened);
    record({ check: `${label}: «Чат на сайте» закрывает окно и открывает чат`, ok: chatOpened > 0, detail: `events ${chatOpened}` });
    await page.screenshot({ path: path.join(SHOTS, `${label.replace(/[^a-z0-9]+/gi, "_")}-chat.png`) });
    // Чат остаётся открытым — перезагружаем страницу для шага заявки.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="service-order-journals-setup"]').waitFor({ state: "visible", timeout: 120_000 });
    await page.waitForFunction(() => document.readyState === "complete", null, { timeout: 60_000 });
    await page.waitForTimeout(1500);

    // Заявка: без цены, без «Оплатить», с крупными контактами.
    await page.locator('[data-testid="service-order-journals-setup"]').click();
    const order = page.locator('[role="dialog"]').filter({ has: page.locator("[data-service-order-contacts]") });
    await order.waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForTimeout(400);
    const orderText = (await order.textContent()) ?? "";
    const phoneVisible = await order.locator("[data-contact-phone]").isVisible();
    record({
      check: `${label}: окно заявки без цены и оплаты, с телефоном`,
      ok: !/₽|Оплатить|Спишем|баланс/i.test(orderText) && orderText.includes("Отправить заявку") && phoneVisible,
      detail: phoneVisible ? "phone visible" : "phone hidden",
    });
    await page.screenshot({ path: path.join(SHOTS, `${label.replace(/[^a-z0-9]+/gi, "_")}-order.png`) });
    await page.keyboard.press("Escape");
  }
  await page.close();
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
try {
  // JSON-LD /uslugi: без цены.
  const html = process.env.E2E_ONLY_MINI ? "" : await (await fetch(`${BASE}/uslugi`)).text();
  if (html) {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => match[1]).join("\n");
  record({
    check: "/uslugi: JSON-LD без price/minPrice/offers",
    ok: ld.length > 0 && !/"price"|"minPrice"|"offers"|"priceCurrency"/.test(ld) && /"Service"/.test(ld),
    detail: `ld bytes ${ld.length}, "price" in html: ${/"price"/.test(html)}`,
  });
  // Без <script>: там сериализованы общие сообщения i18n (подпись комплекта
  // оборудования «от {price} ₽» и т. п.) — это не разметка страницы.
  const markup = html.replace(/<script\b[\s\S]*?<\/script>/g, "");
  record({ check: "/uslugi: в разметке (без <script>) нет «₽»", ok: !markup.includes("₽"), detail: markup.includes("₽") ? markup.slice(markup.indexOf("₽") - 60, markup.indexOf("₽") + 5) : "ok" });
  }

  for (const viewport of process.env.E2E_ONLY_MINI ? [] : WIDTHS) {
    const publicContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    for (const spec of PAGES.filter((item) => !item.auth)) {
      await checkPage(publicContext, spec, viewport, `${spec.route} @${viewport.width}`);
    }
    await publicContext.close();

    const authContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    await authContext.addCookies([{ name: "wesetup-whats-new", value: WHATS_NEW, url: BASE }]);
    await login(authContext);
    for (const spec of PAGES.filter((item) => item.auth)) {
      await checkPage(authContext, spec, viewport, `${spec.route} @${viewport.width}`);
    }
    await authContext.close();
  }

  // Оболочка Mini App (П-3): та же страница кабинета в ws-shell=mini.
  const mini = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await mini.addCookies([{ name: "wesetup-whats-new", value: WHATS_NEW, url: BASE }]);
  await login(mini);
  // Кука оболочки — после входа: страница входа её не сохраняет.
  await mini.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  await checkPage(mini, PAGES.find((item) => item.route === "/settings/services"), WIDTHS[1], "/settings/services @390 mini");
  await mini.close();
} finally {
  await browser.close();
}

const failed = results.filter((entry) => !entry.ok);
writeFileSync(path.join(OUT, process.env.E2E_ONLY_MINI ? "e2e-results-mini.json" : "e2e-results.json"), `${JSON.stringify({ base: BASE, at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2)}\n`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
