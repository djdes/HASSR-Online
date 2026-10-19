// Проверка страниц «Моя компания» в браузере (pages-company-2026-10).
// Запуск из корня worktree: node .agent/tasks/pages-company-2026-10/pages-check.mjs [base] [part]
//   part: owner | phone | mini | roles | all (по умолчанию all)
// Скриншоты и results-<part>.json — в raw/.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3073";
const PART = process.argv[3] || "all";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
const SHOTS = "C:\\Users\\Two\\wesetup-backup-2026-10-17\\pages-shots\\company";
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const PASSWORD = "admin1234";
const OWNER = "admin@haccp.local";
const HEAD_CHEF = "chef@haccp.local";
const COOK = "hotcook1@haccp.local";
const PAGES = [
  { id: "organization", href: "/settings/organization" },
  { id: "documents", href: "/settings/organization/documents" },
  { id: "branding", href: "/settings/organization/branding" },
  { id: "contacts", href: "/settings/organization/contacts" },
];

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", args: ["--lang=ru-RU"] });
  } catch {
    const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    for (const dir of fs.existsSync(base) ? fs.readdirSync(base).sort().reverse() : []) {
      const exe = dir.startsWith("chromium_headless_shell")
        ? path.join(base, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe")
        : path.join(base, dir, "chrome-win64", "chrome.exe");
      if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe, args: ["--lang=ru-RU"] });
    }
    throw new Error("no browser");
  }
}

const results = { base: BASE, part: PART, startedAt: new Date().toISOString(), checks: [] };
const problems = [];
function check(name, ok, detail = null) {
  results.checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail !== null ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  if (!ok) problems.push(name);
}

async function shot(page, name, fullPage = true) {
  const file = path.join(RAW, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  fs.copyFileSync(file, path.join(SHOTS, `${name}.png`));
}

function watchErrors(page, tag) {
  page.on("pageerror", (error) => check(`${tag}: нет pageerror (${page.url()})`, false, error.message.slice(0, 200)));
}

// Ограничитель переходов: не чаще раза в 2,6 с, на 429 — ждать Retry-After.
let lastNavigation = 0;
async function throttle() {
  const wait = lastNavigation + 2_600 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNavigation = Date.now();
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const terms = page.locator("div.fixed").filter({ hasText: "Мы обновили условия" }).last();
  if (await terms.isVisible().catch(() => false)) {
    await terms.locator('input[type="checkbox"]').first().check().catch(() => {});
    await terms.getByRole("button", { name: "Принять и продолжить" }).click().catch(() => {});
    await page.waitForTimeout(1_500);
  }
  for (let i = 0; i < 2; i++) {
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(500);
}

async function goto(page, href) {
  let response = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    response = await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
    if (response?.status() !== 429) break;
    const retryAfter = Number(response.headers()["retry-after"] || 30);
    console.log(`  … 429 на ${href}, пауза ${retryAfter} с`);
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
  }
  await settle(page);
  return response;
}

/** Серверный redirect после начала стрима приходит клиенту позже domcontentloaded — ждём смены адреса. */
async function waitLeave(page) {
  await page.waitForURL((url) => !url.pathname.startsWith("/settings/organization") && url.pathname !== "/settings", { timeout: 60_000 }).catch(() => {});
  await settle(page);
}

async function reload(page) {
  await throttle();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 600_000 });
  await settle(page);
}

async function signIn(page, email) {
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD }, timeout: 600_000 });
  const body = await res.json().catch(() => null);
  if (!res.ok() || body?.requiresCode) throw new Error(`вход ${email}: HTTP ${res.status()} ${JSON.stringify(body)}`);
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function headerPreview(page) {
  return (await page.locator("[data-doc-header-preview]").textContent())?.trim() ?? "";
}

async function waitToast(page, text) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text }).first().waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
}

