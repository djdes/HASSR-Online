// ТЗ2 на локальном стенде (next start + Postgres, демо-организация): новый вид обзора ППК
// (готовность, фильтр, разделы, номера редакций, быстрые действия), «Прежний вид» с запоминанием,
// прокрутка при открытии окон пунктов, шапка при открытом меню объекта, мастер «Заполнить
// типовыми» по 4 сферам (компактность, сфера по умолчанию), сферы объекта с примерами.
// Запуск: node run.mjs <каталог снимков>   (BASE_URL — по умолчанию http://localhost:3000)
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "out-tz2";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await page.waitForTimeout(2500);
  await page.fill("#email", email);
  await page.fill("#password", "admin1234");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
}
async function acceptLegal(page) {
  const legal = page.locator('[data-testid="legal-update-modal"]');
  if (await legal.count()) {
    await legal.locator('input[type="checkbox"], [role="checkbox"]').first().click();
    await page.click('[data-testid="legal-update-accept"]');
    await legal.waitFor({ state: "detached", timeout: 30000 });
  }
}
async function overview(page) {
  await page.goto(`${BASE}/production-control`, { waitUntil: "networkidle", timeout: 120000 });
  await acceptLegal(page);
}
// Минимальный scrollY с момента вызова: ловит «сначала прокрутка вверх».
async function watchScroll(page) {
  await page.evaluate(() => {
    window.__minY = window.scrollY;
    window.__watch = true;
    const tick = () => {
      if (!window.__watch) return;
      window.__minY = Math.min(window.__minY, window.scrollY);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.addEventListener("scroll", () => (window.__minY = Math.min(window.__minY, window.scrollY)), { passive: true });
  });
}
const stopWatch = (page) => page.evaluate(() => { window.__watch = false; return window.__minY; });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await login(page, "admin@haccp.local");
await overview(page);
const api = context.request;

// ---------- Подготовка: объекты двух сфер (у демо-организации их нет) ----------
const list = await (await api.get(`${BASE}/api/settings/buildings`)).json().catch(() => ({}));
const buildings = (list.buildings ?? []).filter((b) => b.kind !== "office");
// Каждый прогон — свой пустой объект медицины: мастер видит пустой ППК.
const clinicName = `Клиника e2e ${new Date().toISOString().slice(11, 19)}`;
const clinicResponse = await api.post(`${BASE}/api/settings/buildings`, { data: { name: clinicName, sphere: "medical" } });
const clinic = (await clinicResponse.json().catch(() => ({}))).building;
check(`стенд: создан объект «${clinicName}» (медицина)`, clinicResponse.ok() && clinic?.id, String(clinicResponse.status()));
let cafe = buildings.find((b) => b.name === "Кафе «Ромашка»");
if (!cafe) {
  const r = await api.post(`${BASE}/api/settings/buildings`, { data: { name: "Кафе «Ромашка»", sphere: "food" } });
  cafe = (await r.json().catch(() => ({}))).building ?? null;
  console.log("второй объект:", r.status());
}

// ---------- Новый вид по умолчанию (организация) ----------
await overview(page);
check("AC6 новый вид по умолчанию", (await page.locator('[data-ppk-overview="new"]').count()) === 1);
check("AC6a «Готовность к проверке»", (await page.locator("[data-ppk-readiness]").count()) === 1,
  (await page.locator("[data-ppk-readiness]").innerText()).replace(/\s+/g, " ").slice(0, 220));
const percent = await page.locator("[data-ppk-readiness-percent]").innerText();
check("AC6a процент заполнения", /^\d{1,3}%$/.test(percent.trim()), percent);
check("AC6a три сигнала: редакции, ознакомление, пересмотр",
  (await page.locator("[data-ppk-readiness-docs]").count()) === 1 &&
  (await page.locator("[data-ppk-readiness-ack]").count()) === 1 &&
  (await page.locator("[data-ppk-readiness-review]").count()) === 1);
const docsTile = (await page.locator("[data-ppk-readiness-docs]").innerText()).replace(/\s+/g, " ");
check("AC6a редакции: ссылка на реестр", (await page.locator('[data-ppk-readiness-docs] a[href="/production-control/revisions"]').count()) === 1, docsTile);
const reviewTile = (await page.locator("[data-ppk-readiness-review]").innerText()).replace(/\s+/g, " ");
check("AC6a пересмотр: дата через 12 месяцев после версии", /\d{2}\.\d{2}\.\d{4}|не утверждена/.test(reviewTile), reviewTile);
check("AC6e «Скачать ППК (PDF)»", (await page.locator('[data-ppk-download-pdf][href="/api/production-control/program/pdf"]').count()) === 1);
const pdf = await api.get(`${BASE}/api/production-control/program/pdf`);
check("AC6e PDF скачивается", pdf.ok() && (pdf.headers()["content-type"] ?? "").includes("pdf"), `${pdf.status()} ${pdf.headers()["content-type"]}`);
check("AC6e «Пришла проверка»", (await page.locator('[data-ppk-inspection-link][href="/inspection"]').count()) === 1);
await shot(page, "01-new-view-top");

// Структура: 32 пункта, 4 раздела, фильтр с числами.
const items = page.locator("[data-ppk-structure-v2] [data-ppk-item]");
check("AC6 структура: 32 пункта", (await items.count()) === 32, String(await items.count()));
check("AC6c разделы: 4 ссылки с прогрессом", (await page.locator("[data-ppk-section-link]").count()) === 4,
  (await page.locator("nav[aria-label] [data-ppk-section-link]").allInnerTexts()).map((s) => s.replace(/\s+/g, " ")).join(" | "));
const statusOf = async (loc) => (await loc.locator('[role="img"]').getAttribute("aria-label").catch(() => null)) ?? "info";
const chipCount = async (value) => Number((await page.locator(`[data-ppk-filter="${value}"] span`).last().innerText()).trim());
const counts = { all: await chipCount("all"), empty: await chipCount("empty"), started: await chipCount("started"), done: await chipCount("done") };
check("AC6b фильтр: 4 кнопки с числами", counts.all === 32 && counts.empty + counts.started + counts.done <= 32, JSON.stringify(counts));
const label = { empty: "Пусто", started: "Начат", done: "Заполнен" };
for (const value of ["empty", "started", "done"]) {
  await page.click(`[data-ppk-filter="${value}"]`);
  await page.waitForTimeout(150);
  const shown = await items.count();
  let same = true;
  for (let i = 0; i < shown; i += 1) if ((await statusOf(items.nth(i))) !== label[value]) same = false;
  check(`AC6b фильтр «${value}»: ${shown} пунктов, все со статусом «${label[value]}»`, shown === counts[value] && same,
    shown === 0 ? (await page.locator("[data-ppk-structure-v2]").innerText()).includes("Таких пунктов нет") ? "пусто — «Таких пунктов нет»" : "пусто без текста" : "");
  if (value === "empty") await shot(page, "02-filter-empty");
}
await page.click('[data-ppk-filter="all"]');
await page.waitForTimeout(150);

// V1: кнопка раздела, скрытого фильтром, — сбрасывает фильтр, адрес без «#», окна потом открываются и закрываются.
{
  let hiddenKey = null;
  for (const value of ["started", "done", "empty"]) {
    await page.click(`[data-ppk-filter="${value}"]`);
    await page.waitForTimeout(150);
    const rendered = await page.locator("[data-ppk-section]").evaluateAll((els) => els.map((el) => el.getAttribute("data-ppk-section")));
    hiddenKey = ["primary", "plan", "prp", "appendix"].find((key) => !rendered.includes(key)) ?? null;
    if (hiddenKey) break;
  }
  if (hiddenKey) {
    await page.click(`[data-ppk-section-link="${hiddenKey}"]`);
    await page.waitForTimeout(800);
    const allChecked = await page.locator('[data-ppk-filter="all"]').getAttribute("aria-checked");
    const top = await page.locator(`[data-ppk-section="${hiddenKey}"]`).evaluate((el) => Math.round(el.getBoundingClientRect().top)).catch(() => null);
    check(`V1 раздел «${hiddenKey}», скрытый фильтром: фильтр сброшен, раздел у верха, адрес без #`,
      allChecked === "true" && top !== null && top >= 0 && top < 220 && !page.url().includes("#"), `all=${allChecked}, top=${top}, url=${page.url()}`);
    const historyState = await page.evaluate(() => history.state !== null);
    check("V1 запись истории — от роутера (state не null)", historyState);
    await page.locator('[data-ppk-item="1-1"]').scrollIntoViewIfNeeded();
    await page.click('[data-ppk-item="1-1"]');
    await page.waitForSelector("[data-ppk-item-dialog]", { timeout: 30000 });
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-ppk-item-dialog]", { state: "detached", timeout: 30000 });
    await page.waitForTimeout(500);
    await page.click('[data-ppk-item="1-1"]');
    const reopened = await page.waitForSelector("[data-ppk-item-dialog]", { timeout: 15000 }).then(() => true).catch(() => false);
    check("V1 после закрытия окно пункта открывается снова", reopened, new URL(page.url()).pathname);
    if (reopened) {
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-ppk-item-dialog]", { state: "detached", timeout: 30000 });
    }
  } else check("V1 раздел, скрытый фильтром", false, "фильтр не скрыл ни одного раздела");
  await page.click('[data-ppk-filter="all"]');
  await page.evaluate(() => window.scrollTo(0, 0));
}

