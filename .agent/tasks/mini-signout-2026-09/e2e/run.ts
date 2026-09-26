// Проверка критериев спеки mini-signout-2026-09 на живом dev-сервере (порт 3044).
//
//   cd C:/wt/fix
//   npx tsx .agent/tasks/mini-signout-2026-09/e2e/setup.ts
//   PHASE=after npx tsx .agent/tasks/mini-signout-2026-09/e2e/run.ts
//
// PHASE=before — прогон на исходном коде (фиксирует жалобу), PHASE=after — на
// исправленном. Результат: evidence/<PHASE>/results.json и несколько снимков.
//
// Кто вошёл, спрашиваем у сервера двумя способами:
//   • /api/mini/session — getServerSession проекта: читает ВСЕ имена кук
//     сессии, ровно так видят человека страницы и API;
//   • /api/auth/session — сам next-auth (useSession на клиенте).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserContext, Locator, Page } from "playwright-core";

import { db } from "./db";
import { PASSWORD, USERS, type UserKey } from "./fixtures";
import { BASE, TASK_DIR, launch, openPhone, telegramLaunchHash, type Tab } from "./tg";

const PHASE = process.env.PHASE === "before" ? "before" : "after";
const OUT = path.join(TASK_DIR, "evidence", PHASE);
// Пока страницы открыты, файлы в дерево проекта не пишем (dev-сервер следит
// за ним); снимки копируются в evidence/ после закрытия браузера.
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), `mso-${PHASE}-`));
fs.mkdirSync(OUT, { recursive: true });
const MARK_KEY = "wesetup.mini.signed-out";
/** Сколько ждём после выхода: успел бы автоматический вход вернуть сессию. */
const SETTLE_MS = 7000;