/** Руководитель, 1440×900: меню, Реквизиты, три новые страницы и ключевые сценарии. */
async function ownerDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await context.newPage();
  watchErrors(page, "owner");
  await signIn(page, OWNER);

  // --- Реквизиты ---
  await goto(page, "/settings/organization");
  await shot(page, "desktop-owner-organization");
  const sidebarItems = await page.locator("[data-app-sidebar] [data-menu-item]").evaluateAll((els) => els.map((el) => el.getAttribute("data-menu-item")));
  check("меню «Моя компания»: Реквизиты → Сведения → Логотип → Контакты, затем «Ещё»", JSON.stringify(sidebarItems.slice(0, 4)) === JSON.stringify(["organization", "documents", "branding", "contacts"]), sidebarItems);
  check("Реквизиты: секций #documents и #branding больше нет", (await page.locator("#documents, #branding").count()) === 0);
  const pageLinks = await page.locator("[data-company-pages] a").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  check("Реквизиты: ссылки на три новые страницы", pageLinks.length === 3 && pageLinks[0] === "/settings/organization/documents", pageLinks);
  check("Реквизиты: ИНН и «Найти» на месте", await page.getByRole("button", { name: "Найти" }).isVisible());
  check("Реквизиты: «Данные из ЕГРЮЛ» (неполный снимок демо) без падения", await page.getByText("Данные из ЕГРЮЛ").first().isVisible());
  check("Реквизиты: ссылка на «Пришла проверка» сохранена", (await page.locator('a[href="/inspection#special-mode"]').count()) > 0);
  const brandLinks = await page.locator('a[href="/settings/organization/branding"]').count();
  check("ссылки «Логотип и цвета» ведут на новую страницу (меню/шапка)", brandLinks > 0, brandLinks);

  // --- Сведения для документов ---
  await page.locator('[data-app-sidebar] [data-menu-item="documents"]').click();
  await page.waitForURL("**/settings/organization/documents", { timeout: 600_000 });
  await settle(page);
  check("переход из меню на «Сведения для документов»", page.url().endsWith("/settings/organization/documents"));
  const h1 = (await page.locator("main h1").first().textContent())?.trim();
  check("заголовок страницы — название пункта", h1 === "Сведения для документов", h1);
  await shot(page, "desktop-owner-documents");
  const before = await headerPreview(page);
  results.documentsHeaderBefore = before;
  check("предпросмотр: в шапке ИНН организации", before.includes("ИНН 7701234567"), before);
  check("предпросмотр: на неполном снимке руководитель из ЕГРЮЛ", (await page.locator('[data-doc-rows-preview] [data-row="director"]').textContent())?.includes("Иванова Анна Петровна"), await page.locator('[data-doc-rows-preview] [data-row="director"]').textContent().catch(() => null));

  // Ввод КПП → шапка меняется сразу.
  await page.locator("#doc-kpp").fill("770199001");
  const afterKpp = await headerPreview(page);
  check("ввод КПП сразу виден в шапке журнала", afterKpp.includes("КПП 770199001"), afterKpp);
  await page.locator("#doc-journalShortName").fill("Берёзка");
  const afterName = await headerPreview(page);
  check("название для журналов сразу в шапке", afterName.startsWith("Берёзка"), afterName);

  // Неверный ОГРН → ошибка у поля.
  await page.locator("#doc-ogrn").fill("123");
  await page.locator("[data-unsaved-bar] button").filter({ hasText: "Сохранить" }).click();
  const ogrnError = page.locator("#doc-ogrn").locator("xpath=ancestor::div[contains(@class,'min-w-0')][1]").locator("[data-field-error]");
  await ogrnError.waitFor({ timeout: 20_000 }).catch(() => {});
  check("ошибка ОГРН показана у поля", await ogrnError.isVisible().catch(() => false), await ogrnError.textContent().catch(() => null));
  await shot(page, "desktop-owner-documents-ogrn-error", false);
  await page.locator("#doc-ogrn").fill("1027700132195");

  // Смена точки → шапка точки.
  const points = page.locator("[data-point-picker] [role=radio]");
  const pointCount = await points.count();
  check("выбор точки: точек две — переключатель", pointCount === 2, pointCount);
  const firstScope = await page.locator("[data-preview-scope]").textContent();
  await points.nth(1).click();
  const secondScope = await page.locator("[data-preview-scope]").textContent();
  const pointHeader = await headerPreview(page);
  check("смена точки меняет предпросмотр", firstScope !== secondScope && pointHeader.includes("Берёзка на Мира"), { firstScope, secondScope, pointHeader });
  await page.locator("#point-kpp").fill("770145002");
  await page.locator("#point-phone").fill("+7 495 123-45-67");
  const pointHeader2 = await headerPreview(page);
  check("КПП и телефон точки сразу в шапке", pointHeader2.includes("КПП 770145002") && pointHeader2.includes("тел. +7 495 123-45-67"), pointHeader2);
  await shot(page, "desktop-owner-documents-edited");

  // Сохранить → перезагрузить → значения на месте.
  await page.locator("[data-unsaved-bar] button").filter({ hasText: "Сохранить" }).click();
  check("сохранение: тост «Сведения для документов сохранены»", await waitToast(page, "Сведения для документов сохранены"));
  await reload(page);
  await page.locator("[data-point-picker] [role=radio]").nth(1).click();
  const persisted = {
    kpp: await page.locator("#doc-kpp").inputValue(),
    ogrn: await page.locator("#doc-ogrn").inputValue(),
    shortName: await page.locator("#doc-journalShortName").inputValue(),
    pointKpp: await page.locator("#point-kpp").inputValue(),
    pointPhone: await page.locator("#point-phone").inputValue(),
    header: await headerPreview(page),
  };
  results.documentsPersisted = persisted;
  check(
    "после перезагрузки правки на месте",
    persisted.kpp === "770199001" && persisted.ogrn === "1027700132195" && persisted.shortName === "Берёзка" && persisted.pointKpp === "770145002" && persisted.pointPhone === "+7 495 123-45-67",
    persisted,
  );
  // «Вернуть из ЕГРЮЛ» у руководителя: правка → кнопка → значение реестра.
  await page.locator("#doc-directorName").fill("Петров Пётр");
  const reset = page.locator("#doc-directorName").locator("xpath=ancestor::div[contains(@class,'space-y-1.5')][1]").getByRole("button", { name: "Вернуть из ЕГРЮЛ" });
  check("«Вернуть из ЕГРЮЛ» появляется у правки", await reset.isVisible().catch(() => false));
  await reset.click().catch(() => {});
  check("«Вернуть из ЕГРЮЛ» очищает правку", (await page.locator("#doc-directorName").inputValue()) === "");
  await page.locator("[data-unsaved-bar] button").filter({ hasText: "Сбросить" }).click().catch(() => {});
  await shot(page, "desktop-owner-documents-saved");

  // --- Логотип и цвета ---
  await goto(page, "/settings/organization/branding");
  await shot(page, "desktop-owner-branding-empty");
  check("цвет не задан — подсказка «чёрно-белые»", (await page.locator("[data-contrast-check]").getAttribute("data-contrast-check")) === "none");
  check("подпись: интерфейс кабинета не перекрашивается", (await page.locator("[data-brand-note]").textContent())?.includes("не перекрашивается"));
  // Загрузка логотипа.
  await page.locator('[data-org-logo] input[type="file"]').setInputFiles(path.join(RAW, "logo-sample.png"));
  check("логотип загружен (тост)", await waitToast(page, "Логотип"));
  await page.locator("[data-brand-logo]").waitFor({ timeout: 30_000 }).catch(() => {});
  check("логотип в миниатюре шапки журнала", (await page.locator("[data-brand-logo]").count()) > 0);
  // Тёмный цвет: контраст хороший, полоса в шапке.
  await page.locator("#brand-color-text").fill("#c2410c");
  check("цвет #c2410c: контраст хороший", (await page.locator("[data-contrast-check]").getAttribute("data-contrast-check")) === "ok");
  check("полоса фирменного цвета в миниатюре", (await page.locator("[data-brand-band]").count()) === 1);
  // Светлый цвет: предупреждение о затемнении линий.
  await page.locator("#brand-color-text").fill("#fde68a");
  const lightState = await page.locator("[data-contrast-check]").getAttribute("data-contrast-check");
  check("светлый цвет #fde68a: предупреждение о контрасте", lightState === "light", await page.locator("[data-contrast-check]").textContent());
  await shot(page, "desktop-owner-branding-light", false);
  await page.locator("#brand-color-text").fill("#c2410c");
  await page.locator("[data-unsaved-bar] button").filter({ hasText: "Сохранить" }).click();
  check("цвет сохранён (тост)", await waitToast(page, "Сохранено"));
  await reload(page);
  const savedColor = await page.locator("#brand-color-text").inputValue();
  check("после перезагрузки цвет и логотип на месте", savedColor === "#c2410c" && (await page.locator("[data-brand-logo]").count()) > 0, savedColor);
  const sidebarLogo = await page.locator("[data-app-sidebar] img").count();
  check("логотип виден в меню слева", sidebarLogo > 0, sidebarLogo);
  // Кабинет не перекрашен: основная кнопка — индиго WeSetup.
  const accent = await page.locator("main button").filter({ hasText: "Сохранить изменения" }).evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => null);
  results.saveButtonBackground = accent;
  await shot(page, "desktop-owner-branding");

  // --- Контакты и уведомления ---
  await goto(page, "/settings/organization/contacts");
  await shot(page, "desktop-owner-contacts");
  await page.locator("#contacts-accountant").fill("bad-email");
  await page.locator("[data-unsaved-bar] button").filter({ hasText: "Сохранить" }).click();
  const emailError = page.locator("#contacts-accountant").locator("xpath=..").locator("[data-field-error]");
  await emailError.waitFor({ timeout: 20_000 }).catch(() => {});
  check("ошибка почты бухгалтера у поля", await emailError.isVisible().catch(() => false), await emailError.textContent().catch(() => null));
  await page.locator("#contacts-accountant").fill("buh@berezka.test");
  await page.locator("#contacts-phone").fill("+7 495 765-43-21");
  await page.locator('[data-field="timezone"]').click();
  await page.waitForTimeout(400);
  await shot(page, "desktop-owner-contacts-timezone", false);
  await page.getByRole("option", { name: /Asia\/Yekaterinburg/ }).click();
  await page.locator("[data-unsaved-bar] button").filter({ hasText: "Сохранить" }).click();
  check("контакты сохранены (тост)", await waitToast(page, "Сохранено"));
  await reload(page);
  const contacts = {
    accountant: await page.locator("#contacts-accountant").inputValue(),
    phone: await page.locator("#contacts-phone").inputValue(),
    timezone: (await page.locator('[data-field="timezone"]').textContent())?.trim(),
  };
  results.contactsPersisted = contacts;
  check("после перезагрузки контакты на месте", contacts.accountant === "buh@berezka.test" && contacts.phone === "+7 495 765-43-21" && contacts.timezone?.includes("Asia/Yekaterinburg"), contacts);
  const tiles = await page.locator("[data-notifications] li").count();
  check("блок «Уведомления»: Telegram, почта, сотрудники", tiles === 3, tiles);
  check("ссылка «Настроить уведомления»", (await page.locator('a[href="/settings/notifications"]').count()) > 0);
  await shot(page, "desktop-owner-contacts-saved");

  // Телефон из контактов попал в предпросмотр документов.
  await goto(page, "/settings/organization/documents");
  const phoneRow = await page.locator('[data-doc-rows-preview] [data-row="phone"]').textContent().catch(() => null);
  check("телефон из «Контактов» — в строках блока документов", phoneRow?.includes("+7 495 765-43-21"), phoneRow);

  await context.close();
}