// Номер редакции у пункта 1.9 (утверждена в прошлой проверке на этом стенде: «ППК 002»).
const badge19 = page.locator('[data-ppk-item="1-9"] [data-ppk-revision-badge]');
check("AC6d номер редакции у пункта 1.9", (await badge19.count()) === 1 && /ППК \d{3}|Не утверждена/.test(await badge19.innerText()), await badge19.innerText().catch(() => "нет"));

// Переход к разделу.
await page.click('[data-ppk-section-link="prp"]');
await page.waitForTimeout(700);
const prpTop = await page.locator('[data-ppk-section="prp"]').evaluate((el) => Math.round(el.getBoundingClientRect().top));
check("AC6c переход к разделу 3 — раздел у верха экрана", prpTop >= 0 && prpTop < 220, `top=${prpTop}`);
check("AC6c переход к разделу — без #якоря в адресе", !page.url().includes("#"), page.url());

// ---------- AC4: окно пункта без прокрутки вверх ----------
await page.evaluate(() => window.scrollTo(0, 0));
await page.locator('[data-ppk-item="2-6"]').scrollIntoViewIfNeeded();
await page.mouse.wheel(0, 200);
await page.waitForTimeout(500);
const before = await page.evaluate(() => Math.round(window.scrollY));
await watchScroll(page);
await page.click('[data-ppk-item="2-6"]');
await page.waitForSelector("[data-ppk-item-dialog]", { timeout: 30000 });
await page.waitForTimeout(800);
const minDuring = await stopWatch(page);
const afterOpen = await page.evaluate(() => Math.round(window.scrollY));
check("AC4 клик по пункту: страница не прокручивается вверх", before > 300 && minDuring >= before - 2 && Math.abs(afterOpen - before) <= 2, `до=${before}, минимум=${Math.round(minDuring)}, после=${afterOpen}`);
const headerTopDialog = await page.evaluate(() => Math.round(document.querySelector("header")?.getBoundingClientRect().top ?? -999));
check("AC5 окно пункта открыто — шапка на месте", headerTopDialog === 0, `top=${headerTopDialog}`);
await shot(page, "03-item-dialog-scrolled");
await watchScroll(page);
await page.keyboard.press("Escape");
await page.waitForSelector("[data-ppk-item-dialog]", { state: "detached", timeout: 30000 });
await page.waitForTimeout(800);
const minClose = await stopWatch(page);
const afterClose = await page.evaluate(() => Math.round(window.scrollY));
check("AC4 закрытие окна: страница на прежнем месте", Math.abs(afterClose - before) <= 2 && minClose >= before - 2, `после=${afterClose}, минимум=${Math.round(minClose)}`);

