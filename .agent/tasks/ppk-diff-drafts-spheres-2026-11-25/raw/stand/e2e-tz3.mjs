// ТЗ3 на локальном стенде (next start :3000 + PostgreSQL + подставная очередь ProjectsFlow :4010):
// сравнение редакций, черновики пунктов от ИИ-помощника, опасные факторы и ПОПМ для сфер.
// Запуск: node run.mjs <каталог снимков> <каталог подставной очереди>
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("/opt/node-tools/node_modules/playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "out-tz3";
const PF = process.argv[3] ?? ".";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled, null, { timeout: 30000 });
  await page.fill("#email", "admin@haccp.local");
  await page.fill("#password", "admin1234");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.click('button[type="submit"]')]);
}
async function open(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 120000 });
  const legal = page.locator('[data-testid="legal-update-modal"]');
  if (await legal.count()) {
    await legal.locator('input[type="checkbox"], [role="checkbox"]').first().click();
    await page.click('[data-testid="legal-update-accept"]');
    await legal.waitFor({ state: "detached", timeout: 30000 });
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await login(page);
const api = context.request;

// ---------- Новый объект медицины: свой ППК для проверок ----------
const name = `Поликлиника e2e ${new Date().toISOString().slice(11, 19)}`;
const created = await api.post(`${BASE}/api/settings/buildings`, { data: { name, sphere: "medical" } });
const point = (await created.json().catch(() => ({}))).building;
check(`стенд: объект «${name}» (медицина)`, created.ok() && point?.id, String(created.status()));
await api.post(`${BASE}/api/me/active-building`, { data: { buildingId: point.id } });

// ---------- AC3: опасные факторы и ПОПМ для медицины ----------
await open(page, "/production-control");
const card = page.locator("[data-ppk-starter]");
check("AC3 карточка «Заполнить типовыми» на пустом ППК", (await card.count()) === 1);
await card.locator("button").click();
const dlg = page.locator("[data-ppk-starter-dialog]");
await dlg.waitFor({ timeout: 15000 });
const summary = (await dlg.locator("[data-starter-summary]").innerText()).replace(/\s+/g, " ");
check("AC3 «что добавится»: опасности и строки таблиц ПОПМ", /8 опасностей/.test(summary) && /строк таблиц ПОПМ/.test(summary) && /план лаборатории/.test(summary), summary);
await shot(page, "01-starter-medical");
const [resp] = await Promise.all([
  page.waitForResponse((r) => r.url().includes("/api/production-control/starter") && r.request().method() === "POST", { timeout: 60000 }),
  dlg.locator("[data-starter-fill]").click(),
]);
const filled = await resp.json().catch(() => ({}));
check("AC3 заполнено: опасности, 4 таблицы ПОПМ, лаборатория, дезинсекция, нормативы",
  resp.ok() && filled.created?.hazards >= 6 && ["prp-infections", "prp-disinfection", "prp-emergencies", "prp-medical"].every((b) => filled.created?.[b] >= 3) && filled.created?.["lab-plan"] > 0 && !("products" in filled.created),
  JSON.stringify(filled.created));
await page.waitForTimeout(1500);
await open(page, "/production-control");
const status = async (id) => (await page.locator(`[data-ppk-item="${id}"] [role="img"]`).first().getAttribute("aria-label").catch(() => null)) ?? "нет";
const st = { "2-6": await status("2-6"), "3-1": await status("3-1"), "3-2": await status("3-2"), "3-3": await status("3-3"), "3-4": await status("3-4") };
check("AC3 пункты 2.6 и 3.1–3.4 — не «Пусто»", Object.values(st).every((v) => v !== "Пусто" && v !== "нет"), JSON.stringify(st));
check("AC3 карточка мастера скрыта — у сферы всё заполнено", (await page.locator("[data-ppk-starter]").count()) === 0);
await open(page, "/production-control/item/2-6");
const hazardsText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
check("AC3 окно 2.6: опасности медицины", /Гемоконтактные инфекции/.test(hazardsText) && /стерилизац/i.test(hazardsText), hazardsText.slice(0, 160));
await open(page, "/production-control/item/3-3");
const emergencies = (await page.locator("main").innerText()).replace(/\s+/g, " ");
check("AC3 окно 3.3: аварийные ситуации медицины", /Аварийная ситуация с кровью/.test(emergencies), emergencies.slice(0, 160));
await shot(page, "02-item-3-3-medical");

// ---------- AC1: сравнение редакций ----------
await open(page, "/production-control/item/1-9");
const editor = page.locator('[data-ppk-text="text-terms"]');
const area = editor.locator("textarea");
await area.fill("ХАССП — система управления безопасностью. Группа ХАССП собирается раз в квартал.");
await editor.locator("button", { hasText: "Сохранить" }).click();
await page.waitForSelector('[data-revision-status="none"]', { timeout: 30000 });
await page.click("[data-revision-approve]");
const ask1 = page.locator('[role="alertdialog"], [role="dialog"]').last();
await ask1.waitFor({ timeout: 15000 });
const code1 = /ППК \d{3}/.exec(await ask1.innerText())?.[0];
await ask1.locator("button", { hasText: code1 }).click();
await page.waitForSelector('[data-revision-status="approved"]', { timeout: 30000 });
check("AC1 утверждена первая редакция", Boolean(code1), String(code1));
await area.fill("ХАССП — система управления безопасностью пищевой продукции. Группа ХАССП собирается раз в месяц.");
await editor.locator("button", { hasText: "Сохранить" }).click();
const ask2 = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: "Документ изменён" });
await ask2.waitFor({ timeout: 30000 });
const code2 = /ППК \d{3}/g.exec(await ask2.innerText()) && [...(await ask2.innerText()).matchAll(/ППК \d{3}/g)].map((m) => m[0]).pop();
await ask2.locator("button", { hasText: code2 }).click();
await page.waitForSelector('[data-revision-status="approved"]', { timeout: 30000 });
check("AC1 изменено слово → новая редакция", code2 && code2 !== code1, `${code1} → ${code2}`);

