// Снимки «до/после» дизайн-прохода оболочки кабинета: три роли × сайт
// (1440×900), телефон (390×800) и Mini App-оболочка (390×800, кука
// ws-shell=mini). Кроме PNG пишет метрики каждого экрана: что в центре шапки,
// что слева вверху, заголовки h1, подписи вкладок, стрелки у пунктов главного
// меню, стиль «Пришла проверка», выход за правый край.
// Запуск из корня worktree:
//   node .agent/tasks/cabinet-design-pass-2026-10/shots.mjs <base> <tag>
// tag — before | after (папка raw/<tag>/), ROLES=owner,headchef,cook — какие роли.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3153";
const TAG = process.argv[3] || "after";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "raw", TAG);
fs.mkdirSync(OUT, { recursive: true });

async function launch() {
  try {
    return await chromium.launch({ args: ["--lang=ru-RU"] });
  } catch (error) {
    const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    const dirs = fs.existsSync(base)
      ? fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d) || /^chromium_headless_shell-\d+$/.test(d))
      : [];
    dirs.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const dir of dirs) {
      const exe = dir.startsWith("chromium_headless_shell")
        ? path.join(base, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe")
        : path.join(base, dir, "chrome-win64", "chrome.exe");
      if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe, args: ["--lang=ru-RU"] });
    }
    throw error;
  }
}

const ROLES = [
  {
    id: "owner",
    email: "admin@haccp.local",
    desktop: [
      "/dashboard",
      "/production-control",
      "/settings/users",
      "/settings/organization",
      "/settings/buildings",
      "/journals",
      "/settings/sections/journals",
      "/checklists",
      "/settings/subscription",
      "/more",
      "/inspection",
    ],
    phone: ["/dashboard", "/production-control", "/settings/users", "/inspection"],
  },
  {
    id: "headchef",
    email: "chef@haccp.local",
    desktop: ["/dashboard", "/production-control", "/settings/users", "/journals", "/inspection"],
    phone: ["/dashboard", "/production-control"],
  },
  { id: "cook", email: "hotcook1@haccp.local", desktop: ["/journals"], phone: ["/journals"] },
];
const PASSWORD = "admin1234";

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
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await page.waitForTimeout(500);
}

async function goto(page, href) {
  let response = null;
  for (let attempt = 0; attempt < 3; attempt++) {
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

async function signIn(page, email) {
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email, password: PASSWORD },
    timeout: 600_000,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok() || body?.requiresCode) throw new Error(`вход ${email}: HTTP ${res.status()} ${JSON.stringify(body)}`);
}

const slug = (href) => href.replace(/^\//, "").replace(/[/?=&]+/g, "_") || "root";

/** Метрики экрана — всё, о чём писал руководитель, одним проходом по DOM. */
async function metrics(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && el.closest("[inert]") === null;
    };
    const text = (el) => (el ? el.innerText.replace(/\s+/g, " ").trim() : null);
    const sidebar = document.querySelector("[data-app-sidebar]");
    const sidebarShown = visible(sidebar);
    const brand = sidebarShown
      ? [...sidebar.querySelectorAll("[data-organization-brand]")].find(visible)
      : null;
    const point = [...document.querySelectorAll("[data-current-point]")].find(visible) ?? null;
    const header = document.querySelector("header");
    const main = document.querySelector("main") ?? document.querySelector(".mini-root") ?? document.body;
    const h1s = [...main.querySelectorAll("h1")].filter(visible).map(text);
    const tabs = [...document.querySelectorAll("[data-section-tab]")].filter(visible).map(text);
    const sections = sidebarShown
      ? [...sidebar.querySelectorAll("[data-nav-section]")].filter(visible).map((el) => ({
          key: el.getAttribute("data-nav-section"),
          label: text(el),
          chevron: Boolean(el.querySelector("svg.lucide-chevron-right, [data-nav-chevron]")),
          current: el.getAttribute("aria-current") === "page",
          bg: getComputedStyle(el).backgroundColor,
          border: getComputedStyle(el).borderTopWidth + " " + getComputedStyle(el).borderTopColor,
          color: getComputedStyle(el).color,
          lines: Math.round(el.querySelector("span")?.getBoundingClientRect().height / 18) || 1,
        }))
      : [];
    const vw = document.documentElement.clientWidth;
    const overflowRight = [];
    for (const el of main.querySelectorAll("a,button,input,h1,h2")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      // Внутри горизонтального скролла (таблицы, вкладки) — не считаем.
      let p = el.parentElement;
      let scrolled = false;
      while (p && p !== main) {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === "auto" || ox === "scroll" || ox === "hidden") && p.scrollWidth > p.clientWidth + 1) {
          scrolled = true;
          break;
        }
        p = p.parentElement;
      }
      if (!scrolled && r.right > vw + 1) overflowRight.push(`${el.tagName.toLowerCase()}:${text(el)?.slice(0, 40)} right=${Math.round(r.right)}`);
    }
    const company = sidebarShown ? text(brand)?.replace(/Добавить логотип/, "").trim() : null;
    const mainText = main.innerText || "";
    return {
      url: location.pathname,
      companyInMain: company ? mainText.includes(company) : null,
      eyebrows: [...main.querySelectorAll("h1")].filter(visible).map((h) => h.previousElementSibling && /uppercase/.test(h.previousElementSibling.className) ? text(h.previousElementSibling) : null).filter(Boolean),
      sidebar: sidebarShown,
      sidebarMode: sidebar?.getAttribute("data-sidebar-mode") ?? null,
      sidebarBrand: text(brand),
      headerCenter: text(point),
      headerCenterKind: point?.getAttribute("data-current-point") || null,
      headerText: text(header)?.slice(0, 200) ?? null,
      h1s,
      tabs,
      sections,
      pageScrollX: document.documentElement.scrollWidth > vw + 1,
      overflowRight: overflowRight.slice(0, 10),
    };
  });
}

