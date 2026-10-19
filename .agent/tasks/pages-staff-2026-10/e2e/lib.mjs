// Общие помощники Playwright для проверок раздела «Сотрудники» (pages-staff-2026-10).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = process.env.BASE || "http://localhost:3071";
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RAW = path.join(HERE, "..", "raw");
export const SHOTS_COPY = "C:\\Users\\Two\\wesetup-backup-2026-10-17\\pages-shots\\staff";
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(SHOTS_COPY, { recursive: true });

export const PASSWORD = process.env.PASSWORD || "admin1234";
export const ROLES = [
  { id: "owner", title: "руководитель", email: "admin@haccp.local" },
  { id: "headchef", title: "заведующая", email: "chef@haccp.local" },
  { id: "cook", title: "повар", email: "hotcook1@haccp.local" },
];

export const PAGES = [
  { id: "positions", href: "/settings/positions" },
  { id: "access", href: "/settings/access" },
  { id: "commission", href: "/settings/brakerage-commission" },
  { id: "haccpGroup", href: "/settings/haccp-group" },
  { id: "controlGroup", href: "/settings/control-group" },
  { id: "inspectors", href: "/settings/inspectors" },
];

export async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", args: ["--lang=ru-RU"] });
  } catch {
    const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    const exe = path.join(base, "chromium_headless_shell-1243", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
    return chromium.launch({ executablePath: exe, args: ["--lang=ru-RU"] });
  }
}

export const problems = [];
/** Предупреждения, которые есть и на прежних страницах (не от этой задачи), — отдельно. */
export const notes = [];
export function problem(text) {
  problems.push(text);
  console.log("  ✗", text);
}

/** Скриншот — в raw/ и копией в общую папку снимков раздела. */
export async function shot(page, name, options = {}) {
  const file = path.join(RAW, `${name}.png`);
  await page.screenshot({ path: file, ...options });
  fs.copyFileSync(file, path.join(SHOTS_COPY, `${name}.png`));
  return file;
}

export function watchErrors(page, tag) {
  page.on("pageerror", (error) => problem(`${tag} ${page.url()}: pageerror ${error.message.slice(0, 200)}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Расхождение атрибутов при гидратации оболочки Mini App есть и на /mini и
    // других старых страницах — записываем отдельно, проблемой не считаем.
    if (/A tree hydrated but some attributes/.test(text)) {
      notes.push(`${tag} ${page.url()}: ${text.slice(0, 120)}`);
      return;
    }
    if (/\[app-error\]|Hydration|hydration/.test(text)) problem(`${tag} ${page.url()}: console ${text.slice(0, 200)}`);
  });
}

// Ограничитель переходов: headless — не чаще 6 страниц за 10 с. Ходим раз в 2,6 с,
// на 429 ждём Retry-After и повторяем.
let lastNavigation = 0;
export async function throttle() {
  const wait = lastNavigation + 2_600 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNavigation = Date.now();
}

export async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  const terms = page.locator("div.fixed").filter({ hasText: "Мы обновили условия" }).last();
  if (await terms.isVisible().catch(() => false)) {
    await terms.locator('input[type="checkbox"]').first().check().catch(() => {});
    await terms.getByRole("button", { name: "Принять и продолжить" }).click().catch(() => {});
    await page.waitForTimeout(1_500);
  }
  for (let i = 0; i < 2; i++) {
    const whatsNew = page.locator('[role="dialog"]').filter({ hasText: /Что нового|What.s new/i }).first();
    if (await whatsNew.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(400);
}

export async function goto(page, href) {
  let response = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    response = await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
    if (response?.status() !== 429) break;
    const retryAfter = Number(response.headers()["retry-after"] || 30);
    console.log(`  … 429 на ${href}, пауза ${retryAfter} с`);
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
  }
  await settle(page);
  return response;
}

export async function signIn(page, email) {
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email, password: PASSWORD },
    timeout: 600_000,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok() || body?.requiresCode) throw new Error(`вход ${email}: HTTP ${res.status()} ${JSON.stringify(body)}`);
}

export async function newContext(browser, kind) {
  if (kind === "desktop") return browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  if (kind === "laptop") return browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU" });
  const context = await browser.newContext({
    viewport: { width: 390, height: 800 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "ru-RU",
  });
  if (kind === "mini") await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  return context;
}

/** Ширина документа больше окна — есть горизонтальная прокрутка. */
export async function horizontalOverflow(page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  return page.evaluate(() => {
    if (!document.documentElement) return { width: window.innerWidth, doc: 0, overflow: false, offenders: [] };
    const width = window.innerWidth;
    const doc = document.documentElement.scrollWidth;
    const offenders = [];
    if (doc > width + 1) {
      for (const el of document.querySelectorAll("main *")) {
        const rect = el.getBoundingClientRect();
        if (rect.right > width + 1 && rect.width > 0 && getComputedStyle(el).position !== "fixed") {
          offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(rect.right)}`);
          if (offenders.length > 5) break;
        }
      }
    }
    return { width, doc, overflow: doc > width + 1, offenders };
  });
}

export function writeJson(name, data) {
  fs.writeFileSync(path.join(HERE, name), JSON.stringify(data, null, 2));
}
