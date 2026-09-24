// e2e beauty-and-journals: 4 новых реестра (выключены у старой организации,
// включаются, создаются, заполняются, печать PDF), анкета со сферой «Салон
// красоты», «Заполнить типовыми» с учётом сферы, публичная /dlya-salona-krasoty.
// Запуск: CHROME_EXE=... node bj-e2e.mjs <outDir>   (сервер на :3034)
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3034";
const OUT = process.argv[2];
const PASSWORD = "E2e-pass-123";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXE,
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
const NEW_CODES = ["inventory_condition", "instrument_sterilization", "medical_waste_b", "batch_release"];

/** Значения для строки реестра: text/number/date/select по коду журнала. */
const ROWS = {
  inventory_condition: {
    date: "2026-09-24", zone: "Холодный цех", item: "Доска разделочная СО",
    material: "Пластик", condition: "Изъят из работы", action: "Трещина — заменена", responsible: "Ольга Старожилова",
  },
  instrument_sterilization: {
    date: "2026-09-24", instruments: "Кусачки — 3 шт.", method: "Воздушный (сухожар)",
    mode: "180 °C, 60 мин", indicator: "Да", sterilizer: "Сухожар ГП-20", responsible: "Ольга Старожилова",
  },
  medical_waste_b: {
    date: "2026-09-24", wasteType: "Ватные диски, перчатки", amount: "0.6", disinfection: "Дезраствор, 60 мин",
    packaging: "Жёлтый пакет", handedTo: "ООО Вывоз, акт 1", responsible: "Ольга Старожилова",
  },
  batch_release: {
    date: "2026-09-24", product: "Хлеб пшеничный", batch: "240926-01", quantity: "320 шт.",
    checks: "Органолептика, маркировка, упаковка — норма", decision: "Допущено", responsible: "Ольга Старожилова",
  },
};

async function noHScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function acceptTerms(p) {
  const btn = p.getByRole("button", { name: "Принять и продолжить" });
  if (await btn.isVisible().catch(() => false)) {
    // Условия — отдельный диалог; анкета может быть открыта одновременно.
    await p.getByRole("dialog").filter({ has: btn }).getByRole("checkbox").first().click();
    await btn.click();
    await btn.waitFor({ state: "hidden" });
    note("terms accepted");
  }
}

async function login(ctx, email) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 });
  note(`logged in ${email} -> ${page.url()}`);
  return page;
}

/** Подсказка «как заполнять» открывается сама при первом визите журнала — закрываем. */
async function closeGuide(page) {
  const guide = page.locator('[aria-labelledby="fill-guide-title"]');
  await page.waitForTimeout(1200);
  if (await guide.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await guide.waitFor({ state: "hidden" }).catch(() => {});
    note("fill guide closed");
  }
}

