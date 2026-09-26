// Task 1 и Task 10 на стенде: приложение WeSetup получает мобильную оболочку
// с первого запроса и на широком экране без перезагрузок по кругу; своя кнопка
// «назад» на вложенных экранах; экран «Обновите приложение» для старой версии.
// Стенд на 3021 с MOBILE_APP_MIN_VERSION=1.0.0.
// Запуск: node --import tsx .agent/tasks/mobile-apps-2026-09/e2e/server-shell.ts
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { APP_UA, BASE, USERS, db, signIn } from "./server-db";

const SHOTS = "d:/wt/tmp";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const HIDE_DEV =
  "try{localStorage.setItem(\"wesetup.last-seen-build-sha\",\"zzz\")}catch(e){};" +
  "document.addEventListener(\"DOMContentLoaded\",function(){var s=document.createElement(\"style\");" +
  "s.textContent=\"nextjs-portal{display:none!important}\";document.head.appendChild(s)})";

async function context(browser: Browser, ua: string, width: number, height = 900) {
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width, height } });
  await ctx.addInitScript(HIDE_DEV);
  return ctx;
}

/** Считает полные загрузки страницы за окно — ловит перезагрузку по кругу. */
async function loadsDuring(page: Page, ms: number): Promise<number> {
  let loads = 0;
  const onLoad = () => loads++;
  page.on("load", onLoad);
  await page.waitForTimeout(ms);
  page.off("load", onLoad);
  return loads;
}

const BACK = "header.mini-topbar button[aria-label=\"Назад\"]";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const out: Record<string, unknown> = {};
  try {
    // 1. Первый запуск приложения без куки и без входа.
    {
      const ctx = await context(browser, APP_UA("1.0.0"), 1366);
      const page = await ctx.newPage();
      const res = await page.goto(`${BASE}/mini?src=app`, { waitUntil: "load", timeout: 300000 });
      const setCookie = (await res?.allHeaders())?.["set-cookie"] ?? "";
      out.firstLoadSetCookie = /ws-shell=mini/.test(setCookie);
      await page.waitForTimeout(1500);
      out.firstLoadPath = new URL(page.url()).pathname;
      out.firstLoadMiniRoot = await page.locator("#mini-root").count();
      out.firstLoadGate = await page.getByTestId("app-update-gate").count();
      out.firstLoadCookie = (await ctx.cookies(BASE)).some((c) => c.name === "ws-shell" && c.value === "mini");
      await page.screenshot({ path: `${SHOTS}/server-app-first-load.png` });
      assert.ok((out.firstLoadMiniRoot as number) > 0, "первый экран в оболочке");
      assert.equal(out.firstLoadCookie, true, "кука оболочки есть");
      assert.equal(out.firstLoadGate, 0);
      await ctx.close();
    }

    // 2. Руководитель в приложении на планшете 1366: кабинет с первого запроса
    //    в оболочке (куки оболочки в браузере нет), без перезагрузки по кругу.
    {
      const ctx = await context(browser, APP_UA("1.0.0"), 1366);
      await signIn(ctx, USERS.managerA);
      await ctx.clearCookies({ name: "ws-shell" });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 300000 });
      out.dashboardUrl = new URL(page.url()).pathname;
      out.dashboardMiniRoot = await page.locator("#mini-root").count();
      out.dashboardReloadsIn6s = await loadsDuring(page, 6000);
      out.dashboardCookie = (await ctx.cookies(BASE)).some((c) => c.name === "ws-shell" && c.value === "mini");
      await page.screenshot({ path: `${SHOTS}/server-app-dashboard-1366.png` });
      assert.ok((out.dashboardMiniRoot as number) > 0, "кабинет в оболочке на 1366");
      assert.equal(out.dashboardReloadsIn6s, 0, "нет перезагрузки по кругу");
      assert.equal(out.dashboardCookie, true);

      // Вложенный экран: своя кнопка «назад» в шапке.
      await page.goto(`${BASE}/journals/hygiene`, { waitUntil: "load", timeout: 300000 });
      await page.waitForTimeout(2000);
      out.nestedPath = new URL(page.url()).pathname;
      out.nestedBackButton = await page.locator(BACK).count();
      out.nestedReloadsIn4s = await loadsDuring(page, 4000);
      await page.screenshot({ path: `${SHOTS}/server-app-nested-back.png` });
      assert.equal(out.nestedBackButton, 1, "своя кнопка «назад» в приложении");
      assert.equal(out.nestedReloadsIn4s, 0);
      // На домашнем экране — без неё.
      await page.goto(`${BASE}/dashboard`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      out.rootBackButton = await page.locator(BACK).count();
      assert.equal(out.rootBackButton, 0);
      await ctx.close();
    }

    // 3. Тот же руководитель с компьютера: сайт без оболочки (регрессия).
    {
      const ctx = await context(browser, DESKTOP_UA, 1366);
      await signIn(ctx, USERS.managerA);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 300000 });
      await page.waitForTimeout(1500);
      out.desktopMiniRoot = await page.locator("#mini-root").count();
      out.desktopCookie = (await ctx.cookies(BASE)).some((c) => c.name === "ws-shell");
      assert.equal(out.desktopMiniRoot, 0, "на компьютере хром сайта");
      assert.equal(out.desktopCookie, false);
      await ctx.close();
    }

    // 4. Старое приложение 0.9.0 — экран «Обновите приложение» и на /mini, и в кабинете.
    {
      const ctx = await context(browser, APP_UA("0.9.0"), 390, 844);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/mini?src=app`, { waitUntil: "load", timeout: 300000 });
      out.oldGateMini = await page.getByTestId("app-update-gate").count();
      out.oldGateHref = await page.getByTestId("app-update-gate").locator("a").getAttribute("href");
      await page.screenshot({ path: `${SHOTS}/server-app-update-gate.png` });
      await signIn(ctx, USERS.cookA);
      await page.goto(`${BASE}/journals`, { waitUntil: "load", timeout: 300000 });
      out.oldGateCabinet = await page.getByTestId("app-update-gate").count();
      assert.equal(out.oldGateMini, 1);
      assert.equal(out.oldGateHref, "https://play.google.com/store/apps/details?id=ru.wesetup.app");
      assert.equal(out.oldGateCabinet, 1);
      await ctx.close();
    }

    // 5. Актуальная 1.0.0 — обычная работа.
    {
      const ctx = await context(browser, APP_UA("1.0.0"), 390, 844);
      await signIn(ctx, USERS.cookA);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/journals`, { waitUntil: "load", timeout: 300000 });
      await page.waitForTimeout(1000);
      out.freshPath = new URL(page.url()).pathname;
      out.freshGate = await page.getByTestId("app-update-gate").count();
      out.freshMiniRoot = await page.locator("#mini-root").count();
      await page.screenshot({ path: `${SHOTS}/server-app-fresh-journals.png` });
      assert.equal(out.freshGate, 0);
      assert.ok((out.freshMiniRoot as number) > 0);
      await ctx.close();
    }
    console.log(JSON.stringify({ ok: true, ...out }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, ...out }, null, 2));
    throw error;
  } finally {
    await browser.close();
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("FAIL", error);
  process.exit(1);
});
