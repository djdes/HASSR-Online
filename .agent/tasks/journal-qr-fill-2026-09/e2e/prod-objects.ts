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
    out[`${kind}Strip`] = (await page.locator("[aria-current=true]").first().locator("xpath=..").innerText()).replace(/\s+/g, " ");
    out[`${kind}Trigger`] = (await page.locator("button[role=combobox]").first().innerText()).replace(/\s+/g, " | ");
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
    const cards = await page.locator(".obj").count();
    for (let i = 0; i < cards; i += 1) await page.locator(".obj").nth(i).locator(".qv .chip").nth(1).click();
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
  await browser.close();
  fs.writeFileSync(path.join(ROOT, "results-prod-objects.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})();