async function waitVisible(locator, timeout = 60000) {
  try {
    await locator.waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

const switchOf = (page, code) => page.locator(`#journal-${code} [role="switch"]`).first();
async function enabledOf(page, code) {
  const sw = switchOf(page, code);
  return (await sw.getAttribute("aria-checked")) === "true" || (await sw.getAttribute("data-state")) === "checked";
}

async function fillDefaultsApi(page, code) {
  return page.evaluate(async (c) => {
    const res = await fetch("/api/settings/onboarding/checklists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "fill-defaults", code: c }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, code);
}

try {
  // ───────── 1. Старая организация: новые журналы выключены → включить → реестр ─────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await login(ctx, "e2e-bj-legacy@wesetup.local");
  await page.goto(`${BASE}/settings/journals`, { waitUntil: "domcontentloaded" });
  await page.locator(`#journal-${NEW_CODES[0]}`).waitFor();
  await acceptTerms(page);
  await page.waitForTimeout(1000);
  const before = [];
  for (const code of NEW_CODES) before.push(`${code}=${await enabledOf(page, code)}`);
  check("legacy-new-codes-off", before.every((s) => s.endsWith("false")), before.join(", "));
  await page.locator(`#journal-${NEW_CODES[0]}`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/bj-01-legacy-settings-new-off-1440.png` });

  for (const code of NEW_CODES) {
    await switchOf(page, code).click();
    const dlg = page.getByRole("dialog");
    if (await dlg.isVisible().catch(() => false)) {
      await dlg.getByRole("button").filter({ hasText: /Включить|Да/ }).last().click();
    }
    await page.waitForTimeout(300);
  }
  // Сохранение настроек — с задержкой 600 мс после последнего переключения.
  await page.waitForResponse((r) => r.url().includes("/api/settings/journals") && r.request().method() !== "GET", { timeout: 30000 }).catch(() => note("no settings save response seen"));
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(`#journal-${NEW_CODES[0]}`).waitFor();
  await page.waitForTimeout(800);
  const after = [];
  for (const code of NEW_CODES) after.push(`${code}=${await enabledOf(page, code)}`);
  check("legacy-new-codes-enable", after.every((s) => s.endsWith("true")), `after switching on + reload: ${after.join(", ")}`);

  for (const code of NEW_CODES) {
    await page.goto(`${BASE}/journals/${code}`, { waitUntil: "domcontentloaded" });
    await acceptTerms(page);
    await closeGuide(page);
    await page.getByRole("button", { name: /Создать документ/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Создание документа" });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: /^Создать$/ }).click();
    await page.waitForURL(/\/documents\/[^/]+/, { timeout: 120000 });
    const docId = /\/documents\/([^/?#]+)/.exec(page.url())[1];
    await closeGuide(page);
    await page.getByRole("button", { name: /^Добавить$/ }).first().click();
    const rowDialog = page.getByRole("dialog", { name: /Новая запись/ });
    await rowDialog.getByText("Новая запись").waitFor();
    for (const [key, value] of Object.entries(ROWS[code])) {
      const field = rowDialog.locator(`#register-field-${key}`);
      const role = await field.getAttribute("role");
      const tag = await field.evaluate((el) => el.tagName.toLowerCase());
      if (role === "combobox" || tag === "button") {
        await field.click();
        await page.getByRole("option", { name: value, exact: true }).click();
      } else {
        await field.fill(value);
      }
    }
    await rowDialog.getByRole("button", { name: "Добавить запись" }).click();
    await rowDialog.waitFor({ state: "hidden" });
    const titleKey = { inventory_condition: "item", instrument_sterilization: "instruments", medical_waste_b: "wasteType", batch_release: "product" }[code];
    const titleValue = ROWS[code][titleKey];
    await page.getByText(titleValue).first().waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await closeGuide(page);
    const persisted = await waitVisible(page.getByText(titleValue).first());
    const selectValue = code === "batch_release" ? "Допущено" : code === "inventory_condition" ? "Изъят из работы" : code === "medical_waste_b" ? "Жёлтый пакет" : "Воздушный (сухожар)";
    const selectShown = await page.getByText(selectValue).first().isVisible().catch(() => false);
    const pdf = await page.request.get(`${BASE}/api/journal-documents/${docId}/pdf`);
    const pdfBody = await pdf.body();
    check(
      `register-${code}`,
      persisted && selectShown && pdf.status() === 200 && /pdf/.test(pdf.headers()["content-type"] ?? "") && pdfBody.length > 1000,
      `doc ${docId}: row «${titleValue}» persisted after reload=${persisted}, select «${selectValue}» shown=${selectShown}; PDF ${pdf.status()} ${pdf.headers()["content-type"]} ${pdfBody.length} bytes`,
    );
    if (code === "instrument_sterilization") fs.writeFileSync(`${OUT}/bj-instrument_sterilization.pdf`, pdfBody);
    await page.screenshot({ path: `${OUT}/bj-02-register-${code}-1440.png` });
  }

  // Публичные описания новых журналов
  const pub = await ctx.newPage();
  pub.setDefaultTimeout(120000);
  const infoResults = [];
  for (const code of NEW_CODES) {
    const res = await pub.goto(`${BASE}/journals-info/${code}`, { waitUntil: "domcontentloaded" });
    const text = await pub.locator("body").textContent();
    const sample = await pub.request.get(`${BASE}/journal-samples/${code}.webp`);
    infoResults.push({ code, status: res.status(), hasName: /Журнал/.test(text), legal: /юрист|юр-сверк/i.test(text), sample: sample.status() });
  }
  await pub.goto(`${BASE}/journals-info/instrument_sterilization`, { waitUntil: "domcontentloaded" });
  await pub.screenshot({ path: `${OUT}/bj-03-journals-info-sterilization-1440.png`, fullPage: true });
  await pub.goto(`${BASE}/journals-info`, { waitUntil: "domcontentloaded" });
  // Каталог показывает карточки по коду со ссылкой на описание.
  const inCatalog = [];
  for (const code of NEW_CODES) {
    if ((await pub.locator(`a[href='/journals-info/${code}']`).count()) > 0) inCatalog.push(code);
  }
  check(
    "journals-info-pages",
    infoResults.every((r) => r.status === 200 && r.hasName && !r.legal && r.sample === 200) && inCatalog.length === 4,
    `${JSON.stringify(infoResults)}; /journals-info lists ${inCatalog.length}/4`,
  );

  // ───────── 2. Публичная страница салона, сетка, sitemap ─────────
  await pub.goto(`${BASE}/dlya-salona-krasoty`, { waitUntil: "domcontentloaded" });
  await pub.getByText("Что проверяет инспектор").waitFor();
  const beautyText = await pub.locator("body").textContent();
  const want = [
    "Журнал контроля стерилизации инструментов",
    "СанПиН 2.1.3678-20",
    "нужен, если в салоне есть косметология или инъекционные процедуры",
    "Требование санитарных правил",
    "О проведении дезинфекции, дезинсекции и дератизации",
    "Чек-листы ежедневного контроля",
    "После клиента уберите одноразовые материалы",
    "Журнал вводного инструктажа по охране труда",
  ];
  const missing = want.filter((w) => !beautyText.includes(w));
  check(
    "public-beauty",
    missing.length === 0 && !/юр-?сверк|юрист/i.test(beautyText) && !/солонк/i.test(beautyText),
    missing.length ? `missing: ${missing.join(" | ")}` : "sterilization + basis + law, waste condition, disinfection order, beauty checklist example, paper journals; no internal legal notes",
  );
  await pub.screenshot({ path: `${OUT}/bj-04-dlya-salona-krasoty-1440.png`, fullPage: true });
  await pub.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const gridLinks = await pub.locator("a[href='/dlya-salona-krasoty']").count();
  const groupTitle = await pub.getByText("Красота и уход").count();
  check("industries-grid", gridLinks > 0 && groupTitle > 0, `home: links to /dlya-salona-krasoty=${gridLinks}, group «Красота и уход»=${groupTitle}`);
  await pub.getByText("Красота и уход").first().scrollIntoViewIfNeeded();
  await pub.screenshot({ path: `${OUT}/bj-05-home-industries-grid-1440.png` });
  const sm = await (await pub.request.get(`${BASE}/sitemap.xml`)).text();
  check("sitemap", sm.includes("/dlya-salona-krasoty"), "sitemap.xml contains /dlya-salona-krasoty");
  await ctx.close();

  // ───────── 3. Анкета: сфера «Салон красоты» ─────────
  const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const bp = await login(bctx, "e2e-bj-beauty@wesetup.local");
  await bp.goto(`${BASE}/dashboard?welcome=1`, { waitUntil: "domcontentloaded" });
  await acceptTerms(bp);
  const form = bp.locator("#complete-profile-form");
  await form.waitFor();
  const sphereSelect = form.locator("select").first();
  const options = await sphereSelect.locator("option").allTextContents();
  await form.locator('input[placeholder="ООО «Ромашка»"]').fill("Салон «Ножницы»");
  await form.locator('input[aria-required]').nth(1).fill("+7 999 123-45-67");
  await sphereSelect.selectOption("beauty");
  // Пароль в анкете подставляется сам и после сохранения меняется — ставим свой.
  const pwd = form.getByLabel(/Пароль/).first();
  if (await pwd.isVisible().catch(() => false)) await pwd.fill(PASSWORD);
  await bp.screenshot({ path: `${OUT}/bj-06-anketa-beauty-1440.png` });
  const saveResp = bp.waitForResponse((r) => r.url().includes("/api/profile/complete"));
  await bp.getByRole("button", { name: /^Готово/ }).last().click();
  const saved = await saveResp;
  check(
    "anketa-beauty",
    options.includes("Салон красоты / Барбершоп / Маникюр") && saved.status() === 200,
    `sphere options include «Салон красоты / Барбершоп / Маникюр»=${options.includes("Салон красоты / Барбершоп / Маникюр")}; /api/profile/complete → ${saved.status()}`,
  );
  await bp.waitForTimeout(1500);

  await bp.goto(`${BASE}/settings/journals`, { waitUntil: "domcontentloaded" });
  await bp.locator("#journal-instrument_sterilization").waitFor();
  await acceptTerms(bp);
  await bp.waitForTimeout(1000);
  const req = ["instrument_sterilization", "general_cleaning", "disinfectant_usage", "medical_waste_b"];
  const rec = ["cleaning", "uv_lamp_runtime", "pest_control", "staff_training", "accident_journal", "complaint_register", "climate_control", "med_books"];
  const reqOn = [];
  for (const c of req) reqOn.push(`${c}=${await enabledOf(bp, c)}`);
  const recOff = [];
  for (const c of rec) recOff.push(`${c}=${await enabledOf(bp, c)}`);
  const foodOff = [];
  for (const c of ["hygiene", "cold_equipment_control"]) foodOff.push(`${c}=${await enabledOf(bp, c)}`);
  check("beauty-required-enabled", reqOn.every((s) => s.endsWith("true")), reqOn.join(", "));
  check("beauty-recommended-disabled", recOff.every((s) => s.endsWith("false")) && foodOff.every((s) => s.endsWith("false")), `${recOff.join(", ")}; food: ${foodOff.join(", ")}`);
  const wasteCard = (await bp.locator("#journal-medical_waste_b").innerText()).replace(/\s+/g, " ");
  check("beauty-waste-condition", /косметолог/.test(wasteCard), `medical_waste_b card: ${wasteCard.slice(0, 200)}`);
  await bp.locator("#journal-instrument_sterilization").scrollIntoViewIfNeeded();
  await bp.screenshot({ path: `${OUT}/bj-07-beauty-settings-journals-1440.png` });

  // Этап «Документы»: пример пункта и «Заполнить типовыми» (генеральная уборка салона)
  await bp.goto(`${BASE}/settings/onboarding`, { waitUntil: "domcontentloaded" });
  await bp.locator("#documents").waitFor();
  await acceptTerms(bp);
  await bp.waitForTimeout(800);
  const docsBefore = (await bp.locator("#documents").innerText()).replace(/\s+/g, " ");
  const ordersOk = /Оформлено 0 из 4/.test(docsBefore);
  await bp.locator("#documents").scrollIntoViewIfNeeded();
  await bp.screenshot({ path: `${OUT}/bj-08-beauty-onboarding-documents-1440.png`, fullPage: true });
  const fillBtns = bp.locator("#documents").getByRole("button", { name: "Заполнить типовыми" });
  const fillCount = await fillBtns.count();
  for (let left = fillCount; left > 0; left--) {
    await bp.locator("#documents").getByRole("button", { name: "Заполнить типовыми" }).first().click();
    // Ждём, пока строка перейдёт в «N пунктов» — иначе следующий клик попадёт в ту же.
    await bp.waitForFunction(
      (n) => [...document.querySelectorAll("#documents button")].filter((b) => b.textContent?.includes("Заполнить типовыми")).length < n,
      left,
      { timeout: 60000 },
    );
  }
  await bp.waitForTimeout(800);
  const docsAfter = (await bp.locator("#documents").innerText()).replace(/\s+/g, " ");
  check(
    "beauty-onboarding-documents",
    ordersOk && fillCount >= 2 && !/Заполнить типовыми/.test(docsAfter),
    `orders «Оформлено 0 из 4»=${ordersOk}; «Заполнить типовыми» clicked ${fillCount}×; after: ${docsAfter.slice(0, 260)}`,
  );
  await bp.screenshot({ path: `${OUT}/bj-09-beauty-checklists-filled-1440.png`, fullPage: true });
  // Уборка в салоне (журнал выключен, но набор сферы на сервере — проверяем API)
  const beautyCleaning = await fillDefaultsApi(bp, "cleaning");
  note(`beauty fill-defaults cleaning: ${JSON.stringify(beautyCleaning)}`);
  await bctx.close();

  // ───────── 4. «Заполнить типовыми» у фитнеса, отеля и ресторана ─────────
  for (const sphere of ["fitness", "hotel", "restaurant"]) {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const p = await login(c, `e2e-bj-${sphere}@wesetup.local`);
    await acceptTerms(p);
    const r = await fillDefaultsApi(p, "cleaning");
    const g = await fillDefaultsApi(p, "general_cleaning");
    note(`${sphere} fill-defaults: cleaning=${JSON.stringify(r)} general_cleaning=${JSON.stringify(g)}`);
    results[`fill-${sphere}`] = { ok: r.status === 200 && g.status === 200, detail: `cleaning ${r.status} created=${r.body?.created}; general_cleaning ${g.status} created=${g.body?.created}` };
    await c.close();
  }

  // ───────── 5. Телефон 390 ─────────
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
  const mp = await login(m, "e2e-bj-legacy@wesetup.local");
  const mobileChecks = [];
  const pages = [
    ["/dlya-salona-krasoty", "bj-m1-dlya-salona-krasoty-390"],
    ["/journals-info/instrument_sterilization", "bj-m2-journals-info-sterilization-390"],
    ["/journals/instrument_sterilization", "bj-m3-register-list-390"],
    ["/settings/journals", "bj-m4-legacy-settings-journals-390"],
    ["/", "bj-m5-home-390"],
  ];
  for (const [path, name] of pages) {
    await mp.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await mp.waitForLoadState("networkidle").catch(() => {});
    await acceptTerms(mp);
    await mp.waitForTimeout(1200);
    if (path === "/") await mp.getByText("Красота и уход").first().scrollIntoViewIfNeeded();
    const overflow = await noHScroll(mp);
    mobileChecks.push(`${path}=${overflow}px`);
    await mp.screenshot({ path: `${OUT}/${name}.png`, fullPage: path !== "/" });
  }
  // Документ реестра на телефоне
  await mp.goto(`${BASE}/journals/instrument_sterilization`, { waitUntil: "domcontentloaded" });
  const docLink = mp.locator("a[href*='/documents/']").first();
  if (await docLink.isVisible().catch(() => false)) {
    await docLink.click();
    await mp.waitForURL(/\/documents\//);
    await mp.waitForTimeout(1500);
    mobileChecks.push(`register-doc=${await noHScroll(mp)}px`);
    await mp.screenshot({ path: `${OUT}/bj-m6-register-doc-390.png`, fullPage: true });
  }
  check("mobile-390-no-hscroll", mobileChecks.every((s) => /=(0|-\d+)px$/.test(s)), mobileChecks.join(", "));
  await m.close();
} catch (err) {
  note(`ERROR: ${err?.stack ?? err}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  fs.writeFileSync(`${OUT}/bj-run.log`, log.join("\n") + "\n");
  fs.writeFileSync(`${OUT}/bj-results.json`, JSON.stringify(results, null, 2));
}
