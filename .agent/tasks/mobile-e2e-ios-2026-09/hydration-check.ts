// Дешёвая проверка на ubuntu: страницы оболочки с User-Agent приложения iOS и
// заглушкой window.Capacitor в WebKit и Chromium — ошибки консоли (гидратация
// React #418 и др.) и скриншоты. В симуляторе iOS при старте приложения была
// «Minified React error #418» — здесь её можно разобрать без macOS.
// BASE=https://localhost:3000 (прод-сборка) или http://localhost:3100 (next dev,
// полный текст ошибки). OUT — папка отчёта. Запуск: npx tsx hydration-check.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, webkit, type Browser } from "playwright";
import { DEFAULT_STUB, installCapacitorStub } from "../mobile-apps-2026-09/e2e/bridge-stub";

const BASE = process.env.BASE ?? "https://localhost:3000";
const OUT = process.env.OUT ?? "hydration-out";
const TAG = process.env.TAG ?? "prod";
fs.mkdirSync(OUT, { recursive: true });

const IOS_APP_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WeSetupApp/1.0.0 (ios)";
const IOS_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

type Row = { browser: string; variant: string; page: string; errors: string[]; shot: string };

async function run(browser: Browser, name: string, variant: "app" | "safari", rows: Row[]) {
  const ctx = await browser.newContext({
    userAgent: variant === "app" ? IOS_APP_UA : IOS_SAFARI_UA,
    viewport: { width: 402, height: 874 },
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
  });
  // tsx оборачивает функции в __name(...) — в браузере его нет.
  await ctx.addInitScript("window.__name = window.__name || function (f) { return f; };");
  if (variant === "app") await ctx.addInitScript(installCapacitorStub, { ...DEFAULT_STUB, platform: "ios", permission: "denied" });
  const page = await ctx.newPage();
  let errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text().slice(0, 1500)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.stack || e).slice(0, 1500)}`));
  const visit = async (label: string, url: string) => {
    errors = [];
    try {
      await page.goto(BASE + url, { waitUntil: "load", timeout: 240000 });
      await page.waitForTimeout(4000);
    } catch (e) {
      errors.push(`goto: ${String(e).slice(0, 300)}`);
    }
    const shot = `${TAG}-${name}-${variant}-${label}.png`;
    await page.screenshot({ path: path.join(OUT, shot) }).catch(() => undefined);
    rows.push({ browser: name, variant, page: `${label} ${new URL(page.url()).pathname}`, errors: [...errors], shot });
    console.log(`[${TAG}] ${name}/${variant} ${label}: ${errors.length} errors`);
    for (const e of errors) console.log("   ", e.slice(0, 400));
  };
  // Холодный старт приложения: /mini?src=app → «Открываем кабинет…» → /mini/login.
  {
    const t0 = Date.now();
    errors = [];
    await page.goto(BASE + "/mini?src=app", { waitUntil: "commit", timeout: 240000 }).catch(() => undefined);
    await page.waitForURL(/\/mini\/login/, { timeout: 60000 }).catch(() => undefined);
    await page.locator("form button[type=submit]").waitFor({ timeout: 60000 }).catch(() => undefined);
    const ms = Date.now() - t0;
    await page.waitForTimeout(2000);
    const shot = `${TAG}-${name}-${variant}-coldstart.png`;
    await page.screenshot({ path: path.join(OUT, shot) }).catch(() => undefined);
    rows.push({ browser: name, variant, page: `coldstart ${ms}ms ${new URL(page.url()).pathname}`, errors: [...errors], shot });
    console.log(`[${TAG}] ${name}/${variant} coldstart to login form: ${ms} ms, errors ${errors.length}`);
  }
  await visit("start", "/mini?src=app");
  await visit("login", "/mini/login");
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    // Вход ограничен 5 попытками на почту за 5 минут: приложение — шеф, Safari — владелец.
    data: { email: variant === "app" ? "chef@cafe-demo.local" : "owner@cafe-demo.local", password: "DemoShots2026!" },
  });
  console.log(`[${TAG}] login ${res.status()}`);
  for (const [label, url] of [
    ["home", "/mini"],
    ["sections", "/mini/sections"],
    ["me", "/mini/me"],
    ["today", "/mini/today"],
  ] as const) {
    await visit(label, url);
  }
  if (variant === "app") await voiceToastProbe(page, name);
  await ctx.close();
}

/**
 * Раунд 6 (iOS, S08m): после «Остановить запись» без речи тост «Ничего не
 * расслышали…» на устройстве не появился ни разу, хотя по журналу плагина
 * событие «stopped» пришло. Здесь — та же прод-сборка, режим приложения, плагин
 * распознавания подменён с порядком событий как на iPhone: start не завершается,
 * stop → событие stopped → start отклоняется «Retry».
 */
async function voiceToastProbe(page: import("playwright").Page, name: string) {
  try {
    await page.goto(BASE + "/journals/e2e_voice/new", { waitUntil: "load", timeout: 240000 });
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      const w = window as unknown as { Capacitor: { Plugins: Record<string, unknown> }; __voiceLog: string[] };
      const listeners: Record<string, ((p: unknown) => void)[]> = {};
      w.__voiceLog = [];
      const log = (m: string) => w.__voiceLog.push(m);
      let rej: ((e: Error) => void) | null = null;
      const emit = (ev: string, p: unknown) => {
        log("emit " + ev + " " + JSON.stringify(p));
        (listeners[ev] || []).forEach((cb) => cb(p));
      };
      w.Capacitor.Plugins.SpeechRecognition = {
        available: async () => ({ available: true }),
        requestPermissions: async () => ({ speechRecognition: "granted" }),
        addListener: async (ev: string, cb: (p: unknown) => void) => {
          (listeners[ev] ||= []).push(cb);
          return { remove: async () => { listeners[ev] = (listeners[ev] || []).filter((x) => x !== cb); log("remove " + ev); } };
        },
        start: () => {
          log("start");
          setTimeout(() => emit("listeningState", { status: "started" }), 50);
          return new Promise((_res, r) => { rej = r; });
        },
        stop: async () => {
          log("stop");
          emit("listeningState", { status: "stopped" });
          setTimeout(() => { log("reject start Retry"); rej?.(new Error("Retry")); }, 2);
        },
      };
    });
    await page.locator("button[title=\"Голосовой ввод\"]").first().click({ timeout: 30000 });
    await page.waitForTimeout(800);
    const rec = await page.locator("button[title=\"Остановить запись\"]").count();
    await page.locator("button[title=\"Остановить запись\"]").first().click({ timeout: 10000 });
    const t0 = Date.now();
    let texts: string[] = [];
    while (Date.now() - t0 < 4000) {
      texts = await page.locator("[data-sonner-toast]").allTextContents();
      if (texts.length) break;
      await page.waitForTimeout(100);
    }
    const ms = Date.now() - t0;
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${TAG}-${name}-app-voice-toast.png`) }).catch(() => undefined);
    const vlog = await page.evaluate(() => (window as unknown as { __voiceLog: string[] }).__voiceLog);
    const regions = await page.locator("section[aria-label^=\"Notifications\"]").count();
    const line = `[${TAG}] ${name}/app voice-toast: recording=${rec} toasts=${JSON.stringify(texts)} after ${ms} ms, toaster regions=${regions}, url=${new URL(page.url()).pathname}, plugin log=${JSON.stringify(vlog)}`;
    console.log(line);
    fs.appendFileSync(path.join(OUT, `${TAG}-voice-toast.txt`), line + "\n");
  } catch (e) {
    console.log(`[${TAG}] ${name}/app voice-toast: probe failed ${String(e).slice(0, 400)}`);
  }
}

async function main() {
  const rows: Row[] = [];
  for (const [name, type] of [
    ["webkit", webkit],
    ["chromium", chromium],
  ] as const) {
    const b = await type.launch();
    try {
      await run(b, name, "app", rows);
      await run(b, name, "safari", rows);
    } finally {
      await b.close();
    }
  }
  fs.writeFileSync(path.join(OUT, `${TAG}-hydration.json`), JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
