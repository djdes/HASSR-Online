// Смоук нового меню кабинета (nav-shell-2026-10) на e2e-стенде.
// Перед запуском: npx tsx .agent/tasks/nav-shell-2026-10/e2e/setup.ts
// Запуск: npx tsx .agent/tasks/nav-shell-2026-10/e2e/smoke.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://localhost:3025";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RAW = path.join(HERE, "..", "raw");
fs.mkdirSync(RAW, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(HERE, "state.json"), "utf8"));

// SMOKE_ONLY=S4,S5 — прогнать только эти сценарии (по номеру блока).
const ONLY = (process.env.SMOKE_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const want = (block: string) => ONLY.length === 0 || ONLY.includes(block);

const results: Array<{ id: string; name: string; ok: boolean; details?: unknown }> = [];
const errors: string[] = [];
function check(id: string, name: string, ok: boolean, details?: unknown) {
  results.push({ id, name, ok, details });
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${details !== undefined ? " " + JSON.stringify(details) : ""}`);
}

async function makeContext(
  browser: Browser,
  width: number,
  theme: "light" | "dark",
  storage?: string,
): Promise<BrowserContext> {
  const mobile = width < 768;
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
    storageState: storage,
  });
  // На dev-стенде (HTTP/1.1) оптимизатор картинок отвечает десятки секунд: пять
  // превью журналов и поток /api/live занимают все 6 соединений к хосту, и
  // переход по ссылке ждёт в очереди. Прод ходит по HTTP/2 — там этого нет.
  if (mobile) await context.route("**/_next/image**", (route) => route.abort());
  await context.addInitScript(
    `try{localStorage.setItem("wesetup-theme-mode",${JSON.stringify(theme)});localStorage.setItem("wesetup-app-theme",${JSON.stringify(theme)});localStorage.setItem("wesetup-theme-auto-schedule","0")}catch(e){}
     document.addEventListener("DOMContentLoaded",function(){var s=document.createElement("style");s.textContent="nextjs-portal{display:none!important}";document.head.appendChild(s)})`,
  );
  return context;
}

async function login(browser: Browser, email: string): Promise<{ storage: string; landed: string }> {
  const context = await makeContext(browser, 1280, "light");
  const page = await context.newPage();
  // Форма входа работает только после гидратации: раньше нажатие уходит
  // обычным GET и страница остаётся на /login. Повторяем до успеха.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 600_000 });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 30; i += 1) {
      await page.fill("#email", email);
      await page.fill("#password", state.password);
      if ((await page.inputValue("#email")) === email) break;
      await page.waitForTimeout(300);
    }
    await page.click('button[type="submit"]');
    const left = await page
      .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180_000 })
      .then(() => true)
      .catch(() => false);
    if (left) break;
  }
  await page.waitForLoadState("load");
  // Домашняя страница может перенаправить дальше потоком RSC (заведующую —
  // на панель контроля): ждём, пока адрес перестанет меняться.
  let landed = new URL(page.url()).pathname;
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(1500);
    const now = new URL(page.url()).pathname;
    if (now === landed) break;
    landed = now;
  }
  const file = path.join(HERE, `storage-${email.split("@")[0]}.json`);
  await context.storageState({ path: file });
  await context.close();
  return { storage: file, landed };
}

async function open(page: Page, url: string) {
  page.on("pageerror", (error) => errors.push(`${url} pageerror: ${String(error).slice(0, 300)}`));
  // «load» на телефонной эмуляции иногда не наступает (долгие запросы
  // живых обновлений) — ждём разметку, а «load» даём минуту.
  const response = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
  await page.waitForLoadState("load", { timeout: 60_000 }).catch(() => null);
  await page.waitForTimeout(800);
  return response;
}

async function sidebarKeys(page: Page): Promise<string[]> {
  return page.$$eval("aside[data-app-sidebar] [data-nav-section]", (nodes) =>
    nodes.map((node) => node.getAttribute("data-nav-section") ?? ""),
  );
}

async function shot(page: Page, name: string) {
  // Снимок — подтверждение для людей, не проверка: страница может ещё
  // перенаправляться (повара с /journals уводит в приложение).
  await page.waitForLoadState("load").catch(() => null);
  await page
    .screenshot({ path: path.join(RAW, `${name}.png`), fullPage: false, timeout: 120_000 })
    .catch((error) => console.log(`screenshot ${name} skipped: ${String(error).slice(0, 120)}`));
}

async function main() {
  // Браузер Playwright этой копии может не совпадать с установленным —
  // E2E_CHROMIUM указывает путь к уже скачанному.
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.E2E_CHROMIUM || undefined,
  });
  try {
    const manager = await login(browser, state.users.manager.email);
    check("S1.1", "управляющая после входа — на «Сегодня»", manager.landed === "/dashboard", manager.landed);

    // ── 1. Управляющая, 3 точки, 1280 ───────────────────────────────
    for (const theme of (want("S1") ? ["light", "dark"] : []) as Array<"light" | "dark">) {
      const context = await makeContext(browser, 1280, theme, manager.storage);
      const page = await context.newPage();
      await open(page, "/dashboard");
      if (theme === "light") {
        const keys = await sidebarKeys(page);
        check("S1.2", "в сайдбаре 9 разделов в порядке схемы", JSON.stringify(keys) === JSON.stringify([
          "company", "staff", "points", "journals", "checklists", "productionControl", "billing", "more", "inspection",
        ]), keys);
        const active = await page.getAttribute('aside [aria-current="page"]', "data-nav-section");
        check("S1.3", "на «Сегодня» подсвечены «Журналы»", active === "journals", active);
        const tabs = await page.$$eval("[data-section-tabs] [data-section-tab]", (n) => n.map((x) => x.textContent?.trim()));
        check("S1.4", "вкладки «Журналов»: Сегодня · Все журналы · Проверка · Настройка", JSON.stringify(tabs) === JSON.stringify(["Сегодня", "Все журналы", "Проверка", "Настройка"]), tabs);
        const crumbs = await page.$$('nav[aria-label="Хлебные крошки"], nav[aria-label*="крошк"]');
        check("S1.5", "на корне раздела крошек нет", crumbs.length === 0, crumbs.length);
        const locationTabs = await page.$$("[data-location-tabs]");
        check("S1.6", "строки вкладок точек больше нет", locationTabs.length === 0, locationTabs.length);
        const point = (await page.textContent("[data-current-point]"))?.trim();
        check("S1.7", "в центре шапки — активная точка", point === state.buildings[0].name, point);
        const headerBox = await page.locator("header").first().boundingBox();
        const asideBox = await page.locator("aside[data-app-sidebar]").boundingBox();
        check("S1.8", "сайдбар 256px слева, шапка — справа от него", asideBox?.width === 256 && (headerBox?.x ?? 0) >= 255, { aside: asideBox, header: headerBox });
        await shot(page, "s1-dashboard-1280-light");

        // Переключение точки из шапки
        await page.click("[data-current-point]");
        await page.click(`[data-point-option="${state.buildings[1].id}"]`);
        await page.waitForFunction(
          (name) => document.querySelector("[data-current-point]")?.textContent?.includes(name),
          state.buildings[1].name,
          { timeout: 300_000 },
        );
        const cookies = await context.cookies();
        const buildingCookie = cookies.find((c) => c.name === "wesetup.building")?.value ?? "";
        check("S1.9", "точка переключается из шапки (cookie)", buildingCookie.endsWith(state.buildings[1].id), buildingCookie);
        await shot(page, "s1-point-switched");

        // Настройка журналов
        await open(page, "/settings/sections/journals");
        const cards = await page.$$("[data-settings-card]");
        check("S1.10", "«Журналы → Настройка» — карточки настроек", cards.length >= 12, cards.length);
        const groups = await page.$$eval("[data-settings-group]", (n) => n.map((x) => x.getAttribute("data-settings-group")));
        check("S1.11", "две группы: журналы и раздача задач", JSON.stringify(groups) === JSON.stringify(["journals", "tasks"]), groups);
        await shot(page, "s1-journals-setup");

        // /settings → Реквизиты
        await open(page, "/settings");
        // Редирект страницы приходит в потоке RSC — ждём, пока роутер перейдёт.
        await page.waitForURL((url) => url.pathname !== "/settings", { timeout: 180_000 }).catch(() => null);
        check("S1.12", "/settings ведёт в «Моя компания → Реквизиты»", new URL(page.url()).pathname === "/settings/organization", page.url());

        // Глубокая страница: крошки, первое звено — раздел
        await open(page, "/journals-progress");
        const firstCrumb = (await page.locator('nav[aria-label="Хлебные крошки"]').first().textContent())?.trim();
        const tabsDeep = await page.$$("[data-section-tabs]");
        check("S1.13", "глубже корня — крошки (первое звено «Журналы»), вкладок нет", tabsDeep.length === 0 && (firstCrumb ?? "").startsWith("Журналы"), firstCrumb);

        // Журнал во всю колонку
        await open(page, "/journals/hygiene");
        const bleed = await page.evaluate(() => {
          const el = document.querySelector('[class*="w-[calc(100vw-var(--app-sidebar-w"]') as HTMLElement | null;
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: Math.round(r.left), right: Math.round(r.right), vw: document.documentElement.clientWidth };
        });
        check("S1.14", "подложка журнала начинается от края сайдбара", bleed !== null && Math.abs(bleed.left - 256) <= 1, bleed);
        await page.emulateMedia({ media: "print" });
        const printBleed = await page.evaluate(() => {
          const el = document.querySelector('[class*="w-[calc(100vw-var(--app-sidebar-w"]') as HTMLElement | null;
          const aside = document.querySelector("aside[data-app-sidebar]") as HTMLElement | null;
          return {
            left: el ? Math.round(el.getBoundingClientRect().left) : null,
            asideVisible: aside ? getComputedStyle(aside).display !== "none" : false,
          };
        });
        check("S1.15", "в печати отступа под сайдбар нет", printBleed.left === 0 && !printBleed.asideVisible, printBleed);
        await page.emulateMedia({ media: "screen" });
        await shot(page, "s1-journal-1280");

        // Пришла проверка: выпустить QR
        await open(page, "/inspection");
        const issue = await page.$("[data-issue-qr]");
        if (issue) {
          await issue.click();
          await page.waitForSelector("[data-inspection-qr]", { timeout: 300_000 });
        }
        check("S1.16", "«Пришла проверка»: QR на экране", Boolean(await page.$("[data-inspection-qr] svg")));
        const steps = await page.$$eval("[data-inspection-step]", (n) => n.map((x) => x.getAttribute("data-inspection-step")));
        check("S1.17", "три шага у управляющей (QR, архив, готовность)", JSON.stringify(steps) === JSON.stringify(["1", "2", "3"]), steps);
        await page.click("text=На весь экран");
        await page.waitForTimeout(300);
        await shot(page, "s1-inspection-fullscreen");
        await page.keyboard.press("Escape");
        await shot(page, "s1-inspection");

        // Производственный контроль: загрузить PDF
        await open(page, "/production-control");
        const pdf = path.join(RAW, "ppk-sample.pdf");
        fs.writeFileSync(pdf, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
        const input = page.locator('[data-production-doc="ppk"] input[type="file"]');
        await input.setInputFiles(pdf);
        const ppkFilled = await page
          .waitForSelector('[data-production-doc="ppk"][data-state="filled"]', { timeout: 300_000 })
          .then(() => true)
          .catch(() => false);
        const ppkName = ppkFilled ? (await page.textContent('[data-production-doc="ppk"]')) ?? "" : "";
        check("S1.18", "ППК загружается файлом: слот показывает имя файла", ppkFilled && ppkName.includes("ppk-sample.pdf"), ppkName.slice(0, 80));
        const fileResponse = await page.request.get(`${BASE}/api/production-control/documents/ppk/file`, { timeout: 600_000 });
        check("S1.19", "файл ППК отдаётся", fileResponse.status() === 200 && (fileResponse.headers()["content-type"] ?? "").includes("pdf"), fileResponse.status());
        await shot(page, "s1-production-control");

        // Логотип
        await open(page, "/settings/organization");
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        );
        const logoFile = path.join(RAW, "logo.png");
        fs.writeFileSync(logoFile, png);
        await page.locator('[data-org-logo] input[type="file"]').setInputFiles(logoFile);
        const logoSrc = await page
          .waitForFunction(
            () => document.querySelector("aside[data-app-sidebar] [data-sidebar-logo] img")?.getAttribute("src") ?? "",
            null,
            { timeout: 300_000 },
          )
          .then((handle) => handle.jsonValue() as Promise<string>)
          .catch(() => "");
        check("S1.20", "логотип загружается файлом и встаёт в сайдбар", logoSrc.includes("/api/org-assets/"), logoSrc);
        const companyTabs = await page.$$eval("[data-section-tabs] [data-section-tab]", (n) => n.map((x) => x.textContent?.trim()));
        check("S1.20b", "«Моя компания»: вкладка «Шаблон заведения» есть", companyTabs.includes("Шаблон заведения"), companyTabs);
        await shot(page, "s1-logo");

        // Торговые точки → Настройка: живой блок онлайн-принтера на месте
        await open(page, "/settings/sections/points");
        const pointsText = (await page.textContent("main")) ?? "";
        check("S1.23", "«Торговые точки → Настройка»: онлайн-принтер", /принтер/i.test(pointsText), pointsText.slice(0, 120));

        // ⌘K находит карточки настроек
        await page.keyboard.press("Control+k");
        await page.waitForTimeout(400);
        await page.keyboard.type("отч");
        await page.waitForTimeout(800);
        const paletteText = (await page.textContent("body")) ?? "";
        check("S1.24", "⌘K находит «Отчёты»", /Остальное · Отчёты/.test(paletteText), null);
        await page.keyboard.press("Escape");

        // Остальное
        await open(page, "/more");
        const moreCards = await page.$$("[data-settings-card]");
        check("S1.21", "«Остальное» — сетка карточек", moreCards.length >= 15, moreCards.length);
        await shot(page, "s1-more");
      } else {
        await shot(page, "s1-dashboard-1280-dark");
        await open(page, "/inspection");
        await shot(page, "s1-inspection-dark");
      }
      await context.close();
    }

    // Старые адреса не падают
    if (want("S1")) {
      const context = await makeContext(browser, 1280, "light", manager.storage);
      const page = await context.newPage();
      const routes = [
        "/dashboard", "/journals", "/settings", "/settings/users", "/settings/buildings", "/settings/areas",
        "/settings/equipment", "/settings/qr-posters", "/settings/journals", "/settings/journal-access",
        "/settings/permissions", "/settings/subscription", "/settings/balance", "/settings/services",
        "/settings/notifications", "/settings/integrations/tasksflow", "/settings/audit", "/settings/inspector-portal",
        "/dashboard/compliance-audit", "/orders", "/knowledge", "/sanpin", "/checklists", "/plans", "/capa",
        "/reports", "/ideas", "/team", "/control-board", "/verifications", "/journals-progress",
        "/settings/staff-health", "/settings/sections/staff", "/settings/sections/points", "/inspection",
        "/production-control", "/more", "/settings/organization", "/settings/appearance", "/settings/names",
      ];
      const statuses: Record<string, number> = {};
      for (const route of routes) {
        // dev-сервер компилирует каждый раздел при первом заходе — ждём долго.
        const response = await page.request.get(`${BASE}${route}`, { maxRedirects: 5, timeout: 600_000 });
        statuses[route] = response.status();
      }
      const bad = Object.entries(statuses).filter(([, status]) => status >= 400);
      check("S1.22", "все разделы и старые адреса отвечают без ошибок", bad.length === 0, bad.length ? bad : Object.keys(statuses).length);
      await context.close();
    }

    // ── 2. Одна точка и выключенный флаг ────────────────────────────
    for (const [id, who] of (want("S2") ? [["S2.1", "managerOne"], ["S2.2", "managerOff"]] : []) as Array<[string, "managerOne" | "managerOff"]>) {
      const session = await login(browser, state.users[who].email);
      const context = await makeContext(browser, 1280, "light", session.storage);
      const page = await context.newPage();
      await open(page, "/journals");
      const chevron = await page.$("[data-current-point] svg.lucide-chevron-down");
      const tag = await page.$eval("[data-current-point]", (el) => el.tagName.toLowerCase());
      check(id, `${who}: имя без переключателя`, !chevron && tag === "span", { tag });
      await shot(page, `s2-${who}`);
      await context.close();
    }

    // ── 3. Повар ────────────────────────────────────────────────────
    if (want("S3")) {
      const cook = await login(browser, state.users.cook.email);
      const context = await makeContext(browser, 1280, "light", cook.storage);
      const page = await context.newPage();
      await open(page, "/journals/hygiene");
      check("S3.1", "у повара нет сайдбара и бургера", (await page.$$("aside[data-app-sidebar], [data-nav-burger]")).length === 0);
      await open(page, "/more");
      check("S3.2", "повара с «Остального» уводит", !new URL(page.url()).pathname.startsWith("/more"), page.url());
      await shot(page, "s3-cook");
      await context.close();
    }

    // ── 4. Заведующая и проверяющий ─────────────────────────────────
    if (want("S4")) {
      const head = await login(browser, state.users.headChef.email);
      const context = await makeContext(browser, 1280, "light", head.storage);
      const page = await context.newPage();
      // Вход ведёт на /dashboard, оттуда заведующую перенаправляет потоком RSC.
      await open(page, "/dashboard");
      const reached = await page
        .waitForURL((url) => url.pathname === "/control-board", { timeout: 300_000, waitUntil: "commit" })
        .then(() => true)
        .catch(() => false);
      check("S4.1", "заведующая с «Главной» попадает на панель контроля", reached, new URL(page.url()).pathname);
      await open(page, "/control-board");
      const keys = await sidebarKeys(page);
      check("S4.2", "у заведующей 8 разделов, без «Моей компании»", keys.length === 8 && !keys.includes("company"), keys);
      await open(page, "/inspection");
      const steps = await page.$$eval("[data-inspection-step]", (n) => n.map((x) => x.getAttribute("data-inspection-step")));
      check("S4.3", "заведующей: QR и архив, без готовности", JSON.stringify(steps) === JSON.stringify(["1", "2"]) && Boolean(await page.$("[data-inspection-qr]")), steps);
      const qrId = await page.$eval('a[href^="/inspector-sheet/"]', (a) => a.getAttribute("href"));
      const sheet = await page.request.get(`${BASE}${qrId}`, { timeout: 600_000 });
      check("S4.4", "лист печати открывается заведующей", sheet.status() === 200, sheet.status());
      const zip = await page.request.get(`${BASE}/api/reports/compliance-bundle?from=2026-10-01&to=2026-10-16`, { timeout: 600_000 });
      check("S4.5", "архив журналов скачивается заведующей", zip.status() === 200 && (zip.headers()["content-type"] ?? "").includes("zip"), zip.status());
      await shot(page, "s4-headchef-inspection");
      await context.close();

      const verify = await login(browser, state.users.verifyOnly.email);
      const vctx = await makeContext(browser, 1280, "light", verify.storage);
      const vpage = await vctx.newPage();
      await open(vpage, "/inspection");
      const vkeys = await sidebarKeys(vpage);
      // Чек-листы видны, если ACL журналов у организации ещё не включён — как на странице.
      const vexpected = ["staff", "journals", "inspection"];
      const vforbidden = ["company", "points", "billing", "more", "productionControl"];
      check("S4.6", "проверяющий с линейной ролью: команда, журналы, проверка — без разделов руководства", vexpected.every((k) => vkeys.includes(k)) && !vforbidden.some((k) => vkeys.includes(k)), vkeys);
      check("S4.7", "проверяющему QR виден, выпуска нет", Boolean(await vpage.$("[data-inspection-qr]")) && !(await vpage.$("[data-issue-qr]")));
      await shot(vpage, "s4-verify-inspection");
      await vctx.close();
    }

    // ── 5. Телефон 390 ──────────────────────────────────────────────
    if (want("S5")) {
      const context = await makeContext(browser, 390, "light", manager.storage);
      const page = await context.newPage();
      await open(page, "/dashboard");
      const headerHeight = await page.$eval("header", (el) => Math.round(el.getBoundingClientRect().height));
      check("S5.1", "шапка на телефоне 56px", headerHeight === 56, headerHeight);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
      check("S5.2", "нет горизонтальной прокрутки на 390px", overflow <= 390, overflow);
      await shot(page, "s5-phone-dashboard");
      await page.click("[data-nav-burger]");
      await page.waitForSelector("[data-mobile-nav]", { timeout: 30_000 });
      const items = await page.$$eval("[data-mobile-nav] [data-nav-section]", (n) => n.length);
      check("S5.3", "бургер: лист с 9 разделами", items === 9, items);
      await shot(page, "s5-phone-menu");
      const staffHref = await page.$eval('[data-mobile-nav] [data-nav-section="staff"]', (el) => el.getAttribute("href"));
      await page.click('[data-mobile-nav] [data-nav-section="staff"]');
      // На dev-сервере клиентский переход в непрогретый маршрут компилируется минутами —
      // ждём ограниченно, а при таймауте открываем адрес пункта напрямую.
      let tapNavigated = true;
      try {
        await page.waitForFunction(() => location.pathname === "/settings/users", undefined, { timeout: 120_000 });
      } catch {
        tapNavigated = false;
        await open(page, staffHref ?? "/settings/users");
      }
      await page.waitForSelector("header", { timeout: 300_000 });
      const overflowUsers = await page.evaluate(() => document.documentElement.scrollWidth);
      check("S5.4", "пункт ведёт в раздел, ширина в норме", staffHref === "/settings/users" && overflowUsers <= 390, { staffHref, tapNavigated, overflowUsers });
      await shot(page, "s5-phone-users");
      await context.close();
    }

    // ── 6. Мини-приложение ──────────────────────────────────────────
    if (want("S6")) {
      const context = await makeContext(browser, 390, "light", manager.storage);
      await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
      const page = await context.newPage();
      await open(page, "/mini/sections");
      const count = await page.$$eval('a.mini-item[href^="/"]', (n) => n.length);
      check("S6.1", "«Разделы» мини-приложения — 9 разделов", count === 9, count);
      await shot(page, "s6-mini-sections");
      await open(page, "/inspection");
      check("S6.2", "«Пришла проверка» в оболочке приложения", Boolean(await page.$("[data-inspection-qr]")));
      await shot(page, "s6-mini-inspection");
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(RAW, "smoke-result.json"), JSON.stringify({ results, errors }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} PASS, pageerrors: ${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 10).join("\n"));
  if (failed.length || errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
