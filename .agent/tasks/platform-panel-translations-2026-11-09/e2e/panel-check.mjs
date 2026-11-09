// Живая проверка: переводы — вкладка панели, панель с разрешёнными вкладками,
// вход в панель без localhost. next dev :3000, локальная БД, люди — fixtures.ts.
//   node .agent/tasks/platform-panel-translations-2026-11-09/e2e/panel-check.mjs [label]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const LABEL = process.argv[2] ?? "run";
const OUT = ".agent/tasks/platform-panel-translations-2026-11-09/raw";
const SHOTS = `${OUT}/screens-${LABEL}`;
mkdirSync(SHOTS, { recursive: true });

const OWNER = ["owner@wesetup.local.test", "LocalRoot-2026!"];
const USER_PASSWORD = "LocalUser-2026!";
const PROD_LIKE = ["-H", "Host: wesetup.ru", "-H", "x-forwarded-proto: https", "-H", "x-forwarded-host: wesetup.ru"];

const results = [];
function check(ac, name, ok, detail) {
  results.push({ ac, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${ac}] ${name} — ${detail}`);
}

/** Raw request like nginx forwards it: status and Location as the browser gets them. */
function curl(path, cookie) {
  const args = ["-s", "-o", "/dev/null", "-D", "-", "--max-time", "120", ...PROD_LIKE];
  if (cookie) args.push("-H", `Cookie: ${cookie}`);
  args.push(`${BASE}${path}`);
  const head = execFileSync("curl", args, { encoding: "utf8" });
  const status = Number(/^HTTP\/[\d.]+ (\d+)/m.exec(head)?.[1] ?? 0);
  const location = /^location: (.*)$/im.exec(head)?.[1]?.trim() ?? null;
  return { status, location };
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const pageErrors = [];

async function login(email, password, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, locale: "ru-RU" });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(`${email} :: ${error.message.slice(0, 200)}`));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.fill('input[placeholder="name@company.com"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180_000 });
  return { context, page };
}

/** The cabinet polls (live claims, chat status) — wait for the page itself, not for network silence. */
async function open(page, path) {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 180_000 });
  await page.waitForTimeout(800);
  return response;
}

async function cookieHeader(context) {
  return (await context.cookies(BASE)).map((item) => `${item.name}=${item.value}`).join("; ");
}

/** Allowed panel tabs: every link of the panel navigation (groups included). */
async function panelTabs(page) {
  const hrefs = await page.locator("header nav a[href^='/root']").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  return [...new Set(hrefs)].sort();
}

async function profileSheetTexts(page) {
  await open(page, "/dashboard");
  await page.getByRole("button", { name: "Профиль" }).first().click({ timeout: 120_000 });
  await page.getByRole("dialog").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  return page.getByRole("dialog").first().innerText();
}

// ── AC1: вход в панель без сессии — как браузер получает его за nginx ──
{
  const anon = curl("/api/me/platform-panel");
  check("AC1", "logged out: entry Location is relative and returns to the panel after login",
    anon.status === 307 && anon.location === "/login?next=%2Fapi%2Fme%2Fplatform-panel",
    `${anon.status} ${anon.location}`);
}

const people = [
  { email: "alexey@wesetup.ru", panel: true, landing: "/root/crm", tabsInclude: ["/root/translations", "/root/crm"], tabsExclude: ["/root/team"], editor: 200 },
  { email: "admin@wesetup.local.test", panel: true, landing: "/root/crm", tabsInclude: ["/root/translations"], tabsExclude: ["/root/team"], editor: 200 },
  { email: "seo@wesetup.local.test", panel: true, landing: "/root/blog", tabsInclude: ["/root/translations", "/root/blog", "/root/seo"], tabsExclude: ["/root/crm", "/root", "/root/team"], editor: 200 },
  { email: "manager@wesetup.local.test", panel: true, landing: "/root/crm", tabsInclude: ["/root/crm"], tabsExclude: ["/root/translations", "/root/team"], editor: 403 },
  { email: "translator@wesetup.local.test", panel: true, landing: "/root/translations", tabsExact: ["/root/translations"], editor: 200 },
  { email: "ivan@romashka-cafe.ru", panel: false, editor: 403 },
];

async function guarded(name, run) {
  try {
    await run();
  } catch (error) {
    check("ERR", name, false, String(error?.message ?? error).split("\n")[0].slice(0, 300));
  }
}

for (const person of people) {
  const who = person.email.split("@")[0];
  await guarded(who, async () => {
  // Телефон: меню-лист снизу — как на скриншоте владельца.
  const phone = await login(person.email, USER_PASSWORD, { width: 390, height: 844 });
  const sheet = await profileSheetTexts(phone.page);
  await phone.page.screenshot({ path: `${SHOTS}/${who}-profile-sheet.png` });
  check("AC3", `${who}: no «Переводы интерфейса» in the phone profile menu`, !sheet.includes("Переводы интерфейса"), sheet.includes("Переводы интерфейса") ? "item present" : "absent");
  check("AC4", `${who}: «Панель платформы» in the phone profile menu ${person.panel ? "shown" : "hidden"}`,
    sheet.includes("Панель платформы") === person.panel, sheet.includes("Панель платформы") ? "shown" : "hidden");

  const cookie = await cookieHeader(phone.context);
  const entry = curl("/api/me/platform-panel", cookie);
  check("AC1", `${who}: entry Location relative (Host wesetup.ru, https)`,
    entry.status === 307 && entry.location?.startsWith("/") && !entry.location.includes("localhost") && entry.location === (person.panel ? person.landing : "/dashboard"),
    `${entry.status} ${entry.location}`);

  if (person.panel) {
    // Нажать «Панель платформы» в листе — куда приведёт.
    await phone.page.getByRole("dialog").first().getByText("Панель платформы").click();
    await phone.page.waitForURL((url) => url.pathname.startsWith("/root"), { timeout: 180_000 });
    await phone.page.locator("header nav").first().waitFor({ state: "attached", timeout: 180_000 });
    await phone.page.waitForTimeout(800);
    const landed = new URL(phone.page.url()).pathname;
    await phone.page.screenshot({ path: `${SHOTS}/${who}-panel-phone.png` });
    check("AC5", `${who}: «Панель платформы» opens ${person.landing}`, landed === person.landing, landed);
    const tabs = await panelTabs(phone.page);
    if (person.tabsExact) {
      check("AC5", `${who}: panel tabs exactly ${person.tabsExact.join(",")}`, JSON.stringify(tabs) === JSON.stringify(person.tabsExact), tabs.join(","));
    }
    for (const href of person.tabsInclude ?? []) check("AC5", `${who}: tab ${href} shown`, tabs.includes(href), tabs.join(","));
    for (const href of person.tabsExclude ?? []) check("AC5", `${who}: tab ${href} hidden`, !tabs.includes(href), tabs.join(","));
  }

  const editor = await phone.page.request.get(`${BASE}/api/translations/categories`);
  check("AC6", `${who}: translation editor API → ${person.editor}`, editor.status() === person.editor, String(editor.status()));
  const translators = await phone.page.request.get(`${BASE}/api/root/translators`);
  check("AC7", `${who}: translators API closed`, translators.status() === 404, String(translators.status()));

  // Старый адрес редактора ведёт в панель.
  const old = curl("/translations", cookie);
  check("AC8", `${who}: /translations → entry with next=/root/translations`,
    old.status === 307 && old.location === "/api/me/platform-panel?next=%2Froot%2Ftranslations", `${old.status} ${old.location}`);
  if (person.panel) {
    await open(phone.page, "/translations");
    const landed = new URL(phone.page.url()).pathname;
    const expected = person.editor === 200 ? "/root/translations" : person.landing;
    check("AC8", `${who}: opening /translations lands on ${expected}`, landed === expected, landed);
    if (landed === "/root/translations") {
      const rows = phone.page.locator("[data-testid='translators-panel']");
      check("AC7", `${who}: «Переводчики» block hidden on the tab`, (await rows.count()) === 0, `${await rows.count()} blocks`);
    }
  }

  // Мини-приложение: профиль.
  await open(phone.page, "/mini/me");
  await phone.page.waitForTimeout(2500);
  const mini = await phone.page.locator("body").innerText();
  check("AC3", `${who}: no «Переводы интерфейса» in the mini app profile`, !mini.includes("Переводы интерфейса"), mini.includes("Переводы интерфейса") ? "row present" : "absent");
  check("AC4", `${who}: «Панель платформы» in the mini app profile ${person.panel ? "shown" : "hidden"}`,
    mini.includes("Панель платформы") === person.panel, mini.includes("Панель платформы") ? "shown" : "hidden");
  await phone.page.screenshot({ path: `${SHOTS}/${who}-mini-me.png`, fullPage: true });

  // Компьютер: выпадающее меню профиля и кнопка панели в шапке.
  const desk = await login(person.email, USER_PASSWORD);
  await open(desk.page, "/dashboard");
  await desk.page.getByRole("button", { name: "Профиль" }).first().click({ timeout: 120_000 });
  const menu = desk.page.getByRole("menu").first();
  await menu.waitFor({ timeout: 30_000 });
  const menuText = await menu.innerText();
  check("AC3", `${who}: no «Переводы интерфейса» in the desktop profile menu`, !menuText.includes("Переводы интерфейса"), menuText.includes("Переводы интерфейса") ? "item present" : "absent");
  await desk.page.keyboard.press("Escape");
  const shield = desk.page.locator("header a[aria-label='Панель платформы']");
  const shieldHref = (await shield.count()) ? await shield.first().getAttribute("href") : null;
  check("AC4", `${who}: header panel button ${person.panel ? "→ entry" : "absent"}`,
    person.panel ? shieldHref === "/api/me/platform-panel" : shieldHref === null, String(shieldHref));
  await desk.context.close();
  await phone.context.close();
  });
}

// ── Владелец ──
await guarded("owner", async () => {
  const owner = await login(...OWNER);
  await open(owner.page, "/dashboard");
  await owner.page.getByRole("button", { name: "Профиль" }).first().click({ timeout: 120_000 });
  const menu = owner.page.getByRole("menu").first();
  await menu.waitFor({ timeout: 30_000 });
  const menuText = await menu.innerText();
  check("AC3", "owner: no «Переводы интерфейса» in the desktop profile menu", !menuText.includes("Переводы интерфейса"), menuText.includes("Переводы интерфейса") ? "item present" : "absent");
  await owner.page.keyboard.press("Escape");
  const shieldHref = await owner.page.locator("header a[aria-label='Панель платформы']").first().getAttribute("href");
  check("AC4", "owner: header panel button → /root", shieldHref === "/root", String(shieldHref));
  await open(owner.page, "/root/translations");
  const tabs = await panelTabs(owner.page);
  check("AC5", "owner: panel shows «Переводы» and «Команда»", tabs.includes("/root/translations") && tabs.includes("/root/team"), `${tabs.length} tabs`);
  const block = owner.page.locator("[data-testid='translators-panel']");
  check("AC7", "owner: «Переводчики» block on the tab", (await block.count()) === 1, `${await block.count()} blocks`);
  const blockText = (await block.count()) ? await block.innerText() : "";
  check("AC7", "owner: block says translators open «Переводы» in the panel", blockText.includes("панели платформы"), blockText.split("\n").slice(0, 2).join(" / "));
  await owner.page.screenshot({ path: `${SHOTS}/owner-translations.png` });
  const translators = await owner.page.request.get(`${BASE}/api/root/translators`);
  check("AC7", "owner: translators API open", translators.status() === 200, String(translators.status()));
  const editor = await owner.page.request.get(`${BASE}/api/translations/categories`);
  check("AC6", "owner: translation editor API → 200", editor.status() === 200, String(editor.status()));
  await owner.context.close();
});

// ── Вход по ссылке из письма без сессии: вход → сразу в панель ──
await guarded("email-link", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
  const page = await context.newPage();
  await open(page, "/api/me/platform-panel");
  check("AC1", "email link while logged out opens the login page", new URL(page.url()).pathname === "/login", page.url().replace(BASE, ""));
  await page.fill('input[placeholder="name@company.com"]', "translator@wesetup.local.test");
  await page.fill('input[type="password"]', USER_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 180_000 });
  await page.waitForTimeout(1500);
  const landed = new URL(page.url()).pathname;
  check("AC1", "after login the translator lands on «Переводы»", landed === "/root/translations", landed);
  await context.close();
});

await browser.close();
const failed = results.filter((item) => !item.ok);
const summary = { label: LABEL, total: results.length, passed: results.length - failed.length, failed: failed.length, pageErrors };
writeFileSync(`${OUT}/panel-check-${LABEL}.json`, JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary));
process.exit(failed.length ? 1 : 0);
