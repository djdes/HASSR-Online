/**
 * Локальный стенд (production-сборка, `next start`), браузер — «Быстрее по
 * журналам за день» (AC1–AC10). Управляющий демо-кухни; для AC6 перед запуском
 * `prepare-filled.ts add` (одна запись «Журнала уборки» сегодня), после — `remove`.
 * Запуск: node .agent/tasks/today-speed-2026-11/e2e/today-check.cjs <папка скриншотов> <manager.json>
 */
const { chromium, devices } = require("playwright");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const BASE = process.env.E2E_BASE || "http://localhost:3022";
const OUT = process.argv[2];
const MANAGER = JSON.parse(readFileSync(process.argv[3], "utf8"));
const results = [];
const check = (name, ok, details) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${details !== undefined ? ` — ${typeof details === "string" ? details : JSON.stringify(details)}` : ""}`);
};
const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
const ip = () => `198.51.100.${Math.floor(Math.random() * 200) + 20}`;

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"]', MANAGER.email);
  await page.fill('input[type="password"]', MANAGER.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
}

const visible = (page, selector) => page.locator(`main ${selector} >> visible=true`).first();

/** На первом входе в журнал открывается «Как заполнять» — закрываем, если есть. */
async function closeFillGuide(page) {
  const guide = page.locator('[role="dialog"][aria-labelledby="fill-guide-title"]');
  if (await guide.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await guide.waitFor({ state: "hidden", timeout: 5000 }).catch(async () => {
      await guide.locator('button[aria-label="Закрыть"]').first().click({ force: true }).catch(() => {});
    });
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });
  try {
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": ip() } });
    await desk.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const d = await desk.newPage();
    d.setDefaultTimeout(60000);
    await login(d);

    // AC1: открыли два журнала → «Недавно открывали», свежий первым.
    for (const code of ["hygiene", "fryer_oil"]) {
      await d.goto(`${BASE}/journals/${code}`, { waitUntil: "load", timeout: 240000 });
      await d.waitForTimeout(1200);
      await closeFillGuide(d);
    }
    // AC9: «Поделиться» на странице журнала — ссылка в буфер.
    await d.locator('[data-testid="share-journal"] >> visible=true').first().click();
    await d.waitForTimeout(500);
    const clip = await d.evaluate(() => navigator.clipboard.readText());
    const toast = await d.evaluate(() => document.body.innerText.includes("Ссылка скопирована"));
    check("AC9 «Поделиться»: адрес журнала в буфере", clip === `${BASE}/journals/fryer_oil` && toast, { clip, toast });
    await shot(d, "ac9-share-journal");

    await d.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 240000 });
    await d.waitForTimeout(1500);
    const recent = await d.evaluate(() => [...document.querySelectorAll('main [data-testid="recent-journals"] [data-recent-journal]')].filter((el) => el.getClientRects().length).map((el) => el.getAttribute("data-recent-journal")));
    check("AC1 «Недавно открывали»: свежий первым", recent[0] === "fryer_oil" && recent[1] === "hygiene", recent);

    // AC2: «Дальше» ведёт на первый незаполненный.
    const next = await d.evaluate(() => {
      const link = [...document.querySelectorAll('main [data-testid="today-next"]')].find((el) => el.getClientRects().length);
      const first = [...document.querySelectorAll('main [data-journal-group="todo"] li a[href^="/journals/"]')].find((el) => el.getClientRects().length);
      return { next: link?.getAttribute("href") ?? null, firstRow: first?.getAttribute("href") ?? null, text: link?.textContent?.trim() ?? null };
    });
    check("AC2 «Дальше: …» — первый незаполненный", next.next && next.next === next.firstRow, next);

    // AC3: «До конца дня … · осталось N».
    const status = await d.evaluate(() => {
      const el = document.querySelector('main [data-testid="today-status"]');
      return el ? { text: el.textContent?.replace(/\s+/g, " ").trim(), tone: el.getAttribute("data-tone") } : null;
    });
    check("AC3 «До конца дня»", status && /(До конца дня (\d+ ч )?\d+ мин|День закрыт в \d\d:00).*осталось \d+/.test(status.text), status);

    // AC4: число незаполненных во вкладке.
    const title = await d.title();
    check("AC4 счётчик во вкладке «(N) …»", /^\(\d+\) /.test(title), title);
    await shot(d, "ac1-ac4-today-desktop");

    // AC10: «/» → поиск; «?» → окно клавиш.
    await d.locator("body").press("Escape");
    await d.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
    await d.keyboard.press("/");
    const focused = await d.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    check("AC10 «/» — фокус в поиск журналов", focused === "journal-search", focused);

    // AC5: неверная раскладка в поиске.
    // «ububty» — «гигиен» в английской раскладке.
    await d.keyboard.type("ububty");
    await d.waitForTimeout(800);
    const found = await d.evaluate(() => [...document.querySelectorAll('main [data-journal-list] li')].filter((li) => li.getClientRects().length).map((li) => (li.innerText || "").split("\n")[0]));
    check("AC5 «ububty» (= «гигиен») находит «Гигиенический журнал»", found.some((name) => /Гигиенич/.test(name)), found.slice(0, 3));
    await shot(d, "ac5-layout-search");
    await d.locator('main [data-testid="journal-search"] >> visible=true').first().fill("");
    await d.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
    await d.keyboard.press("Shift+Slash");
    const help = await d.locator('[data-testid="hotkeys-help"]').waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    check("AC10 «?» — окно горячих клавиш", help);
    if (help) await shot(d, "ac10-hotkeys-help");
    await d.keyboard.press("Escape");

    // AC10 на «Журналах» и возврат заголовка вкладки (AC4).
    await d.goto(`${BASE}/journals`, { waitUntil: "load", timeout: 240000 });
    await d.waitForTimeout(1000);
    const journalsTitle = await d.title();
    await d.keyboard.press("/");
    const focused2 = await d.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    check("AC10 «/» на «Журналах»", focused2 === "journal-search", focused2);
    check("AC4 на других страницах заголовок без счётчика", !/^\(\d+\) /.test(journalsTitle), journalsTitle);

    // AC6: «Скрыть заполненные» (база с заполненным журналом).
    await d.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 240000 });
    const toggle = visible(d, '[data-testid="toggle-filled"]');
    const hasFilled = await toggle.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    if (hasFilled) {
      await toggle.click();
      await d.waitForTimeout(300);
      const hidden = await d.evaluate(() => !document.querySelector('main [data-journal-group="done"]'));
      await d.reload({ waitUntil: "load" });
      await d.waitForTimeout(1500);
      const hiddenAfterReload = await d.evaluate(() => !document.querySelector('main [data-journal-group="done"]') && !!document.querySelector("main [data-filled-group][data-hidden]"));
      await shot(d, "ac6-filled-hidden");
      check("AC6 «Скрыть заполненные» — прячет и помнит на устройстве", hidden && hiddenAfterReload, { hidden, hiddenAfterReload });
      await visible(d, '[data-testid="toggle-filled"]').click();
    } else {
      check("AC6 «Скрыть заполненные» — есть заполненный журнал", false, "нет группы «Заполнено сегодня» — запустите prepare-filled.ts add");
    }

    // AC7: лист на печать.
    const unfilledCount = await d.evaluate(() => [...document.querySelectorAll('main [data-journal-group="todo"] li')].filter((li) => li.getClientRects().length).length);
    await visible(d, '[data-testid="today-print-link"]').click();
    await d.waitForURL((u) => u.pathname === "/dashboard/today-print", { timeout: 60000 });
    await d.waitForTimeout(800);
    const rows = await d.evaluate(() => document.querySelectorAll("[data-print-journal]").length);
    await shot(d, "ac7-print-sheet");
    await d.emulateMedia({ media: "print" });
    const printView = await d.evaluate(() => ({
      header: getComputedStyle(document.querySelector("header")).display,
      button: getComputedStyle(document.querySelector('[data-testid="today-print-button"]')).display,
    }));
    await d.pdf({ path: path.join(OUT, "ac7-print-sheet.pdf"), format: "A4" }).catch(() => null);
    await d.emulateMedia({ media: "screen" });
    check("AC7 лист: столько строк, сколько незаполненных; при печати без шапки и кнопки", rows > 0 && rows === unfilledCount && printView.header === "none" && printView.button === "none", { rows, unfilledCount, printView });
    await desk.close();

    // AC8 и AC2 на телефоне: «Наверх» и «Дальше» внизу экрана.
    const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": ip() } });
    const p = await phone.newPage();
    p.setDefaultTimeout(60000);
    await login(p);
    await p.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 240000 });
    await p.waitForTimeout(1500);
    const sticky = await p.evaluate(() => {
      const el = document.querySelector('main [data-testid="today-next-sticky"]');
      const rect = el?.getBoundingClientRect();
      return el ? { visible: el.getClientRects().length > 0, bottomGap: Math.round(window.innerHeight - (rect?.bottom ?? 0)) } : null;
    });
    await shot(p, "ac2-next-sticky-phone");
    check("AC2 телефон: «Дальше» у нижнего края экрана", sticky && sticky.visible && sticky.bottomGap >= 0 && sticky.bottomGap < 60, sticky);
    await p.mouse.wheel(0, 3000);
    await p.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
    await p.waitForTimeout(600);
    const topButton = p.locator('[data-testid="back-to-top"]');
    const shown = await topButton.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    if (shown) await shot(p, "ac8-back-to-top-phone");
    if (shown) await topButton.click();
    await p.waitForTimeout(1500);
    const scrollY = await p.evaluate(() => window.scrollY);
    check("AC8 «Наверх»: появляется после прокрутки и возвращает наверх", shown && scrollY === 0, { shown, scrollY });
    await phone.close();

    // AC7 без входа — на вход.
    const guest = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU" });
    const g = await guest.newPage();
    await g.goto(`${BASE}/dashboard/today-print?codes=hygiene`, { waitUntil: "load", timeout: 240000 });
    check("AC7 лист без входа — страница входа", new URL(g.url()).pathname.startsWith("/login"), g.url().replace(BASE, ""));
    await guest.close();
  } finally {
    await browser.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\nИтого: ${results.length - failed.length} PASS, ${failed.length} FAIL`);
    if (failed.length) process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
