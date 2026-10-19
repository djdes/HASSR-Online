// Playwright-проверка страниц «Журналы → Наборы журналов» на своём dev-сервере.
// Запуск из корня worktree: node .agent/tasks/pages-journals-2026-10/e2e.mjs [base]
// Пишет скриншоты и results.json в raw/ (копия скриншотов — в pages-shots/journals).
// База — своя копия wesetup_pages_journals (127.0.0.1:5432): подготовка — выключаем
// три журнала стандартного набора, чтобы проверить «Включить весь набор».
import { chromium } from "playwright";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3074";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
const SHOTS = "C:/Users/Two/wesetup-backup-2026-10-17/pages-shots/journals";
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const DB = "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_pages_journals";
const PASSWORD = "admin1234";
const ROLES = {
  owner: "admin@haccp.local",
  headchef: "chef@haccp.local",
  cook: "hotcook1@haccp.local",
};
const TURN_OFF = ["uv_lamp_runtime", "pest_control", "med_books"];
// ONLY=cook,mini — прогнать только эти блоки (результаты — results-cook-mini.json).
const ONLY = (process.env.ONLY || "owner,headchef,cook,mini").split(",").map((item) => item.trim());
const want = (block) => ONLY.includes(block);
const RESULTS_FILE = process.env.ONLY ? `results-${ONLY.join("-")}.json` : "results.json";

const results = { base: BASE, startedAt: new Date().toISOString(), checks: [] };
// "createdAt" хранится как timestamp без пояса (UTC) — сравниваем с UTC-строкой.
const startedAtUtc = results.startedAt.replace("Z", "");
let failures = 0;
function check(name, ok, details = undefined) {
  results.checks.push({ name, ok: Boolean(ok), ...(details === undefined ? {} : { details }) });
  if (!ok) failures++;
  console.log(ok ? "  ✓" : "  ✗", name, details === undefined ? "" : JSON.stringify(details).slice(0, 300));
}

async function shot(page, name) {
  const file = path.join(RAW, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  fs.copyFileSync(file, path.join(SHOTS, `${name}.png`));
}

// Ограничитель переходов: не чаще раза в 2,6 с, на 429 ждём Retry-After.
let lastNavigation = 0;
async function throttle() {
  const wait = lastNavigation + 2_600 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNavigation = Date.now();
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
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
  await page.waitForTimeout(400);
}

async function goto(page, href) {
  let response = null;
  for (let attempt = 0; attempt < 3; attempt++) {
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

async function signIn(context, email) {
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`${email}: pageerror на ${page.url()}`, false, `${error.message} | ${(error.stack || "").slice(0, 700)}`));
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD }, timeout: 600_000 });
  const body = await res.json().catch(() => null);
  if (!res.ok() || body?.requiresCode) throw new Error(`вход ${email}: HTTP ${res.status()} ${JSON.stringify(body)}`);
  return page;
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return { scrollWidth: el.scrollWidth, innerWidth: window.innerWidth, ok: el.scrollWidth <= window.innerWidth + 1 };
  });
}

async function items(page) {
  return page.locator("[data-journal-set-item]").evaluateAll((els) =>
    els.map((el) => ({
      code: el.getAttribute("data-journal-set-item"),
      enabled: el.getAttribute("data-enabled") === "true",
      today: el.getAttribute("data-today"),
      number: el.querySelector("span")?.textContent?.trim(),
    })),
  );
}

async function pills(page) {
  return page.locator("h1").first().locator("xpath=ancestor::div[2]").locator("span.rounded-full").allTextContents();
}

