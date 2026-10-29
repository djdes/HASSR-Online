// Platform panel: clients list, client card contacts, delegated access, «Моя почта».
// LOCAL DB wesetup_root only (seed-local.ts first).
//   BASE=http://localhost:3026 CHROME=<chrome.exe> node .agent/tasks/root-admin-2026-10-29/raw/e2e.mjs
import { chromium } from "playwright";
import pg from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3026";
const DB = "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_root?sslmode=disable";
const OUT = new URL("./shots/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, OUT)), fullPage: false });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sql = async (text, params = []) => {
  const client = new pg.Client({ connectionString: DB });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
};

async function login(context, email) {
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  page.setDefaultNavigationTimeout(240000);
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.fill("#email", email);
    await page.fill("#password", "Test-12345");
    if ((await page.inputValue("#email")) !== email) continue;
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 });
      break;
    } catch {
      await page.waitForTimeout(1500);
    }
  }
  await page.mouse.move(0, 0);
  return page;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
try {
  const [chef] = await sql(`select id from "User" where email='dk-chef@test.local'`);
  await sql(`update "User" set "platformSections"='{}' where id=$1`, [chef.id]);
  await sql(`delete from "PlatformMailSender"`);

  // ── Owner: clients list ────────────────────────────────────────────────
  const rootCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const root = await login(rootCtx, "root@test.local");
  await root.goto(`${BASE}/root`, { waitUntil: "load" });
  await root.waitForSelector("[data-clients-list]");
  check("/root: заголовок «Клиенты»", (await root.textContent("h1"))?.includes("Клиенты"));
  const overflow = await root.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("/root 1440: без горизонтальной прокрутки", overflow <= 0, `overflow ${overflow}px`);
  check("/root: строка ДК с телефоном владельца", (await root.locator('[data-client-row="org-dk"] a[href^="tel:"]').count()) > 0);
  check("/root: почта владельца — контактная, не служебная", (await root.locator('[data-client-row="org-dk"] a[href="mailto:olga@dk-example.ru"]').count()) === 1);
  check("/root: колонок 6 (5 + действия)", (await root.locator("[data-clients-list] thead th").count()) === 6);
  await root.fill("[data-clients-search]", "000-11-22");
  await root.waitForTimeout(300);
  check("/root: поиск по телефону компании находит ДК", (await root.locator("[data-client-row]").count()) === 1 && (await root.locator('[data-client-row="org-dk"]').count()) === 1);
  await root.fill("[data-clients-search]", "");
  await root.click('[data-segment="paying"]');
  check("/root: фильтр «Платят» переключается", (await root.getAttribute('[data-segment="paying"]', "aria-selected")) === "true");
  await root.click('[data-segment="all"]');
  await shot(root, "1-clients-1440");

  const mobile = await rootCtx.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${BASE}/root`, { waitUntil: "load" });
  await mobile.waitForSelector("[data-client-card]");
  const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("/root 390: карточки без горизонтальной прокрутки", mobileOverflow <= 0, `overflow ${mobileOverflow}px`);
  await shot(mobile, "2-clients-390");
  await mobile.close();

  // ── Owner: client card ────────────────────────────────────────────────
  await root.goto(`${BASE}/root/organizations/org-dk`, { waitUntil: "load" });
  await root.waitForSelector("[data-client-contacts]");
  const contactsText = await root.textContent("[data-client-contacts]");
  check("Карточка: телефон владельца крупно, ссылкой", (await root.locator('[data-contact="owner-phone"] a[href^="tel:"]').count()) === 1);
  check("Карточка: контактная почта владельца", contactsText?.includes("olga@dk-example.ru"));
  check("Карточка: бухгалтерия и телефон компании", contactsText?.includes("buh@dk-example.ru") && contactsText?.includes("000-11-22"));
  const peoplePhones = await root.locator('[data-client-people] a[href^="tel:"]').count();
  check("Карточка: телефоны сотрудников", peoplePhones >= 3, `${peoplePhones} телефонов`);
  await shot(root, "3-client-card");

  // Grant SEO preset to the chef from the people list.
  await root.click(`[data-panel-access="${chef.id}"]`);
  await root.waitForSelector("[data-platform-access-dialog]");
  await root.click('[data-preset="seo"]');
  await shot(root, "4-access-dialog");
  await root.getByRole("button", { name: "Открыть доступ" }).click();
  await root.waitForSelector("[data-platform-access-dialog]", { state: "detached", timeout: 120000 });
  const [granted] = await sql(`select "platformSections" from "User" where id=$1`, [chef.id]);
  check("Выдача роли «SEO и контент» сохранилась", JSON.stringify(granted.platformSections) === JSON.stringify(["content", "seo", "translations"]), JSON.stringify(granted.platformSections));

  await root.goto(`${BASE}/root/team`, { waitUntil: "load" });
  await root.waitForSelector(`[data-team-member="${chef.id}"]`);
  check("Команда: сотрудник в списке с ролью", (await root.textContent(`[data-team-member="${chef.id}"]`))?.includes("SEO и контент"));
  await shot(root, "5-team");

  // ── Owner: «Моя почта» — validation and an unreachable server ─────────
  await root.goto(`${BASE}/root/me`, { waitUntil: "load" });
  await root.waitForSelector("[data-mail-sender-form]");
  await root.fill('input[name="host"]', "127.0.0.1");
  await root.fill('input[name="username"]', "root@test.local");
  await root.fill('input[name="password"]', "secret");
  await root.fill('input[name="fromEmail"]', "root@test.local");
  await root.click('button[type="submit"]');
  await root.waitForSelector("text=внешний SMTP-сервер");
  check("Моя почта: внутренний адрес сервера отклонён", true);
  await root.fill('input[name="host"]', "smtp.wesetup-check.invalid");
  await root.click('button[type="submit"]');
  // На этой машине неизвестные имена разрешаются в 127.92.2.3 — как раз случай
  // «внешнее имя ведёт во внутреннюю сеть»: подключения быть не должно.
  await root.waitForSelector('[data-mail-status="error"]', { timeout: 60000 });
  const mailError = (await root.textContent('[data-mail-status="error"]')) ?? "";
  check("Моя почта: имя во внутреннюю сеть или несуществующее — понятная ошибка без подключения", mailError.includes("Не работает") && /внутреннюю сеть|Такого SMTP-сервера нет/.test(mailError), mailError.slice(0, 160));
  const [mailRow] = await sql(`select "passwordEnc", "verifiedAt" from "PlatformMailSender"`);
  check("Моя почта: пароль хранится зашифрованным", mailRow && !mailRow.passwordEnc.includes("secret") && mailRow.passwordEnc.split(".").length === 3);
  await shot(root, "6-my-mail");

  // ── Delegated staff (SEO) ─────────────────────────────────────────────
  const chefCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const staff = await login(chefCtx, "dk-chef@test.local");
  await staff.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  const panelLink = await staff.locator('a[href="/api/me/platform-panel"]').count();
  check("Сотрудник SEO: в кабинете есть ссылка «Панель платформы»", panelLink > 0, String(panelLink));
  // Кабинет сам может увести на свою домашнюю — переход повторяем.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await staff.goto(`${BASE}/api/me/platform-panel`, { waitUntil: "load" }).catch(() => {});
    if (new URL(staff.url()).pathname.startsWith("/root")) break;
    await staff.waitForTimeout(2000);
  }
  check("Сотрудник SEO: ссылка ведёт в его раздел", new URL(staff.url()).pathname === "/root/blog", staff.url());
  await staff.goto(`${BASE}/root`, { waitUntil: "load" });
  await staff.waitForURL((url) => url.pathname === "/root/blog", { timeout: 120000 }).catch(() => {});
  check("Сотрудник SEO: /root ведёт в первый свой раздел (/root/blog)", new URL(staff.url()).pathname === "/root/blog", staff.url());
  const navText = (await staff.locator("header nav").first().textContent()) ?? "";
  check("Сотрудник SEO: в меню нет «Клиенты» и «Деньги»", !navText.includes("Клиенты") && !navText.includes("Деньги"), navText.slice(0, 120));
  check("Сотрудник SEO: в шапке — роль", (await staff.textContent("[data-root-access]"))?.includes("SEO и контент"));
  await shot(staff, "7-staff-seo");
  for (const path of ["/root/tariffs", "/root/team", "/root/organizations/org-dk"]) {
    const response = await staff.goto(`${BASE}${path}`, { waitUntil: "load" });
    check(`Сотрудник SEO: ${path} закрыт (404)`, response?.status() === 404, String(response?.status()));
  }
  const apiTeam = await staff.request.get(`${BASE}/api/root/team`);
  check("Сотрудник SEO: API команды закрыт", apiTeam.status() === 404, String(apiTeam.status()));
  const me = await staff.goto(`${BASE}/root/me`, { waitUntil: "load" });
  check("Сотрудник SEO: «Моя почта» открыта", me?.status() === 200);

  // ── Owner revokes; the staff token is still old, the page closes at once ──
  await root.goto(`${BASE}/root/team`, { waitUntil: "load" });
  await root.click(`[data-team-member="${chef.id}"] button:has-text("Изменить")`);
  await root.waitForSelector("[data-platform-access-dialog]");
  await root.getByRole("button", { name: "Закрыть доступ" }).first().click();
  await root.getByRole("button", { name: "Закрыть доступ" }).last().click();
  await root.waitForSelector(`[data-team-member="${chef.id}"]`, { state: "detached", timeout: 120000 });
  const [revoked] = await sql(`select "platformSections" from "User" where id=$1`, [chef.id]);
  check("Отзыв доступа сохранён", revoked.platformSections.length === 0);
  const after = await staff.goto(`${BASE}/root/blog`, { waitUntil: "load" });
  check("После отзыва /root/blog у сотрудника — 404 сразу", after?.status() === 404, String(after?.status()));
} catch (error) {
  check("скрипт без исключений", false, error?.stack ?? String(error));
} finally {
  await browser.close();
  const failed = results.filter((result) => !result.ok);
  writeFileSync(fileURLToPath(new URL("e2e-result.json", OUT)), JSON.stringify({ base: BASE, total: results.length, failed: failed.length, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exitCode = failed.length ? 1 : 0;
}
