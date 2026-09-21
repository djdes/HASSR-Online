// Круг 16 (dev 3020): PIN спрашивается над «Сохранить», если задан у сотрудника (публичный режим);
// показ/генерация PIN в карточке сотрудника; поиск по ФИО в разделе сотрудников; крупный текст.
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3020";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const ORG = "cmoe6rpt4000097ts71yb922y";
const probe = JSON.parse(fs.readFileSync(path.join(ROOT, "probe.json"), "utf8")) as { tokens: Record<string, string>; users: Array<{ id: string; email: string; name?: string }> };
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "seed-objects.json"), "utf8")) as { rooms: Array<{ href: string }> };
const creds = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), ".agent/tasks/journal-fill-guide-2026-09/e2e/creds.json"), "utf8")) as { email: string; password: string };
const E2E = probe.users.find((u) => u.email === "e2e-fill-guide@wesetup.local")!;
const PIN = process.env.PIN ?? "2580";
const out: Record<string, unknown> = {};

async function pickEmployee(page: Page, text: string) {
  await page.locator("button[role=combobox]").first().click();
  await page.locator("[role=option]").filter({ hasText: text }).first().click();
  await page.waitForTimeout(150);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

  // ---- HTML холодильники: сотрудник с PIN → блок PIN над «Сохранить»; без PIN → ошибка; с верным → запись
  const coldUrl = `${BASE}/journal-fill/${ORG}/cold_equipment_control?token=${encodeURIComponent(probe.tokens.cold)}&employee=${E2E.id}`;
  await page.goto(coldUrl, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#qr-form", { timeout: 120_000 });
  out.htmlPinBox = await page.locator(".pinbox").count();
  out.htmlPinBeforeSticky = await page.evaluate(() => { const a = document.querySelector(".pinbox"); const b = document.querySelector(".sticky"); return !!a && !!b && a.compareDocumentPosition(b) === Node.DOCUMENT_POSITION_FOLLOWING; });
  out.htmlBodyFont = await page.evaluate(() => getComputedStyle(document.body).fontSize);
  out.htmlItemFont = await page.evaluate(() => { const el = document.querySelector(".obj-t"); return el ? getComputedStyle(el).fontSize : null; });
  const cards = await page.locator(".obj").count();
  for (let i = 0; i < cards; i += 1) await page.locator(".obj").nth(i).locator(".qv .chip").nth(1).click();
  await page.screenshot({ path: path.join(ROOT, "shots", "r16-html-pin.png"), fullPage: true });
  await page.locator("input.pin").fill("0000");
  await page.locator("#qr-form button[type=submit]").click();
  await page.waitForSelector(".pinbox .err", { timeout: 60_000 });
  out.htmlWrongPin = (await page.locator(".pinbox .err").innerText()).trim();
  out.htmlValuesKept = await page.locator(".obj input.in").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  await page.locator("input.pin").fill(PIN);
  await page.locator("#qr-form button[type=submit]").click();
  await page.waitForURL((u) => u.search.includes("done="), { timeout: 60_000 });
  out.htmlDone = new URL(page.url()).searchParams.get("done");
  // повторное открытие — PIN спрашивается снова (без 15-минутного пропуска)
  await page.goto(coldUrl, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("#qr-form", { timeout: 60_000 });
  out.htmlPinAgain = await page.locator(".pinbox").count();

  // ---- помещение: выбран сотрудник с PIN → PinPrompt над кнопкой; неверный → ошибка; верный → запись
  await page.goto(`${BASE}${seed.rooms[0].href}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("#room-fill-temperature", { timeout: 120_000 });
  await pickEmployee(page, "Тестовое");
  out.roomPinPrompt = await page.locator("text=Введите ваш PIN").count();
  await page.getByRole("group", { name: "Быстрый ввод: температура" }).getByRole("button", { name: "20", exact: true }).click();
  out.roomSaveDisabledWithoutPin = await page.getByRole("button", { name: /Сохранить/ }).first().isDisabled();
  await page.getByLabel("PIN для быстрой QR-авторизации").fill("0000");
  await page.getByRole("button", { name: /Сохранить/ }).first().click();
  await page.waitForTimeout(1200);
  out.roomWrongPin = (await page.locator("text=/Неверный PIN/").first().innerText().catch(() => "")).trim();
  await page.screenshot({ path: path.join(ROOT, "shots", "r16-room-pin.png"), fullPage: true });
  await page.getByLabel("PIN для быстрой QR-авторизации").fill(PIN);
  await page.getByRole("button", { name: /Сохранить/ }).first().click();
  await page.waitForSelector("text=Записано", { timeout: 60_000 });
  out.roomSaved = true;
  // сотрудник без PIN — блока нет
  await page.goto(`${BASE}${seed.rooms[1].href}`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("#room-fill-temperature", { timeout: 120_000 });
  await pickEmployee(page, "Иванова");
  out.roomNoPinPrompt = await page.locator("text=Введите ваш PIN").count();
  await ctx.close();

  // ---- кабинет: поиск по ФИО, показ и генерация PIN в карточке
  const admin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ap = await admin.newPage();
  await ap.goto(`${BASE}/login`, { waitUntil: "load", timeout: 240_000 });
  await ap.waitForTimeout(2500);
  await ap.locator("#email").fill(creds.email);
  await ap.locator("#password").fill(creds.password);
  await Promise.all([ap.waitForResponse((r) => r.url().includes("/api/auth/login")), ap.locator('button[type="submit"]').first().click()]);
  await ap.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 });
  await ap.goto(`${BASE}/settings/users`, { waitUntil: "load", timeout: 240_000 });
  await ap.waitForSelector('input[aria-label="Поиск сотрудника"]', { timeout: 120_000 });
  await ap.locator('input[aria-label="Поиск сотрудника"]').fill("тестовое");
  await ap.waitForTimeout(300);
  out.staffSearchRows = await ap.locator('[data-testid="staff-search-results"] li').count();
  out.staffSearchFirst = (await ap.locator('[data-testid="staff-search-results"] li').first().innerText().catch(() => "")).replace(/\s+/g, " ");
  await ap.screenshot({ path: path.join(ROOT, "shots", "r16-staff-search.png"), fullPage: false });
  await ap.locator('[data-testid="staff-search-results"] li').first().getByRole("button", { name: "Изменить" }).click();
  await ap.waitForSelector("text=PIN для быстрой QR-авторизации", { timeout: 60_000 });
  await ap.getByRole("button", { name: "Показать" }).click();
  await ap.waitForSelector('[data-testid="qr-pin-shown"]', { timeout: 30_000 });
  out.staffShownPin = (await ap.locator('[data-testid="qr-pin-shown"]').innerText()).trim();
  await ap.getByRole("button", { name: /Сгенерировать/ }).click();
  await ap.waitForTimeout(800);
  out.staffGeneratedPin = (await ap.locator('[data-testid="qr-pin-shown"]').innerText()).trim();
  await ap.screenshot({ path: path.join(ROOT, "shots", "r16-staff-pin.png"), fullPage: false });
  // планшет: тот же PIN
  const reveal = await ap.request.get(`${BASE}/api/staff/${E2E.id}/qr-pin`);
  out.apiReveal = (await reveal.json()) as unknown;
  await admin.close();

  fs.writeFileSync(path.join(ROOT, "results-round16.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