async function main() {
  const client = new pg.Client({ connectionString: DB });
  await client.connect();
  const org = (
    await client.query(
      `select o.id, o."disabledJournalCodes" as disabled from "User" u join "Organization" o on o.id = u."organizationId" where u.email = $1`,
      [ROLES.owner],
    )
  ).rows[0];
  const before = Array.isArray(org.disabled) ? org.disabled : [];
  if (want("owner")) {
  const prepared = [...new Set([...before, ...TURN_OFF])];
  await client.query(`update "Organization" set "disabledJournalCodes" = $1::jsonb where id = $2`, [
    JSON.stringify(prepared),
    org.id,
  ]);
  results.prepared = { organizationId: org.id, turnedOff: TURN_OFF };
  }

  const browser = await chromium.launch({ channel: "chrome", args: ["--lang=ru-RU"] });

  // ── Руководитель, 1440×900 ──────────────────────────────────────────────
  console.log("руководитель 1440");
  if (want("owner")) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const page = await signIn(context, ROLES.owner);
    let res = await goto(page, "/journals/sets/standard");
    check("owner: /journals/sets/standard 200", res?.status() === 200, res?.status());
    const h1 = (await page.locator("h1").first().textContent())?.trim();
    check("owner: заголовок стандартного набора", h1 === "Стандартный набор журналов", h1);
    let list = await items(page);
    check("owner: 11 журналов, нумерация 1–11", list.length === 11 && list.every((item, i) => item.number === String(i + 1)), list.map((i) => `${i.number}:${i.code}`));
    check(
      "owner: три выключенных журнала видны как выключенные",
      TURN_OFF.every((code) => list.find((item) => item.code === code)?.enabled === false),
      list.filter((i) => !i.enabled).map((i) => i.code),
    );
    check("owner: пилюли «Включено 8 из 11» и «Заполнено сегодня»", (await pills(page)).some((t) => t.includes("Включено 8 из 11")), await pills(page));
    const sidebarSets = await page.locator("[data-app-sidebar] [data-menu-item]").evaluateAll((els) =>
      els.map((el) => ({ id: el.getAttribute("data-menu-item"), current: el.getAttribute("aria-current") })),
    );
    check(
      "owner: в сайдбаре группа наборов, «Стандартный набор» активен",
      ["standard", "haccp", "extra"].every((id) => sidebarSets.some((item) => item.id === id)) &&
        sidebarSets.find((item) => item.id === "standard")?.current === "page",
      sidebarSets,
    );
    const related = await page.locator("[data-journal-set-related]").count();
    check("owner: связанный журнал у гигиенического показан", related === 1, related);
    await shot(page, "desktop-owner-standard-before");

    // «Включить весь набор» → подтверждение → тост → все включены.
    const button = page.locator("[data-journal-set-enable-all]");
    check("owner: кнопка «Включить весь набор» есть", await button.isVisible());
    await button.click();
    const dialog = page.locator('[role="dialog"]').filter({ hasText: "Включить весь набор?" });
    await dialog.waitFor({ timeout: 10_000 });
    const dialogText = await dialog.textContent();
    check("owner: подтверждение перечисляет 3 журнала", /Включатся 3 журнала/.test(dialogText ?? ""), dialogText?.slice(0, 400));
    await shot(page, "desktop-owner-standard-confirm");
    await dialog.getByRole("button", { name: "Включить", exact: true }).click();
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Включено журналов: 3" });
    await toast.waitFor({ timeout: 180_000 }).catch(() => {});
    check("owner: тост «Включено журналов: 3»", await toast.isVisible().catch(() => false));
    await page.waitForFunction(() => document.querySelectorAll('[data-journal-set-item][data-enabled="false"]').length === 0, null, { timeout: 60_000 }).catch(() => {});
    list = await items(page);
    check("owner: после включения все 11 включены", list.length === 11 && list.every((item) => item.enabled), list.filter((i) => !i.enabled).map((i) => i.code));
    check("owner: кнопка пропала", (await page.locator("[data-journal-set-enable-all]").count()) === 0);
    await page.waitForTimeout(800);
    await shot(page, "desktop-owner-standard-after");
    const dbAfter = (await client.query(`select "disabledJournalCodes" as d from "Organization" where id = $1`, [org.id])).rows[0].d;
    check("owner: в базе журналы набора больше не выключены", TURN_OFF.every((code) => !dbAfter.includes(code)), dbAfter);
    const audit = (
      await client.query(
        `select count(*)::int as n from "AuditLog" where "organizationId" = $1 and action = 'journal.enable' and details->>'journalSet' = 'standard' and "createdAt" >= $2::timestamp`,
        [org.id, startedAtUtc],
      )
    ).rows[0].n;
    check("owner: три записи journal.enable в AuditLog", audit === 3, audit);

    // «Заполнен сегодня» после записи в журнал (тот же POST /api/journals, что у формы).
    const target = list.find((item) => item.today === "notFilled");
    check("owner: есть ежедневный журнал «Не заполнен»", Boolean(target), list.map((i) => `${i.code}:${i.today}`));
    if (target) {
      const entry = await page.request.post(`${BASE}/api/journals`, {
        data: { templateCode: target.code, data: { note: "e2e: проверка «заполнен сегодня»" } },
        headers: { "Idempotency-Key": `e2e-${Date.now()}` },
      });
      check(`owner: запись в журнал ${target.code} создана`, entry.ok(), entry.status());
      await goto(page, "/journals/sets/standard");
      const after = (await items(page)).find((item) => item.code === target.code);
      check(`owner: ${target.code} — «Заполнен сегодня»`, after?.today === "filled", after);
      results.filledProbe = { code: target.code, before: target.today, after: after?.today };
      await shot(page, "desktop-owner-standard-filled");
    }

    // Открыть журнал — страница журнала не сломана.
    const open = page.locator('[data-journal-open="hygiene"]');
    check("owner: «Открыть журнал» у гигиенического", await open.isVisible());
    await throttle();
    await open.click({ timeout: 600_000, noWaitAfter: true });
    await page.waitForURL(/\/journals\/hygiene/, { timeout: 600_000 }).catch(() => {});
    await settle(page);
    check("owner: /journals/hygiene открылся", /\/journals\/hygiene/.test(page.url()) && (await page.locator("h1").count()) > 0, page.url());

    res = await goto(page, "/journals/sets/haccp");
    check("owner: /journals/sets/haccp 200", res?.status() === 200, res?.status());
    list = await items(page);
    check("owner: ХАССП — 19 журналов", list.length === 19, list.length);
    check("owner: ХАССП — кнопка «Включить весь набор»", (await page.locator("[data-journal-set-enable-all]").count()) === 1);
    results.haccpPills = await pills(page);
    await shot(page, "desktop-owner-haccp");

    res = await goto(page, "/journals/sets/extra");
    check("owner: /journals/sets/extra 200", res?.status() === 200, res?.status());
    list = await items(page);
    check("owner: дополнительные — нет массового включения", (await page.locator("[data-journal-set-enable-all]").count()) === 0);
    const off = list.find((item) => !item.enabled);
    check("owner: дополнительные — есть выключенный журнал", Boolean(off), list.length);
    await shot(page, "desktop-owner-extra-before");
    if (off) {
      await page.locator(`[data-journal-enable="${off.code}"]`).click();
      await page.locator("[data-sonner-toast]").filter({ hasText: "Журнал включён" }).waitFor({ timeout: 180_000 }).catch(() => {});
      check("owner: тост «Журнал включён: …»", await page.locator("[data-sonner-toast]").filter({ hasText: "Журнал включён" }).isVisible().catch(() => false));
      await page.waitForFunction((code) => document.querySelector(`[data-journal-set-item="${code}"]`)?.getAttribute("data-enabled") === "true", off.code, { timeout: 60_000 }).catch(() => {});
      const now = (await items(page)).find((item) => item.code === off.code);
      check(`owner: «Включить» по одному — ${off.code} включён`, now?.enabled === true, now);
      results.extraEnabled = off.code;
      await page.waitForTimeout(600);
      await shot(page, "desktop-owner-extra-after");
    }
    await context.close();
  }

  // ── Руководитель, телефон 390×800 ──────────────────────────────────────
  console.log("руководитель 390");
  if (want("owner")) {
    const context = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: "ru-RU", isMobile: true, hasTouch: true });
    const page = await signIn(context, ROLES.owner);
    for (const id of ["standard", "haccp", "extra"]) {
      const res = await goto(page, `/journals/sets/${id}`);
      const scroll = await noHorizontalScroll(page);
      check(`owner 390: /journals/sets/${id} 200, без горизонтальной прокрутки`, res?.status() === 200 && scroll.ok, scroll);
      await shot(page, `mobile-owner-${id}`);
    }
    await context.close();
  }

  // ── Заведующая ─────────────────────────────────────────────────────────
  console.log("заведующая");
  if (want("headchef")) for (const [tag, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 800 }]]) {
    const context = await browser.newContext({ viewport, locale: "ru-RU", ...(tag === "mobile" ? { isMobile: true, hasTouch: true } : {}) });
    const page = await signIn(context, ROLES.headchef);
    let res = await goto(page, "/journals/sets/standard");
    check(`headchef ${tag}: /journals/sets/standard 200`, res?.status() === 200 && /\/journals\/sets\/standard/.test(page.url()), { status: res?.status(), url: page.url() });
    const list = await items(page);
    check(`headchef ${tag}: 11 журналов`, list.length === 11, list.length);
    if (tag === "mobile") check("headchef 390: без горизонтальной прокрутки", (await noHorizontalScroll(page)).ok, await noHorizontalScroll(page));
    await shot(page, `${tag}-headchef-standard`);
    res = await goto(page, "/journals/sets/haccp");
    check(`headchef ${tag}: ХАССП — кнопка видна (API разрешает руководству)`, (await page.locator("[data-journal-set-enable-all]").count()) === 1);
    await shot(page, `${tag}-headchef-haccp`);
    if (tag === "desktop") {
      const sidebar = await page.locator("[data-app-sidebar] [data-menu-item]").evaluateAll((els) => els.map((el) => el.getAttribute("data-menu-item")));
      check("headchef: в меню «Журналов» — наборы", ["standard", "haccp", "extra"].every((id) => sidebar.includes(id)), sidebar);
      res = await goto(page, "/journals/climate_control");
      check("headchef: «Открыть журнал» ведёт на рабочую страницу журнала", res?.status() === 200 && /\/journals\/climate_control/.test(page.url()), { status: res?.status(), url: page.url() });
    }
    await context.close();
  }

  // ── Повар ──────────────────────────────────────────────────────────────
  console.log("повар");
  if (want("cook")) for (const [tag, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 800 }]]) {
    const context = await browser.newContext({ viewport, locale: "ru-RU" });
    const page = await signIn(context, ROLES.cook);
    for (const id of ["standard", "extra"]) {
      // Ветка `journals` стримится (loading.tsx), поэтому redirect() страницы
      // приходит внутри потока и браузер уходит со страницы уже после
      // domcontentloaded — ждём смены адреса.
      await throttle();
      const response = await page
        .goto(`${BASE}/journals/sets/${id}`, { waitUntil: "domcontentloaded", timeout: 600_000 })
        .catch((error) => ({ aborted: String(error?.message ?? error).slice(0, 80) }));
      await page.waitForURL((url) => !url.pathname.startsWith("/journals/sets/"), { timeout: 180_000 }).catch(() => {});
      await settle(page);
      const items = await page.locator("[data-journal-set-item]").count();
      check(
        `cook ${tag}: прямой заход на /journals/sets/${id} — редирект, списка набора нет`,
        !new URL(page.url()).pathname.startsWith("/journals/sets/") && items === 0,
        { url: page.url(), first: typeof response?.status === "function" ? response.status() : response?.aborted ?? null, items },
      );
    }
    check(`cook ${tag}: ссылок на наборы нет`, (await page.locator('a[href^="/journals/sets/"]').count()) === 0);
    await shot(page, `${tag}-cook-redirect`);
    await context.close();
  }

  // ── Mini App (оболочка ws-shell=mini) ──────────────────────────────────
  console.log("Mini App");
  if (want("mini")) {
    const context = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: "ru-RU", isMobile: true, hasTouch: true });
    await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    const page = await signIn(context, ROLES.owner);
    for (const id of ["standard", "haccp", "extra"]) {
      const res = await goto(page, `/journals/sets/${id}`);
      const scroll = await noHorizontalScroll(page);
      const count = await page.locator("[data-journal-set-item]").count();
      check(`mini: /journals/sets/${id} 200, список, без прокрутки вбок`, res?.status() === 200 && count > 0 && scroll.ok, { count, scroll });
      await shot(page, `mini-owner-${id}`);
    }
    const topbar = (await page.locator(".mini-topbar-title").first().textContent().catch(() => null))?.trim();
    check("mini: заголовок экрана «Дополнительные журналы»", topbar === "Дополнительные журналы", topbar);
    // Меню раздела в Mini App: пункты наборов.
    const menuButton = page.locator("[data-section-menu-button], button:has-text('Меню раздела')").first();
    if (await menuButton.isVisible().catch(() => false)) {
      await menuButton.click();
      await page.waitForTimeout(800);
      const menuItems = await page.locator("[data-menu-item]").evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height > 0).map((el) => el.getAttribute("data-menu-item")));
      check("mini: в меню раздела — три набора", ["standard", "haccp", "extra"].every((id) => menuItems.includes(id)), menuItems);
      await shot(page, "mini-owner-section-menu");
    } else {
      check("mini: кнопка меню раздела", false, "не найдена");
    }
    await context.close();
  }

  await browser.close();
  await client.end();
  results.finishedAt = new Date().toISOString();
  results.failures = failures;
  fs.writeFileSync(path.join(RAW, RESULTS_FILE), JSON.stringify(results, null, 2));
  console.log(failures === 0 ? "ВСЁ ЗЕЛЁНОЕ" : `ПРОВАЛОВ: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  results.fatal = String(error?.stack || error);
  fs.writeFileSync(path.join(RAW, RESULTS_FILE), JSON.stringify(results, null, 2));
  process.exit(2);
});
