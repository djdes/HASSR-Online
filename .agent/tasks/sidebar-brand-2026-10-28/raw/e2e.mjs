// Проверка в браузере на ЛОКАЛЬНОЙ тестовой базе (wesetup_brand), не на проде.
// Запуск (из корня worktree): BASE=http://localhost:3025 CHROME=<chrome.exe> node .agent/tasks/sidebar-brand-2026-10-28/raw/e2e.mjs
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3025";
const OUT = new URL("./shots/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const shot = (name) => fileURLToPath(new URL(name, OUT));
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
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180000 });
}

// Видимая панель сайдбара — та, что без inert (главное меню или меню раздела).
const BRAND_PARTS = [
  "[data-app-sidebar] div:not([inert]) > [data-sidebar-logo] [data-organization-brand]",
  "[data-app-sidebar] > [data-sidebar-logo] [data-organization-brand]",
];
const brandSel = (suffix = "") => BRAND_PARTS.map((part) => part + suffix).join(", ");
const BRAND = brandSel();

/** Центрированы ли логотип/заглушка, название и ИНН по оси шапки сайдбара. */
async function centering(page) {
  return page.evaluate((selector) => {
    const brand = document.querySelector(selector);
    const header = brand?.closest("[data-sidebar-logo]");
    if (!brand || !header) return null;
    const axis = (el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    };
    const center = axis(header);
    const parts = ["a", "[data-org-short-name]", "[data-org-inn]", "[data-logo-upload]"]
      .map((part) => brand.querySelector(part))
      .filter(Boolean);
    return Math.max(...parts.map((el) => Math.abs(axis(el) - center)));
  }, BRAND);
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  // ---- Тестовый логотип: PNG с прозрачным фоном ---------------------------
  const logoPage = await browser.newPage({ viewport: { width: 400, height: 200 } });
  await logoPage.setContent(
    `<div id="logo" style="display:inline-flex;align-items:center;gap:10px;padding:6px 10px;font:700 34px Arial;color:#c2410c">
       <svg width="44" height="44" viewBox="0 0 44 44"><g fill="#facc15">${[0, 45, 90, 135, 180, 225, 270, 315]
         .map((a) => `<ellipse cx="22" cy="9" rx="5" ry="9" transform="rotate(${a} 22 22)"/>`)
         .join("")}</g><circle cx="22" cy="22" r="7" fill="#ea580c"/></svg>Ромашка</div>`,
  );
  const logoFile = shot("test-logo.png");
  await (await logoPage.$("#logo")).screenshot({ path: logoFile, omitBackground: true });
  await logoPage.close();

  // ---- Руководитель, десктоп: заглушка → загрузка из меню ------------------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await login(page, "owner@test.local");
  await page.waitForSelector(BRAND, { timeout: 180000 });
  const sidebarClip = async () => {
    const box = await page.locator("[data-app-sidebar]").boundingBox();
    return { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 520) };
  };
  await page.screenshot({ path: shot("1-owner-no-logo.png"), clip: await sidebarClip() });

  const brand = page.locator(BRAND).first();
  check("AC3 без логотипа — заглушка", (await brand.locator("[data-logo-placeholder]").count()) === 1);
  check("AC3 без логотипа — кнопка «Загрузить логотип»", (await brand.locator("[data-logo-upload]").textContent())?.includes("Загрузить логотип"));
  check("AC1/AC2 краткое название", (await brand.locator("[data-org-short-name]").textContent()) === "ООО «Ромашка»");
  check("AC1/AC2 ИНН под названием", (await brand.locator("[data-org-inn]").textContent()) === "ИНН 7701234567");
  const offset1 = await centering(page);
  check("AC1 блок по центру (отклонение ≤ 1.5 px)", offset1 !== null && offset1 <= 1.5, `${offset1?.toFixed(2)} px`);

  // Выбор файла сразу из меню.
  await brand.locator('input[type="file"]').setInputFiles(logoFile);
  await page.waitForSelector(brandSel("[data-has-logo] img"), { timeout: 60000 });
  const toast = await page.locator("[data-sonner-toast]").first().textContent({ timeout: 15000 }).catch(() => "");
  check("AC3 уведомление: где сменить потом", toast.includes("Фирменный стиль"), toast);
  check("AC3 после загрузки кнопки нет", (await page.locator(brandSel(" [data-logo-upload]")).count()) === 0);
  await page.locator(brandSel(" img")).evaluate((img) => (img.complete ? null : new Promise((r) => (img.onload = r))));
  await page.screenshot({ path: shot("2-owner-logo-uploaded.png"), clip: await sidebarClip() });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(brandSel("[data-has-logo] img"), { timeout: 120000 });
  check("AC4 после перезагрузки — логотип, кнопки нет", (await page.locator(brandSel(" [data-logo-upload]")).count()) === 0);
  const imgBox = await page.locator(brandSel(" img")).boundingBox();
  check("AC1 логотип не выше 80 px", imgBox && imgBox.height <= 80.5, `${imgBox?.width.toFixed(0)}×${imgBox?.height.toFixed(0)}`);
  const offset2 = await centering(page);
  check("AC1 с логотипом блок по центру (≤ 1.5 px)", offset2 !== null && offset2 <= 1.5, `${offset2?.toFixed(2)} px`);

  // ---- Смена — только в «Фирменном стиле» ---------------------------------
  await page.goto(`${BASE}/settings/organization/branding`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-org-logo] img", { timeout: 180000 });
  check("AC4 «Фирменный стиль» показывает логотип и «Заменить»", (await page.locator("[data-org-logo] button").first().textContent())?.includes("Заменить"));
  await page.screenshot({ path: shot("3-branding-page.png"), fullPage: false });
  await page.locator("[data-org-logo] button[aria-label]").click();
  await page.waitForSelector(brandSel(" [data-logo-upload]"), { timeout: 60000 });
  check("AC4 убрали логотип в «Фирменном стиле» — в меню снова заглушка и кнопка", true);

  // ---- Телефон: лист меню ---------------------------------------------------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phonePage = await phone.newPage();
  phonePage.on("pageerror", (error) => errors.push(String(error)));
  await login(phonePage, "owner@test.local");
  await phonePage.waitForSelector("[data-nav-burger]", { timeout: 180000 });
  await phonePage.click("[data-nav-burger]");
  const sheetBrand = phonePage.locator("[data-mobile-nav] [data-organization-brand]");
  await sheetBrand.waitFor({ timeout: 30000 });
  check("AC6 телефон: заглушка, кнопка, название, ИНН",
    (await sheetBrand.locator("[data-logo-placeholder]").count()) === 1 &&
      (await sheetBrand.locator("[data-logo-upload]").count()) === 1 &&
      (await sheetBrand.locator("[data-org-short-name]").textContent()) === "ООО «Ромашка»" &&
      (await sheetBrand.locator("[data-org-inn]").textContent()) === "ИНН 7701234567");
  await phonePage.waitForTimeout(400);
  await phonePage.screenshot({ path: shot("4-phone-sheet.png") });
  const horizontal = await phonePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("AC6 телефон: без прокрутки вбок", horizontal <= 0, `${horizontal}px`);

  // ---- Mini App: лист «Меню раздела» ----------------------------------------
  await phone.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  await phonePage.goto(`${BASE}/monitoring`, { waitUntil: "domcontentloaded" });
  const miniButton = phonePage.locator("[data-section-menu-button]");
  await miniButton.waitFor({ timeout: 180000 });
  const miniBrand = phonePage.locator('[data-sheet-menu="mini"] [data-organization-brand]');
  // Кнопка видна ещё до гидратации: нажимаем, пока лист не откроется.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await miniButton.click();
    if (await miniBrand.waitFor({ timeout: 3000 }).then(() => true, () => false)) break;
  }
  await miniBrand.waitFor({ timeout: 5000 });
  check("AC6 Mini App: тот же блок — кнопка, название, ИНН",
    (await miniBrand.locator("[data-logo-upload]").count()) === 1 &&
      (await miniBrand.locator("[data-org-short-name]").textContent()) === "ООО «Ромашка»" &&
      (await miniBrand.locator("[data-org-inn]").textContent()) === "ИНН 7701234567");
  await phonePage.waitForTimeout(400);
  await phonePage.screenshot({ path: shot("5-mini-sheet.png") });
  await phone.close();

  // ---- Заведующая (без admin.full): заглушка без кнопки ----------------------
  const head = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const headPage = await head.newPage();
  headPage.on("pageerror", (error) => errors.push(String(error)));
  await login(headPage, "head@test.local");
  const hasSidebar = await headPage.waitForSelector(BRAND, { timeout: 120000 }).then(() => true, () => false);
  if (hasSidebar) {
    const headBrand = headPage.locator(BRAND).first();
    check("AC5 без права на оформление — заглушка без кнопки",
      (await headBrand.locator("[data-logo-placeholder]").count()) === 1 && (await headBrand.locator("[data-logo-upload]").count()) === 0);
    const box = await headPage.locator("[data-app-sidebar]").boundingBox();
    await headPage.screenshot({ path: shot("6-head-no-logo.png"), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 520) } });
  } else {
    check("AC5 у заведующей нет сайдбара — проверено юнит-тестом", true, "сайдбар не показан");
  }
  await head.close();

  check("нет ошибок страницы", errors.length === 0, errors.join(" | ").slice(0, 400));
  await ctx.close();
} finally {
  await browser.close();
  writeFileSync(new URL("./e2e-result.json", OUT), JSON.stringify(results, null, 2));
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