// «Следующий пункт».
const nextLink = page.locator("[data-ppk-next-item] a");
if (await nextLink.count()) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await nextLink.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 120));
  await page.waitForTimeout(300);
  const y0 = await page.evaluate(() => Math.round(window.scrollY));
  await watchScroll(page);
  await nextLink.click();
  await page.waitForSelector("[data-ppk-item-dialog]", { timeout: 30000 });
  await page.waitForTimeout(800);
  const yMin = await stopWatch(page);
  check("AC4 «Следующий пункт»: без прокрутки вверх", yMin >= y0 - 2, `до=${y0}, минимум=${Math.round(yMin)}`);
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-ppk-item-dialog]", { state: "detached", timeout: 30000 });
} else check("AC4 «Следующий пункт»", false, "нет блока");

// Из окна в окно: 2.7 → «К анализу» (2.6) — страница под окнами стоит на месте.
await page.evaluate(() => window.scrollTo(0, 0));
await page.locator('[data-ppk-item="2-7"]').scrollIntoViewIfNeeded();
await page.mouse.wheel(0, 200);
await page.waitForTimeout(400);
const y27 = await page.evaluate(() => Math.round(window.scrollY));
await page.click('[data-ppk-item="2-7"]');
await page.waitForSelector("[data-ppk-item-dialog]", { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector("[data-ppk-item-skeleton]"), null, { timeout: 60000 });
const toAnalysis = page.locator('[data-ppk-item-dialog] a[href="/production-control/item/2-6"]').first();
if (await toAnalysis.count()) {
  await watchScroll(page);
  await toAnalysis.click();
  await page.waitForURL((u) => u.pathname.endsWith("/item/2-6"), { timeout: 30000 });
  await page.waitForSelector("[data-ppk-item-dialog]", { timeout: 30000 });
  await page.waitForTimeout(800);
  const yMinSwitch = await stopWatch(page);
  check("AC4 из окна в окно (2.7 → 2.6): страница не прокручивается", yMinSwitch >= y27 - 2, `до=${y27}, минимум=${Math.round(yMinSwitch)}`);
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-ppk-item-dialog]", { state: "detached", timeout: 30000 });
  await page.waitForTimeout(600);
  const yBack = await page.evaluate(() => Math.round(window.scrollY));
  check("AC4 закрытие после перехода: обзор на прежнем месте", Math.abs(yBack - y27) <= 2 && new URL(page.url()).pathname === "/production-control", `y=${yBack}, ${new URL(page.url()).pathname}`);
} else {
  check("AC4 из окна в окно", false, "в окне 2.7 нет ссылки на 2.6");
  await page.keyboard.press("Escape");
}

