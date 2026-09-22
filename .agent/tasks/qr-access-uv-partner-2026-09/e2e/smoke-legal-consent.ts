// Смоук «Согласие с документами»: регистрация без галки невозможна, окно у руководителя один раз.
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/qr-access-uv-partner-2026-09/e2e/smoke-legal-consent.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

async function login(page: Page, email: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.fill("#email", email);
    await page.fill("#password", state.password);
    await page.click('button[type="submit"]').catch(() => null);
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (left) return;
  }
  throw new Error("login failed");
}

async function main() {
  const managerId = state.users.managerA.id as string;
  const original = await db.user.findUniqueOrThrow({ where: { id: managerId }, select: { legalVersion: true } });
  const newEmail = `consent-smoke-${Date.now()}@gmail.com`;
  const browser = await chromium.launch({ channel: "chrome" });
  const anonCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    // API без согласия — отказ.
    const noConsent = await anonCtx.request.post(`${BASE}/api/auth/instant-register`, { data: { email: newEmail } });
    check("instant-register без согласия — 400", noConsent.status() === 400, await noConsent.text());
    check("аккаунт без согласия не создан", (await db.user.count({ where: { email: newEmail } })) === 0);

    // Форма /register: без галки кнопка не отправляет, с галкой — создаёт и пишет согласие.
    const reg = await anonCtx.newPage();
    await reg.goto(`${BASE}/register`, { waitUntil: "load", timeout: 240_000 });
    await reg.fill("#register-email", newEmail);
    await reg.waitForTimeout(1500);
    await reg.getByRole("button", { name: /Создать аккаунт/ }).click();
    await reg.getByText("Отметьте согласие с документами").waitFor({ timeout: 15_000 });
    await reg.screenshot({ path: path.join(SHOTS, "20-register-consent-required.png") });
    check("форма без галки показывает, что нужно согласие", true);
    await reg.getByTestId("legal-consent").check();
    await reg.getByRole("button", { name: /Создать аккаунт/ }).click();
    await reg.waitForURL((u) => u.pathname.startsWith("/dashboard"), { timeout: 120_000 }).catch(() => null);
    const created = await db.user.findUnique({ where: { email: newEmail }, select: { id: true, legalVersion: true } });
    const consent = created ? await db.legalConsent.findFirst({ where: { userId: created.id } }) : null;
    check("с галкой — аккаунт создан, согласие записано", Boolean(created?.legalVersion) && consent?.source === "register", { created, consent });

    // Действующий руководитель без согласия видит окно один раз.
    await db.user.update({ where: { id: managerId }, data: { legalVersion: null } });
    const page = await ctx.newPage();
    await login(page, state.users.managerA.email);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 240_000 });
    const modal = page.getByTestId("legal-update-modal");
    await modal.waitFor({ timeout: 60_000 });
    await page.screenshot({ path: path.join(SHOTS, "21-legal-update-modal.png") });
    check("кнопка «Принять» неактивна без галки", await page.getByTestId("legal-update-accept").isDisabled());
    await modal.getByTestId("legal-consent").check();
    await page.getByTestId("legal-update-accept").click();
    await modal.waitFor({ state: "detached", timeout: 30_000 });
    const after = await db.user.findUniqueOrThrow({ where: { id: managerId }, select: { legalVersion: true } });
    check("после «Принять» версия записана", Boolean(after.legalVersion));
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(2000);
    check("после перезагрузки окна нет", (await page.getByTestId("legal-update-modal").count()) === 0);
  } finally {
    await browser.close();
    const u = await db.user.findUnique({ where: { email: newEmail }, select: { id: true, organizationId: true } });
    if (u) {
      await db.legalConsent.deleteMany({ where: { userId: u.id } });
      await db.account.deleteMany({ where: { ownerUserId: u.id } }).catch(() => null);
      await db.user.delete({ where: { id: u.id } }).catch(() => null);
      await db.organization.delete({ where: { id: u.organizationId } }).catch(() => null);
    }
    await db.legalConsent.deleteMany({ where: { userId: managerId } });
    await db.user.update({ where: { id: managerId }, data: { legalVersion: original.legalVersion } });
    fs.writeFileSync(path.join(HERE, "smoke-legal-consent.json"), JSON.stringify(checks, null, 2));
    await db.$disconnect();
  }
  const failed = checks.filter((item) => !item.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
