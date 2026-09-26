// Общие помощники e2e: браузер, «Telegram», кто вошёл, проверки после выхода.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";

import { BOT_TOKEN, ROOT } from "./db";

export const BASE = process.env.BASE ?? "http://localhost:3050";
export const TASK_DIR = path.join(ROOT, ".agent", "tasks", "logout-and-master-menu-2026-09");
const HOST = fs.readFileSync(path.join(ROOT, ".agent", "tasks", "mini-sweep-2026-09", "tg-host.js"), "utf8");

/** Chromium из %LOCALAPPDATA%\ms-playwright (ревизия под playwright-core 1.59). */
function chromePath(): string {
  const base = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  for (const rev of ["chromium-1217", "chromium-1232"]) {
    const exe = path.join(base, rev, "chrome-win64", "chrome.exe");
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error("нет Chromium в " + base);
}

export async function launch(): Promise<Browser> {
  // Без окна: прогон автоматический, смотреть его некому; браузер закрывается в конце.
  return chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox", "--use-gl=swiftshader"] });
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

export function telegramLaunchHash(tgId: string): string {
  return (
    "#tgWebAppData=" + encodeURIComponent(forgeInitData(tgId)) +
    "&tgWebAppVersion=8.0&tgWebAppPlatform=ios&tgWebAppThemeParams=" +
    encodeURIComponent(JSON.stringify(LIGHT_THEME))
  );
}

export type Tab = { ctx: BrowserContext; page: Page; errors: string[]; requests: string[] };
export type Device = "desktop" | "phone" | "tablet" | "telegram";

export async function openTab(browser: Browser, device: Device): Promise<Tab> {
  const phone = device === "phone" || device === "telegram";
  const viewport =
    device === "desktop" ? { width: 1440, height: 900 } : device === "tablet" ? { width: 1024, height: 768 } : { width: 390, height: 844 };
  const ctx = await browser.newContext({
    viewport,
    isMobile: phone,
    hasTouch: phone,
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "ru-RU",
    reducedMotion: "reduce",
  });
  if (device === "telegram") {
    await ctx.addInitScript(`window.__tgHostConfig=${JSON.stringify({ themeParams: LIGHT_THEME })};`);
    await ctx.addInitScript(HOST);
  }
  // Значок dev-сборки Next перекрывает угол экрана — прячем.
  await ctx.addInitScript(
    "document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})",
  );
  const page = await ctx.newPage();
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|DevTools|hydrat|Failed to sync build state/i.test(m.text())) {
      errors.push("console: " + m.text().slice(0, 200));
    }
  });
  // Журнал запросов к адресам входа и выхода — кто что гасил и в каком порядке.
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (/^\/api\/(auth|kiosk\/(lock|unlock)|security|me\/active-organization|q\/login|mini\/login|invite)/.test(u.pathname)) {
      requests.push(`${r.method()} ${u.pathname}`);
    }
  });
  page.setDefaultTimeout(90_000);
  page.setDefaultNavigationTimeout(300_000);
  return { ctx, page, errors, requests };
}

/** Дождаться гидратации элемента: React вешает на узел `__reactProps$…`. */
export async function hydrated(locator: Locator, timeout = 240_000): Promise<Locator> {
  await locator.waitFor({ state: "visible", timeout });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ok = await locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))).catch(() => false);
    if (ok) return locator;
    await locator.page().waitForTimeout(250);
  }
  throw new Error("элемент так и не гидратировался");
}

export const pathOf = (page: Page) => new URL(page.url()).pathname;

export async function waitPath(page: Page, test: (p: string) => boolean, timeout = 240_000): Promise<string> {
  await page.waitForURL((u) => test(u.pathname), { timeout });
  return pathOf(page);
}

/** Куки сессии в браузере (все имена `*session-token*`). */
export async function sessionCookies(ctx: BrowserContext): Promise<string[]> {
  return (await ctx.cookies()).filter((c) => /session-token/.test(c.name)).map((c) => c.name).sort();
}

async function get(ctx: BrowserContext, p: string) {
  return ctx.request.get(`${BASE}${p}`, { timeout: 300_000, maxRedirects: 0 });
}

function locationOf(r: Awaited<ReturnType<typeof get>>): string | null {
  const raw = r.headers()["location"];
  return raw ? new URL(raw, BASE).pathname : null;
}

/**
 * Кто вошёл — тремя независимыми способами:
 *   nextAuth — сам next-auth (`/api/auth/session`, так видит `useSession`);
 *   pages    — `getServerSession` проекта (`/api/mini/session`); сессии
 *              мастер-кабинета proxy этот API закрывает → «directory(403)»;
 *   proxy    — решение proxy по токену: `/master` пускает только мастер-
 *              кабинет, сессию обычной организации уводит на /dashboard, без
 *              сессии страница отправляет на вход; `/settings` proxy
 *              закрывает линейному сотруднику (→ /journals).
 */
export async function whoami(ctx: BrowserContext) {
  const na = await get(ctx, "/api/auth/session");
  const naJson = (await na.json().catch(() => null)) as { user?: { id?: string } } | null;
  const pg = await get(ctx, "/api/mini/session");
  const pgJson = (await pg.json().catch(() => null)) as { user?: { id?: string } } | null;
  const pages = pg.status() === 200 ? pgJson?.user?.id ?? null : pg.status() === 403 ? "directory(403)" : null;
  const master = await get(ctx, "/master");
  const masterLoc = locationOf(master);
  const proxyOrg = master.status() === 200 ? "directory" : masterLoc === "/dashboard" ? "regular" : `none(${master.status()}→${masterLoc})`;
  const settings = await get(ctx, "/settings");
  const settingsLoc = locationOf(settings);
  const proxyRole =
    proxyOrg === "directory"
      ? "directory"
      : proxyOrg !== "regular"
        ? "none"
        : settingsLoc === "/journals" || settingsLoc === "/mini"
          ? "staff"
          : "management";
  return { nextAuth: naJson?.user?.id ?? null, pages, proxyOrg, proxyRole, cookies: await sessionCookies(ctx) };
}

/**
 * Состояние «вышел»: кук сессии нет, next-auth и getServerSession никого не
 * видят, /login открывается, защищённые страницы требуют входа.
 */
export async function loggedOutState(ctx: BrowserContext) {
  const who = await whoami(ctx);
  const login = await get(ctx, "/login");
  const dashboard = await get(ctx, "/dashboard");
  const master = await get(ctx, "/master");
  return {
    ...who,
    loginStatus: login.status(),
    dashboard: `${dashboard.status()}→${locationOf(dashboard)}`,
    masterPage: `${master.status()}→${locationOf(master)}`,
  };
}

export type LoggedOutState = Awaited<ReturnType<typeof loggedOutState>>;

/**
 * Экраны входа, куда защищённая страница отправляет без сессии: сайт —
 * /login; в оболочке мини-приложения proxy ведёт на /mini?next=…; на
 * планшете-киоске — список сотрудников /mini/kiosk.
 */
export const SIGN_IN_SCREENS = ["/login", "/mini", "/mini/login", "/mini/kiosk"];

const requiresSignIn = (v: string) => SIGN_IN_SCREENS.some((screen) => v === `307→${screen}`);

export function isLoggedOut(s: LoggedOutState): boolean {
  return (
    s.cookies.length === 0 &&
    s.nextAuth === null &&
    s.pages === null &&
    s.loginStatus === 200 &&
    requiresSignIn(s.dashboard) &&
    requiresSignIn(s.masterPage)
  );
}
