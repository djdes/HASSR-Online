/**
 * Проверка спецрежима глазами на локальном стенде (база wesetup_e2e, НЕ прод).
 * Сценарии: спецрежим выключен — нигде ничего не видно; включена одна галочка
 * «Догнать пропуски» — появляется только она.
 *
 *   DATABASE_URL=...wesetup_e2e... npx tsx .agent/tasks/special-mode-hide-2026-11-05/raw/ui-check.ts
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { db } from "@/lib/db";

const BASE = process.env.UI_BASE ?? "http://localhost:3157";
const ORG = "e2e-org-loc";
const EMAIL = "loc-manager@e2e.local";
const PASSWORD = "E2eTest2026!";
const OUT = path.join(process.cwd(), ".agent", "tasks", "special-mode-hide-2026-11-05", "raw", "ui");
if (!(process.env.DATABASE_URL ?? "").includes("wesetup_e2e")) throw new Error("Не та база");
fs.mkdirSync(OUT, { recursive: true });

const results: Record<string, unknown> = {};
const KEY = `org-journal-controls:${ORG}`;

async function setAutomation(automation: Record<string, boolean>) {
  const row = await db.platformSetting.findUnique({ where: { key: KEY } });
  const current = row ? JSON.parse(row.value as string) : {};
  const value = JSON.stringify({ ...current, automation });
  await db.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

const OFF = { enabled: false, autoFill: false, autoCreate: false, copyYesterday: false, closeDayAutofill: false, catchUp: false };

async function login(page: Page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 600_000 });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 30; i += 1) {
      await page.fill("#email", EMAIL);
      await page.fill("#password", PASSWORD);
      if ((await page.inputValue("#email")) === EMAIL) break;
      await page.waitForTimeout(300);
    }
    await page.click('button[type="submit"]');
    const left = await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180_000 }).then(() => true).catch(() => false);
    if (left) return;
  }
  throw new Error("не удалось войти");
}

async function open(page: Page, route: string) {
  const response = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  return response?.status() ?? 0;
}

const FORBIDDEN_WORDS = /Спецрежим|Специальный режим|спецрежим|Догнать пропуски/;

async function scenario(page: Page, name: string) {
  const r: Record<string, unknown> = {};
  for (const route of ["/inspection", "/settings/organization", "/dashboard"]) {
    r[`${route}:status`] = await open(page, route);
    const text = await page.locator("body").innerText();
    r[`${route}:mentions`] = (text.match(new RegExp(FORBIDDEN_WORDS, "g")) ?? []).join(", ") || null;
    r[`${route}:catchUpLinks`] = await page.locator('a[href="/dashboard/catch-up"]').count();
    r[`${route}:autofillButton`] = /Автозаполнить/.test(text);
    await page.screenshot({ path: path.join(OUT, `${name}${route.replace(/\//g, "_")}.png`), fullPage: true });
  }
  await open(page, "/inspection");
  r["/inspection:settingsLink"] = await page.locator('a[href="/inspection/settings"]').count();
  r["menu:specialItem"] = await page.locator('a[href="/inspection/special-mode"], a[href="/inspection/settings"]:has-text("Спецрежим")').count();
  r["/dashboard/catch-up:status"] = await open(page, "/dashboard/catch-up");
  r["/dashboard/catch-up:notFound"] = /Такой страницы нет/.test(await page.locator("body").innerText());
  await page.screenshot({ path: path.join(OUT, `${name}_catch-up.png`), fullPage: true });
  r["/inspection/special-mode:status"] = await open(page, "/inspection/special-mode");
  r["/inspection/special-mode:notFound"] = /Такой страницы нет/.test(await page.locator("body").innerText());
  r["api catch-up GET"] = await page.evaluate(async () => (await fetch("/api/dashboard/catch-up")).status);
  r["/inspection/settings:status"] = await open(page, "/inspection/settings");
  r["/inspection/settings:features"] = await page.locator("[data-special-mode-feature]").evaluateAll((els) => els.map((e) => e.getAttribute("data-special-mode-feature")));
  r["/inspection/settings:visible"] = await page.locator("[data-special-mode-visible]").getAttribute("data-special-mode-visible").catch(() => null);
  await page.screenshot({ path: path.join(OUT, `${name}_inspection_settings.png`), fullPage: true });
  results[name] = r;
}

(async () => {
  const executablePath = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1194", "chrome-win", "chrome.exe");
  const browser = await chromium.launch({ executablePath: fs.existsSync(executablePath) ? executablePath : undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await context.newPage();
  try {
    await setAutomation(OFF);
    await login(page);
    await scenario(page, "off");
    await setAutomation({ ...OFF, enabled: true, catchUp: true });
    await scenario(page, "catchUp-only");
  } finally {
    await setAutomation(OFF);
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    await browser.close();
    process.exit(0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
