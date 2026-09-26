/**
 * Снимки «до»: страница журнала холодильников у руководителя и повара,
 * 1440×900 и 390×844, на коде ДО правки (dev-сервер http://localhost:3047).
 *
 * Запуск (из C:/wt/jtitle): npx tsx .agent/tasks/journal-title-rename-2026-09/e2e/shots-before.ts
 */
import "dotenv/config";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";

const BASE = process.env.E2E_BASE ?? "http://localhost:3047";
const TASK_DIR = path.resolve(".agent/tasks/journal-title-rename-2026-09");
const EVIDENCE = path.join(TASK_DIR, "evidence");
const setup = JSON.parse(readFileSync(path.join(TASK_DIR, "e2e/setup-output.json"), "utf8")) as {
  password: string;
  journal: string;
  managerEmail: string;
  cookEmail: string;
};
const CHROME =
  process.env.E2E_CHROME ??
  path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright/chromium-1232/chrome-win64/chrome.exe");
const NAV_TIMEOUT = 240_000;

async function login(context: BrowserContext, email: string) {
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { email, password: setup.password },
    timeout: NAV_TIMEOUT,
  });
  if (!res.ok()) throw new Error(`login ${email}: ${res.status()} ${await res.text()}`);
}

async function closeDialogs(page: Page) {
  for (let i = 0; i < 3; i += 1) {
    const dialog = page.getByRole("dialog").first();
    await dialog.waitFor({ state: "visible", timeout: 3_000 }).catch(() => {});
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  }
}

async function shot(page: Page, name: string) {
  await page.mouse.move(4, 420);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(400);
  const file = path.join(EVIDENCE, name);
  await page.screenshot({ path: file, animations: "disabled" });
  console.log(`${name} — ${Math.round(statSync(file).size / 1024)} КБ`);
}

/** Геометрия строки заголовка: где стоит индикатор и сколько он занимает. */
// Строкой: tsx оборачивает именованные функции в `__name`, которого в браузере нет.
const MEASURE_SCRIPT = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const h1 = document.querySelector("h1");
  const pill = Array.from(document.querySelectorAll("button, span")).find(
    (el) => /Включён/.test(el.textContent || "") && (el.textContent || "").length < 40
  );
  return { h1: box(h1), indicator: box(pill), indicatorText: pill ? pill.textContent.trim() : null };
})()`;

async function measure(page: Page) {
  return page.evaluate(MEASURE_SCRIPT);
}

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-gl=swiftshader", "--no-sandbox"],
  });
  const out: Record<string, unknown> = {};
  try {
    for (const who of ["manager", "cook"] as const) {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        if (who === "cook" && viewport.width === 1440) continue;
        const context = await browser.newContext({
          viewport,
          deviceScaleFactor: 1,
          isMobile: viewport.width < 500,
          hasTouch: viewport.width < 500,
          locale: "ru-RU",
          reducedMotion: "reduce",
        });
        await login(context, who === "manager" ? setup.managerEmail : setup.cookEmail);
        const page = await context.newPage();
        await page.goto(`${BASE}/journals/${setup.journal}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
        await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
        await closeDialogs(page);
        const name = `before-${who}-${viewport.width}.png`;
        await shot(page, name);
        out[name] = await measure(page);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(EVIDENCE, "before-geometry.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