await page.click("[data-revision-compare-open]");
const cmp = page.locator("[data-revision-compare]");
await cmp.waitFor({ timeout: 15000 });
await cmp.locator("[data-compare-summary]").waitFor({ timeout: 30000 });
const added = (await cmp.locator('[data-diff="add"]').allInnerTexts()).join(" ");
const removed = (await cmp.locator('[data-diff="del"]').allInnerTexts()).join(" ");
check("AC1 «Сравнить»: предыдущая ↔ последняя, добавленное и удалённое", /пищевой продукции/.test(added) && /месяц/.test(added) && /квартал/.test(removed), `+[${added}] −[${removed}]`);
const sum = await cmp.locator("[data-compare-summary]").innerText();
check("AC1 итог: добавлено и удалено слов", /Добавлено слов: 3 · удалено: 1/.test(sum), sum.replace(/\s+/g, " "));
const fromSel = await cmp.locator("[data-compare-from]").inputValue();
const toSel = await cmp.locator("[data-compare-to]").inputValue();
check("AC1 выбор «Было/Стало» по умолчанию — две последние редакции", fromSel !== toSel && toSel !== "current", `${fromSel} → ${toSel}`);
await shot(page, "03-compare-revisions");
await page.keyboard.press("Escape");
await cmp.waitFor({ state: "detached", timeout: 15000 });

// Текущий текст после правки без утверждения.
await area.fill("ХАССП — система управления безопасностью пищевой продукции. Группа ХАССП собирается раз в месяц, протоколы хранятся год.");
await editor.locator("button", { hasText: "Сохранить" }).click();
const ask3 = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: "Документ изменён" });
await ask3.waitFor({ timeout: 30000 });
await ask3.locator("button", { hasText: /Позже|Не сейчас|Отмена/ }).first().click().catch(() => page.keyboard.press("Escape"));
await page.waitForSelector('[data-revision-status="changed"]', { timeout: 30000 });
await page.click("[data-revision-compare-open]");
await cmp.waitFor({ timeout: 15000 });
await cmp.locator("[data-compare-summary]").waitFor({ timeout: 30000 });
check("AC1 изменён после утверждения: последняя редакция ↔ текущий текст", (await cmp.locator("[data-compare-to]").inputValue()) === "current" &&
  /протоколы хранятся год/.test((await cmp.locator('[data-diff="add"]').allInnerTexts()).join(" ")));
await page.keyboard.press("Escape");

// Реестр: «Сравнить с ППК NNN» и старая редакция без текста.
await open(page, "/production-control/revisions");
const rowLink = page.locator(`[data-revision-row="${code2}"] [data-revision-compare-open]`);
check("AC1 реестр: у новой редакции — «Сравнить с …»", (await rowLink.count()) === 1 && (await rowLink.innerText()).includes(code1), await rowLink.innerText().catch(() => "нет"));
await rowLink.click();
await cmp.waitFor({ timeout: 15000 });
await cmp.locator("[data-compare-summary]").waitFor({ timeout: 30000 });
check("AC1 реестр: окно сравнения с подсветкой", (await cmp.locator('[data-diff="add"]').count()) > 0);
await page.keyboard.press("Escape");
const oldRow = page.locator('[data-revision-row="ППК 002"] [data-revision-compare-open]');
if (await oldRow.count()) {
  await oldRow.click();
  await cmp.waitFor({ timeout: 15000 });
  await cmp.locator("[data-compare-unavailable]").waitFor({ timeout: 30000 });
  check("AC1 редакция до сравнения — честная надпись «текст не сохранён»", /не сохранён/.test(await cmp.locator("[data-compare-unavailable]").innerText()));
  await shot(page, "04-compare-old-revision");
  await page.keyboard.press("Escape");
} else check("AC1 старая редакция без текста", false, "нет строки ППК 002 со ссылкой");

