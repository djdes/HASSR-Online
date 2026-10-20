// Смоук сведённой ветки страниц разделов (S4): все новые страницы шести
// разделов под руководителем, заведующей и поваром; 1440 и Mini App 390.
// BASE=http://localhost:3077 node .agent/tasks/pages-release-2026-10/smoke.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE || "http://localhost:3077";
const PASSWORD = process.env.PASSWORD || "admin1234";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
const SHOTS = "C:\\Users\\Two\\wesetup-backup-2026-10-17\\pages-shots\\release";
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const PAGES = [
  // Сотрудники
  "/settings/positions",
  "/settings/access",
  "/settings/brakerage-commission",
  "/settings/haccp-group",
  "/settings/control-group",
  "/settings/inspectors",
  // Торговые точки
  "/settings/buildings",
  "/settings/buildings/new",
  "POINT",
  // Моя компания
  "/settings/organization",
  "/settings/organization/documents",
  "/settings/organization/branding",
  "/settings/organization/contacts",
  // Журналы
  "/journals/sets/standard",
  "/journals/sets/haccp",
  "/journals/sets/extra",
  // Чек-листы
  "/checklists/templates",
  "/checklists",
  "/checklists/assignments",
  "/checklists/results",
  // Пришла проверка
  "/inspection",
  "/inspection/visits",
  "/inspection/norms",
  "/inspection/experts",
  "/inspection/special-mode",
];

const ROLES = [
  { id: "owner", email: "admin@haccp.local" },
  { id: "headchef", email: "chef@haccp.local" },
  { id: "cook", email: "hotcook1@haccp.local" },
];

const results = [];
const problems = [];

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", args: ["--lang=ru-RU"] });
  } catch {
    const exe = path.join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium_headless_shell-1243", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
    return chromium.launch({ executablePath: exe, args: ["--lang=ru-RU"] });
  }
}

let last = 0;
async function throttle() {
  const wait = last + 2_700 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const terms = page.locator("div.fixed").filter({ hasText: "Мы обновили условия" }).last();
  if (await terms.isVisible().catch(() => false)) {
    await terms.locator('input[type="checkbox"]').first().check().catch(() => {});
    await terms.getByRole("button", { name: "Принять и продолжить" }).click().catch(() => {});
    await page.waitForTimeout(1_500);
  }
  const whatsNew = page.locator('[role="dialog"]').filter({ hasText: /Что нового/i }).first();
  if (await whatsNew.isVisible().catch(() => false)) await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

async function goto(page, href) {
  let response = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    try {
      response = await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
    } catch (error) {
      // Клиентский редирект (guard страницы) обрывает переход — это не ошибка.
      if (!/ERR_ABORTED|interrupted by another navigation/.test(String(error))) throw error;
      await page.waitForLoadState("domcontentloaded", { timeout: 60_000 }).catch(() => {});
      response = null;
      break;
    }
    if (response?.status() !== 429) break;
    const retry = Number(response.headers()["retry-after"] || 30);
    await new Promise((r) => setTimeout(r, (retry + 1) * 1000));
  }
  await settle(page);
  return response;
}

async function signIn(page, email) {
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD }, timeout: 600_000 });
  const body = await res.json().catch(() => null);
  if (!res.ok() || body?.requiresCode) throw new Error(`вход ${email}: HTTP ${res.status()} ${JSON.stringify(body)}`);
}

async function check(browser, role, kind) {
  const context = await browser.newContext(
    kind === "desktop"
      ? { viewport: { width: 1440, height: 900 }, locale: "ru-RU" }
      : { viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" },
  );
  if (kind === "mini") await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  await signIn(page, role.email);

  let pointHref = null;
  for (const raw of PAGES) {
    let href = raw;
    if (raw === "POINT") {
      if (!pointHref) {
        await goto(page, "/settings/buildings");
        pointHref = await page
          .locator('a[href^="/settings/buildings/"]:not([href="/settings/buildings/new"])')
          .first()
          .getAttribute("href")
          .catch(() => null);
      }
      if (!pointHref) {
        results.push({ role: role.id, kind, href: raw, skipped: "нет ссылки на точку" });
        continue;
      }
      href = pointHref;
    }
    errors.length = 0;
    const response = await goto(page, href);
    const status = response?.status() ?? 0;
    const finalPath = new URL(page.url()).pathname;
    const h1 = await page.locator("main h1, h1").first().innerText({ timeout: 3_000 }).catch(() => "");
    const overflow = await page
      .evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      .catch(() => 0);
    const errorOverlay = await page.locator("nextjs-portal, [data-nextjs-dialog]").count().catch(() => 0);
    const row = { role: role.id, kind, href, status, finalPath, h1: h1.slice(0, 80), overflow, errors: [...errors], errorOverlay };
    results.push(row);
    const redirected = finalPath !== href;
    if (status >= 500) problems.push(`${role.id}/${kind} ${href}: HTTP ${status}`);
    if (errors.length) problems.push(`${role.id}/${kind} ${href}: pageerror ${errors[0]}`);
    if (role.id === "owner" && !redirected && !h1) problems.push(`${role.id}/${kind} ${href}: нет h1`);
    if (kind !== "desktop" && overflow > 2) problems.push(`${role.id}/${kind} ${href}: горизонтальная прокрутка ${overflow}px`);
    if (role.id === "owner" && kind === "desktop") {
      const name = `${role.id}-${kind}-${href.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
      const file = path.join(RAW, `${name}.png`);
      await page.screenshot({ path: file }).catch(() => {});
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(SHOTS, `${name}.png`));
    }
    console.log(`${role.id}/${kind} ${href} → ${status} ${redirected ? `→ ${finalPath}` : ""} «${h1.slice(0, 40)}»`);
  }
  await context.close();
}

const browser = await launch();
try {
  for (const role of ROLES) await check(browser, role, "desktop");
  await check(browser, ROLES[0], "mini");
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(RAW, "smoke-results.json"), JSON.stringify({ base: BASE, problems, results }, null, 2));
console.log(`\nПроблем: ${problems.length}`);
for (const p of problems) console.log("  ✗", p);
process.exit(problems.length ? 1 : 0);
