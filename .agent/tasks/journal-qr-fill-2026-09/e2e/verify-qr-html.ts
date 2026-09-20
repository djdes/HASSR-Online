/* eslint-disable no-console */
// QR-форма как серверный HTML: public / pin / auth, с JS и без (390px, без cookies).
//   MODE=public|pin|auth [NOJS=1] [RATE=1] npx tsx verify-qr-html.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3020";
const MODE = process.env.MODE ?? "public";
const NOJS = process.env.NOJS === "1";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const probe = JSON.parse(fs.readFileSync(path.join(ROOT, "probe.json"), "utf8")) as {
  tokens: Record<string, string>;
  users: Array<{ id: string; name: string; email: string; role: string }>;
  docs: Record<string, { id: string; title: string } | null>;
};
const ORG = "cmoe6rpt4000097ts71yb922y";
const E2E = probe.users.find((u) => u.email === "e2e-fill-guide@wesetup.local")!;
const results: Record<string, unknown> = {};
const errors: string[] = [];
const tag = `${MODE}${NOJS ? "-nojs" : ""}`;
const shot = (p: Page, n: string) => p.screenshot({ path: path.join(ROOT, "shots", `html-${tag}-${n}.png`), fullPage: true });
fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true });
const url = (code: string, token: string) => `${BASE}/journal-fill/${ORG}/${code}?token=${encodeURIComponent(token)}`;
const body = (p: Page) => p.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 600));

