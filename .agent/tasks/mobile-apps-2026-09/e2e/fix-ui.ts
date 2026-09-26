// Stream server-fixes, пункты 5-7 на стенде 3022 (NEXT_PUBLIC_YANDEX_METRIKA_ID=12345678):
// оплата в приложении, Метрика в приложении, шапка ConfirmDialog в тёмной теме.
// Запуск из d:/wt/mobile-apps:
//   node --import tsx .agent/tasks/mobile-apps-2026-09/e2e/fix-ui.ts
import fs from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { APP_UA, PASSWORD, db } from "./server-db";

const BASE = "http://localhost:3022";
const SHOTS = "d:/wt/tmp";
const OWNER = "owner-a@e2e.local";
const ORG = "e2e-org-a";
const WEB_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const INIT =
  'try{localStorage.setItem("wesetup.last-seen-build-sha","zzz")}catch(e){};' +
  "document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');" +
  "s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})";

const results: Array<{ check: string; ok: boolean; detail?: unknown }> = [];
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : " " + JSON.stringify(detail).slice(0, 300)}`);
}

async function newCtx(browser: Browser, ua: string, theme: "light" | "dark") {
  const ctx = await browser.newContext({
    userAgent: ua,
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    colorScheme: theme,
  });
  await ctx.addInitScript(INIT);
  return ctx;
}

async function login(ctx: BrowserContext) {
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: OWNER, password: PASSWORD } });
  if (r.status() !== 200) throw new Error(`login ${r.status()}`);
}

async function open(page: Page, path: string) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 300000 });
  await page.waitForTimeout(1200);
  return res;
}

/** Всё, что зовёт к оплате: ссылки на оформление и слова-действия. */
async function paymentSurface(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const links = [...main.querySelectorAll("a[href]")]
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => /\/order|\/pricing|robokassa|\/api\/payments/.test(h));
    const words = [...main.querySelectorAll("a,button")]
      .map((el) => (el.textContent ?? "").trim())
      .filter((t) => /Оплатить|Продлить|Пополнить|Улучшить|Выставить сч|Автопродл/i.test(t));
    return { links, words };
  });
}

async function main() {
  const owner = await db.user.findFirstOrThrow({ where: { email: OWNER }, select: { id: true, themePreference: true } });
  const org = await db.organization.findUniqueOrThrow({
    where: { id: ORG },
    select: { subscriptionEnd: true, balanceRub: true },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    await db.organization.update({ where: { id: ORG }, data: { balanceRub: 500 } });

    // --- 5. Оплата: сайт и приложение ---
    for (const theme of ["light", "dark"] as const) {
      await db.user.update({ where: { id: owner.id }, data: { themePreference: theme } });
      for (const mode of ["web", "app"] as const) {
        if (mode === "web" && theme === "dark") continue;
        const ctx = await newCtx(browser, mode === "app" ? APP_UA("1.0.0") : WEB_UA, theme);
        await login(ctx);
        const page = await ctx.newPage();
        for (const path of ["/settings/subscription", "/settings/balance"]) {
          const res = await open(page, path);
          const surface = await paymentSurface(page);
          const name = path.split("/").pop();
          await page.screenshot({ path: `${SHOTS}/fix-pay-${name}-${mode}-${theme}.png` });
          await page.screenshot({ path: `${SHOTS}/fix-pay-${name}-${mode}-${theme}-full.png`, fullPage: true });
          if (mode === "app") {
            check(`${path} app ${theme} 200`, res?.status() === 200, res?.status());
            check(
              `${path} app ${theme} no payment links/buttons`,
              surface.links.length === 0 && surface.words.length === 0,
              surface
            );
          } else {
            check(`${path} web still has payment actions`, surface.links.length > 0 || surface.words.length > 0, surface);
          }
        }
        if (mode === "app" && theme === "light") {
          for (const path of ["/pricing", "/order?plan=monthly", "/"]) {
            await open(page, path);
            const final = new URL(page.url()).pathname;
            check(`${path} app -> ${final}`, final.startsWith("/mini"), final);
          }
          const api = await ctx.request.post(`${BASE}/api/payments/robokassa/create`, {
            data: { tariffKey: "monthly", email: OWNER },
          });
          check("robokassa create from app 403", api.status() === 403, api.status());
          const inv = await ctx.request.post(`${BASE}/api/payments/invoice`, { data: {} });
          check("invoice from app 403", inv.status() === 403, inv.status());

          // Подписка закончилась — нейтральный текст без оплаты.
          await db.organization.update({ where: { id: ORG }, data: { subscriptionEnd: new Date("2026-09-01T00:00:00Z") } });
          await open(page, "/settings/subscription");
          const expiredText = await page.getByTestId("subscription-expired").textContent().catch(() => null);
          check(
            "expired app text",
            expiredText === "Подписка компании закончилась. Обратитесь к владельцу компании.",
            expiredText
          );
          const expSurface = await paymentSurface(page);
          check("expired app no payment", expSurface.links.length === 0 && expSurface.words.length === 0, expSurface);
          await page.screenshot({ path: `${SHOTS}/fix-pay-subscription-expired-app-light.png` });
          await db.organization.update({ where: { id: ORG }, data: { subscriptionEnd: org.subscriptionEnd } });
        }
        if (mode === "web") {
          await open(page, "/pricing");
          check("/pricing web stays", new URL(page.url()).pathname === "/pricing", page.url());
        }
        await ctx.close();
      }
    }

    // --- 6. Метрика ---
    for (const mode of ["web", "app"] as const) {
      const ctx = await newCtx(browser, mode === "app" ? APP_UA("1.0.0") : WEB_UA, "light");
      const hits: string[] = [];
      await ctx.route(/mc\.yandex\.(ru|com)/, (route) => {
        hits.push(route.request().url());
        return route.abort();
      });
      const page = await ctx.newPage();
      await open(page, mode === "app" ? "/mini/login" : "/login");
      await page.waitForTimeout(2500);
      const state = await page.evaluate(() => ({
        ym: typeof (window as unknown as { ym?: unknown }).ym,
        tagScripts: [...document.scripts].filter((s) => s.src.includes("mc.yandex")).length,
      }));
      if (mode === "app") {
        check("metrika app: no request to mc.yandex", hits.length === 0, hits);
        check("metrika app: no ym, no tag.js", state.ym === "undefined" && state.tagScripts === 0, state);
      } else {
        check("metrika web: counter loads", hits.length > 0 && state.tagScripts > 0, { hits: hits.length, state });
      }
      await ctx.close();
    }

    // --- 7. ConfirmDialog: четыре варианта, светлая и тёмная ---
    for (const theme of ["light", "dark"] as const) {
      await db.user.update({ where: { id: owner.id }, data: { themePreference: theme } });
      const ctx = await newCtx(browser, APP_UA("1.0.0"), theme);
      await login(ctx);
      const page = await ctx.newPage();
      const shot = async (variant: string) => {
        await page.locator("#confirm-dialog-title").waitFor({ timeout: 60000 });
        await page.waitForTimeout(400);
        const colors = await page.evaluate(() => {
          const title = document.getElementById("confirm-dialog-title");
          const header = title?.closest("div.relative.shrink-0") as HTMLElement | null;
          return {
            title: title ? getComputedStyle(title).color : null,
            headerBg: header ? getComputedStyle(header).backgroundImage.slice(0, 140) : null,
          };
        });
        check(`dialog ${variant} ${theme}`, Boolean(colors.title), colors);
        await page.screenshot({ path: `${SHOTS}/fix-dialog-${variant}-${theme}.png` });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      };
      // default — «Своё название журнала»
      await open(page, "/journals/hygiene");
      await page.getByRole("button", { name: "Переименовать журнал" }).first().click();
      await shot("default");
      // info — «Выйти из аккаунта?»
      await open(page, "/mini/me");
      await page.getByRole("button", { name: /^Выйти/ }).last().click();
      await shot("info");
      // warn и danger — ссылка календаря
      await open(page, "/settings/calendar");
      const create = page.getByRole("button", { name: "Создать ссылку" });
      if (await create.count()) {
        await create.click();
        await page.getByRole("button", { name: "Перевыпустить" }).first().waitFor({ timeout: 30000 });
      }
      await page.getByRole("button", { name: "Перевыпустить" }).first().click();
      await shot("warn");
      await page.getByRole("button", { name: /Отключить/ }).first().click();
      await shot("danger");
      await ctx.close();
    }
  } finally {
    await db.organization.update({
      where: { id: ORG },
      data: { balanceRub: org.balanceRub, subscriptionEnd: org.subscriptionEnd },
    });
    await db.user.update({ where: { id: owner.id }, data: { themePreference: owner.themePreference } });
    await browser.close();
    fs.writeFileSync(
      "d:/wt/mobile-apps/.agent/tasks/mobile-apps-2026-09/e2e/fix-ui.json",
      JSON.stringify(results, null, 2)
    );
    await db.$disconnect();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
