// Критерии спеки logout-and-master-menu-2026-09 на живом dev-сервере (порт 3050).
//
//   cd C:/wt/mkmenu
//   npx tsx .agent/tasks/logout-and-master-menu-2026-09/e2e/setup.ts
//   npx tsx .agent/tasks/logout-and-master-menu-2026-09/e2e/run.ts
//   ONLY=S01,S02 …  — прогнать выборочно
//
// Каждый сценарий — чистый браузерный контекст: вход одним путём, выход одной
// кнопкой, затем проверки (lib.ts → loggedOutState): кук сессии нет,
// next-auth и getServerSession проекта никого не видят, /login открывается,
// /dashboard и /master требуют входа. Для смены аккаунта A → B — что и
// proxy, и страницы, и next-auth видят B.
// Итог: evidence/after/results.json; снимки — в C:/wt/mkmenu-tmp/shots
// (копируются в evidence/after после прогона).
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";

import { db, NEXTAUTH_SECRET } from "./db";
import { INVITE_RAW, KIOSK_DEVICE_ID, ORGS, PASSWORD, PIN, QR_RAW, USERS, type UserKey } from "./fixtures";
import {
  BASE,
  TASK_DIR,
  hydrated,
  isLoggedOut,
  launch,
  loggedOutState,
  openTab,
  pathOf,
  sessionCookies,
  telegramLaunchHash,
  waitPath,
  whoami,
  type Device,
  type Tab,
} from "./lib";
import crypto from "node:crypto";

const OUT = path.join(TASK_DIR, "evidence", "after");
const STAGE = "C:/wt/mkmenu-tmp/shots";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(STAGE, { recursive: true });
/** Сколько ждём после выхода: успел бы автоматический вход вернуть сессию. */
const SETTLE_MS = 4000;
const ONLY = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);