/** Руководитель, телефон 390×800 (сайт и Mini App): четыре страницы без горизонтальной прокрутки. */
async function ownerPhone(browser, mini) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
  const page = await context.newPage();
  const tag = mini ? "mini" : "mobile";
  watchErrors(page, `owner/${tag}`);
  await signIn(page, OWNER);
  if (mini) await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  for (const { id, href } of PAGES) {
    await goto(page, href);
    check(`${tag}: ${id} без горизонтальной прокрутки`, await noHorizontalScroll(page));
    await shot(page, `${tag}-owner-${id}`);
  }
  if (mini) {
    // Меню раздела в Mini App: кнопка → лист с пунктами раздела.
    const button = page.locator("[data-section-menu-button]");
    check("mini: кнопка меню раздела", await button.isVisible().catch(() => false));
    await button.click().catch(() => {});
    await page.waitForTimeout(700);
    const items = await page.locator("[data-mini-menu-mode] [data-menu-item]").evaluateAll((els) => els.map((el) => el.getAttribute("data-menu-item")));
    check("mini: в меню раздела новые пункты", ["documents", "branding", "contacts"].every((id) => items.includes(id)), items);
    await shot(page, "mini-owner-section-menu", false);
    const title = (await page.locator("header").first().textContent().catch(() => "")) ?? "";
    results.miniHeader = title.slice(0, 200);
  } else {
    // Лист меню по бургеру: раздел «Моя компания» с новыми пунктами.
    const burger = page.locator("[data-nav-burger]");
    await burger.click().catch(() => {});
    await page.waitForTimeout(700);
    const items = await page.locator("[data-menu-item]").evaluateAll((els) => els.filter((el) => el.offsetParent !== null).map((el) => el.getAttribute("data-menu-item")));
    check("телефон: в листе меню новые пункты", ["documents", "branding", "contacts"].every((id) => items.includes(id)), items);
    await shot(page, "mobile-owner-menu-sheet", false);
  }
  await context.close();
}

