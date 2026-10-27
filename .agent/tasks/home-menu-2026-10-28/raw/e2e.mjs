// Проверка в браузере на ЛОКАЛЬНОЙ тестовой базе (wesetup_home_menu), не на проде.
// Запуск: node .agent/tasks/home-menu-2026-10-28/raw/e2e.mjs
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3047";
const OUT = new URL("./shots/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", "Test-12345");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120000 });
}

const sidebarKeys = (page) =>
  page.$$eval('[data-app-sidebar] [inert] ~ * [data-nav-section], [data-app-sidebar]:not([data-sidebar-mode="section"]) nav [data-nav-section]', (els) =>
    els.map((el) => el.getAttribute("data-nav-section")),
  );

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  // ---- Владелец, десктоп -------------------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await login(page, "owner@test.local");
  check("AC7 вход руководителя → /home", new URL(page.url()).pathname === "/home", page.url());
  await page.waitForSelector("[data-home-page]", { timeout: 120000 });
  // Повторяемость: избранное прошлого прогона убираем.
  await page.evaluate(() =>
    fetch("/api/me/home-favorites", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hrefs: [] }) }),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-home-page]", { timeout: 120000 });
  await page.screenshot({ path: new URL("home-desktop.png", OUT).pathname.slice(1), fullPage: true });

  const mainKeys = await page.$$eval('[data-app-sidebar] nav [data-nav-section]', (els) =>
    [...new Set(els.map((el) => el.getAttribute("data-nav-section")))],
  );
  check(
    "AC1 главное меню владельца",
    JSON.stringify(mainKeys) === JSON.stringify(["company", "monitoring", "billing", "settings", "inspection"]),
    mainKeys.join(","),
  );
  const chevrons = await page.$$eval('[data-app-sidebar] nav [data-nav-section] [data-nav-chevron]', (els) => els.length);
  check("AC1 у всех пунктов главного меню стрелка ›", chevrons === 5, String(chevrons));
  const legal = await page.textContent("[data-sidebar-legal-name]").catch(() => null);
  check("AC5 краткое юр. наименование под логотипом", legal?.includes("ООО «Ромашка»"), legal ?? "");
  const homeText = await page.textContent("[data-home-page]");
  check("AC6 главная: подпись и телефон", homeText.includes("Ваш электронный ХАССП") && homeText.includes("8 (925) 305-80-77"));
  check("AC6 главная: три контакта", (await page.$$("[data-home-contact]")).length === 3);
  check("AC6 главная: три пустых слота избранного", (await page.$$("[data-home-favorite-empty]")).length === 3);

  // Избранное: закрепить «Мониторинг → Сводка», перезагрузить, открепить.
  await page.click("[data-home-favorite-empty]");
  await page.waitForSelector('[data-search-pick="home-favorites"]');
  await page.click('[data-search-pick="home-favorites"] [data-pick-item="/monitoring"]');
  await page.waitForSelector('[data-home-favorite="/monitoring"]', { timeout: 30000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-home-favorite="/monitoring"]', { timeout: 60000 });
  check("AC6 избранное сохраняется после перезагрузки", true);
  const forged = await page.evaluate(async () => {
    const response = await fetch("/api/me/home-favorites", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hrefs: ["/root", "https://evil.example/", "/monitoring"] }),
    });
    return response.json();
  });
  check("AC6 API отбрасывает чужие адреса", JSON.stringify(forged.hrefs) === JSON.stringify(["/monitoring"]), JSON.stringify(forged));

  // Моя компания → меню раздела.
  await page.click('[data-app-sidebar] nav [data-nav-section="company"]');
  await page.waitForSelector('[data-app-sidebar][data-sidebar-section="company"]', { timeout: 120000 });
  const companyItems = await page.$$eval('[data-section-menu="company"] [data-menu-item]', (els) =>
    els.map((el) => el.getAttribute("data-menu-item")),
  );
  check(
    "AC2 меню «Моей компании»",
    JSON.stringify(companyItems) === JSON.stringify(["office", "points", "master", "more", "organization"]),
    companyItems.join(","),
  );
  const pro = await page.textContent('[data-section-menu="company"] [data-menu-item="master"]');
  check("Мастер-кабинет с меткой PRO", pro.includes("PRO"), pro);
  await page.screenshot({ path: new URL("company-menu.png", OUT).pathname.slice(1) });

  // Торговые точки → список точек, меню точек.
  await page.click('[data-section-menu="company"] [data-menu-item="points"]');
  await page.waitForURL("**/settings/buildings", { timeout: 120000 });
  await page.waitForSelector('[data-app-sidebar][data-sidebar-section="points"]', { timeout: 60000 });
  const pointItems = await page.$$eval('[data-section-menu="points"] [data-menu-item]', (els) =>
    els.map((el) => el.getAttribute("data-menu-item")),
  );
  check(
    "AC2 меню «Торговых точек»",
    JSON.stringify(pointItems.slice(0, 6)) === JSON.stringify(["staff", "journals", "productionControl", "areas", "equipment", "qr"]),
    pointItems.join(","),
  );
  await page.waitForSelector("text=Ромашка на Мира", { timeout: 60000 }).catch(() => {});
  const pointsPage = await page.textContent("main");
  check("AC7 корень «Торговых точек» — список точек", pointsPage.includes("Ромашка на Ленина") && pointsPage.includes("Ромашка на Мира"));
  await page.screenshot({ path: new URL("points.png", OUT).pathname.slice(1) });

  // «‹ Назад» из точек — в меню «Моей компании», из компании — в главное.
  await page.click("[data-app-sidebar] [data-back-to-main]");
  await page.waitForSelector('[data-app-sidebar][data-sidebar-section="company"]', { timeout: 10000 });
  check("AC2 «‹ Назад» из точек → меню «Моей компании»", true);
  const pointsActive = await page.getAttribute('[data-section-menu="company"] [data-menu-item="points"]', "aria-current");
  check("AC2 пункт-родитель подсвечен", pointsActive === "true", String(pointsActive));
  await page.click("[data-app-sidebar] [data-back-to-main]");
  await page.waitForSelector('[data-app-sidebar][data-sidebar-mode="main"]', { timeout: 10000 });
  check("AC2 «‹ Назад» из компании → главное меню", new URL(page.url()).pathname === "/settings/buildings");

  // Журналы точек.
  await page.goto(`${BASE}/journals/points`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-point-journals-card]", { timeout: 120000 });
  const cards = await page.$$eval("[data-point-journals-card]", (els) => els.map((el) => el.getAttribute("data-point-journals-card")));
  check("AC9 карточки точек (без офиса)", JSON.stringify(cards) === JSON.stringify(["b-lenina", "b-mira"]), cards.join(","));
  const sidebarSection = await page.getAttribute("[data-app-sidebar]", "data-sidebar-section");
  check("AC2 «Журналы» — своё меню слева", sidebarSection === "journals", String(sidebarSection));
  const countBefore = async (id) => page.$$eval(`[data-point-journals-card="${id}"] [data-point-journal]`, (els) => els.length);
  const leninaBefore = await countBefore("b-lenina");
  const miraBefore = await countBefore("b-mira");
  const firstCode = await page.getAttribute('[data-point-journals-card="b-lenina"] [data-point-journal]', "data-point-journal");
  await page.click(`[data-point-journals-card="b-lenina"] [data-point-journal="${firstCode}"] button`);
  await page.waitForFunction(
    ([code]) => !document.querySelector(`[data-point-journals-card="b-lenina"] [data-point-journal="${code}"]`),
    [firstCode],
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-point-journals-card]", { timeout: 120000 });
  const leninaAfter = await countBefore("b-lenina");
  const miraAfter = await countBefore("b-mira");
  check(
    "AC9 убрать журнал на одной точке — другая не меняется",
    leninaAfter === leninaBefore - 1 && miraAfter === miraBefore,
    `Ленина ${leninaBefore}→${leninaAfter}, Мира ${miraBefore}→${miraAfter}`,
  );
  await page.click('[data-point-journals-card="b-lenina"] [data-point-journals-add]');
  await page.waitForSelector('[data-search-pick="point-journals"]');
  await page.click(`[data-search-pick="point-journals"] [data-pick-item="${firstCode}"]`);
  await page.waitForSelector(`[data-point-journals-card="b-lenina"] [data-point-journal="${firstCode}"]`, { timeout: 30000 });
  check("AC9 добавить журнал обратно", true);
  await page.screenshot({ path: new URL("point-journals.png", OUT).pathname.slice(1), fullPage: true });

  // Мониторинг.
  await page.goto(`${BASE}/monitoring`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-monitoring-card]", { timeout: 120000 });
  const metricCards = await page.$$eval("[data-monitoring-card]", (els) => els.map((el) => el.getAttribute("data-monitoring-card")));
  check("AC8 три карточки мониторинга", JSON.stringify(metricCards) === JSON.stringify(["journals", "checklists", "ppk"]), metricCards.join(","));
  check("AC8 переключатель точек", (await page.$$("[data-monitoring-points] a")).length === 4);
  await page.click('[data-monitoring-points] a:has-text("Ромашка на Мира")');
  await page.waitForURL("**/monitoring?point=b-mira", { timeout: 60000 });
  check("AC8 выбор точки", true);
  const monitoringMenu = await page.$$eval('[data-section-menu="monitoring"] [data-menu-item]', (els) =>
    els.map((el) => el.getAttribute("data-menu-item")),
  );
  check("AC2 «Мониторинг» → «Чек-листы ›»", monitoringMenu.includes("checklists"), monitoringMenu.join(","));
  await page.screenshot({ path: new URL("monitoring.png", OUT).pathname.slice(1), fullPage: true });

  // Пришла проверка.
  await page.goto(`${BASE}/inspection/laws`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-section-menu="inspection"]', { timeout: 120000 });
  const inspectionItems = await page.$$eval('[data-section-menu="inspection"] [data-menu-item]', (els) =>
    els.map((el) => el.getAttribute("data-menu-item")),
  );
  check(
    "AC10 «Пришла проверка»: четыре пункта эскиза сверху",
    JSON.stringify(inspectionItems.slice(0, 4)) === JSON.stringify(["laws", "norms", "portal", "experts"]),
    inspectionItems.join(","),
  );
  const lawsCurrent = await page.getAttribute('[data-section-menu="inspection"] [data-menu-item="laws"]', "aria-current");
  check("AC10 «Нормативные документы» — страница раздела, меню не переключается", lawsCurrent === "page");
  await page.screenshot({ path: new URL("inspection-laws.png", OUT).pathname.slice(1) });
  check("нет ошибок страницы (владелец)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();

  // ---- Владелец, телефон 390 px -------------------------------------------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await phone.newPage();
  await login(mobile, "owner@test.local");
  await mobile.waitForSelector("[data-home-page]", { timeout: 120000 });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("AC6 главная на 390 px без прокрутки вбок", overflow <= 0, `лишние ${overflow}px`);
  await mobile.screenshot({ path: new URL("home-phone.png", OUT).pathname.slice(1), fullPage: true });
  await mobile.goto(`${BASE}/journals/points`, { waitUntil: "domcontentloaded" });
  await mobile.waitForSelector("[data-point-journals-card]", { timeout: 120000 });
  const burger = await mobile.$("[data-nav-burger]");
  if (burger) {
    await burger.click();
    await mobile.waitForSelector('[data-sheet-menu="mobile"]', { timeout: 15000 });
    const sheetSection = await mobile.getAttribute('[data-sheet-menu="mobile"]', "data-mobile-nav-section");
    check("AC2 лист на телефоне открывается с меню «Журналов»", sheetSection === "journals", String(sheetSection));
    await mobile.click('[data-sheet-menu="mobile"] [data-back-to-main]');
    await mobile.waitForFunction(() => document.querySelector('[data-sheet-menu="mobile"]')?.getAttribute("data-mobile-nav-section") === "points", null, { timeout: 10000 });
    check("AC2 «‹ Назад» в листе → меню «Торговых точек»", true);
    await mobile.screenshot({ path: new URL("phone-sheet.png", OUT).pathname.slice(1) });
  } else {
    check("AC2 кнопка меню на телефоне найдена", false);
  }
  await phone.close();

  // ---- Заведующая ----------------------------------------------------------
  const chefCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const chef = await chefCtx.newPage();
  await login(chef, "head@test.local");
  await chef.waitForSelector("[data-app-sidebar]", { timeout: 120000 });
  await chef.waitForURL((url) => url.pathname !== "/home", { timeout: 60000 }).catch(() => {});
  const chefPath = new URL(chef.url()).pathname;
  check("AC7 заведующая после входа — не на /home", chefPath !== "/home", chefPath);
  const chefMain = await chef.$$eval('[data-app-sidebar] nav [data-nav-section]', (els) =>
    [...new Set(els.map((el) => el.getAttribute("data-nav-section")))],
  );
  check(
    "AC3 заведующая: разделы закрытой «Моей компании» — в главном меню",
    JSON.stringify(chefMain) === JSON.stringify(["office", "points", "monitoring", "billing", "settings", "more", "inspection"]),
    chefMain.join(","),
  );
  await chef.goto(`${BASE}/home`, { waitUntil: "domcontentloaded" });
  check("заведующую /home уводит на её домашнюю", new URL(chef.url()).pathname !== "/home", chef.url());
  await chefCtx.close();
} finally {
  await browser.close();
  writeFileSync(new URL("e2e-result.json", OUT).pathname.slice(1), JSON.stringify(results, null, 2));
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exitCode = 1;
}