// ---------- AC5: меню объекта на прокрученной странице ----------
await page.evaluate(() => window.scrollTo(0, 0));
await page.mouse.move(720, 500);
await page.mouse.wheel(0, 1400);
await page.waitForTimeout(800);
const switcher = page.locator('[data-current-point]:not([data-current-point="all"]):not([data-current-point="single"])').first();
if (await switcher.count()) {
  const yScrolled = await page.evaluate(() => Math.round(window.scrollY));
  await switcher.click();
  await page.waitForSelector("[data-point-menu]", { timeout: 15000 });
  await page.waitForTimeout(500);
  const box = await page.evaluate(() => {
    const h = document.querySelector("header")?.getBoundingClientRect();
    const m = document.querySelector("[data-point-menu]")?.getBoundingClientRect();
    return { headerTop: h ? Math.round(h.top) : null, menuTop: m ? Math.round(m.top) : null, menuBottom: m ? Math.round(m.bottom) : null, y: Math.round(window.scrollY), vh: window.innerHeight };
  });
  check("AC5 меню объекта открыто на прокрученной странице: шапка и меню на экране",
    yScrolled > 300 && box.headerTop === 0 && box.menuTop !== null && box.menuTop >= 0 && box.menuBottom <= box.vh, JSON.stringify(box));
  await shot(page, "04-point-menu-scrolled");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
} else check("AC5 меню объекта", false, "в шапке нет переключателя объекта с меню");

