// «Telegram» на стенде: настоящий telegram-web-app.js + эмулятор клиента
// (tg-host.js из mini-sweep) + initData, подписанный токеном бота из .env —
// ровно тот вход, что проходит приложение в Telegram. Код приложения не ослаблен.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

import { BOT_TOKEN, db } from "./db";
import { USERS } from "./fixtures";

export const BASE = process.env.BASE ?? "http://localhost:3041";
export const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const HOST = fs.readFileSync(path.join(HERE, "..", "..", "mini-sweep-2026-09", "tg-host.js"), "utf8");
const CHROME = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");

export type Role = keyof typeof USERS;
export type Theme = "light" | "dark";

/** Цвета клиента Telegram: по ним telegram-web-app.js считает colorScheme. */
const THEME_PARAMS: Record<Theme, Record<string, string>> = {
  light: { bg_color: "#ffffff", text_color: "#000000", hint_color: "#999999", link_color: "#2481cc", button_color: "#2481cc", button_text_color: "#ffffff", secondary_bg_color: "#efeff3" },
  dark: { bg_color: "#212121", text_color: "#ffffff", hint_color: "#aaaaaa", link_color: "#8774e1", button_color: "#8774e1", button_text_color: "#ffffff", secondary_bg_color: "#0f0f0f" },
};

function forge(tgId: string): string {
  const p = new URLSearchParams();
  p.set("auth_date", String(Math.floor(Date.now() / 1000) - 5));
  p.set("user", JSON.stringify({ id: Number(tgId), first_name: "Т" }));
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  p.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex"));
  return p.toString();
}

export type Session = { browser: Browser; ctx: BrowserContext; page: Page; errors: string[]; close: () => Promise<void> };

export async function openTelegram(opts: { role: Role; theme: Theme; width?: number; height?: number; browser?: Browser }): Promise<Session> {
  const u = USERS[opts.role];
  // Тема профиля побеждает тему Telegram (см. mini-theme.tsx) — ставим ту же.
  await db.user.update({ where: { email: u.email }, data: { themePreference: opts.theme, telegramChatId: u.tg } });
  const browser = opts.browser ?? (await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--use-gl=swiftshader"] }));
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 390, height: opts.height ?? 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    colorScheme: opts.theme,
    locale: "ru-RU",
  });
  await ctx.addInitScript(HOST);
  await ctx.addInitScript(
    `try{localStorage.setItem("wesetup.mini.tour.seen",String(Date.now()));localStorage.setItem("wesetup.last-seen-build-sha","zzz")}catch(e){};` +
      // Значок dev-сборки Next перекрывает угол экрана — прячем (только на снимках).
      `document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})`
  );
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|DevTools|hydrat/i.test(m.text())) errors.push("console: " + m.text().slice(0, 200));
  });
  const hash =
    "#tgWebAppData=" + encodeURIComponent(forge(u.tg)) +
    "&tgWebAppVersion=8.0&tgWebAppPlatform=ios&tgWebAppThemeParams=" + encodeURIComponent(JSON.stringify(THEME_PARAMS[opts.theme]));
  await page.goto(`${BASE}/mini${hash}`, { waitUntil: "load", timeout: 300000 });
  await page.waitForURL((url) => url.pathname !== "/mini", { timeout: 180000 }).catch(() => null);
  await page.waitForTimeout(1500);
  return {
    browser,
    ctx,
    page,
    errors,
    close: async () => {
      await ctx.close();
      if (!opts.browser) await browser.close();
    },
  };
}
