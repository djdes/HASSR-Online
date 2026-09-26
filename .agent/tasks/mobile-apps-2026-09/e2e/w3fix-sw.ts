// Волна 3, fixes №1: в приложении WeSetup воркер кабинета (/mini-sw.js) не
// регистрируется, а старая регистрация снимается; viewport-fit=cover на месте.
// В обычном мобильном браузере воркер регистрируется как раньше.
// Стенд 3021. Запуск: node --import tsx .agent/tasks/mobile-apps-2026-09/e2e/w3fix-sw.ts
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { APP_UA, BASE, USERS, db, signIn } from "./server-db";

const SHOTS = "d:/wt/tmp";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/128.0.0.0 Mobile Safari/537.36";
const HIDE_DEV =
  "try{localStorage.setItem(\"wesetup.last-seen-build-sha\",\"zzz\")}catch(e){};" +
  "document.addEventListener(\"DOMContentLoaded\",function(){var s=document.createElement(\"style\");" +
  "s.textContent=\"nextjs-portal{display:none!important}\";document.head.appendChild(s)})";

async function registrations(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const list = await navigator.serviceWorker.getRegistrations();
    return list.map((r) => (r.active ?? r.waiting ?? r.installing)?.scriptURL ?? `(empty) ${r.scope}`);
  });
}

async function viewport(page: Page): Promise<string> {
  return (await page.locator('meta[name="viewport"]').last().getAttribute("content")) ?? "";
}

async function visitTwice(ctx: BrowserContext, label: string) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/mini/me`, { waitUntil: "load", timeout: 300000 });
  await page.waitForTimeout(4000);
  const first = await registrations(page);
  await page.goto(`${BASE}/mini/me`, { waitUntil: "load", timeout: 300000 });
  await page.waitForTimeout(4000);
  const second = await registrations(page);
  const vp = await viewport(page);
  await page.screenshot({ path: `${SHOTS}/w3fix-sw-${label}.png` });
  return { page, first, second, vp };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const out: Record<string, unknown> = {};
  try {
    const cookies = await (async () => {
      const ctx = await browser.newContext({ userAgent: MOBILE_UA });
      await signIn(ctx, USERS.managerA);
      const c = await ctx.cookies(BASE);
      await ctx.close();
      return c;
    })();

    // 1. Обычный мобильный браузер: воркер кабинета регистрируется.
    {
      const ctx = await browser.newContext({ userAgent: MOBILE_UA, viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
      await ctx.addInitScript(HIDE_DEV);
      await ctx.addCookies(cookies);
      const r = await visitTwice(ctx, "browser");
      out.browser = { first: r.first, second: r.second, viewport: r.vp };
      assert.ok(r.second.some((u) => u.endsWith("/mini-sw.js")), "в браузере воркер есть");
      await ctx.close();
    }

    // 2. Приложение, чистый профиль: воркера нет после двух заходов.
    {
      const ctx = await browser.newContext({ userAgent: APP_UA("1.0.0"), viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
      await ctx.addInitScript(HIDE_DEV);
      await ctx.addCookies(cookies);
      const r = await visitTwice(ctx, "app");
      out.app = { first: r.first, second: r.second, viewport: r.vp };
      assert.deepEqual(r.second.filter((u) => u.endsWith("/mini-sw.js")), [], "в приложении воркера нет");
      assert.match(r.vp, /viewport-fit=cover/, "viewport-fit=cover в приложении");
      await ctx.close();
    }

    // 3. Приложение с воркером, оставшимся от прежней версии: снимается.
    {
      const ctx = await browser.newContext({ userAgent: APP_UA("1.0.0"), viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
      await ctx.addInitScript(HIDE_DEV);
      await ctx.addCookies(cookies);
      const page = await ctx.newPage();
      // Статичная страница без нашего кода — ставим воркер «как раньше».
      await page.goto(`${BASE}/robots.txt`, { waitUntil: "load", timeout: 300000 }).catch(() => undefined);
      out.legacyInstalled = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.register("/mini-sw.js", { scope: "/mini" });
        await new Promise<void>((resolve) => {
          const w = reg.installing ?? reg.waiting ?? reg.active;
          if (!w || w.state === "activated") return resolve();
          w.addEventListener("statechange", () => w.state === "activated" && resolve());
          setTimeout(resolve, 15000);
        });
        return (await navigator.serviceWorker.getRegistrations()).map((r) => r.active?.scriptURL ?? r.scope);
      });
      let loads = 0;
      page.on("load", () => loads++);
      await page.goto(`${BASE}/mini/me`, { waitUntil: "load", timeout: 300000 });
      out.legacyControlledOnFirstVisit = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
      await page.waitForTimeout(4000);
      out.legacyAfterFirst = await registrations(page);
      out.legacyLoadsAfterFirst = loads;
      await page.goto(`${BASE}/mini/me`, { waitUntil: "load", timeout: 300000 });
      await page.waitForTimeout(3000);
      out.legacyAfterSecond = await registrations(page);
      out.legacyControlledOnSecondVisit = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
      out.legacyViewport = await viewport(page);
      assert.ok((out.legacyInstalled as string[]).some((u) => u.endsWith("/mini-sw.js")), "старый воркер поставлен");
      assert.deepEqual(out.legacyAfterFirst, [], "старый воркер снят");
      assert.equal(out.legacyLoadsAfterFirst, 1, "без перезагрузки");
      assert.equal(out.legacyControlledOnSecondVisit, false, "второй заход без воркера");
      assert.match(out.legacyViewport as string, /viewport-fit=cover/);
      await ctx.close();
    }
    out.ok = true;
  } finally {
    writeFileSync(".agent/tasks/mobile-apps-2026-09/e2e/w3fix-sw.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await browser.close();
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