// ---------- AC1/AC2: мастер «Заполнить типовыми» на объекте «медицина» ----------
async function choosePoint(id) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("[data-current-point]").first().click();
  await page.waitForSelector("[data-point-menu]", { timeout: 15000 });
  await Promise.all([
    page.waitForResponse((r) => r.request().method() !== "GET", { timeout: 30000 }).catch(() => null),
    page.click(`[data-point-menu] [data-point-option="${id}"]`),
  ]);
  await page.waitForTimeout(2500);
  await overview(page);
}
if (clinic?.id) {
  await choosePoint(clinic.id);
  const card = page.locator("[data-ppk-starter]");
  check("AC1 карточка «Заполнить типовыми» на пустом ППК объекта", (await card.count()) === 1);
  if (await card.count()) {
    const h = await card.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    check("AC2 карточка — одна строка (≤ 72 px)", h <= 72, `${h}px`);
    await shot(page, "05-starter-card");
    await card.locator("button").click();
    const dlg = page.locator("[data-ppk-starter-dialog]");
    await dlg.waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    check("AC1 окно: 4 сферы", (await dlg.locator("[data-starter-sphere]").count()) === 4,
      (await dlg.locator("[data-starter-sphere]").allInnerTexts()).map((s) => s.split("\n")[0]).join(" | "));
    const checked = await dlg.locator('[data-starter-sphere][aria-checked="true"]').getAttribute("data-starter-sphere");
    check("AC1 по умолчанию — сфера объекта (медицина)", checked === "medical", String(checked));
    check("AC1 у медицины нет выбора вида общепита", (await dlg.locator("[data-starter-kind]").count()) === 0);
    const summaryMed = (await dlg.locator("[data-starter-summary]").innerText()).replace(/\s+/g, " ");
    check("AC1 медицина: план лаборатории, дезинсекции, нормативы — без продукции и опасностей",
      /лаборатор/i.test(summaryMed) && /дезинсекц/i.test(summaryMed) && /норматив/i.test(summaryMed) && !/продукт|опасност/i.test(summaryMed), summaryMed);
    const scroller = await dlg.evaluate((el) => {
      const inner = el.querySelector(".overflow-y-auto");
      return { box: Math.round(el.getBoundingClientRect().height), inner: inner ? inner.scrollHeight - inner.clientHeight : -1 };
    });
    check("AC2 окно без прокрутки на 1440×900", scroller.inner <= 1 && scroller.box <= 900, JSON.stringify(scroller));
    await shot(page, "06-starter-dialog-medical");
    await dlg.locator('[data-starter-sphere="food"]').click();
    await page.waitForTimeout(200);
    check("AC1 общепит: 4 вида заведения", (await dlg.locator("[data-starter-kind]").count()) === 4,
      (await dlg.locator("[data-starter-kind]").allInnerTexts()).join(" | "));
    const summaryFood = (await dlg.locator("[data-starter-summary]").innerText()).replace(/\s+/g, " ");
    check("AC1 общепит: продукция, опасности, блок-схемы", /продукт/i.test(summaryFood) && /опасност/i.test(summaryFood), summaryFood);
    const foodScroll = await dlg.evaluate((el) => { const i = el.querySelector(".overflow-y-auto"); return i ? i.scrollHeight - i.clientHeight : -1; });
    check("AC2 окно общепита без прокрутки на 1440×900", foodScroll <= 1, `лишнее=${foodScroll}px`);
    await shot(page, "07-starter-dialog-food");
    await dlg.locator('[data-starter-sphere="medical"]').click();
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/production-control/starter") && r.request().method() === "POST", { timeout: 60000 }),
      dlg.locator("[data-starter-fill]").click(),
    ]);
    const body = await resp.json().catch(() => ({}));
    check("AC1 заполнение медицины: только план лаборатории, дезинсекции и нормативы", resp.ok() &&
      body.created && Object.keys(body.created).every((k) => ["lab-plan", "pest-plan", "norms"].includes(k)) && (body.created.norms ?? 0) > 0,
      JSON.stringify(body.created ?? body));
    await page.waitForTimeout(1500);
    // Прежний запрос { kind } — по-прежнему общепит: добавляет только пустые блоки.
    const legacy = await api.post(`${BASE}/api/production-control/starter`, { data: { kind: "canteen" } });
    const legacyBody = await legacy.json().catch(() => ({}));
    check("AC1 прежний запрос { kind } работает, заполненные блоки не трогает", legacy.ok() &&
      !("lab-plan" in (legacyBody.created ?? {})) && !("norms" in (legacyBody.created ?? {})), `${legacy.status()} ${JSON.stringify(legacyBody.created ?? legacyBody)}`);
    const bad = await api.post(`${BASE}/api/production-control/starter`, { data: { sphere: "space" } });
    check("AC1 неизвестная сфера — 400", bad.status() === 400, String(bad.status()));
  }
} else check("AC1 мастер на объекте медицины", false, "объект не создан");

