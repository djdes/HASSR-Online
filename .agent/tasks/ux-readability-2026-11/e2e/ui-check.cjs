/**
 * Локальный стенд (production-сборка, `next start`), браузер — «Удобство
 * чтения» и меньше «воды» (AC1–AC6, AC8–AC10). Управляющий демо-кухни.
 * Скриншоты — в папку argv[2]; почта и пароль управляющего — JSON argv[3].
 * Запуск: node .agent/tasks/ux-readability-2026-11/e2e/ui-check.cjs <папка> <manager.json> [ac8]
 *   ac8 — только проверка «Сначала то, что осталось» (после prepare-filled.ts add).
 */
const { chromium, devices } = require("playwright");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const BASE = process.env.E2E_BASE || "http://localhost:3022";
const OUT = process.argv[2];
const MANAGER = JSON.parse(readFileSync(process.argv[3], "utf8"));
const ONLY_AC8 = process.argv[4] === "ac8";
/** Подпись кнопки профиля в шапке (navigation.header.profile). */
const PROFILE_LABEL = process.env.PROFILE_LABEL || "Профиль";

const t0 = Date.now();
const results = [];
const step = (message) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${message}`);
const check = (name, ok, details) => {
  results.push({ name, ok: Boolean(ok), details });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${details !== undefined ? ` — ${typeof details === "string" ? details : JSON.stringify(details)}` : ""}`);
};
const shot = async (page, name, fullPage = false) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  step(`screenshot ${name}`);
};
const ip = () => `198.51.100.${Math.floor(Math.random() * 200) + 20}`;

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240000 });
  await page.fill('input[type="email"], input[name="email"]', MANAGER.email);
  await page.fill('input[type="password"]', MANAGER.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }), page.click('button[type="submit"]')]);
}

/** Кегль первого видимого элемента с классом. */
const sizeOf = (page, cls) =>
  page.evaluate((c) => {
    const el = [...document.querySelectorAll(`main .${CSS.escape(c)}`)].find((node) => node.getClientRects().length > 0);
    return el ? getComputedStyle(el).fontSize : null;
  }, cls);

const htmlAttrs = (page) =>
  page.evaluate(() => Object.fromEntries([...document.documentElement.attributes].filter((a) => a.name.startsWith("data-view")).map((a) => [a.name, a.value])));