type Check = { scenario: string; ac: string; id: string; ok: boolean; detail: string };
const checks: Check[] = [];
/** Проверки текущей попытки сценария: в итог попадает только последняя попытка. */
let attemptChecks: Check[] = [];
function check(scenario: string, ac: string, id: string, ok: boolean, detail: string) {
  attemptChecks.push({ scenario, ac, id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${ac}] ${scenario}/${id} — ${detail}`);
}
const retries: Array<{ scenario: string; attempt: number; reason: string }> = [];

const ids: Record<UserKey, string> = { a: "", b: "", owner: "" };
function who(id: string | null): string {
  if (!id) return "нет сессии";
  const key = (Object.keys(ids) as UserKey[]).find((k) => ids[k] === id);
  return key ? `${key.toUpperCase()} (${USERS[key].name})` : `чужой ${id}`;
}

async function serverUser(ctx: BrowserContext): Promise<string | null> {
  const r = await ctx.request.get(`${BASE}/api/mini/session`, { timeout: 180_000 });
  if (r.status() === 401) return null;
  const j = (await r.json().catch(() => null)) as { user?: { id?: string } } | null;
  return j?.user?.id ?? null;
}

async function nextAuthUser(ctx: BrowserContext): Promise<string | null> {
  const r = await ctx.request.get(`${BASE}/api/auth/session`, { timeout: 180_000 });
  const j = (await r.json().catch(() => null)) as { user?: { id?: string } } | null;
  return j?.user?.id ?? null;
}

async function sessionCookies(ctx: BrowserContext): Promise<string[]> {
  return (await ctx.cookies()).filter((c) => /session-token/.test(c.name)).map((c) => c.name);
}

async function mark(page: Page): Promise<string | null> {
  return page.evaluate((k) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return "storage-error";
    }
  }, MARK_KEY);
}

const pathOf = (page: Page) => new URL(page.url()).pathname;

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(STAGE, `${name}.png`), animations: "disabled" }).catch(() => {});
}

/** Прогрев маршрутов dev-сервера: первая компиляция страницы занимает минуты. */
async function warm(ctx: BrowserContext) {
  for (const p of ["/mini", "/mini/login", "/mini/me", "/mini/today", "/journals", "/dashboard", "/login", "/api/mini/session", "/api/auth/session", "/api/auth/csrf", "/api/auth/providers"]) {
    const t = Date.now();
    const r = await ctx.request.get(`${BASE}${p}`, { timeout: 600_000, maxRedirects: 0 }).catch((e) => e as Error);
    console.log("warm", p, r instanceof Error ? r.message.slice(0, 80) : r.status(), `${Date.now() - t}ms`);
  }
}

/** Открыть приложение из бота: чистая вкладка и адрес с подписанным initData. */
async function openFromBot(page: Page, user: UserKey) {
  await page.goto("about:blank");
  await page.goto(`${BASE}/mini${telegramLaunchHash(USERS[user].tg ?? USERS.a.tg)}`, { waitUntil: "load" });
}

/** Дождаться, пока экран входа `/mini` уведёт дальше (или не уведёт). */
async function waitLeaves(page: Page, paths: string[], timeout = 180_000): Promise<boolean> {
  return page
    .waitForURL((u) => !paths.includes(u.pathname), { timeout })
    .then(() => true)
    .catch(() => false);
}

/**
 * Дождаться гидратации элемента: React вешает на узел `__reactProps$…`.
 * Нажатие по серверной разметке до гидратации ничего не делает, а отправка
 * формы до неё ушла бы обычным GET с паролем в адресе.
 */
async function hydrated(locator: Locator, timeout = 180_000): Promise<Locator> {
  await locator.waitFor({ state: "visible", timeout });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ok = await locator
      .evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps")))
      .catch(() => false);
    if (ok) return locator;
    await locator.page().waitForTimeout(250);
  }
  throw new Error("элемент так и не гидратировался");
}

/** «Профиль» → «Выйти» → подтверждение. Возвращает, куда увело. */
async function signOutFromProfile(page: Page): Promise<string> {
  await page.goto(`${BASE}/mini/me`, { waitUntil: "load" });
  const row = await hydrated(page.getByRole("button", { name: /^Выйти/ }));
  await row.click();
  const dialog = page.getByRole("dialog");
  await (await hydrated(dialog.getByRole("button", { name: "Выйти", exact: true }), 30_000)).click();
  await page.waitForURL((u) => u.pathname !== "/mini/me", { timeout: 180_000 });
  // Даём время автоматическому входу, если он есть, вернуть сессию.
  await page.waitForTimeout(SETTLE_MS);
  return pathOf(page);
}

async function loginByPhone(page: Page, user: UserKey) {
  await hydrated(page.locator("#phone"));
  await page.locator("#phone").fill(USERS[user].phone);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await waitLeaves(page, ["/mini/login"]);
  await waitLeaves(page, ["/mini"]);
  await page.waitForTimeout(1500);
}

type Scenario = (tab: Tab) => Promise<void>;

/**
 * Сбой dev-сервера, а не приложения: webpack пересобирает общий чанк
 * (`app/layout`), пока страница его грузит, — страница остаётся без JS.
 * На проде (одна сборка) такого нет.
 */
const DEV_CHUNK_ERROR = /ChunkLoadError|Loading chunk|Invalid or unexpected token/;

async function runScenario(
  name: string,
  openTab: () => Promise<Tab>,
  body: Scenario,
  reset: () => Promise<void> = async () => {},
) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    attemptChecks = [];
    await reset();
    const tab = await openTab();
    try {
      await body(tab);
    } catch (error) {
      check(name, "-", "exception", false, String(error).slice(0, 300));
      await shot(tab.page, `${name}-exception`);
    } finally {
      if (tab.errors.length) console.log(`[${name}] ошибки страницы:`, tab.errors.slice(0, 5));
      await tab.ctx.close();
    }
    const failed = attemptChecks.some((c) => !c.ok);
    const devError = tab.errors.find((e) => DEV_CHUNK_ERROR.test(e));
    if (failed && devError && attempt < 3) {
      // Повтор с чистого листа: провал из-за пересборки dev-сервера ничего
      // не говорит о приложении. Повтор записываем в итог.
      retries.push({ scenario: name, attempt, reason: devError.slice(0, 160) });
      console.log(`[${name}] попытка ${attempt} сорвана пересборкой dev-сервера — повтор`);
      continue;
    }
    checks.push(...attemptChecks);
    return;
  }
}

/** S1 — внутри Telegram: выйти за A, войти через Telegram, войти за B, войти по почте. */
const telegramScenario: Scenario = async ({ ctx, page }) => {
  const S = "S1-telegram";
  await openFromBot(page, "a");
  await waitLeaves(page, ["/mini"]);
  await page.waitForTimeout(1500);
  const start = await serverUser(ctx);
  check(S, "AC1", "auto-login-A", start === ids.a, `открыли из бота → ${pathOf(page)}, сессия: ${who(start)} (автовход как раньше)`);

  // Шаг 1. «Выйти».
  const afterOut = await signOutFromProfile(page);
  const s1 = await serverUser(ctx);
  const n1 = await nextAuthUser(ctx);
  const m1 = await mark(page);
  await shot(page, "tg-after-signout");
  check(S, "AC1", "signout-stays-out", s1 === null && n1 === null, `после «Выйти» и ${SETTLE_MS / 1000} с: экран ${afterOut}, сервер: ${who(s1)}, next-auth: ${who(n1)}`);
  if (s1 !== null) {
    check(S, "AC1", "rest", false, "сессия вернулась — дальнейшие шаги сценария не имеют смысла (пропущены)");
    return;
  }
  const tgButton = page.getByRole("button", { name: "Войти через Telegram" });
  const tgVisible = await tgButton.isVisible().catch(() => false);
  const formVisible = await page.locator("#password").isVisible().catch(() => false);
  check(S, "AC1", "login-screen", afterOut === "/mini/login" && tgVisible && formVisible, `экран ${afterOut}: «Войти через Telegram» ${tgVisible ? "есть" : "нет"}, форма пароля ${formVisible ? "есть" : "нет"}; пометка=${m1 === null ? "нет" : "есть"}`);
  check(S, "AC1", "mark-set", m1 !== null && m1 !== "storage-error", `localStorage[${MARK_KEY}] = ${JSON.stringify(m1)}`);
  const cookies1 = await sessionCookies(ctx);
  check(S, "AC1", "cookies-cleared", cookies1.length === 0, `куки сессии после выхода: ${cookies1.join(", ") || "нет"}`);

  // Шаг 2. Закрыли и снова открыли из бота — сам не входит.
  await openFromBot(page, "a");
  await page.waitForTimeout(SETTLE_MS);
  const s2 = await serverUser(ctx);
  check(S, "AC1", "reopen-from-bot", s2 === null && pathOf(page) === "/mini/login", `снова открыли из бота → ${pathOf(page)}, сессия: ${who(s2)}`);

  // Шаг 3. «Войти через Telegram» → снова A (AC2).
  await (await hydrated(page.getByRole("button", { name: "Войти через Telegram" }))).click();
  await waitLeaves(page, ["/mini/login"]);
  await waitLeaves(page, ["/mini"]);
  await page.waitForTimeout(1500);
  const s3 = await serverUser(ctx);
  const m3 = await mark(page);
  check(S, "AC2", "telegram-button-signs-in-A", s3 === ids.a, `«Войти через Telegram» → ${pathOf(page)}, сессия: ${who(s3)}`);
  check(S, "AC2", "mark-cleared-by-telegram", m3 === null, `пометка после входа через Telegram: ${JSON.stringify(m3)}`);

  // Шаг 4. Снова «Выйти» и вход по телефону и паролю за B (AC1).
  const afterOut2 = await signOutFromProfile(page);
  check(S, "AC1", "signout-again", afterOut2 === "/mini/login" && (await serverUser(ctx)) === null, `второй выход → ${afterOut2}`);
  await loginByPhone(page, "b");
  const s4 = await serverUser(ctx);
  const n4 = await nextAuthUser(ctx);
  const m4 = await mark(page);
  await shot(page, "tg-logged-in-as-B");
  check(S, "AC1", "password-login-B", s4 === ids.b && n4 === ids.b, `вход по телефону и паролю B → ${pathOf(page)}, сервер: ${who(s4)}, next-auth: ${who(n4)}`);
  check(S, "AC1", "mark-cleared-by-password", m4 === null, `пометка после входа по паролю: ${JSON.stringify(m4)}`);

  // Шаг 5. B вышел — вход по почте и паролю (руководитель).
  await signOutFromProfile(page);
  await (await hydrated(page.getByRole("radio", { name: "Почта" }))).click();
  await page.locator("#email").fill(USERS.owner.email);
  await page.locator("#password").fill(PASSWORD);
  await shot(page, "tg-login-by-email");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await waitLeaves(page, ["/mini/login"]);
  await waitLeaves(page, ["/mini"]);
  await page.waitForTimeout(1500);
  const s5 = await serverUser(ctx);
  check(S, "AC1", "email-login-owner", s5 === ids.owner, `вход по почте и паролю → ${pathOf(page)}, сессия: ${who(s5)}`);
  check(S, "AC1", "mark-cleared-by-email", (await mark(page)) === null, "пометка после входа по почте снята");
};

/** S2 — вне Telegram (браузер телефона, оболочка приложения): выход без возврата сессии. */
const browserScenario: Scenario = async ({ ctx, page }) => {
  const S = "S2-browser";
  await page.goto(`${BASE}/mini`, { waitUntil: "load" });
  await waitLeaves(page, ["/mini"]);
  check(S, "AC3", "no-session-login", pathOf(page) === "/mini/login", `без сессии /mini → ${pathOf(page)}`);
  await loginByPhone(page, "b");
  const s0 = await serverUser(ctx);
  const cookies0 = await sessionCookies(ctx);
  check(S, "AC3", "login-B", s0 === ids.b, `вход по телефону → ${pathOf(page)}, сессия: ${who(s0)}, куки: ${cookies0.join(", ")}`);
  const shell = (await ctx.cookies()).some((c) => c.name === "ws-shell" && c.value === "mini");
  check(S, "AC3", "mini-shell-on", shell, `кука оболочки ws-shell=mini: ${shell ? "есть" : "нет"}`);

  const afterOut = await signOutFromProfile(page);
  const s1 = await serverUser(ctx);
  const n1 = await nextAuthUser(ctx);
  const cookies1 = await sessionCookies(ctx);
  check(S, "AC3", "signout-no-session", s1 === null && n1 === null, `после «Выйти» → ${afterOut}, сервер: ${who(s1)}, next-auth: ${who(n1)}, куки сессии: ${cookies1.join(", ") || "нет"}`);
  if (s1 !== null) {
    await shot(page, "browser-after-signout");
    check(S, "AC3", "rest", false, "сессия вернулась — дальнейшие шаги пропущены");
    return;
  }

  await page.goto(`${BASE}/mini`, { waitUntil: "load" });
  await waitLeaves(page, ["/mini"]);
  await page.waitForTimeout(SETTLE_MS);
  const s2 = await serverUser(ctx);
  await shot(page, "browser-after-signout");
  check(S, "AC3", "mini-opens-login", pathOf(page) === "/mini/login" && s2 === null, `снова /mini → ${pathOf(page)}, сессия: ${who(s2)}`);

  // Страница кабинета в оболочке — тоже без сессии (спека п. 4).
  await page.goto(`${BASE}/journals`, { waitUntil: "load" });
  await waitLeaves(page, ["/journals", "/mini"]);
  await page.waitForTimeout(2000);
  const s3 = await serverUser(ctx);
  check(S, "AC3", "cabinet-in-shell", pathOf(page) === "/mini/login" && s3 === null, `/journals в оболочке после выхода → ${pathOf(page)}, сессия: ${who(s3)}`);
  const tgButton = await page.getByRole("button", { name: "Войти через Telegram" }).isVisible().catch(() => false);
  check(S, "AC3", "no-telegram-button-outside", !tgButton, `кнопка «Войти через Telegram» вне Telegram: ${tgButton ? "показана" : "не показана"}`);
};

/** S3 — выход с сайта: компьютер и телефон без оболочки. */
const siteDesktopScenario: Scenario = async ({ ctx, page }) => {
  const S = "S3-site-desktop";
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await hydrated(page.locator("#email"));
  await page.locator("#email").fill(USERS.owner.email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/dashboard"), { timeout: 300_000 });
  const s0 = await serverUser(ctx);
  check(S, "AC4", "site-login", s0 === ids.owner, `вход на сайте по почте → ${pathOf(page)}, сессия: ${who(s0)}`);
  await (await hydrated(page.locator('header button[aria-label="Выйти"]'))).click();
  await page.waitForURL((u) => u.pathname === "/login", { timeout: 180_000 });
  await page.waitForTimeout(1500);
  const s1 = await serverUser(ctx);
  const cookies1 = await sessionCookies(ctx);
  check(S, "AC4", "site-logout", s1 === null && cookies1.length === 0, `«Выйти» в шапке → ${pathOf(page)}, сессия: ${who(s1)}, куки сессии: ${cookies1.join(", ") || "нет"}`);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  check(S, "AC4", "site-dashboard-closed", pathOf(page) === "/login", `/dashboard после выхода → ${pathOf(page)}`);
};

const sitePhoneScenario: Scenario = async ({ ctx, page }) => {
  const S = "S3-site-phone";
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await hydrated(page.locator("#email"));
  await page.locator("#email").fill(USERS.owner.email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/dashboard"), { timeout: 300_000 });
  const s0 = await serverUser(ctx);
  check(S, "AC4", "site-login-phone", s0 === ids.owner, `вход на сайте с телефона → ${pathOf(page)}, сессия: ${who(s0)}`);
  await (await hydrated(page.getByRole("button", { name: "Меню" }))).click();
  await page.getByRole("dialog").getByRole("button", { name: "Выйти" }).click();
  await page.waitForURL((u) => u.pathname === "/login", { timeout: 180_000 });
  await page.waitForTimeout(1500);
  const s1 = await serverUser(ctx);
  check(S, "AC4", "site-logout-phone", s1 === null, `«Меню» → «Выйти» → ${pathOf(page)}, сессия: ${who(s1)}`);
  // Потом человек открывает мини-приложение в том же браузере — сессии нет.
  await page.goto(`${BASE}/mini`, { waitUntil: "load" });
  await waitLeaves(page, ["/mini"]);
  await page.waitForTimeout(SETTLE_MS);
  const s2 = await serverUser(ctx);
  check(S, "AC4", "mini-after-site-logout", pathOf(page) === "/mini/login" && s2 === null, `/mini после выхода с сайта → ${pathOf(page)}, сессия: ${who(s2)}`);
};

/** S4 — «Отвязать Telegram» внутри Telegram работает как раньше. */
const unlinkScenario: Scenario = async ({ ctx, page }) => {
  const S = "S4-unlink";
  await openFromBot(page, "a");
  await waitLeaves(page, ["/mini"]);
  await page.waitForTimeout(1500);
  const s0 = await serverUser(ctx);
  check(S, "AC4", "auto-login-A", s0 === ids.a, `открыли из бота → ${pathOf(page)}, сессия: ${who(s0)}`);
  await page.goto(`${BASE}/mini/me`, { waitUntil: "load" });
  const row = await hydrated(page.getByRole("button", { name: /^Отвязать Telegram/ }));
  await row.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("ОТВЯЗАТЬ");
  await dialog.getByRole("button", { name: "Отвязать", exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/mini", { timeout: 180_000 });
  const errorText = page.getByText("Аккаунт не связан с Telegram", { exact: false });
  const shown = await errorText.waitFor({ state: "visible", timeout: 120_000 }).then(() => true).catch(() => false);
  const row0 = await db.user.findUniqueOrThrow({ where: { email: USERS.a.email }, select: { telegramChatId: true } });
  const s1 = await serverUser(ctx);
  const m1 = await mark(page);
  await shot(page, "tg-after-unlink");
  check(S, "AC4", "unlink-clears-link", row0.telegramChatId === null, `User.telegramChatId после отвязки: ${JSON.stringify(row0.telegramChatId)}`);
  check(S, "AC4", "unlink-signed-out", s1 === null && shown, `после отвязки → ${pathOf(page)}, «Аккаунт не связан с Telegram» ${shown ? "показано" : "не показано"}, сессия: ${who(s1)}`);
  check(S, "AC4", "unlink-no-mark", m1 === null, `пометка «вышел вручную» после отвязки: ${JSON.stringify(m1)} (отвязка её не ставит — как раньше)`);

  // Доп.: «Войти по телефону» с экрана ошибки остаётся на форме входа.
  await (await hydrated(page.getByRole("link", { name: "Войти по телефону" }))).click();
  await page.waitForTimeout(SETTLE_MS);
  check(S, "extra", "error-screen-phone-link", pathOf(page) === "/mini/login", `«Войти по телефону» с экрана ошибки → ${pathOf(page)}`);
};

/** S5 (доп.) — сервер не подтвердил выход: ошибка на экране, человек остаётся в аккаунте. */
const logoutFailureScenario: Scenario = async ({ ctx, page }) => {
  const S = "S5-logout-fails";
  await openFromBot(page, "a");
  await waitLeaves(page, ["/mini"]);
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/mini/me`, { waitUntil: "load" });
  await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 500, body: "{}" }));
  const row = await hydrated(page.getByRole("button", { name: /^Выйти/ }));
  await row.click();
  await (await hydrated(page.getByRole("dialog").getByRole("button", { name: "Выйти", exact: true }), 30_000)).click();
  const errorShown = await page
    .getByText("Не удалось выйти. Проверьте связь и попробуйте ещё раз.")
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(3000);
  const s1 = await serverUser(ctx);
  const m1 = await mark(page);
  await shot(page, "tg-logout-failed");
  check(S, "extra", "logout-error-shown", errorShown && pathOf(page) === "/mini/me", `выход не подтверждён (HTTP 500) → ${pathOf(page)}, ошибка ${errorShown ? "показана" : "не показана"}`);
  check(S, "extra", "logout-error-keeps-session", s1 === ids.a && m1 === null, `сессия: ${who(s1)}, пометка: ${JSON.stringify(m1)} — «вышел» не пишем, пока сервер не подтвердил`);
  await page.unroute("**/api/auth/logout");
};