/** Заведующая и повар: раздела нет, прямой заход — редирект. */
async function roles(browser) {
  for (const role of [
    { id: "headchef", email: HEAD_CHEF },
    { id: "cook", email: COOK },
  ]) {
    for (const viewport of [
      { tag: "desktop", width: 1440, height: 900 },
      { tag: "mobile", width: 390, height: 800 },
    ]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: "ru-RU", ...(viewport.tag === "mobile" ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
      const page = await context.newPage();
      watchErrors(page, `${role.id}/${viewport.tag}`);
      await signIn(page, role.email);
      for (const { id, href } of PAGES.slice(1)) {
        await goto(page, href);
        await waitLeave(page);
        const url = new URL(page.url());
        check(`${role.id}/${viewport.tag}: ${id} закрыта (редирект на ${url.pathname})`, !url.pathname.startsWith("/settings/organization"), url.pathname);
        if (id === "documents") await shot(page, `${viewport.tag}-${role.id}-documents-redirect`, false);
      }
      if (viewport.tag === "desktop") {
        const sections = await page.locator("[data-app-sidebar] [data-nav-section]").evaluateAll((els) => els.map((el) => el.getAttribute("data-nav-section")));
        check(`${role.id}: раздела «Моя компания» в меню нет`, !sections.includes("company"), sections);
      }
      await context.close();
    }
  }
  // Mini App заведующей — тот же редирект.
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "ru-RU" });
  const page = await context.newPage();
  await signIn(page, HEAD_CHEF);
  await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  await goto(page, "/settings/organization/branding");
  await waitLeave(page);
  check("mini/headchef: «Логотип и цвета» закрыта", !new URL(page.url()).pathname.startsWith("/settings/organization"), page.url());
  await shot(page, "mini-headchef-branding-redirect", false);
  await context.close();
}