async function ac8(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": ip() } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  await login(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 240000 });
  const done = page.locator('main [data-journal-group="done"] >> visible=true').first();
  await done.waitFor({ timeout: 60000 });
  const groups = await page.evaluate(() => {
    const names = (sel) => [...document.querySelectorAll(`main ${sel} li`)].filter((li) => li.getClientRects().length > 0).map((li) => (li.innerText || "").split("\n")[0].trim());
    const heading = document.querySelector("main [data-filled-group] h3");
    return { todo: names('[data-journal-group="todo"]'), done: names('[data-journal-group="done"]'), heading: heading?.textContent?.trim() ?? null };
  });
  check("AC8 заполненный журнал — в группе ниже", groups.done.length === 1 && /уборк/i.test(groups.done[0]) && groups.todo.every((name) => !/^Журнал уборки$/i.test(name)), {
    heading: groups.heading,
    done: groups.done,
    todoFirst: groups.todo.slice(0, 3),
    todoCount: groups.todo.length,
  });
  const sortedTodo = [...groups.todo].sort((a, b) => a.localeCompare(b, "ru"));
  check("AC8 незаполненные по алфавиту", JSON.stringify(sortedTodo) === JSON.stringify(groups.todo));
  await page.locator('main [data-filled-group] >> visible=true').first().scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -260);
  await page.waitForTimeout(400);
  await shot(page, "ac8-filled-group-desktop");
  // Поиск — один список.
  await page.locator('main input[type="search"], main input[placeholder*="Найти журнал"]').first().fill("журнал");
  await page.waitForTimeout(800);
  const searching = await page.evaluate(() => document.querySelectorAll("main [data-filled-group]").length);
  check("AC8 при поиске — один список", searching === 0);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium" });
  try {
    if (ONLY_AC8) {
      await ac8(browser);
      return;
    }

    // ── Компьютер: меню профиля, размер, печать, контраст, анимация, пояснения, Tab.
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": ip() } });
    const d = await desk.newPage();
    d.setDefaultTimeout(60000);
    await login(d);
    await d.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 240000 });
    check("AC1 по умолчанию атрибуты <html>", JSON.stringify(await htmlAttrs(d)) === JSON.stringify({ "data-view-text": "normal", "data-view-contrast": "auto", "data-view-motion": "auto", "data-view-hints": "on" }), await htmlAttrs(d));
    const base13 = await sizeOf(d, "text-[13px]");
    const baseH1 = await d.evaluate(() => getComputedStyle(document.querySelector("main h1")).fontSize);
    check("AC1 обычный: 13px и заголовок 26px", base13 === "13px" && baseH1 === "26px", { base13, baseH1 });
    await shot(d, "desktop-dashboard-normal");

    // AC2: меню профиля — «Очень крупный».
    await d.locator(`header button[aria-label="${PROFILE_LABEL}"]`).last().click();
    const picker = d.locator('[role="menu"] [data-testid="text-size-picker"]');
    await picker.waitFor();
    await shot(d, "ac2-profile-menu-desktop");
    await picker.locator('[data-text-size-option="xlarge"]').click();
    await d.waitForTimeout(300);
    const attrsXl = await htmlAttrs(d);
    const xl13 = await sizeOf(d, "text-[13px]");
    const xlH1 = await d.evaluate(() => getComputedStyle(document.querySelector("main h1")).fontSize);
    check("AC2 меню профиля: размер сменился сразу, без перезагрузки", attrsXl["data-view-text"] === "xlarge", attrsXl);
    check("AC1 очень крупный: 13px → 16.9px, заголовок 26px → 29.9px", xl13 === "16.9px" && xlH1 === "29.9px", { xl13, xlH1 });
    const cookie = (await desk.cookies()).find((c) => c.name === "wesetup-view");
    check("AC1 кука устройства", cookie && decodeURIComponent(cookie.value).startsWith("t:xlarge"), cookie?.value);
    await d.keyboard.press("Escape");
    // Перезагрузка — сервер рисует сразу крупно (атрибут в HTML сервера).
    const html = await (await d.request.get(`${BASE}/dashboard`)).text();
    check("AC1 первый кадр с сервера уже крупный", /<html[^>]*data-view-text="xlarge"/.test(html));
    await d.reload({ waitUntil: "load" });
    await shot(d, "desktop-dashboard-xlarge");
    await d.emulateMedia({ media: "print" });
    const print13 = await sizeOf(d, "text-[13px]");
    check("AC1 печать не меняется: 13px", print13 === "13px", print13);
    await d.emulateMedia({ media: "screen" });

    // «Крупный».
    await d.locator(`header button[aria-label="${PROFILE_LABEL}"]`).last().click();
    await d.locator('[role="menu"] [data-text-size-option="large"]').click();
    await d.waitForTimeout(300);
    const l13 = await sizeOf(d, "text-[13px]");
    const lH1 = await d.evaluate(() => getComputedStyle(document.querySelector("main h1")).fontSize);
    check("AC1 крупный: 13px → 14.95px, заголовок → 28.08px", l13 === "14.95px" && lH1 === "28.08px", { l13, lH1 });

    // Окно «Удобство чтения»: контраст, анимация, пояснения.
    await d.locator('[role="menu"] [data-testid="open-readability"]').click();
    const dialog = d.locator('[data-testid="readability-dialog"]');
    await dialog.waitFor();
    await shot(d, "ac2-readability-dialog-desktop");
    const colorOf = (cls) =>
      d.evaluate((c) => {
        const el = [...document.querySelectorAll(`main .${CSS.escape(c)}`)].find((node) => node.getClientRects().length > 0 && !node.closest('[class~="bg-[#0b1024]"]'));
        return el ? getComputedStyle(el).color : null;
      }, cls);
    const before = { faint: await colorOf("text-[#9b9fb3]"), muted: await colorOf("text-[#6f7282]") };
    await dialog.locator('[data-testid="view-contrast"]').click();
    await d.waitForTimeout(200);
    const after = { faint: await colorOf("text-[#9b9fb3]"), muted: await colorOf("text-[#6f7282]"), flag: await d.evaluate(() => document.documentElement.hasAttribute("data-view-hc")) };
    check("AC3 высокий контраст: подписи темнее", after.flag && after.faint === "rgb(74, 78, 98)" && after.muted === "rgb(60, 64, 83)", { before, after });
    await dialog.locator('[data-testid="view-motion"]').click();
    await d.waitForTimeout(200);
    const still = await d.evaluate(() => {
      const el = [...document.querySelectorAll("main *")].find((node) => getComputedStyle(node).transitionProperty !== "none" && getComputedStyle(node).transitionProperty !== "all" ) ?? document.querySelector("main a");
      return { flag: document.documentElement.hasAttribute("data-view-still"), duration: el ? getComputedStyle(el).transitionDuration : null };
    });
    check("AC4 без анимации: флаг и мгновенные переходы", still.flag && /^(1e-05s|0\.00001s|0s)(, (1e-05s|0\.00001s|0s))*$/.test(still.duration ?? ""), still);
    await dialog.locator('[data-testid="view-hints"]').click();
    await d.waitForTimeout(200);
    await d.keyboard.press("Escape");
    const hintHidden = await d.evaluate(() => {
      const hint = document.querySelector("main [data-page-hint]");
      return hint ? getComputedStyle(hint).display : "none-found";
    });
    check("AC5 пояснения выключены — подзаголовок скрыт", hintHidden === "none", hintHidden);
    await shot(d, "desktop-dashboard-large-hc-nohints");

    // Тёмная тема + контраст: переменные светлее.
    await desk.addCookies([{ name: "wesetup-theme", value: "dark", url: BASE }]);
    await d.evaluate(() => {
      try {
        localStorage.setItem("wesetup-app-theme", "dark");
        localStorage.setItem("wesetup-theme-mode", "dark");
      } catch {}
    });
    await d.reload({ waitUntil: "load" });
    await d.waitForTimeout(800);
    const darkVars = await d.evaluate(() => {
      const shell = document.querySelector(".app-shell");
      const s = getComputedStyle(shell);
      return { theme: shell.getAttribute("data-app-theme"), muted: s.getPropertyValue("--app-text-muted").trim(), faint: s.getPropertyValue("--app-text-faint").trim() };
    });
    check("AC3 тёмная тема: подписи светлее", darkVars.theme === "dark" && darkVars.muted === "#d6d8e8" && darkVars.faint === "#cccee0", darkVars);
    await shot(d, "desktop-dashboard-dark-hc");
    await d.evaluate(() => {
      try {
        localStorage.setItem("wesetup-app-theme", "light");
        localStorage.setItem("wesetup-theme-mode", "light");
      } catch {}
    });
    await desk.addCookies([{ name: "wesetup-theme", value: "light", url: BASE }]);

    // «Скрыть пояснения везде» из блока «Как это работает»: сначала вернуть пояснения.
    await desk.addCookies([{ name: "wesetup-view", value: "t:normal|c:auto|m:auto|h:on", url: BASE }]);
    await d.goto(`${BASE}/journals`, { waitUntil: "load", timeout: 240000 });
    const guide = d.locator("main [data-page-guide] >> visible=true").first();
    const restore = d.locator("main button[data-page-hint] >> visible=true").first();
    if (await restore.count()) await restore.click();
    await guide.waitFor();
    if (!(await guide.locator('[data-testid="hide-hints-everywhere"]').count())) await guide.locator("button").first().click();
    await guide.locator('[data-testid="hide-hints-everywhere"]').click();
    await d.waitForTimeout(400);
    const afterHide = await d.evaluate(() => ({
      hints: document.documentElement.getAttribute("data-view-hints"),
      visibleHints: [...document.querySelectorAll("main [data-page-hint]")].filter((el) => el.getClientRects().length > 0).length,
      toast: document.body.innerText.includes("Пояснения скрыты"),
    }));
    check("AC5 «Скрыть пояснения везде»", afterHide.hints === "off" && afterHide.visibleHints === 0 && afterHide.toast, afterHide);
    await shot(d, "ac5-hints-hidden-journals");
    await desk.addCookies([{ name: "wesetup-view", value: "t:normal|c:auto|m:auto|h:on", url: BASE }]);

    // AC10: первая остановка Tab — «Перейти к содержимому», Enter → main.
    // Свежая загрузка без кликов: точка отсчёта Tab — начало документа.
    await d.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 240000 });
    await d.waitForTimeout(800);
    await d.keyboard.press("Tab");
    const skip = await d.evaluate(() => {
      const el = document.activeElement;
      const rect = el?.getBoundingClientRect();
      return { testid: el?.getAttribute("data-testid"), text: el?.textContent?.trim(), top: rect ? Math.round(rect.top) : null, left: rect ? Math.round(rect.left) : null };
    });
    await shot(d, "ac10-skip-link");
    await d.keyboard.press("Enter");
    const mainFocused = await d.evaluate(() => document.activeElement?.id);
    check("AC10 Tab → «Перейти к содержимому» видна, Enter → main", skip.testid === "skip-to-content" && skip.top !== null && skip.top >= 0 && skip.left >= 0 && mainFocused === "main-content", { skip, mainFocused });
    // Рамка фокуса у элемента без своего стиля фокуса (Tab по содержимому).
    let ring = null;
    for (let i = 0; i < 60 && !ring; i += 1) {
      await d.keyboard.press("Tab");
      ring = await d.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cls = el.getAttribute("class") ?? "";
        if (/focus/.test(cls) || el.hasAttribute("data-slot") || el.hasAttribute("data-nav-row") || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return null;
        const s = getComputedStyle(el);
        return { tag: el.tagName, text: (el.textContent ?? "").trim().slice(0, 40), outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}` };
      });
    }
    check("AC10 элемент без своего фокуса — рамка бренда с клавиатуры", ring && ring.outline.startsWith("solid 2px rgb(85, 102, 246)"), ring);

    // AC9: цифровая клавиатура.
    await d.goto(`${BASE}/settings/organization`, { waitUntil: "load", timeout: 240000 });
    const modes = await d.evaluate(() => [...document.querySelectorAll('main input[type="number"]')].map((el) => ({ min: el.getAttribute("min"), step: el.getAttribute("step"), inputmode: el.getAttribute("inputmode") })));
    check("AC9 числовые поля с min ≥ 0 — с inputmode", modes.length > 0 && modes.every((m) => m.min === null || Number(m.min) < 0 || m.inputmode === "numeric" || m.inputmode === "decimal"), modes);

    // AC6: плашка пробного периода — одна строка.
    await d.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 240000 });
    const banner = await d.evaluate(() => {
      const el = document.querySelector('[data-testid="billing-announcement"]');
      return el ? { text: el.innerText.replace(/\s+/g, " ").trim(), words: el.innerText.split(/\s+/).filter(Boolean).length, height: Math.round(el.getBoundingClientRect().height) } : null;
    });
    check("AC6 плашка пробного периода ≤ 12 слов", banner && banner.words <= 12 && /Тарифы/.test(banner.text), banner);
    await desk.close();

    // ── Телефон: очень крупный текст без горизонтальной прокрутки.
    const phone = await browser.newContext({ ...devices["Pixel 7"], locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": ip() } });
    await phone.addCookies([{ name: "wesetup-view", value: "t:xlarge|c:auto|m:auto|h:on", url: BASE }]);
    const p = await phone.newPage();
    p.setDefaultTimeout(60000);
    await login(p);
    for (const url of ["/dashboard", "/journals", "/settings/journals"]) {
      await p.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 240000 });
      await p.waitForTimeout(1500);
      const metrics = await p.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        width: document.documentElement.clientWidth,
        attr: document.documentElement.getAttribute("data-view-text"),
      }));
      check(`AC1 телефон, очень крупный, ${url}: без горизонтальной прокрутки`, metrics.attr === "xlarge" && metrics.overflow <= 0, metrics);
      await shot(p, `phone-xlarge${url.replace(/\//g, "_")}`);
    }
    // Лист профиля на телефоне: «Размер текста».
    await p.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 240000 });
    await p.locator(`header button[aria-label="${PROFILE_LABEL}"] >> visible=true`).first().click().catch(() => {});
    const sheetPicker = p.locator('[data-testid="profile-readability"] [data-testid="text-size-picker"] >> visible=true').first();
    const sheetOk = await sheetPicker.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    if (sheetOk) {
      await sheetPicker.scrollIntoViewIfNeeded();
      await shot(p, "ac2-profile-sheet-phone");
      await sheetPicker.locator('[data-text-size-option="normal"]').click();
      await p.waitForTimeout(300);
    }
    check("AC2 лист профиля на телефоне: размер текста", sheetOk && (await p.evaluate(() => document.documentElement.getAttribute("data-view-text"))) === "normal");
    // Из листа — окно «Удобство чтения» (контраст, анимация, пояснения).
    let phoneDialog = false;
    if (sheetOk) {
      await p.locator('[data-testid="profile-readability"] [data-testid="open-readability"] >> visible=true').first().click();
      phoneDialog = await p.locator('[data-testid="readability-dialog"]').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
      if (phoneDialog) await shot(p, "ac2-readability-dialog-phone");
      await p.keyboard.press("Escape");
    }
    check("AC2 телефон: окно «Удобство чтения» из листа профиля", phoneDialog);
    // Профиль мини-приложения (та же сессия в браузере телефона).
    await p.goto(`${BASE}/mini/me`, { waitUntil: "load", timeout: 240000 });
    const mini = p.locator('[data-testid="mini-readability"] >> visible=true').first();
    const miniOk = await mini.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    if (miniOk) {
      await mini.scrollIntoViewIfNeeded();
      await mini.locator('[data-text-size-option="large"]').click();
      await p.waitForTimeout(300);
      await shot(p, "ac2-mini-profile-readability");
    }
    check("AC2 профиль мини-приложения: «Удобство чтения»", miniOk && (await p.evaluate(() => document.documentElement.getAttribute("data-view-text"))) === "large", { url: p.url().replace(BASE, "") });
    await phone.close();

    // ── Лендинг без анимации: секции видны сразу.
    const guest = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": ip() } });
    await guest.addCookies([{ name: "wesetup-view", value: "t:large|c:auto|m:reduce|h:on", url: BASE }]);
    const g = await guest.newPage();
    g.setDefaultTimeout(60000);
    await g.goto(`${BASE}/`, { waitUntil: "load", timeout: 240000 });
    await g.waitForTimeout(1000);
    const landing = await g.evaluate(() => {
      const sections = [...document.querySelectorAll(".landing-page > section:not(.landing-hero)")];
      const last = sections[sections.length - 1];
      return { count: sections.length, lastOpacity: last ? getComputedStyle(last).opacity : null, lastFilter: last ? getComputedStyle(last).filter : null, still: document.documentElement.hasAttribute("data-view-still") };
    });
    check("AC4 лендинг без анимации: нижняя секция видна без прокрутки", landing.still && landing.lastOpacity === "1" && landing.lastFilter === "none", landing);
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
