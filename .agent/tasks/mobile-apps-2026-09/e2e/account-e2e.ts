// E2e удаления аккаунта и файлов связи с доменом на стенде :3022.
// Запуск из d:/wt/mobile-apps:  npx tsx .agent/tasks/mobile-apps-2026-09/e2e/account-e2e.ts
// Работает ТОЛЬКО с localhost:5432/wesetup_e2e (см. проверку ниже).
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { chromium, type BrowserContext, type Page } from "playwright";

const URL_DB = "postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable";
if (!/@localhost:5432\/wesetup_e2e\b/.test(URL_DB)) throw new Error("refuse");
const db = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: URL_DB })) });
const BASE = "http://localhost:3022";
const SHOTS = "d:/wt/tmp";
const PASSWORD = "E2eTest2026!";
const STATE = JSON.parse(
  fs.readFileSync("D:/www/Wesetup.ru/.agent/tasks/journal-responsibles-org-2026-09/e2e/state.json", "utf8"),
);

const results: Array<{ check: string; ok: boolean; detail?: unknown }> = [];
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : " " + JSON.stringify(detail).slice(0, 300)}`);
}

async function newCtx(browser: import("playwright").Browser, theme: "light" | "dark") {
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    colorScheme: theme,
  });
  await ctx.addInitScript(
    `try{localStorage.setItem("wesetup.last-seen-build-sha","zzz")}catch(e){};document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.appendChild(s)})`,
  );
  return ctx;
}

async function login(ctx: BrowserContext, email: string) {
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD } });
  return r.status();
}

async function sessionUser(ctx: BrowserContext) {
  const r = await ctx.request.get(`${BASE}/api/auth/session`);
  const body = await r.json().catch(() => null);
  return body?.user?.id ?? null;
}

async function main() {
  // --- /.well-known ---
  for (const p of ["/.well-known/apple-app-site-association", "/.well-known/assetlinks.json"]) {
    const r = await fetch(BASE + p, { redirect: "manual" });
    const text = await r.text();
    check(`${p} 200 json no redirect`, r.status === 200 && (r.headers.get("content-type") ?? "").includes("application/json"), {
      status: r.status,
      type: r.headers.get("content-type"),
      body: text.slice(0, 400),
    });
  }

  // --- подготовка: сотрудник «ZZM Удаляемый» в e2e-org-a ---
  const orgId = STATE.orgA as string;
  await db.user.deleteMany({ where: { name: "ZZM Удаляемый" } });
  const stamp = Date.now();
  const email = `zzm-delete-${stamp}@e2e.local`;
  const victim = await db.user.create({
    data: {
      organizationId: orgId,
      email,
      name: "ZZM Удаляемый",
      phone: `+7999${String(stamp).slice(-7)}`,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "cook",
      telegramChatId: `77${String(stamp).slice(-7)}`,
      contactEmail: "zzm@example.com",
      themePreference: "light",
    },
    select: { id: true },
  });
  await db.webPushSubscription.create({
    data: { organizationId: orgId, userId: victim.id, endpoint: `https://push.example/${stamp}`, p256dh: "x", auth: "y" },
  });
  // Слот ответственного — чтобы проверить, что он освобождается.
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { journalResponsibleUsersJson: true } });
  const slots = { ...((org?.journalResponsibleUsersJson ?? {}) as Record<string, Record<string, string | null>>) };
  slots["zzm_test_journal"] = { filler: victim.id };
  await db.organization.update({ where: { id: orgId }, data: { journalResponsibleUsersJson: slots as never } });

  const browser = await chromium.launch({ headless: true });
  try {
    // --- /delete-account без входа, светлая и тёмная ---
    for (const theme of ["light", "dark"] as const) {
      const ctx = await newCtx(browser, theme);
      const page = await ctx.newPage();
      const r = await page.goto(`${BASE}/delete-account`, { waitUntil: "load", timeout: 300000 });
      await page.waitForTimeout(500);
      check(`/delete-account anon ${theme} 200`, r?.status() === 200, r?.status());
      check(`/delete-account anon ${theme} login link`, (await page.getByTestId("delete-account-login").getAttribute("href")) === "/mini/login?next=%2Fdelete-account");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`/delete-account anon ${theme} no horizontal overflow`, overflow <= 0, overflow);
      await page.screenshot({ path: `${SHOTS}/account-page-anon-${theme}.png`, fullPage: true });
      await ctx.close();
    }

    // --- профиль, светлая и тёмная: строка и диалог ---
    for (const theme of ["light", "dark"] as const) {
      await db.user.update({ where: { id: victim.id }, data: { themePreference: theme } });
      const ctx = await newCtx(browser, theme);
      check(`victim login ${theme}`, (await login(ctx, email)) === 200);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/mini/me`, { waitUntil: "load", timeout: 300000 });
      const row = page.getByTestId("me-delete-account");
      await row.waitFor({ timeout: 120000 });
      await row.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/account-profile-${theme}.png` });
      await row.click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/account-dialog-${theme}.png` });
      if (theme === "light") {
        // /delete-account с сессией
        const p2 = await ctx.newPage();
        await p2.goto(`${BASE}/delete-account`, { waitUntil: "load" });
        check("/delete-account signed-in shows button", await p2.getByTestId("delete-account-button").isVisible());
        await p2.screenshot({ path: `${SHOTS}/account-page-signed-in-light.png`, fullPage: true });
        await p2.close();
      }
      if (theme === "dark") {
        // Удаляем из профиля: вводим слово и подтверждаем.
        const cookiesBefore = await ctx.cookies();
        await page.getByRole("dialog").locator("input").fill("удалить");
        await page.getByRole("dialog").getByRole("button", { name: "Удалить аккаунт" }).click();
        await page.waitForURL((u) => u.pathname === "/mini/login", { timeout: 60000 });
        check("redirect to /mini/login?deleted=1", page.url().includes("deleted=1"), page.url());

        // Старые куки больше не дают сессию.
        const oldCtx = await newCtx(browser, "light");
        await oldCtx.addCookies(cookiesBefore);
        check("old session revoked", (await sessionUser(oldCtx)) === null);
        const apiWithOld = await oldCtx.request.get(`${BASE}/mini/me`);
        check("old cookie /mini/me still renders (signed-out view)", apiWithOld.status() < 500, apiWithOld.status());
        await oldCtx.close();

        // Войти снова нельзя ни по старой почте, ни по телефону.
        const again = await newCtx(browser, "light");
        const st = await login(again, email);
        check("cannot sign in again by email", st !== 200, st);
        const phoneLogin = await again.request.post(`${BASE}/api/mini/login`, {
          data: { phone: `+7999${String(stamp).slice(-7)}`, password: PASSWORD },
        });
        check("cannot sign in again by phone", phoneLogin.status() !== 200, phoneLogin.status());
        await again.close();
      }
      await ctx.close();
    }

    // --- база после удаления ---
    const after = await db.user.findUnique({ where: { id: victim.id } });
    check("isActive false", after?.isActive === false);
    check("archivedAt set", Boolean(after?.archivedAt));
    check("name anonymized", after?.name === "Удалённый сотрудник", after?.name);
    check("email anonymized", after?.email === `deleted-${victim.id}@deleted.wesetup.local`, after?.email);
    check("phone/contact/telegram null", after?.phone === null && after?.contactEmail === null && after?.telegramChatId === null);
    check("sessionVersion bumped", (after?.sessionVersion ?? 0) >= 1, after?.sessionVersion);
    check("web push removed", (await db.webPushSubscription.count({ where: { userId: victim.id } })) === 0);
    const orgAfter = await db.organization.findUnique({ where: { id: orgId }, select: { journalResponsibleUsersJson: true } });
    const slotAfter = (orgAfter?.journalResponsibleUsersJson as Record<string, Record<string, string | null>>)?.zzm_test_journal;
    check("journal slot freed", slotAfter?.filler === null, slotAfter);
    const audit = await db.auditLog.findFirst({ where: { entityId: victim.id, action: "account.deleted" } });
    check("audit log written", Boolean(audit), audit?.userName);

    // --- владелец: 409 + диалог перехода ---
    {
      const ctx = await newCtx(browser, "light");
      check("ownerA login", (await login(ctx, STATE.users.ownerA.email)) === 200);
      const bad = await ctx.request.post(`${BASE}/api/account/delete`, { data: { confirm: "нет" } });
      check("no confirm -> 400", bad.status() === 400, await bad.json());
      const r = await ctx.request.post(`${BASE}/api/account/delete`, { data: { confirm: "УДАЛИТЬ" } });
      const body = await r.json();
      check("owner -> 409 redirect", r.status() === 409 && body.redirect === "/settings/organization#delete", body);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/delete-account`, { waitUntil: "load" });
      await page.getByTestId("delete-account-button").click();
      await page.getByRole("dialog").locator("input").fill("УДАЛИТЬ");
      await page.getByRole("dialog").getByRole("button", { name: "Удалить аккаунт" }).click();
      await page.getByText("Сначала удалите компанию").waitFor({ timeout: 30000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/account-owner-409-light.png` });
      await page.getByRole("button", { name: "Перейти к удалению компании" }).click();
      await page.waitForURL((u) => u.pathname === "/settings/organization", { timeout: 120000 });
      check("owner navigates to /settings/organization#delete", page.url().endsWith("/settings/organization#delete"), page.url());
      const owner = await db.user.findUnique({ where: { id: STATE.users.ownerA.id }, select: { isActive: true, name: true } });
      check("owner untouched", owner?.isActive === true && owner?.name === STATE.users.ownerA.name, owner);
      await ctx.close();
    }

    // --- ROOT: 403 ---
    {
      const ctx = await newCtx(browser, "light");
      const st = await login(ctx, STATE.root.email);
      check("root login", st === 200, st);
      const r = await ctx.request.post(`${BASE}/api/account/delete`, { data: { confirm: "УДАЛИТЬ" } });
      check("root -> 403", r.status() === 403, await r.json());
      await ctx.close();
    }

    // --- без сессии: 401 ---
    const anon = await fetch(`${BASE}/api/account/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "УДАЛИТЬ" }),
    });
    check("anon -> 401", anon.status === 401, anon.status);
  } finally {
    await browser.close();
    // Уборка: вернуть слоты организации как были.
    const o = await db.organization.findUnique({ where: { id: orgId }, select: { journalResponsibleUsersJson: true } });
    const s = { ...((o?.journalResponsibleUsersJson ?? {}) as Record<string, unknown>) };
    delete s.zzm_test_journal;
    await db.organization.update({ where: { id: orgId }, data: { journalResponsibleUsersJson: s as never } });
    await db.$disconnect();
  }
  fs.writeFileSync(
    "d:/wt/mobile-apps/.agent/tasks/mobile-apps-2026-09/e2e/account-e2e.json",
    JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
  );
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