// ---------- AC3: сферы объекта — новое название и примеры ----------
if (clinic?.id) {
  await page.goto(`${BASE}/settings/buildings/${clinic.id}`, { waitUntil: "networkidle" });
  await page.locator("button:has(svg.lucide-pencil)").first().click();
  const select = page.locator("#point-sphere");
  await select.waitFor({ timeout: 15000 });
  const options = await select.locator("option").allInnerTexts();
  check("AC3 правка объекта: «Общественное питание и производство пищевой продукции»", options.includes("Общественное питание и производство пищевой продукции"), options.join(" | "));
  const ex1 = await page.locator("[data-object-category-examples]").innerText();
  check("AC3 правка объекта: примеры медицины", /Многопрофильные медицинские центры, стоматология/.test(ex1), ex1);
  await select.selectOption("consumer");
  const ex2 = await page.locator("[data-object-category-examples]").innerText();
  check("AC3 примеры меняются вместе со сферой", /тату-салоны/.test(ex2) && /маникюрные/.test(ex2), ex2);
  await shot(page, "08-object-edit-examples");
  await page.keyboard.press("Escape");
}
await page.goto(`${BASE}/settings/buildings/new`, { waitUntil: "networkidle" });
const cards = await page.locator("[data-object-category]").allInnerTexts();
check("AC3 создание объекта: 4 сферы с примерами с листка", cards.length === 4 &&
  /Общественное питание и производство пищевой продукции/.test(cards[0]) && /комбинаты питания/.test(cards[0]) &&
  /стоматология/.test(cards[1]) && /барбершопы/.test(cards[2]) && /детские лагеря/.test(cards[3]), cards.map((c) => c.replace(/\s+/g, " ")).join(" | "));
await shot(page, "09-object-create-spheres");

// ---------- AC6: «Прежний вид» и обратно ----------
await overview(page);
await page.click('[data-ppk-view-toggle="new"]');
await page.waitForSelector('[data-ppk-overview="classic"]', { timeout: 30000 });
check("AC6 «Прежний вид»: прежняя страница (структура без фильтра, без «Готовности»)",
  (await page.locator("[data-ppk-structure]").count()) === 1 && (await page.locator("[data-ppk-structure-v2]").count()) === 0 &&
  (await page.locator("[data-ppk-readiness]").count()) === 0 && (await page.locator("[data-ppk-revisions-link]").count()) === 1);
await overview(page);
check("AC6 прежний вид запоминается (после перезагрузки)", (await page.locator('[data-ppk-overview="classic"]').count()) === 1);
await shot(page, "10-classic-view");
// Прокрутка и в прежнем виде.
await page.locator('[data-ppk-item="2-6"]').scrollIntoViewIfNeeded();
await page.mouse.wheel(0, 200);
await page.waitForTimeout(400);
const cBefore = await page.evaluate(() => Math.round(window.scrollY));
await watchScroll(page);
await page.click('[data-ppk-item="2-6"]');
await page.waitForSelector("[data-ppk-item-dialog]", { timeout: 30000 });
await page.waitForTimeout(800);
const cMin = await stopWatch(page);
check("AC4 прежний вид: клик по пункту без прокрутки вверх", cMin >= cBefore - 2, `до=${cBefore}, минимум=${Math.round(cMin)}`);
await page.keyboard.press("Escape");
await page.waitForSelector("[data-ppk-item-dialog]", { state: "detached", timeout: 30000 });
await page.evaluate(() => window.scrollTo(0, 0));
await page.click('[data-ppk-view-toggle="classic"]');
await page.waitForSelector('[data-ppk-overview="new"]', { timeout: 30000 });
check("AC6 «Новый вид» возвращает новый", true);

