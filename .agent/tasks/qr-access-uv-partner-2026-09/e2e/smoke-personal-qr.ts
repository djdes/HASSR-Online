// Смоук: «Разрешение менять настройки» + личный QR-вход (QR + PIN → кабинет).
// Запуск (dev на 3020 с wesetup_e2e): npx tsx .agent/tasks/qr-access-uv-partner-2026-09/e2e/smoke-personal-qr.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { chromium, type Page } from "playwright";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
const state = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "..", "journal-responsibles-org-2026-09", "e2e", "state.json"), "utf8")
);
const PIN = "7342";

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
    if (await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error("login failed");
}

async function main() {
  const cleaner = state.users.cleanerA as { id: string; name: string };
  const before = await db.user.findUniqueOrThrow({ where: { id: cleaner.id }, select: { qrPinHash: true, qrPinEncrypted: true, canManageSettings: true, qrPinFailedCount: true } });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    await db.user.update({ where: { id: cleaner.id }, data: { qrPinHash: await bcrypt.hash(PIN, 10), qrPinFailedCount: 0, qrPinLockedUntil: null } });
    const manager = await (await browser.newContext()).newPage();
    await login(manager, state.users.managerA.email);
    const api = manager.context().request;

    const flag = await api.put(`${BASE}/api/users/${cleaner.id}`, { data: { canManageSettings: true } });
    check("руководитель ставит «Разрешение менять настройки»", flag.status() === 200, await flag.text());
    const self = await api.put(`${BASE}/api/users/${state.users.managerA.id}`, { data: { canManageSettings: true } });
    check("себе выдать нельзя", self.status() === 400);

    const issued = (await (await api.post(`${BASE}/api/staff/${cleaner.id}/personal-qr`, { data: {} })).json()) as { url?: string; svg?: string };
    check("личный QR выпущен (ссылка + SVG)", Boolean(issued.url?.includes("/q/")) && Boolean(issued.svg?.includes("<svg")), issued.url);
    const qrPath = new URL(issued.url ?? "http://x/").pathname;

    // Вход по QR на телефоне.
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await phoneCtx.newPage();
    await phone.goto(`${BASE}${qrPath}`, { waitUntil: "load", timeout: 240_000 });
    await phone.getByTestId("personal-qr-submit").waitFor({ timeout: 60_000 });
    check("страница QR показывает имя сотрудника", (await phone.locator("main").innerText()).includes(cleaner.name));
    await phone.getByLabel("PIN для быстрой QR-авторизации").fill("1111");
    await phone.getByTestId("personal-qr-submit").click();
    await phone.getByText(/Неверный PIN/).waitFor({ timeout: 30_000 });
    check("неверный PIN — отказ с числом попыток", true);
    await phone.getByLabel("PIN для быстрой QR-авторизации").fill(PIN);
    await phone.screenshot({ path: path.join(SHOTS, "50-personal-qr-login.png") });
    await phone.getByTestId("personal-qr-submit").click();
    await phone.waitForURL((u) => u.pathname.startsWith("/dashboard"), { timeout: 120_000 });
    check("верный PIN — вход в кабинет (дашборд руководителя)", phone.url().includes("/dashboard"));

    await phone.goto(`${BASE}/settings/equipment`, { waitUntil: "load", timeout: 240_000 });
    check("с галкой открываются настройки (оборудование)", phone.url().includes("/settings/equipment"), phone.url());

    // Сняли галку — настройки закрыты (без перевхода).
    const revoke = await api.put(`${BASE}/api/users/${cleaner.id}`, { data: { canManageSettings: false } });
    console.log("revoke status", revoke.status(), (await revoke.text()).slice(0, 200));
    await phone.goto(`${BASE}/journals`, { waitUntil: "load", timeout: 240_000 });
    await phone.goto(`${BASE}/settings/equipment`, { waitUntil: "load", timeout: 240_000 });
    const bodyText = (await phone.locator("body").innerText()).slice(0, 300);
    check("галку сняли — настройки больше не открываются", !phone.url().includes("/settings/equipment") || !bodyText.includes("Добавить оборудование"), { url: phone.url(), bodyText });

    // Отключили QR — ссылка не работает.
    await api.delete(`${BASE}/api/staff/${cleaner.id}/personal-qr`);
    const again = await (await browser.newContext()).newPage();
    await again.goto(`${BASE}${qrPath}`, { waitUntil: "load", timeout: 240_000 });
    check("отключённый QR — «больше не действует»", (await again.locator("main").innerText()).includes("QR больше не действует"));
  } finally {
    await browser.close();
    await db.personalLoginToken.deleteMany({ where: { userId: cleaner.id } });
    await db.user.update({ where: { id: cleaner.id }, data: { ...before, qrPinLockedUntil: null } });
    fs.writeFileSync(path.join(HERE, "smoke-personal-qr.json"), JSON.stringify(checks, null, 2));
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
