// Скриншоты для App Store и Google Play: «Кафе «Демо»» (shots-seed.ts +
// shots-claims.ts) на стенде 3021, приложение WeSetup (UA WeSetupApp) с
// заглушкой Capacitor. iPhone 6.9" 440x956@3 -> 1320x2868, Android
// 432x768@2.5 -> 1080x1920 (типичная ширина телефона). Итог — PNG без альфа-канала в docs/mobile/screenshots.
// Env: SHOTS_PLATFORMS=ios,android  SHOTS_ONLY=1,3
// Запуск из d:/wt/mobile-apps: npx tsx .agent/tasks/mobile-apps-2026-09/e2e/shots-take.mts
import fs from "node:fs";
// @ts-ignore
import { chromium } from "file:///D:/www/Wesetup.ru/node_modules/playwright/index.mjs";
// @ts-ignore
import sharp from "file:///D:/wt/mobile-apps/mobile/node_modules/sharp/lib/index.js";
import * as stubMod from "./bridge-stub.ts";
const { installCapacitorStub, DEFAULT_STUB } = ((stubMod as any).installCapacitorStub ? stubMod : (stubMod as any).default) as any;

const BASE = "http://localhost:3021";
const TMP = "d:/wt/tmp/shots";
const OUT = "d:/wt/mobile-apps/docs/mobile/screenshots";
const PASSWORD = "DemoShots2026!";
const EMAILS: Record<string, string> = { owner: "owner@cafe-demo.local", chef: "chef@cafe-demo.local", cook: "cook@cafe-demo.local" };
const UA = {
  ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WeSetupApp/1.0.0 (ios)",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 WeSetupApp/1.0.0 (android)",
};
const VP = { ios: { width: 440, height: 956 }, android: { width: 432, height: 768 } };
const DSF = { ios: 3, android: 2.5 };
const SIZE = { ios: [1320, 2868], android: [1080, 1920] };
const CSS =
  "nextjs-portal{display:none!important}[data-sonner-toaster]{display:none!important}" +
  "*{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}";
const INIT =
  "window.__name=window.__name||function(f){return f};" +
  "try{localStorage.setItem('wesetup.last-seen-build-sha','zzz');localStorage.setItem('wesetup.mini.tour.seen',String(Date.now()));" +
  "localStorage.setItem('wesetup.push.asked','1');localStorage.setItem('wesetup.cookie-consent','1');localStorage.setItem('wesetup-app-theme','light')}catch(e){};" +
  "document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');" +
  `s.textContent=${JSON.stringify(CSS)};document.head.appendChild(s)})`;

const CLEANING = "cmujotj5f00dhd09msdvaxld7";
const COLD = "cmujotjsz00r4d09mr61jfqzu";

type Shot = { n: number; name: string; role: string; path: string; act?: (page: any) => Promise<void> };

/** Прокрутить так, чтобы элемент с текстом оказался сразу под шапкой. */
async function scrollTo(page: any, text: string, gap = 12) {
  await page.evaluate(
    ({ src, gap }: { src: string; gap: number }) => {
      const re = new RegExp(src);
      const el = Array.from(document.querySelectorAll("main *"))
        .filter((e) => re.test(((e as HTMLElement).innerText || "").trim()))
        .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0] as HTMLElement | undefined;
      if (!el) throw new Error("not found " + src);
      const header = document.querySelector("header.mini-topbar") as HTMLElement | null;
      const hb = header ? header.getBoundingClientRect().bottom : 0;
      const top = el.getBoundingClientRect().top + window.scrollY - hb - gap;
      window.scrollTo({ top, behavior: "instant" as ScrollBehavior });
    },
    { src: text, gap }
  );
  await page.waitForTimeout(800);
}

