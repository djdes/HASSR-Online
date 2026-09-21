// Прод: вход тестовым аккаунтом → токены плакатов через /api/qr-fill → страницы
// /room-fill и /equipment-fill тестовой организации (±, имя, полоса объектов).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const BASE = "https://wesetup.ru";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "seed-objects.json"), "utf8")) as { rooms: Array<{ id: string; name: string }>; equipment: Array<{ id: string; name: string }> };
const creds = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), ".agent/tasks/journal-fill-guide-2026-09/e2e/creds.json"), "utf8")) as { email: string; password: string };
const out: Record<string, unknown> = {};
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const admin = await browser.newContext();
  const ap = await admin.newPage();
  await ap.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120_000 });
  await ap.waitForTimeout(2500);
  await ap.locator("#email").fill(creds.email);
  await ap.locator("#password").fill(creds.password);
  await ap.waitForTimeout(500);
  const [res] = await Promise.all([ap.waitForResponse((r) => r.url().includes("/api/auth/login")), ap.locator('button[type="submit"]').first().click()]);
  out.login = res.status();
  await ap.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 });
  const posterUrl = async (kind: string, id: string) => {
    const r = await ap.request.get(`${BASE}/api/qr-fill/${kind}/${id}`);
    const j = (await r.json()) as { poster?: Record<string, unknown> };
    const p = j.poster ?? {};
    const url = String(p.url ?? p.fillUrl ?? p.href ?? "");
    return url.replace(/^https?:\/\/[^/]+/, "");
  };
  const roomHref = await posterUrl("room", seed.rooms[0].id);
  const eqHref = await posterUrl("equipment", seed.equipment[1].id);
  const coldHref = await posterUrl("journal", "cold_equipment_control");
  out.coldHref = coldHref.replace(/token=.*/, "token=…");
  out.roomHref = roomHref.replace(/token=.*/, "token=…");
  await admin.close();

  // Как сотрудник: чистый мобильный контекст без сессии.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const [kind, href] of [["room", roomHref], ["equipment", eqHref]] as const) {
    const started = Date.now();
    const r = await page.goto(`${BASE}${href}`, { waitUntil: "load", timeout: 120_000 });
    out[`${kind}Status`] = r?.status();
    out[`${kind}LoadMs`] = Date.now() - started;
    await page.waitForSelector("input[inputmode=decimal]", { timeout: 60_000 });
    const input = page.locator("input[inputmode=decimal]").first();
    await input.fill("");
    await page.getByRole("button", { name: /^Минус: температура/ }).first().click();
    out[`${kind}AfterMinusFromEmpty`] = await input.inputValue();
    await page.getByRole("button", { name: /^Плюс: температура/ }).first().click();
    out[`${kind}AfterPlus`] = await input.inputValue();
    out[`${kind}Label`] = (await page.locator("label", { hasText: "Температура" }).first().innerText()).replace(/\s+/g, " ");
    out[`${kind}Header`] = (await page.locator("header").innerText()).replace(/\s+/g, " ").trim();
    out[`${kind}Sheet`] = await page.getByRole("button", { name: /Кто снимает показания/ }).count();
    // Список объектов теперь под кнопкой «Сменить» у строки объекта.
    await page.getByRole("button", { name: kind === "room" ? /Помещение/ : /Оборудование/ }).first().click();
    await page.waitForTimeout(200);
    out[`${kind}Strip`] = (await page.locator("[aria-current=true]").first().locator("xpath=..").innerText()).replace(/\s+/g, " ");
    await page.getByRole("button", { name: kind === "room" ? /Помещение/ : /Оборудование/ }).first().click();
    out[`${kind}Trigger`] = (await page.getByRole("button", { name: /Кто снимает показания/ }).first().innerText()).replace(/\s+/g, " | ");
    await page.screenshot({ path: path.join(ROOT, "shots", `prod-${kind}-fill.png`), fullPage: true });
  }
  // HTML-форма холодильников: чипы быстрого ввода, запись касанием, повторное открытие с подстановкой.
  if (coldHref) {
    await page.goto(`${BASE}${coldHref}`, { waitUntil: "load", timeout: 120_000 });
    out.coldStep1 = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 200);
    const emp = page.locator('a[href*="employee="]').first();
    if (await emp.count()) await emp.click();
    else {
      const doc = page.locator('a[href*="doc="], a[href*="document="]').first();
      if (await doc.count()) { await doc.click(); await page.waitForTimeout(500); const e2 = page.locator('a[href*="employee="]').first(); if (await e2.count()) await e2.click(); }
    }
    await page.waitForTimeout(500);
    out.coldStep2 = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 200);
    out.coldUrl2 = page.url().replace(/token=[^&]+/, "token=…");
    await page.screenshot({ path: path.join(ROOT, "shots", "prod-cold-step.png"), fullPage: true });
    fs.writeFileSync(path.join(ROOT, "results-prod-objects.json"), JSON.stringify(out, null, 2));
    await page.waitForSelector("#qr-form", { state: "attached", timeout: 90_000 });
    out.coldChipRows = await page.locator(".chips.qv").count();
    out.coldToday = (await page.locator(".today").innerText().catch(() => "")).trim();
    out.coldSteppers = await page.locator(".stp").count();
    const firstInput = page.locator(".obj").nth(0).locator("input.in");
    await firstInput.fill("");
    await page.locator(".obj").nth(0).locator(".stp.minus").click();
    out.coldStepFromEmpty = await firstInput.inputValue();
    // Пустые поля → понятная ошибка с подсветкой; чип «Выключено» есть у каждой карточки.
    for (const input of await page.locator(".obj input.in").all()) await input.fill("");
    await page.locator("#qr-form button[type=submit]").click();
    await page.waitForSelector(".err", { timeout: 60_000 });
    out.coldEmptyError = (await page.locator(".err").innerText()).trim().slice(0, 120);
    out.coldEmptyBad = await page.locator(".fl.bad").count();
    out.coldOffChips = await page.locator(".chip.offc").count();
    out.coldValueFont = await page.locator(".obj input.in").first().evaluate((el) => `${getComputedStyle(el).fontSize} ${getComputedStyle(el).textAlign}`);
    out.coldNotes = await page.locator(".note").count();
    out.amberDeviationCss = (await page.content()).includes("#e9b949");
    out.flatLabelCss = (await page.content()).includes(".lab .lab-s");
    out.offrowCss = (await page.content()).includes(".chips.offrow{margin:14px 0 4px}");
    out.pinboxCss = (await page.content()).includes(".pinbox{");
    out.bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontSize);
    // У холодильника может быть несколько замеров в день — заполняем каждое поле (ряд быстрых значений).
    const rows = await page.locator(".obj .chips.qv").count();
    for (let i = 0; i < rows; i += 1) await page.locator(".obj .chips.qv").nth(i).locator(".chip").nth(1).click();
    out.coldValues = await page.locator(".obj input.in").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    await page.screenshot({ path: path.join(ROOT, "shots", "prod-cold-form.png"), fullPage: true });
    await page.locator("#qr-form button[type=submit]").click();
    await page.waitForURL((u) => u.search.includes("done="), { timeout: 60_000 });
    await page.goto(`${BASE}${coldHref}`, { waitUntil: "load", timeout: 120_000 });
    const again = page.locator('a[href*="employee="]').first();
    if (await again.count()) await again.click();
    await page.waitForSelector("#qr-form", { state: "attached", timeout: 90_000 });
    out.coldNotice = (await page.locator(".note").first().innerText().catch(() => "")).trim();
    out.coldPrefilled = await page.locator(".obj input.in").evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    await page.screenshot({ path: path.join(ROOT, "shots", "prod-cold-prefilled.png"), fullPage: true });
  }
  // ---- PIN: выдать тестовому сотруднику через API, проверить запрос над «Сохранить» на HTML-форме и странице помещения, снять.
  if (process.env.PIN_FLOW) {
    const admin2 = await browser.newContext();
    const ap2 = await admin2.newPage();
    await ap2.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120_000 });
    await ap2.waitForTimeout(2500);
    await ap2.locator("#email").fill(creds.email);
    await ap2.locator("#password").fill(creds.password);
    await Promise.all([ap2.waitForResponse((r) => r.url().includes("/api/auth/login")), ap2.locator('button[type="submit"]').first().click()]);
    await ap2.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 });
    const E2E_ID = "cmto7vatn0000cg9mgopek07o";
    const gen = await ap2.request.post(`${BASE}/api/staff/${E2E_ID}/qr-pin`);
    const genJson = (await gen.json()) as { pin?: string };
    const pin = genJson.pin ?? "";
    out.pinFlow = { generated: Boolean(pin) };
    const reveal = await ap2.request.get(`${BASE}/api/staff/${E2E_ID}/qr-pin`);
    out.pinReveal = ((await reveal.json()) as { pin?: string }).pin === pin;
    // поиск по ФИО в разделе сотрудников
    await ap2.goto(`${BASE}/settings/users`, { waitUntil: "load", timeout: 120_000 });
    await ap2.waitForSelector('input[aria-label="Поиск сотрудника"]', { timeout: 120_000 });
    await ap2.locator('input[aria-label="Поиск сотрудника"]').fill("тестовое");
    await ap2.waitForTimeout(400);
    out.staffSearchRows = await ap2.locator('[data-testid="staff-search-results"] li').count();
    const coldEmp = `${coldHref}&employee=${E2E_ID}`;
    await admin2.close();
    const p2 = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
    await p2.goto(`${BASE}${coldEmp}`, { waitUntil: "load", timeout: 120_000 });
    await p2.waitForSelector("#qr-form", { state: "attached", timeout: 90_000 });
    out.htmlPinBox = await p2.locator(".pinbox").count();
    out.htmlBodyFont = await p2.evaluate(() => getComputedStyle(document.body).fontSize);
    const cards2 = await p2.locator(".obj").count();
    for (let i = 0; i < cards2; i += 1) await p2.locator(".obj").nth(i).locator(".qv .chip").nth(1).click();
    await p2.locator("input.pin").fill("0000");
    await p2.locator("#qr-form button[type=submit]").click();
    await p2.waitForSelector(".pinbox .err", { timeout: 60_000 });
    out.htmlWrongPin = (await p2.locator(".pinbox .err").innerText()).trim();
    await p2.locator("input.pin").fill(pin);
    await p2.locator("#qr-form button[type=submit]").click();
    await p2.waitForURL((u) => u.search.includes("done="), { timeout: 60_000 });
    out.htmlDone = new URL(p2.url()).searchParams.get("done");
    await p2.screenshot({ path: path.join(ROOT, "shots", "prod-r16-pin-done.png"), fullPage: true });
    // помещение: выбор сотрудника с PIN → блок PIN
    await p2.goto(`${BASE}${roomHref}`, { waitUntil: "load", timeout: 120_000 });
    await p2.waitForSelector("#room-fill-temperature", { timeout: 60_000 });
    await p2.locator("button[role=combobox]").first().click();
    await p2.locator("[role=option]").filter({ hasText: "Тестовое" }).first().click();
    await p2.waitForTimeout(200);
    out.roomPinPrompt = await p2.locator("text=Введите ваш PIN").count();
    await p2.screenshot({ path: path.join(ROOT, "shots", "prod-r16-room-pin.png"), fullPage: true });
    await p2.context().close();
    // снять тестовый PIN
    const admin3 = await browser.newContext();
    const ap3 = await admin3.newPage();
    await ap3.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120_000 });
    await ap3.waitForTimeout(2500);
    await ap3.locator("#email").fill(creds.email);
    await ap3.locator("#password").fill(creds.password);
    await Promise.all([ap3.waitForResponse((r) => r.url().includes("/api/auth/login")), ap3.locator('button[type="submit"]').first().click()]);
    await ap3.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120_000 });
    const clear = await ap3.request.patch(`${BASE}/api/staff/${E2E_ID}`, { data: { qrPin: null } });
    out.pinCleared = clear.ok();
    await admin3.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, "results-prod-objects.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})();