// API: границы.
const docKey = `text:text-terms@${point.id}`;
check("AC1 API: чужой ключ — 404", (await api.get(`${BASE}/api/production-control/revisions/compare?docKey=${encodeURIComponent("text:text-terms@nonexistent0")}`)).status() === 404);
check("AC1 API: неверный номер — 400", (await api.get(`${BASE}/api/production-control/revisions/compare?docKey=${encodeURIComponent(docKey)}&from=abc`)).status() === 400);
const anon = await (await browser.newContext()).request.get(`${BASE}/api/production-control/revisions/compare?docKey=${encodeURIComponent(docKey)}`);
check("AC1 API: без входа — 401", anon.status() === 401, String(anon.status()));

// ---------- AC2: черновик от ИИ-помощника ----------
await open(page, "/production-control/item/2-2");
const reg = page.locator('[data-ppk-text="text-team-regulation"]');
const regArea = reg.locator("textarea");
const before = await regArea.inputValue();
check("AC2 кнопка «Черновик от ИИ-помощника» у пункта 2.2", (await reg.locator("[data-ppk-draft]").count()) === 1);
await reg.locator("[data-ppk-draft]").click();
const replace = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: "Заменить текст черновиком" });
await replace.waitFor({ timeout: 15000 });
check("AC2 непустое поле — вопрос о замене", true);
await Promise.all([
  page.waitForResponse((r) => r.url().includes("/api/production-control/text-docs/draft"), { timeout: 120000 }),
  replace.locator("button", { hasText: "Заменить" }).click(),
]);
await page.waitForFunction((prev) => {
  const t = document.querySelector('[data-ppk-text="text-team-regulation"] textarea');
  return t && t.value !== prev;
}, before, { timeout: 30000 });
const draft = await regArea.inputValue();
check("AC2 черновик в поле, без разметки", draft.startsWith("2.2. Положение о группе ХАССП") && !/[#*`]/.test(draft) && /— Пункт списка/.test(draft), draft.slice(0, 120).replace(/\n/g, "⏎"));
check("AC2 черновик не сохранён сам — «Сохранить» доступна", await reg.locator("button", { hasText: "Сохранить" }).isEnabled());
const job = fs.readFileSync(`${PF}/last-job.txt`, "utf8");
check("AC2 задание ушло в очередь с типом и данными кабинета", job.startsWith("type: wesetup_generate_sop\n---\n") && /Раздел: 2\.2\. Положение о группе ХАССП/.test(job) && /<org_data>/.test(job) && job.includes(name) && /Медицинские услуги/.test(job),
  job.split("\n").slice(0, 2).join(" | "));
await shot(page, "05-draft-2-2");
await reg.locator("button", { hasText: "Сохранить" }).click();
await page.waitForTimeout(1200);
check("AC2 после «Сохранить» черновик сохранён", (await reg.innerText()).includes("Сохранено"));

// Пустое поле (1.9 без текста на организации? — свой объект: 2.9 с шаблоном) и предел запросов.
let limited = 0;
for (let i = 0; i < 6; i += 1) {
  const r = await api.post(`${BASE}/api/production-control/text-docs/draft`, { data: { block: "text-ccp-method" } });
  if (r.status() === 429) limited += 1;
}
check("AC2 предел запросов: не больше 5 в минуту", limited >= 1, `429: ${limited}`);
check("AC2 неизвестный пункт — 400", (await api.post(`${BASE}/api/production-control/text-docs/draft`, { data: { block: "policy" } })).status() === 400);

// ---------- Телефон и тёмная тема ----------
const phone = await browser.newContext({ ...devices["iPhone 13"], locale: "ru-RU" });
await phone.addCookies(await context.cookies());
const mp = await phone.newPage();
mp.on("pageerror", (error) => errors.push(`phone: ${error.message}`));
await mp.goto(`${BASE}/production-control/item/1-9`, { waitUntil: "networkidle", timeout: 120000 });
await mp.click("[data-revision-compare-open]");
await mp.locator("[data-revision-compare] [data-compare-summary]").waitFor({ timeout: 30000 });
const w = await mp.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: window.innerWidth }));
check("телефон: окно сравнения без горизонтальной прокрутки", w.docW <= w.vw, JSON.stringify(w));
await mp.screenshot({ path: `${OUT}/06-phone-compare.png` });
await phone.close();
const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "ru-RU" });
await dark.addInitScript(() => { try { localStorage.setItem("wesetup-theme-mode", "dark"); } catch {} });
await dark.addCookies([...(await context.cookies()), { name: "wesetup-theme", value: "dark", url: BASE }]);
const dp = await dark.newPage();
dp.on("pageerror", (error) => errors.push(`dark: ${error.message}`));
await dp.goto(`${BASE}/production-control/item/1-9`, { waitUntil: "networkidle", timeout: 120000 });
await dp.click("[data-revision-compare-open]");
await dp.locator("[data-revision-compare] [data-compare-summary]").waitFor({ timeout: 30000 });
await dp.screenshot({ path: `${OUT}/07-dark-compare.png` });
await dark.close();

check("нет ошибок страницы", errors.length === 0, errors.slice(0, 3).join(" || "));
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, errors }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
await browser.close();
process.exit(failed ? 1 : 0);