const SHOTS: Shot[] = [
  { n: 1, name: "control-board", role: "chef", path: "/control-board" },
  { n: 2, name: "today", role: "cook", path: "/mini/today" },
  {
    n: 3,
    name: "cleaning-journal",
    role: "chef",
    path: `/journals/cleaning/documents/${CLEANING}`,
    act: async (page) => {
      // Вкладка «Сегодня»: помещения со статусом уборки за день и средством.
      // iPhone: с заголовка журнала (название, счётчик «осталось», помещения).
      // Android ниже: с вкладок, чтобы влезли все шесть помещений.
      const narrow = (page.viewportSize()?.width ?? 999) < 436;
      await scrollTo(page, process.env.SHOTS_ANCHOR3 ?? (narrow ? "^Сегодня$" : "^Журнал уборки$"), 12);
    },
  },
  {
    n: 4,
    name: "fridges",
    role: "chef",
    path: `/journals/cold_equipment_control/documents/${COLD}`,
    act: async (page) => {
      await scrollTo(page, "^Сегодня всё заполнено$");
    },
  },
  {
    n: 5,
    name: "all-sections",
    role: "chef",
    path: "/mini/sections",
    act: async (page) => {
      // На узком экране вводная карточка занимает полэкрана — начинаем со списка.
      if ((page.viewportSize()?.width ?? 999) < 436) await scrollTo(page, "^Работа$", 8);
    },
  },
  {
    n: 6,
    name: "notifications",
    role: "chef",
    // Панель открывается из профиля: наверху страницы пусто, и из-за скруглённого
    // угла панели ничего не выглядывает (на «Панели контроля» торчал крупный
    // заголовок). Прокрутка не помогает: при открытой панели страница
    // фиксируется и шапка приложения уезжает вместе с ней.
    path: process.env.SHOTS_PATH6 ?? "/mini/me",
    act: async (page) => {
      await page.locator('header button[aria-label="Уведомления"]').first().click();
      await page.waitForTimeout(2500);
    },
  },
];

async function roleState(browser: any, role: string) {
  const file = `${TMP}/state-${role}.json`;
  if (fs.existsSync(file)) return file;
  const ctx = await browser.newContext();
  const csrf = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email: EMAILS[role], password: PASSWORD, json: "true", callbackUrl: `${BASE}/mini` },
    maxRedirects: 0,
  });
  if (!(await ctx.cookies(BASE)).some((c: any) => /session/i.test(c.name))) throw new Error("sign-in failed " + role);
  await ctx.storageState({ path: file });
  await ctx.close();
  return file;
}

async function settle(page: any) {
  await page.waitForTimeout(1500);
  for (let i = 0; i < 30; i++) {
    const busy = await page.evaluate(() => {
      const t = document.body.innerText;
      return (
        !!document.querySelector('main [class*="skeleton"],main .animate-spin,[aria-busy="true"]') ||
        /Загрузка|Загружаем/.test(t) ||
        !document.querySelector("#mini-root")
      );
    });
    if (!busy) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);
}

async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  const platforms = (process.env.SHOTS_PLATFORMS ?? "ios,android").split(",") as Array<"ios" | "android">;
  const only = process.env.SHOTS_ONLY?.split(",").map(Number);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const platform of platforms) {
      fs.mkdirSync(`${OUT}/${platform}`, { recursive: true });
      for (const shot of SHOTS) {
        if (only && !only.includes(shot.n)) continue;
        const ctx = await browser.newContext({
          storageState: await roleState(browser, shot.role),
          serviceWorkers: "block",
          userAgent: UA[platform],
          viewport: VP[platform],
          deviceScaleFactor: DSF[platform],
          hasTouch: true,
          isMobile: true,
          colorScheme: "light",
          locale: "ru-RU",
          timezoneId: "Europe/Moscow",
        });
        await ctx.addInitScript(INIT);
        await ctx.addInitScript(installCapacitorStub, { ...DEFAULT_STUB, platform, permission: "granted", topInset: 0 });
        await ctx.route("**/api/me/notices**", (route: any) =>
          route.fulfill({ json: route.request().method() === "GET" ? { seen: true } : { ok: true } })
        );
        const page = await ctx.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e: Error) => errors.push(e.message));
        // Прогрев: первая компиляция страницы на dev-стенде медленная.
        await page.goto(BASE + shot.path, { waitUntil: "load", timeout: 300000 });
        await settle(page);
        await page.goto(BASE + shot.path, { waitUntil: "load", timeout: 300000 });
        await settle(page);
        if (shot.act) await shot.act(page);
        const raw = `${TMP}/raw-${platform}-${shot.n}.png`;
        await page.screenshot({ path: raw });
        const file = `${OUT}/${platform}/0${shot.n}-${shot.name}.png`;
        await sharp(raw).flatten({ background: "#ffffff" }).removeAlpha().toColourspace("srgb").png().toFile(file);
        const m = await sharp(file).metadata();
        if (m.width !== SIZE[platform][0] || m.height !== SIZE[platform][1] || m.channels !== 3 || m.hasAlpha)
          throw new Error(`bad size ${file}: ${m.width}x${m.height}x${m.channels}`);
        console.log(
          platform,
          shot.n,
          new URL(page.url()).pathname,
          `${m.width}x${m.height}x${m.channels}`,
          errors.length ? "ERR " + errors.join(" | ").slice(0, 200) : ""
        );
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
