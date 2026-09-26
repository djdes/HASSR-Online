// «Telegram» на стенде: настоящий telegram-web-app.js + эмулятор клиента
// (tg-host.js из mini-sweep) + initData, подписанный токеном бота из .env, —
// ровно тот вход, что проходит приложение в Telegram. Проверка initData в
// приложении не ослаблена: подпись честная, просто токен бота — стендовый.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

import { BOT_TOKEN, ROOT } from "./db";

export const BASE = process.env.BASE ?? "http://localhost:3044";
export const TASK_DIR = path.join(ROOT, ".agent", "tasks", "mini-signout-2026-09");
const HOST = fs.readFileSync(path.join(ROOT, ".agent", "tasks", "mini-sweep-2026-09", "tg-host.js"), "utf8");

/** Chromium из %LOCALAPPDATA%\ms-playwright (ревизия под playwright-core 1.59 — 1217). */
function chromePath(): string {
  const base = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  for (const rev of ["chromium-1217", "chromium-1232"]) {
    const exe = path.join(base, rev, "chrome-win64", "chrome.exe");
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error("нет Chromium в " + base);
}

export async function launch(): Promise<Browser> {
  return chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--no-sandbox", "--use-gl=swiftshader"],
  });
}

const LIGHT_THEME = {
  bg_color: "#ffffff",
  text_color: "#000000",
  hint_color: "#999999",
  link_color: "#2481cc",
  button_color: "#2481cc",
  button_text_color: "#ffffff",
  secondary_bg_color: "#efeff3",
};

/** Подписанный initData для Telegram-пользователя `tgId` (как у клиента Telegram). */
export function forgeInitData(tgId: string): string {
  const p = new URLSearchParams();
  p.set("auth_date", String(Math.floor(Date.now() / 1000) - 5));
  p.set("user", JSON.stringify({ id: Number(tgId), first_name: "Т" }));
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  p.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex"));
  return p.toString();
}

/** Хвост адреса, с которым Telegram открывает мини-приложение из бота. */
export function telegramLaunchHash(tgId: string): string {
  return (
    "#tgWebAppData=" + encodeURIComponent(forgeInitData(tgId)) +
    "&tgWebAppVersion=8.0&tgWebAppPlatform=ios&tgWebAppThemeParams=" +
    encodeURIComponent(JSON.stringify(LIGHT_THEME))
  );
}

export type Tab = { ctx: BrowserContext; page: Page; errors: string[] };

/**
 * Телефон: 390×844, touch. `telegram: true` — страница открыта внутри
 * Telegram (эмулятор клиента подключён до скриптов страницы).
 */
export async function openPhone(browser: Browser, opts: { telegram: boolean; width?: number; height?: number; mobile?: boolean }): Promise<Tab> {
  const mobile = opts.mobile ?? true;
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 390, height: opts.height ?? 844 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "ru-RU",
  });
  if (opts.telegram) {
    await ctx.addInitScript(`window.__tgHostConfig=${JSON.stringify({ themeParams: LIGHT_THEME })};`);
    await ctx.addInitScript(HOST);
  }
  // Значок dev-сборки Next перекрывает угол экрана — прячем (только на снимках).
  await ctx.addInitScript(
    `document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})`
  );
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|DevTools|hydrat|Failed to sync build state/i.test(m.text())) {
      errors.push("console: " + m.text().slice(0, 200));
    }
  });
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(300_000);
  return { ctx, page, errors };
}
