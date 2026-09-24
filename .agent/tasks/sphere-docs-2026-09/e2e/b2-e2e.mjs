// B2 e2e: fitness org → journals settings, onboarding «Документы» (orders with
// return, checklist defaults, reviewed), QuickStartCard, public sphere pages.
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = "http://localhost:3032";
const OUT = process.argv[2];
const exe = process.env.CHROME_EXE;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ["--no-sandbox", "--use-gl=swiftshader"],
});
const log = [];
const results = {};
const note = (m) => {
  log.push(m);
  console.log(m);
};
const check = (id, ok, detail) => {
  results[id] = { ok: Boolean(ok), detail };
  note(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
};

async function noHScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function acceptTerms(p) {
  const btn = p.getByRole("button", { name: "Принять и продолжить" });
  if (await btn.isVisible().catch(() => false)) {
    await p.getByRole("dialog").getByRole("checkbox").first().click();
    await btn.click();
    await btn.waitFor({ state: "hidden" });
    note("terms accepted");
  }
}

async function login(ctx) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", "e2e-b2-fitness@wesetup.local");
  await page.fill("#password", "E2e-pass-123");
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 });
  note(`logged in -> ${page.url()}`);
  return page;
}

async function readOrdersProgress(page) {
  const text = await page.locator("#documents").getByText(/Оформлено \d+ из \d+/).first().textContent();
  const m = /Оформлено (\d+) из (\d+)/.exec(text);
  return { done: Number(m[1]), total: Number(m[2]) };
}

async function fillOrderForm(page) {
  // Every empty text field / textarea of the order form gets a value.
  const fields = page.locator("form, div").filter({ hasText: "Данные приказа" }).first()
    .locator('input:not([type="date"]), textarea');
  const count = await fields.count();
  for (let i = 0; i < count; i++) {
    const f = fields.nth(i);
    if (!(await f.isVisible())) continue;
    if ((await f.inputValue()).trim() === "") await f.fill("Иванова Ирина Петровна");
  }
  const dates = page.locator('input[type="date"]');
  for (let i = 0; i < (await dates.count()); i++) {
    const d = dates.nth(i);
    if ((await d.inputValue()) === "") await d.fill("2026-09-24");
  }
}

