// Смоук интеграционной ветки на dev-сервере: вход руководителем демо-организации
// и обход страниц. Для каждой: HTTP-статус, увод, ошибки страницы и консоли,
// режим сайдбара (меню раздела), h1. Ограничитель переходов не обходится:
// не чаще раза в 2,6 с, на 429 — ждём Retry-After.
// Запуск из корня worktree: node .agent/tasks/integ-sketch-wave-2026-10/smoke.mjs [base]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3060";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
fs.mkdirSync(RAW, { recursive: true });
const EMAIL = "admin@haccp.local";
const PASSWORD = "admin1234";

const PAGES = [
  "/dashboard",
  "/settings/users",
  "/settings/areas",
  "/settings/equipment",
  "/journals",
  "/checklists",
  "/settings/organization",
  "/inspection",
  "/journals/perishable_rejection",
];

async function launch() {
  try {
    return await chromium.launch({ args: ["--lang=ru-RU"] });
  } catch (error) {
    const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    const dirs = fs.existsSync(base)
      ? fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d) || /^chromium_headless_shell-\d+$/.test(d))
      : [];
    dirs.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const dir of dirs) {
      const exe = dir.startsWith("chromium_headless_shell")
        ? path.join(base, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe")
        : path.join(base, dir, "chrome-win64", "chrome.exe");
      if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe, args: ["--lang=ru-RU"] });
    }
    throw error;
  }
}

let lastNavigation = 0;
async function throttle() {
  const wait = lastNavigation + 2_600 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNavigation = Date.now();
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const terms = page.locator("div.fixed").filter({ hasText: "Мы обновили условия" }).last();
  if (await terms.isVisible().catch(() => false)) {
    await terms.locator('input[type="checkbox"]').first().check().catch(() => {});
    await terms.getByRole("button", { name: "Принять и продолжить" }).click().catch(() => {});
    await page.waitForTimeout(1_500);
  }
  for (let i = 0; i < 2; i++) {
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(500);
}

async function goto(page, href) {
  let response = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await throttle();
    response = await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 900_000 });
    if (response?.status() !== 429) break;
    const retryAfter = Number(response.headers()["retry-after"] || 30);
    console.log(`  … 429 на ${href}, пауза ${retryAfter} с`);
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
  }
  await settle(page);
  return response;
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
const page = await context.newPage();
let current = null;
page.on("pageerror", (error) => current?.pageErrors.push(error.message.slice(0, 300)));
page.on("console", (message) => {
  if (message.type() === "error") current?.consoleErrors.push(message.text().slice(0, 300));
});

const results = { base: BASE, startedAt: new Date().toISOString(), login: null, pages: [] };
const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD }, timeout: 900_000 });
results.login = { status: res.status(), body: await res.json().catch(() => null) };
console.log("login", results.login.status);

const queue = [...PAGES];
while (queue.length) {
  const href = queue.shift();
  current = { href, pageErrors: [], consoleErrors: [] };
  const started = Date.now();
  const response = await goto(page, href).catch((error) => ({ error }));
  const r = current;
  r.ms = Date.now() - started;
  r.status = response?.error ? `ERR ${response.error.message.slice(0, 200)}` : response?.status() ?? null;
  r.finalUrl = page.url().replace(BASE, "");
  r.sidebarMode = await page.locator("[data-sidebar-mode]").first().getAttribute("data-sidebar-mode").catch(() => null);
  r.sidebarItems = await page
    .locator("[data-sidebar-mode] a")
    .evaluateAll((links) => links.map((a) => a.textContent?.trim()).filter(Boolean).slice(0, 30))
    .catch(() => []);
  r.h1 = await page.locator("main h1, h1").first().textContent({ timeout: 2_000 }).catch(() => null);
  r.errorBoundary = await page.getByText(/Что-то пошло не так|Application error|Unhandled Runtime Error/).count().catch(() => 0);
  await page.screenshot({ path: path.join(RAW, `smoke${href.replace(/[^a-z0-9]+/gi, "-")}.png`), fullPage: false }).catch(() => {});
  if (href === "/journals/perishable_rejection") {
    const doc = await page.locator('a[href*="/journals/perishable_rejection/documents/"]').first().getAttribute("href").catch(() => null);
    r.documentLink = doc;
    if (doc && !PAGES.includes(doc)) queue.push(doc.replace(BASE, ""));
  }
  results.pages.push(r);
  console.log(
    `${r.status} ${href} -> ${r.finalUrl} | sidebar=${r.sidebarMode} items=${r.sidebarItems.length} | h1=${(r.h1 || "").trim().slice(0, 60)} | pageErrors=${r.pageErrors.length} consoleErrors=${r.consoleErrors.length} boundary=${r.errorBoundary} | ${r.ms} ms`,
  );
}
current = null;
results.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(RAW, "smoke-results.json"), JSON.stringify(results, null, 2));
await browser.close();