async function main() {
  for (const key of Object.keys(ids) as UserKey[]) {
    ids[key] = (await db.user.findUniqueOrThrow({ where: { email: USERS[key].email }, select: { id: true } })).id;
  }
  // Исходное состояние стенда: A привязан к Telegram.
  await db.user.update({ where: { email: USERS.a.email }, data: { telegramChatId: USERS.a.tg } });

  const browser = await launch();
  try {
    const warmTab = await openPhone(browser, { telegram: false });
    await warm(warmTab.ctx);
    await warmTab.ctx.close();

    const relinkA = async () => {
      await db.user.update({ where: { email: USERS.a.email }, data: { telegramChatId: USERS.a.tg } });
    };
    const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
    const run = (name: string) => !only || only.some((prefix) => name.startsWith(prefix));
    if (run("S1")) await runScenario("S1-telegram", () => openPhone(browser, { telegram: true }), telegramScenario, relinkA);
    if (run("S2")) await runScenario("S2-browser", () => openPhone(browser, { telegram: false }), browserScenario);
    if (run("S3")) await runScenario("S3-site-desktop", () => openPhone(browser, { telegram: false, width: 1440, height: 900, mobile: false }), siteDesktopScenario);
    if (run("S3")) await runScenario("S3-site-phone", () => openPhone(browser, { telegram: false }), sitePhoneScenario);
    if (run("S4")) await runScenario("S4-unlink", () => openPhone(browser, { telegram: true }), unlinkScenario, relinkA);
    if (run("S5")) await runScenario("S5-logout-fails", () => openPhone(browser, { telegram: true }), logoutFailureScenario, relinkA);
  } finally {
    await browser.close();
    // Стенд — в исходное состояние: A снова привязан к Telegram.
    await db.user.update({ where: { email: USERS.a.email }, data: { telegramChatId: USERS.a.tg } });
    await db.$disconnect();
  }

  const failed = checks.filter((c) => !c.ok);
  const result = {
    phase: PHASE,
    base: BASE,
    finishedAt: new Date().toISOString(),
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    devServerRetries: retries,
    checks,
  };
  // Браузер закрыт — теперь можно писать в дерево проекта.
  for (const file of fs.readdirSync(STAGE)) {
    fs.copyFileSync(path.join(STAGE, file), path.join(OUT, file));
  }
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(`\n${PHASE}: ${result.passed}/${result.total} PASS`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