/** Организация без точек (тестовый руководитель в своей базе): пустое состояние карточки точки. */
async function emptyPoints(browser) {
  // Один вход, два размера окна (второй вход подряд на этой машине ловил ECONNRESET).
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await context.newPage();
  watchErrors(page, "nopoints");
  await signIn(page, "nopoints-owner@haccp.local");
  for (const viewport of [{ tag: "desktop", width: 1440, height: 900 }, { tag: "mobile", width: 390, height: 800 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await goto(page, "/settings/organization/documents");
    check(`${viewport.tag}: без точек — пустое состояние с «Добавить точку»`, await page.locator("[data-points-empty]").isVisible().catch(() => false));
    const scope = await page.locator("[data-preview-scope]").textContent().catch(() => null);
    check(`${viewport.tag}: без точек — шапка на всю организацию`, scope?.includes("всей организации"), scope);
    check(`${viewport.tag}: без горизонтальной прокрутки`, await noHorizontalScroll(page));
    await shot(page, `${viewport.tag}-nopoints-documents`);
  }
  await context.close();
}

const browser = await launch();
try {
  if (PART === "all" || PART === "owner") await ownerDesktop(browser);
  if (PART === "all" || PART === "phone") await ownerPhone(browser, false);
  if (PART === "all" || PART === "mini") await ownerPhone(browser, true);
  if (PART === "all" || PART === "roles") await roles(browser);
  if (PART === "all" || PART === "empty") await emptyPoints(browser);
} catch (error) {
  check("скрипт дошёл до конца", false, String(error?.stack ?? error).slice(0, 800));
} finally {
  await browser.close();
  results.finishedAt = new Date().toISOString();
  results.problems = problems;
  fs.writeFileSync(path.join(RAW, `results-${PART}.json`), JSON.stringify(results, null, 2));
  console.log(problems.length ? `ПРОБЛЕМ: ${problems.length}` : "OK");
}
