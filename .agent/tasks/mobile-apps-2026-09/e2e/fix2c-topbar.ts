// Шапка мини-оболочки на узких экранах: название экрана видно целиком.
// Стенд 3022. Запуск из d:/wt/mobile-apps:
//   TAG=before node --import tsx .agent/tasks/mobile-apps-2026-09/e2e/fix2c-topbar.ts
// Скриншоты — d:/wt/tmp/fix2c/<tag>-<ctx>-<page>.png, итог — <tag>.json.
import fs from "node:fs";
import { chromium, type Browser } from "playwright";
import { installCapacitorStub, DEFAULT_STUB } from "./bridge-stub";
import { db } from "./server-db";

const BASE = "http://localhost:3022";
const OUT = "d:/wt/tmp/fix2c";
const TAG = process.env.TAG ?? "run";
const EMAIL = process.env.EMAIL ?? "owner-a@e2e.local";
const PASSWORD = "E2eTest2026!";
fs.mkdirSync(OUT, { recursive: true });

const APP_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 WeSetupApp/1.0.0 (android)";
const PLAIN_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
const CTXS = [
  { key: "app360", ua: APP_UA, w: 360, h: 740, stub: true },
  { key: "app412", ua: APP_UA, w: 412, h: 915, stub: true },
  { key: "tg360", ua: PLAIN_UA, w: 360, h: 740, stub: false },
  { key: "tg412", ua: PLAIN_UA, w: 412, h: 915, stub: false },
];
const HIDE_DEV =
  "window.__name=window.__name||function(f){return f};" +
  "try{localStorage.setItem('wesetup.last-seen-build-sha','zzz');localStorage.setItem('wesetup.mini.tour.seen',String(Date.now()))}catch(e){};" +
  "document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})";

async function state(browser: Browser): Promise<string> {
  const file = `${OUT}/state-${EMAIL}.json`;
  if (fs.existsSync(file)) return file;
  const ctx = await browser.newContext();
  const csrf = (await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json()) as { csrfToken: string };
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email: EMAIL, password: PASSWORD, json: "true", callbackUrl: `${BASE}/mini` },
    maxRedirects: 0,
  });
  if (!(await ctx.cookies(BASE)).some((c) => /session/i.test(c.name))) throw new Error("sign-in failed");
  await ctx.storageState({ path: file });
  await ctx.close();
  return file;
}

const PROBE = () => {
  const bar = document.querySelector("header.mini-topbar");
  const title = bar?.querySelector(".mini-topbar-title") as HTMLElement | null;
  const visible = (sel: string) => {
    const el = bar?.querySelector(sel) as HTMLElement | null;
    return !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== "none";
  };
  const buttons = [...(bar?.querySelectorAll("button") ?? [])]
    .filter((b) => b.getBoundingClientRect().width > 0)
    .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "?");
  return {
    hasBar: !!bar,
    title: title?.textContent ?? null,
    titleCut: title ? title.scrollWidth > title.clientWidth + 1 : null,
    titleW: title ? Math.round(title.clientWidth) : null,
    logo: visible(".mini-topbar-ico"),
    partner: visible('[aria-label^="Партнёрская"]'),
    buttons,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
};

async function main() {
  const owner = await db.user.findFirstOrThrow({ where: { email: EMAIL }, select: { organizationId: true } });
  const doc = await db.journalDocument.findFirst({
    where: { organizationId: owner.organizationId },
    select: { id: true, template: { select: { code: true } } },
    orderBy: { createdAt: "desc" },
  });
  const pages: Array<[string, string]> = [
    ["dashboard", "/dashboard"],
    ["control", "/control-board"],
    ["journals", "/journals"],
    ["sections", "/mini/sections"],
    ["today", "/mini/today"],
  ];
  if (doc) pages.push(["document", `/journals/${doc.template.code}/documents/${doc.id}`]);

  const browser = await chromium.launch({ headless: true });
  const file = await state(browser);
  const results: Record<string, unknown> = {};
  try {
    for (const c of CTXS) {
      const ctx = await browser.newContext({
        storageState: file,
        serviceWorkers: "block",
        userAgent: c.ua,
        viewport: { width: c.w, height: c.h },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      });
      // Telegram-режим без приложения: кука оболочки, как её ставит клиент мини-приложения.
      if (!c.stub) await ctx.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
      await ctx.addInitScript(HIDE_DEV);
      if (c.stub) await ctx.addInitScript(installCapacitorStub, { ...DEFAULT_STUB, permission: "denied" as const, topInset: 0 });
      const page = await ctx.newPage();
      for (const [name, path] of pages) {
        await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 300000 });
        await page.waitForTimeout(1500);
        const shot = `${OUT}/${TAG}-${c.key}-${name}.png`;
        await page.screenshot({ path: shot });
        const r = { path, final: new URL(page.url()).pathname, shot, ...(await page.evaluate(PROBE)) };
        results[`${c.key} ${name}`] = r;
        console.log(c.key, name, JSON.stringify(r));
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    await db.$disconnect();
  }
  fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