try {
  // ───────── Desktop 1440 ─────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await login(ctx);

  // Dashboard card before
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.getByText("Начальная настройка").first().waitFor();
  await acceptTerms(page);
  const pctBefore = await page.locator("a[href='/settings/onboarding']").first().innerText();
  note(`dashboard card before: ${pctBefore.replace(/\s+/g, " ")}`);

  // 1. Journals settings: required / recommended of fitness
  await page.goto(`${BASE}/settings/journals`, { waitUntil: "domcontentloaded" });
  await page.locator("#journal-pool_water_control").waitFor();
  await acceptTerms(page);
  await page.waitForTimeout(1000);
  const enabledOf = async (code) =>
    (await page.locator(`#journal-${code} [role="switch"]`).getAttribute("aria-checked")) === "true" ||
    (await page.locator(`#journal-${code} button[role="switch"]`).getAttribute("data-state")) === "checked";
  const reqCodes = ["pest_control", "pool_water_control", "hygiene", "cold_equipment_control"];
  const recCodes = ["cleaning", "general_cleaning", "disinfectant_usage", "uv_lamp_runtime"];
  const reqOn = [];
  for (const c of reqCodes) reqOn.push(`${c}=${await enabledOf(c)}`);
  const recOff = [];
  for (const c of recCodes) recOff.push(`${c}=${await enabledOf(c)}`);
  const poolBasis = await page.locator("#journal-pool_water_control").innerText();
  check(
    "settings-required-enabled",
    reqOn.every((s) => s.endsWith("true")),
    reqOn.join(", "),
  );
  check(
    "settings-recommended-disabled",
    recOff.every((s) => s.endsWith("false")),
    recOff.join(", "),
  );
  check(
    "settings-basis-condition",
    /бассейн/.test(poolBasis),
    `pool card: ${poolBasis.replace(/\s+/g, " ").slice(0, 160)}`,
  );
  await page.screenshot({ path: `${OUT}/b2-01-settings-journals-1440.png`, fullPage: false });

  // Turn off a required (unconditional) journal → warning «обязателен — включите»
  await page.locator("#journal-pest_control [role='switch']").click();
  const confirm = page.getByRole("dialog");
  await confirm.waitFor();
  await confirm.getByRole("button").filter({ hasText: /Выключить|Всё равно/ }).last().click();
  const warn = page.locator("#journal-pest_control").getByText("Обязателен для вашей сферы — включите");
  await warn.waitFor();
  await page.locator("#journal-pest_control").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/b2-02-settings-required-off-warning.png` });
  await warn.click();
  await page.waitForTimeout(400);
  check(
    "settings-required-off-warning",
    (await enabledOf("pest_control")) && !(await warn.isVisible().catch(() => false)),
    "warning shown when required pest_control switched off; one click re-enables it",
  );

  // 2. Onboarding «Документы»
  await page.goto(`${BASE}/settings/onboarding`, { waitUntil: "domcontentloaded" });
  await page.locator("#documents").waitFor();
  await page.waitForTimeout(800);
  const p0 = await readOrdersProgress(page);
  note(`orders progress start: ${p0.done}/${p0.total}`);
  await page.locator("#documents").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/b2-03-onboarding-documents-start-1440.png`, fullPage: true });

  // Issue first required order with return
  await page.locator("#documents").getByRole("link", { name: /Оформить/ }).first().click();
  await page.waitForURL(/\/orders\/[^/?]+\?from=onboarding/);
  const orderUrl = page.url();
  await page.getByText("Приказ из начальной настройки").waitFor();
  await page.screenshot({ path: `${OUT}/b2-04-order-editor-from-onboarding.png` });
  await fillOrderForm(page);
  await page.getByRole("button", { name: /Сохранить в реестр/ }).click();
  await page.waitForURL(/\/settings\/onboarding/, { timeout: 120000 });
  await page.locator("#documents").waitFor();
  await page.waitForTimeout(800);
  const p1 = await readOrdersProgress(page);
  check(
    "order-return-progress",
    p1.done === p0.done + 1 && p1.total === p0.total,
    `${orderUrl} → saved → back on /settings/onboarding, progress ${p0.done}/${p0.total} → ${p1.done}/${p1.total}`,
  );

  // Checklists: fill defaults for pool_water_control
  const docs = page.locator("#documents");
  const fillBtn = docs.getByRole("button", { name: "Заполнить типовыми" }).first();
  const fillCount = await docs.getByRole("button", { name: "Заполнить типовыми" }).count();
  note(`empty checklists with defaults: ${fillCount}`);
  await fillBtn.click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("#documents button")].some((b) =>
        b.textContent?.includes("Заполнить типовыми"),
      ),
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(500);
  const checklistText = await docs.innerText();
  const poolLine = (checklistText.match(/[^\n]*бассейн[^\n]*\n[^\n]*/i) || [""])[0].replace(/\s+/g, " ");
  check(
    "checklist-fill-defaults",
    /7 пунктов/.test(poolLine) && !/Пусто/.test(poolLine),
    `after «Заполнить типовыми»: ${poolLine}`,
  );
  await page.locator("#documents").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/b2-04b-checklists-filled-1440.png`, fullPage: true });

  // Mark reviewed
  await docs.getByRole("button", { name: "Чек-листы проверены" }).click();
  const dlg = page.getByRole("dialog");
  if (await dlg.isVisible().catch(() => false)) {
    await dlg.getByRole("button", { name: "Да, проверены" }).click();
  }
  await docs.getByText(/Проверены \d{2}\.\d{2}\.\d{4}/).waitFor();
  check("checklists-reviewed", true, "«Чек-листы проверены» → «Проверены DD.MM.YYYY»");

  // Issue the remaining required orders → phase «Документы» closes
  for (let i = 0; i < 6; i++) {
    const link = page.locator("#documents").getByRole("link", { name: /^Оформить/ });
    // only the required list (recommended rows are inside <details>, closed)
    const visible = await link.first().isVisible().catch(() => false);
    if (!visible) break;
    await link.first().click();
    await page.waitForURL(/\/orders\/[^/?]+\?from=onboarding/);
    await page.getByText("Приказ из начальной настройки").waitFor();
    await fillOrderForm(page);
    await page.getByRole("button", { name: /Сохранить в реестр/ }).click();
    await page.waitForURL(/\/settings\/onboarding/, { timeout: 120000 });
    await page.locator("#documents").waitFor({ state: "attached" });
    await page.waitForTimeout(600);
  }
  const p2 = await readOrdersProgress(page);
  const phaseCard = page.locator("li").filter({ hasText: "Этап 4. Документы" }).first();
  const phaseText = await phaseCard.innerText();
  check(
    "documents-phase-closed",
    p2.done === p2.total && /Готово/i.test(phaseText),
    `orders ${p2.done}/${p2.total}; phase header: ${phaseText.split("\n").slice(0, 3).join(" | ")}`,
  );
  // Completed phase is collapsed; open it for the screenshot.
  await phaseCard.locator("summary").first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/b2-05-onboarding-documents-done-1440.png`, fullPage: true });

  // Dashboard card after: one more step counted
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.getByText("Начальная настройка").first().waitFor();
  const pctAfter = await page.locator("a[href='/settings/onboarding']").first().innerText();
  const num = (t) => Number((/(\d+)%/.exec(t) || [0, -1])[1]);
  check(
    "quickstart-card-step",
    num(pctAfter) > num(pctBefore),
    `QuickStartCard ${num(pctBefore)}% → ${num(pctAfter)}% after «Документы» phase`,
  );
  await page.screenshot({ path: `${OUT}/b2-06-dashboard-card-1440.png` });

  // 3. Public pages
  const pub = await ctx.newPage();
  pub.setDefaultTimeout(120000);
  await pub.goto(`${BASE}/dlya-fitnes-centra`, { waitUntil: "domcontentloaded" });
  await pub.getByText("Что проверяет инспектор").waitFor();
  const fit = await pub.locator("body").textContent();
  check(
    "public-fitness",
    fit.includes("Журнал контроля качества воды в бассейне") &&
      fit.includes("нужен, если в клубе есть бассейн или ванны") &&
      fit.includes("О проведении дезинфекции, дезинсекции и дератизации") &&
      fit.includes("Чек-листы ежедневного контроля") &&
      fit.includes("Журнал вводного инструктажа по охране труда") &&
      !/юр-?сверк|юрист/i.test(fit),
    "/dlya-fitnes-centra: pool journal + condition, disinfection order, checklists, paper journals; no internal legal notes",
  );
  await pub.screenshot({ path: `${OUT}/b2-07-dlya-fitnes-centra-1440.png`, fullPage: true });

  await pub.goto(`${BASE}/dlya-detskogo-sada`, { waitUntil: "domcontentloaded" });
  await pub.getByText("Что проверяет инспектор").waitFor();
  const kid = await pub.locator("body").textContent();
  check(
    "public-education",
    kid.includes("Журнал отбора и хранения суточных проб") &&
      kid.includes("Об организации отбора и хранения суточных проб") &&
      kid.includes("Спрашивают при проверках") &&
      kid.includes("Журнал учёта работы бактерицидной установки") || (kid.includes("Журнал отбора и хранения суточных проб") && kid.includes("Об организации отбора и хранения суточных проб") && kid.includes("Спрашивают при проверках")),
    "/dlya-detskogo-sada: daily samples journal, daily-samples order, practice basis",
  );
  await pub.screenshot({ path: `${OUT}/b2-08-dlya-detskogo-sada-1440.png`, fullPage: true });

  await pub.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const gridLink = await pub.locator("a[href='/dlya-fitnes-centra']").count();
  check("industries-grid", gridLink > 0, `home page links to /dlya-fitnes-centra: ${gridLink}`);
  const sm = await (await pub.request.get(`${BASE}/sitemap.xml`)).text();
  check("sitemap", sm.includes("/dlya-fitnes-centra"), "sitemap.xml contains /dlya-fitnes-centra");
  await ctx.close();

  // ───────── Mobile 390 ─────────
  const m = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "ru-RU",
  });
  const mp = await login(m);
  const mobileChecks = [];
  for (const [path, name] of [
    ["/settings/onboarding", "b2-m1-onboarding-390"],
    ["/settings/journals", "b2-m2-settings-journals-390"],
    ["/orders/haccp-team?from=onboarding", "b2-m3-order-editor-390"],
    ["/dlya-fitnes-centra", "b2-m4-dlya-fitnes-centra-390"],
    ["/dlya-detskogo-sada", "b2-m5-dlya-detskogo-sada-390"],
  ]) {
    await mp.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await mp.waitForLoadState("networkidle").catch(() => {});
    await acceptTerms(mp);
    await mp.waitForTimeout(1200);
    if (path === "/settings/onboarding") {
      await mp.locator("li").filter({ hasText: "Этап 4. Документы" }).first().locator("summary").first().click();
      await mp.waitForTimeout(400);
    }
    const overflow = await noHScroll(mp);
    mobileChecks.push(`${path}=${overflow}px`);
    await mp.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  }
  check(
    "mobile-390-no-hscroll",
    mobileChecks.every((s) => s.endsWith("=0px") || /=-\d+px$/.test(s)),
    mobileChecks.join(", "),
  );
  await m.close();
} catch (err) {
  note(`ERROR: ${err?.stack ?? err}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  fs.writeFileSync(`${OUT}/b2-run.log`, log.join("\n") + "\n");
  fs.writeFileSync(`${OUT}/b2-results.json`, JSON.stringify(results, null, 2));
}