async function desktop(browser, role, out) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await context.newPage();
  await signIn(page, role.email);
  for (const href of role.desktop) {
    await goto(page, href);
    const m = await metrics(page);
    out[`desktop ${href}`] = m;
    await page.screenshot({ path: path.join(OUT, `desktop-${role.id}-${slug(href)}.png`) });
    console.log(`  desktop ${href}: center=${m.headerCenter} brand=${m.sidebarBrand} h1=${JSON.stringify(m.h1s)} overflow=${m.overflowRight.length}`);
  }
  // Главное меню (из раздела — «‹ Главное меню»).
  const back = page.locator("[data-app-sidebar] button[data-back-to-main]");
  const mode = await page.locator("[data-app-sidebar]").getAttribute("data-sidebar-mode").catch(() => null);
  if (mode === "section" && (await back.isVisible().catch(() => false))) {
    await back.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  if (await page.locator("[data-app-sidebar]").isVisible().catch(() => false)) {
    out["desktop main-menu"] = await metrics(page);
    await page.screenshot({ path: path.join(OUT, `desktop-${role.id}-main-menu.png`) });
    await page.locator("[data-app-sidebar]").screenshot({ path: path.join(OUT, `desktop-${role.id}-main-menu-sidebar.png`) });
    // Наведение на пункт без меню и на «Пришла проверка» — как выглядит hover.
    const inspection = page.locator('[data-app-sidebar] [data-nav-section="inspection"]').filter({ visible: true }).first();
    if (await inspection.isVisible().catch(() => false)) {
      await inspection.hover({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(300);
      await page.locator("[data-app-sidebar]").screenshot({ path: path.join(OUT, `desktop-${role.id}-sidebar-hover-inspection.png`) });
    }
  }
  try {
    // Главное меню без открытого раздела — на «Остальном» (своего меню нет).
    if (role.desktop.includes("/more") || role.id === "headchef") {
      await goto(page, "/more");
      // Курсор остался над «Пришла проверка» после наведения — уводим в сторону.
      await page.mouse.move(900, 450);
      await page.waitForTimeout(300);
      if (await page.locator("[data-app-sidebar]").isVisible().catch(() => false)) {
        out["desktop more-sidebar"] = await metrics(page);
        await page.locator("[data-app-sidebar]").screenshot({ path: path.join(OUT, `desktop-${role.id}-sidebar-on-more.png`) });
      }
    }
  } catch (error) {
    console.log("  ! шаг /more:", error.message.slice(0, 120));
  }
  await context.close();
}

async function phone(browser, role, out, mini) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 800 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "ru-RU",
  });
  const page = await context.newPage();
  await signIn(page, role.email);
  if (mini) await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  const tag = mini ? "mini" : "mobile";
  for (const href of role.phone) {
    await goto(page, href);
    const m = await metrics(page);
    out[`${tag} ${href}`] = m;
    await page.screenshot({ path: path.join(OUT, `${tag}-${role.id}-${slug(href)}.png`) });
    console.log(`  ${tag} ${href}: center=${m.headerCenter} h1=${JSON.stringify(m.h1s)} scrollX=${m.pageScrollX}`);
    if (mini) {
      const button = page.locator("[data-section-menu-button]");
      if (await button.isVisible().catch(() => false)) {
        out[`${tag} ${href} menu-button`] = await button.innerText();
        await button.click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(OUT, `${tag}-${role.id}-${slug(href)}-menu.png`) });
        const back = page.locator("[data-mini-menu-mode] button[data-back-to-main]");
        if (await back.isVisible().catch(() => false)) {
          await back.click();
          await page.waitForTimeout(500);
          out[`${tag} ${href} main-menu`] = await page
            .locator("[data-mini-menu-mode] [data-nav-section]")
            .evaluateAll((els) => els.map((el) => ({ key: el.getAttribute("data-nav-section"), chevron: Boolean(el.querySelector("svg.lucide-chevron-right, [data-nav-chevron]")) })));
          await page.screenshot({ path: path.join(OUT, `${tag}-${role.id}-${slug(href)}-main-menu.png`) });
        }
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      }
    } else {
      const burger = page.locator("[data-nav-burger]");
      if (await burger.isVisible().catch(() => false)) {
        await burger.click();
        await page.waitForTimeout(700);
        const nav = page.locator("[data-mobile-nav]");
        out[`${tag} ${href} sheet-mode`] = await nav.getAttribute("data-mobile-nav-mode").catch(() => null);
        await page.screenshot({ path: path.join(OUT, `${tag}-${role.id}-${slug(href)}-menu.png`) });
        const back = nav.locator("button[data-back-to-main]");
        if (await back.isVisible().catch(() => false)) {
          await back.click();
          await page.waitForTimeout(500);
        }
        out[`${tag} ${href} main-menu`] = await nav
          .locator("[data-nav-section]")
          .evaluateAll((els) => els.map((el) => ({ key: el.getAttribute("data-nav-section"), chevron: Boolean(el.querySelector("svg.lucide-chevron-right, [data-nav-chevron]")), bg: getComputedStyle(el).backgroundColor })));
        await page.screenshot({ path: path.join(OUT, `${tag}-${role.id}-${slug(href)}-main-menu.png`) });
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  }
  if (!mini && role.id !== "cook") {
    await goto(page, "/more");
    const burger = page.locator("[data-nav-burger]");
    if (await burger.isVisible().catch(() => false)) {
      await burger.click();
      await page.waitForTimeout(700);
      const nav = page.locator("[data-mobile-nav]");
      const before = new URL(page.url()).pathname;
      await page.screenshot({ path: path.join(OUT, `mobile-${role.id}-sheet-main-on-more.png`) });
      await nav.locator('[data-nav-section="staff"]').click({ timeout: 10_000 }).catch((e) => console.log("  ! drill:", e.message.slice(0, 100)));
      await page.waitForTimeout(700);
      out["mobile drill staff"] = {
        mode: await nav.getAttribute("data-mobile-nav-mode").catch(() => null),
        section: await nav.getAttribute("data-mobile-nav-section").catch(() => null),
        urlBefore: before,
        urlAfter: new URL(page.url()).pathname,
        items: await nav.locator("[data-menu-item]").evaluateAll((els) => els.map((el) => el.getAttribute("data-menu-item"))),
        focused: await page.evaluate(() => document.activeElement?.getAttribute("data-back-to-main") !== null),
      };
      await page.screenshot({ path: path.join(OUT, `mobile-${role.id}-sheet-drill-staff.png`) });
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  if (mini) {
    // Лист Mini App: из «Главного меню» раздел со стрелкой раскрывается на месте.
    await goto(page, "/production-control");
    const button = page.locator("[data-section-menu-button]");
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await page.waitForTimeout(700);
      await page.locator("[data-mini-menu-mode] button[data-back-to-main]").click().catch(() => {});
      await page.waitForTimeout(500);
      await page.locator('[data-mini-menu-mode] [data-nav-section="staff"]').click().catch(() => {});
      await page.waitForTimeout(700);
      out["mini drill staff"] = {
        mode: await page.locator("[data-mini-menu-mode]").getAttribute("data-mini-menu-mode").catch(() => null),
        section: await page.locator("[data-mini-menu-mode]").getAttribute("data-section-menu").catch(() => null),
        urlAfter: new URL(page.url()).pathname,
        items: await page.locator("[data-mini-menu-mode] [data-menu-item]").evaluateAll((els) => els.map((el) => el.getAttribute("data-menu-item"))),
      };
      await page.screenshot({ path: path.join(OUT, `mini-${role.id}-sheet-drill-staff.png`) });
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
    await goto(page, "/mini/sections");
    out["mini /mini/sections"] = await page.evaluate(() =>
      [...document.querySelectorAll("a.mini-item")].map((el) => ({
        href: el.getAttribute("href"),
        label: el.querySelector("span span")?.textContent?.trim(),
        chevron: Boolean(el.querySelector("svg.lucide-chevron-right, [data-nav-chevron]")),
      })),
    );
    await page.screenshot({ path: path.join(OUT, `mini-${role.id}-sections.png`), fullPage: true });
  }
  await context.close();
}

const only = process.env.ROLES ? process.env.ROLES.split(",") : null;
const browser = await launch();
const results = { base: BASE, tag: TAG, startedAt: new Date().toISOString(), roles: {} };
const file = path.join(OUT, only ? `metrics-${only.join("-")}.json` : "metrics.json");
try {
  for (const role of ROLES) {
    if (only && !only.includes(role.id)) continue;
    console.log(`== ${role.id}`);
    const out = {};
    results.roles[role.id] = out;
    await desktop(browser, role, out);
    await phone(browser, role, out, false);
    await phone(browser, role, out, true);
    fs.writeFileSync(file, JSON.stringify(results, null, 2));
  }
} finally {
  await browser.close();
}
results.finishedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(results, null, 2));
console.log("готово:", file);