// ---------- Телефон: шторка мастера без горизонтальной прокрутки ----------
// Пустой ППК — у кафе: мастер на телефоне открывается со сферой «общепит».
if (cafe?.id) await api.post(`${BASE}/api/me/active-building`, { data: { buildingId: cafe.id } });
const phone = await browser.newContext({ ...require("/opt/node-tools/node_modules/playwright").devices["iPhone 13"], locale: "ru-RU" });
await phone.addCookies(await context.cookies());
const mp = await phone.newPage();
mp.on("pageerror", (error) => errors.push(`phone: ${error.message}`));
await mp.goto(`${BASE}/production-control`, { waitUntil: "networkidle", timeout: 120000 });
const phoneCard = mp.locator("[data-ppk-starter]");
if (await phoneCard.count()) {
  await phoneCard.locator("button").click();
  await mp.locator("[data-ppk-starter-dialog]").waitFor({ timeout: 15000 });
  await mp.waitForTimeout(500);
  const phoneDefault = await mp.locator('[data-ppk-starter-dialog] [data-starter-sphere][aria-checked="true"]').getAttribute("data-starter-sphere");
  check("AC1 кафе: по умолчанию — общепит", phoneDefault === "food", String(phoneDefault));
  const m = await mp.evaluate(() => {
    const d = document.querySelector("[data-ppk-starter-dialog]").getBoundingClientRect();
    return { docW: document.documentElement.scrollWidth, vw: window.innerWidth, left: Math.round(d.left), right: Math.round(d.right) };
  });
  check("AC2 телефон: окно мастера без горизонтальной прокрутки", m.docW <= m.vw && m.left >= 0 && m.right <= m.vw, JSON.stringify(m));
  await mp.screenshot({ path: `${OUT}/11-phone-starter.png` });
  await mp.keyboard.press("Escape");
} else {
  const w = await mp.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: window.innerWidth }));
  check("AC2 телефон: обзор без горизонтальной прокрутки (карточки мастера нет)", w.docW <= w.vw, JSON.stringify(w));
}
// V3: карточка мастера на телефоне — текст не в столбик, кнопка под ним.
await mp.goto(`${BASE}/production-control`, { waitUntil: "networkidle", timeout: 120000 });
const phoneCard2 = mp.locator("[data-ppk-starter]");
if (await phoneCard2.count()) {
  const m3 = await phoneCard2.evaluate((el) => ({ h: Math.round(el.getBoundingClientRect().height), text: Math.round(el.querySelector("p").getBoundingClientRect().width) }));
  check("V3 телефон: карточка мастера невысокая, текст во всю ширину", m3.h <= 160 && m3.text >= 220, JSON.stringify(m3));
  await phoneCard2.screenshot({ path: `${OUT}/15-phone-starter-card.png` });
}
const mw = await mp.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: window.innerWidth }));
check("телефон: новый вид обзора без горизонтальной прокрутки", mw.docW <= mw.vw, JSON.stringify(mw));
await mp.screenshot({ path: `${OUT}/12-phone-overview.png`, fullPage: true });
// V2: список объектов на телефоне — название объекта не сжимается в столбик.
await mp.goto(`${BASE}/settings/buildings`, { waitUntil: "networkidle", timeout: 120000 });
const rows = await mp.locator("[data-building-sphere]").evaluateAll((chips) =>
  chips.map((chip) => {
    const row = chip.parentElement;
    const name = row?.querySelector("h2");
    const pin = row?.querySelector("button");
    const nameBox = name?.getBoundingClientRect();
    const pinBox = pin?.getBoundingClientRect();
    return {
      sphere: chip.getAttribute("data-building-sphere"),
      name: nameBox ? Math.round(nameBox.width) : 0,
      chipH: Math.round(chip.getBoundingClientRect().height),
      // Скрепка не одна под сферой: в строке с названием или рядом со сферой.
      pinRow: pinBox ? pinBox.top < chip.getBoundingClientRect().bottom - 2 : null,
    };
  }),
);
const food = rows.filter((r) => r.sphere === "food");
check("V2 телефон: у объекта общепита название не в столбик, сфера не больше двух строк",
  food.length > 0 && food.every((r) => r.name >= 100 && r.chipH <= 48), JSON.stringify(rows.slice(0, 4)));
check("V10 телефон: скрепка не остаётся одна под сферой", rows.length > 0 && rows.every((r) => r.pinRow !== false), JSON.stringify(rows.map((r) => r.pinRow)));
await mp.screenshot({ path: `${OUT}/16-phone-buildings.png` });
await phone.close();

// ---------- Тёмная тема ----------
const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "ru-RU" });
await dark.addInitScript(() => { try { localStorage.setItem("wesetup-theme-mode", "dark"); } catch {} });
await dark.addCookies([...(await context.cookies()), { name: "wesetup-theme", value: "dark", url: BASE }]);
const dp = await dark.newPage();
dp.on("pageerror", (error) => errors.push(`dark: ${error.message}`));
await dp.goto(`${BASE}/production-control`, { waitUntil: "networkidle", timeout: 120000 });
check("тёмная тема включена", (await dp.evaluate(() => document.querySelector("[data-app-theme]")?.getAttribute("data-app-theme"))) === "dark");
await dp.screenshot({ path: `${OUT}/13-new-view-dark.png` });
await dark.close();

const hydration = errors.filter((e) => /hydrat|did not match/i.test(e));
check("нет ошибок страницы", errors.length === 0, errors.slice(0, 3).join(" || "));
console.log(`hydration-related: ${hydration.length}`);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
await browser.close();
process.exit(failed ? 1 : 0);