type Check = { scenario: string; ac: string; id: string; ok: boolean; detail: string };
const checks: Check[] = [];
let attemptChecks: Check[] = [];
function check(scenario: string, ac: string, id: string, ok: boolean, detail: string) {
  attemptChecks.push({ scenario, ac, id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${ac}] ${scenario}/${id} — ${detail}`);
}
const retries: Array<{ scenario: string; attempt: number; reason: string }> = [];
const flows: Array<{ scenario: string; requests: string[] }> = [];

const ids = {} as Record<UserKey, string>;
/** Строки мастер-кабинетов: порядок — по алфавиту (как список организаций). */
const MASTER_NAMES = [ORGS.master.name, ORGS.master2.name].sort((a, b) => a.localeCompare(b, "ru")).join("|");
const sortedNames = (texts: string[]) => texts.map((t) => t.trim()).sort((a, b) => a.localeCompare(b, "ru")).join("|");
function who(id: string | null): string {
  if (!id) return "нет";
  const key = (Object.keys(ids) as UserKey[]).find((k) => ids[k] === id);
  return key ? key : id;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(STAGE, `${name}.png`), animations: "disabled" }).catch(() => {});
}

/* ─────────────────────────── входы ─────────────────────────── */

async function loginSite(page: Page, user: UserKey) {
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await hydrated(page.locator("#email"));
  await page.locator("#email").fill(USERS[user].email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await waitPath(page, (p) => p !== "/login");
  await page.waitForLoadState("load");
}

async function loginMiniPhone(page: Page, user: UserKey) {
  await page.goto(`${BASE}/mini/login`, { waitUntil: "load" });
  await hydrated(page.locator("#phone"));
  await page.locator("#phone").fill(USERS[user].phone ?? "");
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await waitPath(page, (p) => p !== "/mini/login" && p !== "/mini");
  await page.waitForTimeout(1500);
}

async function loginMiniEmail(page: Page, user: UserKey) {
  await page.goto(`${BASE}/mini/login`, { waitUntil: "load" });
  await (await hydrated(page.getByRole("radio", { name: "Почта" }).or(page.getByRole("button", { name: "Почта" })).first())).click();
  await hydrated(page.locator("#email"));
  await page.locator("#email").fill(USERS[user].email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await waitPath(page, (p) => p !== "/mini/login" && p !== "/mini");
  await page.waitForTimeout(1500);
}

async function loginPersonalQr(page: Page, user: "cook" | "owner") {
  await page.goto(`${BASE}/q/${QR_RAW[user]}`, { waitUntil: "load" });
  const pin = await hydrated(page.getByLabel("PIN для быстрой QR-авторизации"));
  await pin.fill(PIN);
  await (await hydrated(page.getByTestId("personal-qr-submit"))).click();
  await waitPath(page, (p) => !p.startsWith("/q/"));
  await page.waitForLoadState("load");
}

async function loginTelegram(page: Page, user: UserKey) {
  await page.goto("about:blank");
  await page.goto(`${BASE}/mini${telegramLaunchHash(USERS[user].tg ?? "")}`, { waitUntil: "load" });
  await waitPath(page, (p) => p !== "/mini" && p !== "/mini/login");
  await page.waitForTimeout(1500);
}

async function acceptInvite(page: Page) {
  await page.goto(`${BASE}/invite/${INVITE_RAW}`, { waitUntil: "load" });
  await hydrated(page.locator("#password"));
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.getByRole("button", { name: "Установить пароль и войти" }).click();
  await waitPath(page, (p) => p === "/master");
  await page.waitForLoadState("load");
}

/* ─────────────────────────── выходы ─────────────────────────── */

async function logoutHeaderIcon(page: Page) {
  await (await hydrated(page.locator('header button[aria-label="Выйти"]'))).click();
}

async function openDesktopProfileMenu(page: Page) {
  await (await hydrated(page.locator("header").getByRole("button", { name: "Профиль" }))).click();
  return page.getByRole("menu");
}

async function logoutDesktopDropdown(page: Page) {
  const menu = await openDesktopProfileMenu(page);
  await menu.getByRole("menuitem", { name: "Выйти" }).click();
}

async function openProfileSheet(page: Page) {
  await (await hydrated(page.locator("header").getByRole("button", { name: "Профиль" }))).click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor({ state: "visible" });
  return sheet;
}

async function logoutProfileSheet(page: Page) {
  const sheet = await openProfileSheet(page);
  await (await hydrated(sheet.getByRole("button", { name: "Выйти" }))).click();
}

async function logoutMobileNav(page: Page) {
  await (await hydrated(page.locator("header").getByRole("button", { name: "Меню" }))).click();
  const sheet = page.getByRole("dialog");
  await (await hydrated(sheet.getByRole("button", { name: "Выйти" }))).click();
}

/** Меню профиля оболочки (мастер-кабинет, партнёр): на компьютере — список, на телефоне — лист. */
async function shellMenuSelect(page: Page, device: Device, label: string) {
  await (await hydrated(page.getByRole("button", { name: "Профиль" }))).click();
  if (device === "desktop" || device === "tablet") {
    await page.getByRole("menuitem", { name: label }).click();
  } else {
    await (await hydrated(page.getByRole("dialog").getByRole("button", { name: label }))).click();
  }
}

async function logoutMini(page: Page) {
  await page.goto(`${BASE}/mini/me`, { waitUntil: "load" });
  await (await hydrated(page.getByRole("button", { name: /^Выйти/ }))).click();
  await (await hydrated(page.getByRole("dialog").getByRole("button", { name: "Выйти", exact: true }), 60_000)).click();
}

/** После выхода: где страница, и полное состояние «вышел». */
async function expectLoggedOut(tab: Tab, S: string, ac: string, id: string, landing: string) {
  await waitPath(tab.page, (p) => p === landing).catch(() => undefined);
  await tab.page.waitForTimeout(SETTLE_MS);
  const where = pathOf(tab.page);
  const state = await loggedOutState(tab.ctx);
  const ok = where === landing && isLoggedOut(state);
  check(S, ac, id, ok, `страница ${where}; ${JSON.stringify(state)}`);
  await shot(tab.page, `${S}-${id}`);
  return state;
}

/* ─────────────────────────── сценарии ─────────────────────────── */

type Scenario = { name: string; device: Device; body: (tab: Tab) => Promise<void> };

const scenarios: Scenario[] = [
  {
    name: "S01-site-password-desktop-header-icon",
    device: "desktop",
    body: async (tab) => {
      const S = "S01-site-password-desktop-header-icon";
      await loginSite(tab.page, "owner");
      const w = await whoami(tab.ctx);
      check(S, "AC1", "login", w.nextAuth === ids.owner && w.pages === ids.owner, `вход паролем → ${pathOf(tab.page)}; ${JSON.stringify(w)}`);
      check(S, "AC1", "one-cookie", w.cookies.length === 1, `кук сессии после входа: ${w.cookies.join(", ")}`);
      await logoutHeaderIcon(tab.page);
      await expectLoggedOut(tab, S, "AC1", "logout-header-icon", "/login");
    },
  },
  {
    name: "S02-site-desktop-menu-master-logout",
    device: "desktop",
    body: async (tab) => {
      const S = "S02-site-desktop-menu-master-logout";
      await loginSite(tab.page, "owner");
      const menu = await openDesktopProfileMenu(tab.page);
      await menu.waitFor({ state: "visible" });
      await tab.page.waitForTimeout(400);
      await shot(tab.page, `${S}-profile-menu`);
      const cabinetLabel = await menu.getByText("Кабинет", { exact: true }).count();
      const masterRows = await menu.getByTestId("profile-master-cabinet").allInnerTexts();
      const orgButtons = await menu.getByRole("button").allInnerTexts();
      check(
        S,
        "AC3",
        "desktop-cabinet-section",
        cabinetLabel === 1 &&
          sortedNames(masterRows) === MASTER_NAMES &&
          (await menu.getByRole("menuitem", { name: "Моя организация" }).count()) === 1,
        `«Кабинет»: ${cabinetLabel}; строки мастер-кабинетов: ${JSON.stringify(masterRows)}`,
      );
      check(
        S,
        "AC3",
        "desktop-not-in-organizations",
        !orgButtons.some((t) => t.includes("Мастер-кабинет")) && orgButtons.some((t) => t.includes(ORGS.cafe.name)),
        `кнопки списка «Организации»: ${JSON.stringify(orgButtons)}`,
      );
      await menu.getByTestId("profile-master-cabinet").filter({ hasText: ORGS.master.name }).click();
      await waitPath(tab.page, (p) => p === "/master");
      await tab.page.getByTestId("master-org-name").waitFor();
      const name = (await tab.page.getByTestId("master-org-name").innerText()).trim();
      const w = await whoami(tab.ctx);
      check(S, "AC3", "desktop-opens-master", name === ORGS.master.name && w.proxyOrg === "directory", `→ /master «${name}»; ${JSON.stringify(w)}`);
      await shot(tab.page, `${S}-master`);
      // Жалоба владельца: из мастер-кабинета «Выйти» возвращало обратно.
      await shellMenuSelect(tab.page, "desktop", "Выйти");
      await expectLoggedOut(tab, S, "AC1", "logout-master-desktop", "/login");
    },
  },
  {
    name: "S03-site-desktop-dropdown-logout",
    device: "desktop",
    body: async (tab) => {
      const S = "S03-site-desktop-dropdown-logout";
      await loginSite(tab.page, "owner");
      await logoutDesktopDropdown(tab.page);
      await expectLoggedOut(tab, S, "AC1", "logout-profile-dropdown", "/login");
    },
  },
  {
    name: "S04-site-phone-sheet-master-back-logout",
    device: "phone",
    body: async (tab) => {
      const S = "S04-site-phone-sheet-master-back-logout";
      await loginSite(tab.page, "owner");
      const sheet = await openProfileSheet(tab.page);
      await tab.page.waitForTimeout(600);
      await shot(tab.page, `${S}-profile-sheet`);
      const masterRows = await sheet.getByTestId("profile-master-cabinet").allInnerTexts();
      const cabinetLabel = await sheet.getByText("Кабинет", { exact: true }).count();
      const buttons = await sheet.getByRole("button").allInnerTexts();
      const orgList = buttons.filter((t) => !/Выйти|Мастер-кабинет|Добавить|демо/i.test(t));
      check(
        S,
        "AC3",
        "phone-cabinet-section",
        cabinetLabel === 1 && sortedNames(masterRows) === MASTER_NAMES,
        `«Кабинет»: ${cabinetLabel}; строки: ${JSON.stringify(masterRows)}`,
      );
      check(
        S,
        "AC3",
        "phone-not-in-organizations",
        buttons.filter((t) => t.includes("Мастер-кабинет")).length === 2 && masterRows.length === 2 && orgList.some((t) => t.includes(ORGS.cafe.name)),
        `кнопки листа: ${JSON.stringify(buttons)} (мастер-кабинеты — только строки «Кабинета»)`,
      );
      await sheet.getByTestId("profile-master-cabinet").filter({ hasText: ORGS.master2.name }).click();
      await waitPath(tab.page, (p) => p === "/master");
      await tab.page.getByTestId("master-org-name").waitFor();
      const name = (await tab.page.getByTestId("master-org-name").innerText()).trim();
      check(S, "AC3", "phone-opens-master", name === ORGS.master2.name, `→ /master «${name}»`);
      // «Моя организация» — обратно из кабинета.
      await shellMenuSelect(tab.page, "phone", "Моя организация");
      await waitPath(tab.page, (p) => p !== "/master");
      const w = await whoami(tab.ctx);
      check(S, "AC3", "master-my-organization", pathOf(tab.page) === "/dashboard" && w.proxyOrg === "regular", `«Моя организация» → ${pathOf(tab.page)}; ${JSON.stringify(w)}`);
      await logoutProfileSheet(tab.page);
      await expectLoggedOut(tab, S, "AC1", "logout-profile-sheet", "/login");
    },
  },
  {
    name: "S05-site-phone-menu-sheet-logout",
    device: "phone",
    body: async (tab) => {
      const S = "S05-site-phone-menu-sheet-logout";
      await loginSite(tab.page, "owner");
      await logoutMobileNav(tab.page);
      await expectLoggedOut(tab, S, "AC1", "logout-menu-sheet", "/login");
    },
  },
  {
    name: "S06-mini-phone-login-mini-logout",
    device: "phone",
    body: async (tab) => {
      const S = "S06-mini-phone-login-mini-logout";
      await loginMiniPhone(tab.page, "cook");
      const w = await whoami(tab.ctx);
      check(S, "AC1", "login", w.nextAuth === ids.cook && w.pages === ids.cook && w.cookies.length === 1, `телефон и пароль → ${pathOf(tab.page)}; ${JSON.stringify(w)}`);
      await logoutMini(tab.page);
      await expectLoggedOut(tab, S, "AC1", "logout-mini", "/mini/login");
      const mark = await tab.page.evaluate(() => window.localStorage.getItem("wesetup.mini.signed-out"));
      check(S, "AC1", "signed-out-mark", Boolean(mark), `пометка «вышел вручную»: ${mark}`);
    },
  },
  {
    name: "S07-mini-email-owner-master-switcher",
    device: "phone",
    body: async (tab) => {
      const S = "S07-mini-email-owner-master-switcher";
      await loginMiniEmail(tab.page, "owner");
      const w = await whoami(tab.ctx);
      check(S, "AC1", "login", w.nextAuth === ids.owner && w.pages === ids.owner, `почта и пароль → ${pathOf(tab.page)}; ${JSON.stringify(w)}`);
      await tab.page.goto(`${BASE}/mini/me`, { waitUntil: "load" });
      const rows = tab.page.getByTestId("mini-master-cabinet");
      await hydrated(rows.first());
      await tab.page.waitForTimeout(500);
      await shot(tab.page, `${S}-mini-me`);
      const texts = (await rows.allInnerTexts()).map((t) => t.trim());
      const card = (label: string) =>
        tab.page.locator("section.mini-card").filter({ has: tab.page.locator(".mini-label", { hasText: new RegExp(`^${label}$`) }) }).count();
      const orgCard = await card("Организация");
      const cabinetCard = await card("Кабинет");
      check(
        S,
        "AC3",
        "mini-cabinet-card",
        sortedNames(texts) === MASTER_NAMES && cabinetCard === 1 && orgCard === 0,
        `«Кабинет»: ${JSON.stringify(texts)}; карточка «Организация» (одна обычная организация — не нужна): ${orgCard}`,
      );
      await rows.filter({ hasText: ORGS.master.name }).click();
      await waitPath(tab.page, (p) => p === "/master");
      await tab.page.getByTestId("master-org-name").waitFor();
      const name = (await tab.page.getByTestId("master-org-name").innerText()).trim();
      check(S, "AC3", "mini-opens-master", name === ORGS.master.name, `→ /master «${name}»`);
      await shellMenuSelect(tab.page, "phone", "Выйти");
      await expectLoggedOut(tab, S, "AC1", "logout-master-phone", "/login");
    },
  },
  {
    // Повар на телефоне: после входа кабинет открывается в оболочке
    // мини-приложения (/journals → «Сегодня»), выход — в её «Профиле».
    name: "S08-personal-qr-cook-phone-logout",
    device: "phone",
    body: async (tab) => {
      const S = "S08-personal-qr-cook-phone-logout";
      await loginPersonalQr(tab.page, "cook");
      await tab.page.waitForTimeout(1500);
      const w = await whoami(tab.ctx);
      check(S, "AC1", "login", w.nextAuth === ids.cook && w.pages === ids.cook && w.proxyRole === "staff" && w.cookies.length === 1, `личный QR + PIN → ${pathOf(tab.page)}; ${JSON.stringify(w)}`);
      await logoutMini(tab.page);
      await expectLoggedOut(tab, S, "AC1", "logout-mini", "/mini/login");
    },
  },
  {
    name: "S08b-personal-qr-owner-desktop-logout",
    device: "desktop",
    body: async (tab) => {
      const S = "S08b-personal-qr-owner-desktop-logout";
      await loginPersonalQr(tab.page, "owner");
      await waitPath(tab.page, (p) => p === "/dashboard");
      const w = await whoami(tab.ctx);
      check(S, "AC1", "login", w.nextAuth === ids.owner && w.pages === ids.owner && w.proxyRole === "management" && w.cookies.length === 1, `личный QR + PIN → ${pathOf(tab.page)}; ${JSON.stringify(w)}`);
      await logoutHeaderIcon(tab.page);
      await expectLoggedOut(tab, S, "AC1", "logout-header-icon", "/login");
    },
  },
  {
    name: "S09-invite-master-logout",
    device: "desktop",
    body: async (tab) => {
      const S = "S09-invite-master-logout";
      await acceptInvite(tab.page);
      await tab.page.getByTestId("master-org-name").waitFor();
      const w = await whoami(tab.ctx);
      check(S, "AC1", "login", w.nextAuth === ids.master && w.proxyOrg === "directory" && w.cookies.length === 1, `приглашение → /master; ${JSON.stringify(w)}`);
      const menuItems = await (async () => {
        await (await hydrated(tab.page.getByRole("button", { name: "Профиль" }))).click();
        const items = await tab.page.getByRole("menuitem").allInnerTexts();
        await tab.page.keyboard.press("Escape");
        return items.map((t) => t.trim());
      })();
      check(S, "AC3", "backoffice-no-return", !menuItems.includes("Моя организация"), `меню сотрудника бэк-офиса: ${JSON.stringify(menuItems)}`);
      await shellMenuSelect(tab.page, "desktop", "Выйти");
      await expectLoggedOut(tab, S, "AC1", "logout-master-desktop", "/login");
    },
  },
  {
    name: "S10-partner-shell-logout",
    device: "desktop",
    body: async (tab) => {
      const S = "S10-partner-shell-logout";
      await loginSite(tab.page, "partner");
      await tab.page.goto(`${BASE}/partner`, { waitUntil: "load" });
      await waitPath(tab.page, (p) => p === "/partner");
      const w = await whoami(tab.ctx);
      check(S, "AC1", "login", w.nextAuth === ids.partner && w.pages === ids.partner, `вход паролем → /partner; ${JSON.stringify(w)}`);
      await shellMenuSelect(tab.page, "desktop", "Выйти");
      await expectLoggedOut(tab, S, "AC1", "logout-partner", "/login");
    },
  },
  {
    name: "S11-logout-all",
    device: "desktop",
    body: async (tab) => {
      const S = "S11-logout-all";
      await loginSite(tab.page, "owner");
      await tab.page.goto(`${BASE}/settings/security`, { waitUntil: "load" });
      await (await hydrated(tab.page.getByRole("button", { name: "Завершить все сессии" }))).click();
      await (await hydrated(tab.page.getByRole("dialog").getByRole("button", { name: "Завершить все сессии" }), 60_000)).click();
      await expectLoggedOut(tab, S, "AC1", "logout-all", "/login");
    },
  },
  {
    name: "S12-kiosk-logout",
    device: "tablet",
    body: async (tab) => {
      const S = "S12-kiosk-logout";
      const sig = crypto.createHmac("sha256", NEXTAUTH_SECRET).update(KIOSK_DEVICE_ID).digest("base64url");
      await tab.ctx.addCookies([{ name: "wesetup.kiosk", value: `${KIOSK_DEVICE_ID}.${sig}`, url: BASE, httpOnly: true, sameSite: "Lax" }]);
      // Руководитель: у него /journals — сам журнал; линейного повара /journals
      // уводит на «Сегодня» мини-приложения, где кнопки киоска нет вовсе.
      const unlock = await tab.ctx.request.post(`${BASE}/api/kiosk/unlock`, { data: { userId: ids.owner, pin: PIN }, timeout: 300_000 });
      check(S, "AC1", "kiosk-unlock", unlock.status() === 200, `ПИН на планшете → ${unlock.status()}; куки: ${(await sessionCookies(tab.ctx)).join(", ")}`);
      await tab.page.goto(`${BASE}/journals`, { waitUntil: "load" });
      const pill = tab.page.locator("div.fixed").filter({ hasText: USERS.owner.name });
      await pill.waitFor();
      await tab.page.waitForTimeout(3000);
      await shot(tab.page, `${S}-kiosk-pill`);
      await (await hydrated(pill.getByRole("button", { name: "Выйти" }))).click();
      const state = await expectLoggedOut(tab, S, "AC1", "logout-kiosk", "/mini/kiosk");
      const device = (await tab.ctx.cookies()).some((c) => c.name === "wesetup.kiosk");
      check(S, "AC1", "kiosk-device-kept", device, `кука планшета осталась: ${device}; после выхода: ${JSON.stringify(state.cookies)}`);
    },
  },
  {
    name: "S13-telegram-login-mini-logout",
    device: "telegram",
    body: async (tab) => {
      const S = "S13-telegram-login-mini-logout";
      await loginTelegram(tab.page, "tg");
      const w = await whoami(tab.ctx);
      check(S, "AC1", "login", w.nextAuth === ids.tg && w.pages === ids.tg && w.cookies.length === 1, `Telegram (next-auth) → ${pathOf(tab.page)}; ${JSON.stringify(w)}`);
      await logoutMini(tab.page);
      await expectLoggedOut(tab, S, "AC1", "logout-mini-telegram", "/mini/login");
    },
  },
  // ─── AC2: вход A → выход → вход B разными путями; B видят proxy, страницы и next-auth.
  {
    name: "S14-switch-master-to-owner",
    device: "desktop",
    body: async (tab) => {
      const S = "S14-switch-master-to-owner";
      await loginSite(tab.page, "master");
      const a = await whoami(tab.ctx);
      check(S, "AC2", "A-master", a.nextAuth === ids.master && a.proxyOrg === "directory", `A: сотрудник бэк-офиса паролем → ${pathOf(tab.page)}; ${JSON.stringify(a)}`);
      await shellMenuSelect(tab.page, "desktop", "Выйти");
      await waitPath(tab.page, (p) => p === "/login");
      await loginSite(tab.page, "owner");
      const b = await whoami(tab.ctx);
      check(
        S,
        "AC2",
        "B-owner",
        b.nextAuth === ids.owner && b.pages === ids.owner && b.proxyOrg === "regular" && b.proxyRole === "management" && b.cookies.length === 1,
        `B: владелец паролем → ${pathOf(tab.page)}; next-auth: ${who(b.nextAuth)}, страницы: ${who(b.pages)}, proxy: ${b.proxyOrg}/${b.proxyRole}; ${JSON.stringify(b)}`,
      );
    },
  },
  {
    name: "S15-switch-telegram-to-qr-owner",
    device: "telegram",
    body: async (tab) => {
      const S = "S15-switch-telegram-to-qr-owner";
      await loginTelegram(tab.page, "tg");
      const a = await whoami(tab.ctx);
      check(S, "AC2", "A-telegram", a.nextAuth === ids.tg && a.pages === ids.tg && a.proxyRole === "staff", `A: повар через Telegram; ${JSON.stringify(a)}`);
      await logoutMini(tab.page);
      await waitPath(tab.page, (p) => p === "/mini/login");
      await tab.page.waitForTimeout(SETTLE_MS);
      await loginPersonalQr(tab.page, "owner");
      await tab.page.waitForTimeout(1500);
      const b = await whoami(tab.ctx);
      check(
        S,
        "AC2",
        "B-owner-qr",
        b.nextAuth === ids.owner && b.pages === ids.owner && b.proxyOrg === "regular" && b.proxyRole === "management" && b.cookies.length === 1,
        `B: владелец по личному QR → ${pathOf(tab.page)}; next-auth: ${who(b.nextAuth)}, страницы: ${who(b.pages)}, proxy: ${b.proxyOrg}/${b.proxyRole}; ${JSON.stringify(b)}`,
      );
    },
  },
  {
    name: "S16-switch-mini-cook-to-master",
    device: "phone",
    body: async (tab) => {
      const S = "S16-switch-mini-cook-to-master";
      await loginMiniPhone(tab.page, "cook");
      const a = await whoami(tab.ctx);
      check(S, "AC2", "A-cook", a.nextAuth === ids.cook && a.pages === ids.cook && a.proxyRole === "staff", `A: повар в мини-приложении; ${JSON.stringify(a)}`);
      await logoutMini(tab.page);
      await waitPath(tab.page, (p) => p === "/mini/login");
      await loginSite(tab.page, "master");
      await waitPath(tab.page, (p) => p === "/master");
      await tab.page.getByTestId("master-org-name").waitFor();
      const b = await whoami(tab.ctx);
      const name = (await tab.page.getByTestId("master-org-name").innerText()).trim();
      check(
        S,
        "AC2",
        "B-master",
        b.nextAuth === ids.master && b.pages === "directory(403)" && b.proxyOrg === "directory" && name === ORGS.master.name && b.cookies.length === 1,
        `B: сотрудник бэк-офиса паролем → /master «${name}»; next-auth: ${who(b.nextAuth)}, proxy: ${b.proxyOrg}; ${JSON.stringify(b)}`,
      );
    },
  },
];

const DEV_CHUNK_ERROR = /ChunkLoadError|Loading chunk|Invalid or unexpected token/;

async function main() {
  for (const key of Object.keys(USERS) as UserKey[]) {
    const user = await db.user.findUnique({ where: { email: USERS[key].email }, select: { id: true } });
    if (!user) throw new Error(`нет пользователя ${key} — сначала setup.ts`);
    ids[key] = user.id;
  }
  const browser = await launch();
  try {
    for (const scenario of scenarios) {
      if (ONLY.length && !ONLY.some((o) => scenario.name.startsWith(o))) continue;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        attemptChecks = [];
        const tab = await openTab(browser, scenario.device);
        const started = Date.now();
        try {
          await scenario.body(tab);
        } catch (error) {
          check(scenario.name, "-", "exception", false, String(error).slice(0, 400));
          await shot(tab.page, `${scenario.name}-exception`);
        } finally {
          if (tab.errors.length) console.log(`[${scenario.name}] ошибки страницы:`, tab.errors.slice(0, 5));
          await tab.ctx.close();
        }
        console.log(`[${scenario.name}] ${Math.round((Date.now() - started) / 1000)} с; запросы: ${tab.requests.join(" → ")}`);
        const failed = attemptChecks.some((c) => !c.ok);
        const devError = tab.errors.find((e) => DEV_CHUNK_ERROR.test(e));
        if (failed && devError && attempt < 3) {
          retries.push({ scenario: scenario.name, attempt, reason: devError.slice(0, 160) });
          console.log(`[${scenario.name}] попытка ${attempt} сорвана пересборкой dev-сервера — повтор`);
          continue;
        }
        checks.push(...attemptChecks);
        flows.push({ scenario: scenario.name, requests: tab.requests });
        break;
      }
    }
  } finally {
    await browser.close();
    await db.$disconnect();
  }
  const summary = { total: checks.length, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length };
  const result = { base: BASE, finishedAt: new Date().toISOString(), summary, devServerRetries: retries, checks, flows };
  const file = path.join(OUT, ONLY.length ? `results-${ONLY.join("_")}.json` : "results.json");
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log("SUMMARY", JSON.stringify(summary), "→", file);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