async function goto(page: Page, href: string) {
  await page.goto(href, { waitUntil: "load", timeout: 240_000 });
  await page.waitForTimeout(300);
}
async function pickEmployee(page: Page) {
  // Запомненный сотрудник → «Продолжить», иначе ссылка в списке.
  const cont = page.locator("a.btn", { hasText: "Продолжить" });
  if (await cont.count()) {
    const on = await page.locator("a.item.on").first().innerText().catch(() => "");
    if (on.includes(E2E.name.split(" ")[0])) {
      await cont.first().click();
      await page.waitForLoadState("load");
      return "remembered";
    }
  }
  await page.locator(`a[href*="employee=${E2E.id}"]`).first().click();
  await page.waitForLoadState("load");
  return "list";
}
async function enterPin(page: Page, pin: string) {
  await page.locator('input[name="pin"]').fill(pin);
  await page.locator('#qr-form button[type="submit"]').click();
  await page.waitForLoadState("load");
}
async function submit(page: Page) {
  await page.locator('#qr-form button[type="submit"]').click();
  await page.waitForLoadState("load");
  await page.waitForTimeout(300);
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, javaScriptEnabled: !NOJS });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  try {
    await goto(page, url("hygiene", "bad.token"));
    results.badTokenH1 = (await page.locator("h1").first().textContent())?.trim();
    const bad = await page.request.post(`${BASE}/api/journal-fill/${ORG}/hygiene`, { data: { token: "bad.token.value", documentId: "x", employeeId: E2E.id, rowKey: "employee-x", values: {} } });
    results.badTokenApi = bad.status();
    results.pageBytes = (await page.request.get(url("hygiene", probe.tokens.hygiene))).headers()["content-length"] ?? (await (await page.request.get(url("hygiene", probe.tokens.hygiene))).text()).length;

    if (MODE === "auth") {
      await goto(page, url("hygiene", probe.tokens.hygiene));
      results.authRedirect = page.url();
      const authCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: path.resolve(process.cwd(), ".agent/tasks/names-memory-2026-09/e2e/state.json") });
      const ap = await authCtx.newPage();
      await goto(ap, url("hygiene", probe.tokens.hygiene));
      results.authBody = await body(ap);
      results.authRememberedSelf = (await ap.locator("a.item.on").first().innerText().catch(() => "")).includes(E2E.name.split(" ")[0]);
      await shot(ap, "auth-employees");
      await pickEmployee(ap);
      results.authFormLabels = await ap.evaluate(() => Array.from(document.querySelectorAll(".ft label")).map((l) => l.textContent?.trim()));
      await submit(ap);
      results.authResult = (await ap.locator("h2").first().textContent())?.trim();
      await shot(ap, "auth-result");
      await authCtx.close();
      return;
    }

    // --- хаб
    await goto(page, url("all", probe.tokens.hub));
    results.hubLinks = await page.locator("a.item[href*='/journal-fill/']").count();
    await shot(page, "hub");

    // --- гигиена
    await goto(page, url("hygiene", probe.tokens.hygiene));
    results.employeeLinks = await page.locator("a.item[href*='employee=']").count();
    await shot(page, "employees");
    results.pick1 = await pickEmployee(page);
    if (MODE === "pin") {
      results.pinStep = (await page.locator('input[name="pin"]').count()) === 1;
      await enterPin(page, "9999");
      results.pinWrong = (await body(page)).match(/Неверный PIN[^.]*\./)?.[0] ?? null;
      await shot(page, "pin-wrong");
      await enterPin(page, "2580");
      results.pinPassed = (await page.locator('input[name="pin"]').count()) === 0;
    }
    results.hygieneLabels = await page.evaluate(() => Array.from(document.querySelectorAll(".ft label")).map((l) => l.textContent?.trim()));
    results.hygieneWho = (await page.locator(".who").first().innerText()).replace(/\s+/g, " ");
    results.stickySave = await page.locator('#qr-form .sticky button[type="submit"]').count();
    await shot(page, "hygiene-form");
    await submit(page);
    results.hygieneResult = (await page.locator("h2").first().textContent())?.trim();
    results.hygieneUrlDone = page.url().includes("done=");
    results.hygieneDaily = (await page.locator(".label", { hasText: /сегодня у вас/i }).count()) === 1;
    results.hygieneNext = await page.locator("a.btn.second", { hasText: "Дальше" }).count();
    await shot(page, "hygiene-result");
    // повтор — обновление, а не дубль; сотрудник запомнен cookie
    await goto(page, url("hygiene", probe.tokens.hygiene));
    results.pick2 = await pickEmployee(page);
    await submit(page);
    results.hygieneRepeat = (await page.locator("h2").first().textContent())?.trim();

    // --- бракераж
    const dish = `E2E QR ${Date.now().toString().slice(-5)}`;
    await goto(page, url("finished_product", probe.tokens.finished_product));
    await pickEmployee(page);
    if (MODE === "pin" && (await page.locator('input[name="pin"]').count())) await enterPin(page, "2580");
    results.fpLabels = await page.evaluate(() => Array.from(document.querySelectorAll(".ft label")).map((l) => l.textContent?.trim()));
    results.fpTimeDefault = await page.locator("#f-productionTime").inputValue();
    results.fpTimeChips = await page.locator('[data-fill="productionTime"][data-ago]').count();
    results.fpChoiceChips = await page.locator('[data-fill="organoleptic"]').count();
    results.fpOrganolepticDefault = await page.locator("#f-organoleptic").inputValue();
    await page.locator("#f-productName").fill(dish);
    await page.locator("#f-productTemp").fill("73");
    if (!NOJS) {
      await page.locator('[data-fill="organoleptic"][data-value="Хорошо"]').click();
      results.fpChoiceApplied = await page.locator("#f-organoleptic").inputValue();
      await page.locator('[data-fill="productionTime"][data-ago="60"]').click();
      results.fpTimeChipApplied = await page.locator("#f-productionTime").inputValue();
    }
    await shot(page, "fp-form");
    await submit(page);
    results.fpResult = (await page.locator("h2").first().textContent())?.trim();
    results.fpAddMore = await page.locator("a.btn", { hasText: "Добавить ещё" }).count();
    await shot(page, "fp-result");
    await page.locator("a.btn", { hasText: "Добавить ещё" }).first().click();
    await page.waitForLoadState("load");
    results.fpRecentChip = await page.locator(`[data-fill="productName"][data-value="${dish}"]`).count();
    if (!NOJS && (await page.locator(`[data-fill="productName"][data-value="${dish}"]`).count())) {
      await page.locator(`[data-fill="productName"][data-value="${dish}"]`).click();
      await page.waitForTimeout(200);
      results.fpTempAuto = await page.locator("#f-productTemp").inputValue();
      results.fpTempHint = await page.locator("#temp-hint:not([hidden])").count();
    }
    // отклонение проверяется только там, где у числового поля есть норма (блок #deviation)
    results.fpHasDeviationBlock = await page.locator("#deviation").count();
    if (await page.locator("#deviation").count()) {
      await page.locator("#f-productName").fill(`${dish} 2`);
      await page.locator("#f-productTemp").fill("150");
      if (!NOJS) results.fpDeviationShown = await page.locator("#deviation:not([hidden])").count();
      await shot(page, "fp-deviation");
      await submit(page);
      results.fpDeviationBlocked = (await body(page)).includes("вне нормы");
      await page.locator("#f-__correction").fill("Повторю замер через 30 минут");
      await submit(page);
      // 150 °C выше физического предела валидатора (120) — ожидаем понятную ошибку, а не запись
      results.fpDeviationThenValidator = (await body(page)).match(/Проверьте «[^»]+»[^.]*/)?.[0] ?? (await page.locator("h2").first().textContent().catch(() => null));
    }

    // --- холодильники и уборка: пустые состояния
    await goto(page, url("cold_equipment_control", probe.tokens.cold));
    await pickEmployee(page);
    if (MODE === "pin" && (await page.locator('input[name="pin"]').count())) await enterPin(page, "2580");
    results.coldBody = (await body(page)).slice(0, 260);
    await goto(page, url("cleaning", probe.tokens.cleaning));
    await pickEmployee(page).catch(() => null);
    results.cleaningBody = (await body(page)).slice(0, 260);

    // --- плакат документа: сразу список сотрудников
    await goto(page, url("finished_product", probe.tokens.fpDoc));
    results.docTokenEmployees = await page.locator("a.item[href*='employee=']").count();

    if (process.env.RATE === "1") {
      let got429 = 0;
      for (let i = 0; i < 35; i += 1) {
        const r = await page.request.post(`${BASE}/api/journal-fill/${ORG}/hygiene`, { data: { token: probe.tokens.hygiene, documentId: probe.docs.hygiene!.id, employeeId: "nope", rowKey: "employee-nope", values: {} } });
        if (r.status() === 429) got429 += 1;
      }
      results.rateLimited429 = got429;
    }
  } finally {
    results.errors = errors;
    fs.writeFileSync(path.join(ROOT, `results-html-${tag}.json`), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 1));
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
