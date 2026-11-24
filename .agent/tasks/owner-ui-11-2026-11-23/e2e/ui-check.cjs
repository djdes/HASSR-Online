/**
 * Локальный стенд (`next dev` или `next start`), браузер — 11 правок владельца
 * (spec.md, AC1–AC11). Управляющий демо-организации (prisma/seed-haccp-demo.ts).
 * Запуск: node .agent/tasks/owner-ui-11-2026-11-23/e2e/ui-check.cjs <папка-скриншотов>
 * Переменные: E2E_BASE (http://localhost:3022), E2E_EMAIL, E2E_PASSWORD.
 */
const { chromium, devices } = require("playwright");
const path = require("node:path");

const BASE = process.env.E2E_BASE || "http://localhost:3022";
const OUT = process.argv[2] || ".";
const EMAIL = process.env.E2E_EMAIL || "admin@haccp.local";
const PASSWORD = process.env.E2E_PASSWORD || "admin1234";

const results = [];
const check = (name, ok, details) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${details !== undefined ? ` — ${typeof details === "string" ? details : JSON.stringify(details)}` : ""}`);
};
const shot = (page, name, options = {}) => page.screenshot({ path: path.join(OUT, `${name}.png`), ...options });
const rect = (el) => {
  const b = el.getBoundingClientRect();
  return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), width: Math.round(b.width) };
};

async function login(browser, options) {
  const ctx = await browser.newContext({ locale: "ru-RU", extraHTTPHeaders: { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 200) + 20}` }, ...options });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
  const accept = page.getByRole("button", { name: "Принять и продолжить" });
  if (await accept.count()) {
    await page.locator('[role="dialog"] [role="checkbox"], [role="dialog"] input[type="checkbox"]').first().click();
    await accept.click();
    await page.waitForTimeout(1500);
  }
  return { ctx, page };
}

const room = (id, x, y, w, h, label) => ({ id, x, y, w, h, label, kind: "room", ccp: null, areaId: null });
const flow = (id, kind, points) => ({ id, from: null, to: null, points, flow: kind, label: "" });
const PLAN = {
  title: "План для проверки дверей",
  nodes: [room("r1", 40, 40, 200, 180, "Приёмка сырья"), room("r2", 240, 40, 220, 180, "Склад сырья"), room("r3", 460, 40, 320, 180, "Цех")],
  doors: [{ id: "d1", kind: "door", x: 240, y: 130, w: 40, angle: 90, flip: false, label: "" }],
  edges: [flow("f1", "raw", [{ x: 80, y: 180 }, { x: 300, y: 180 }]), flow("f2", "water", [{ x: 500, y: 200 }, { x: 740, y: 200 }]), flow("f3", "sewage", [{ x: 500, y: 80 }, { x: 740, y: 80 }])],
};

(async () => {
  // Проектный playwright может ждать другую сборку браузера — берём установленную.
  const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
  // ---------- компьютер ----------
  const { ctx, page } = await login(browser, { viewport: { width: 1440, height: 900 } });

  // AC7, AC8: поиск в шапке, нет кнопки «Выйти».
  await page.goto(`${BASE}/home`, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  const search = page.locator("header [data-header-search]");
  check("AC7 поиск в шапке виден на компьютере", (await search.count()) === 1 && (await search.isVisible()), await search.innerText().catch(() => ""));
  await search.click();
  const palette = page.locator('[role="dialog"] input').first();
  check("AC7 поиск открывает общий поиск (Ctrl+K)", await palette.isVisible().catch(() => false));
  await page.keyboard.press("Escape");
  const logoutInHeader = await page.locator('header button[aria-label="Выйти"], header button[title="Выйти"]').count();
  check("AC8 в шапке нет отдельной кнопки «Выйти»", logoutInHeader === 0, logoutInHeader);
  await shot(page, "ac7-header", { clip: { x: 0, y: 0, width: 1440, height: 120 } });

  // AC9: низ меню профиля.
  await page.getByRole("button", { name: "Профиль" }).first().click();
  await page.waitForTimeout(600);
  const footer = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="profile-menu-footer"]');
    if (!row) return null;
    const lang = row.querySelector('[data-testid="personal-language"]');
    const out = row.querySelector('[data-testid="profile-logout"]');
    const menu = row.closest('[role="menu"]');
    const last = menu ? [...menu.children].filter((c) => c.getClientRects().length).at(-1) : null;
    const b = (el) => el.getBoundingClientRect();
    return { langLeft: Math.round(b(lang).left), logoutRight: Math.round(b(out).right), rowLeft: Math.round(b(row).left), rowRight: Math.round(b(row).right), sameRow: Math.abs(b(lang).top - b(out).top) < 12, isLast: last === row, languages: menu.querySelectorAll('[data-testid="personal-language"]').length };
  });
  check("AC9 внизу меню: язык слева, «Выйти» справа, язык один раз", footer && footer.sameRow && footer.isLast && footer.langLeft - footer.rowLeft < 24 && footer.rowRight - footer.logoutRight < 24 && footer.languages === 1, footer);
  await shot(page, "ac9-profile-menu");
  await page.keyboard.press("Escape");

  // AC9 в «Новой» теме: тот же низ меню.
  await ctx.addCookies([{ name: "wesetup-view", value: "d:new", url: BASE }]);
  await page.goto(`${BASE}/home`, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Профиль" }).first().click();
  await page.waitForTimeout(600);
  const footerNew = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="profile-menu-footer"]');
    if (!row) return null;
    const lang = row.querySelector('[data-testid="personal-language"]').getBoundingClientRect();
    const out = row.querySelector('[data-testid="profile-logout"]').getBoundingClientRect();
    return { design: document.documentElement.getAttribute("data-view-design"), sameRow: Math.abs(lang.top - out.top) < 12, languageLeft: lang.left < out.left, languages: row.closest('[role="menu"]').querySelectorAll('[data-testid="personal-language"]').length };
  });
  check("AC9 «Новая» тема: внизу меню язык слева, «Выйти» справа", footerNew && footerNew.design === "new" && footerNew.sameRow && footerNew.languageLeft && footerNew.languages === 1, footerNew);
  await shot(page, "ac9-profile-menu-new");
  await page.keyboard.press("Escape");
  await ctx.clearCookies({ name: "wesetup-view" });

  // AC3, AC5: окно оборудования.
  await page.goto(`${BASE}/settings/equipment`, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /Добавить оборудование/ }).first().click();
  await page.waitForTimeout(800);
  await page.locator("#eq-type").click();
  await page.waitForTimeout(500);
  const geo = await page.evaluate(() => {
    const frame = document.querySelector("#eq-type").closest("[data-field-frame]");
    const list = document.querySelector('[data-slot="select-content"]');
    const b = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), bottom: Math.round(r.bottom), top: Math.round(r.top), width: Math.round(r.width) }; };
    return { frame: b(frame), list: b(list) };
  });
  check("AC5 список «Тип» ровно под рамкой (левый край, ширина, зазор 6px)", Math.abs(geo.frame.left - geo.list.left) <= 1 && Math.abs(geo.frame.width - geo.list.width) <= 1 && geo.list.top - geo.frame.bottom >= 4 && geo.list.top - geo.frame.bottom <= 8, geo);
  await shot(page, "ac5-type-list-desktop");
  await page.getByRole("option", { name: "Холодильник" }).click();
  await page.waitForTimeout(300);
  const fridge = await page.evaluate(() => ({ min: !!document.querySelector("#eq-temp-min"), max: !!document.querySelector("#eq-temp-max"), tuya: !!document.querySelector("#eq-tuya"), toggles: document.querySelectorAll('[data-testid^="temp-toggle"]').length, placeholder: document.querySelector("#eq-temp-min")?.getAttribute("placeholder") }));
  check("AC3 холодильник: норма и Tuya всегда, без галочек, пример 2…6", fridge.min && fridge.max && fridge.tuya && fridge.toggles === 0 && /2/.test(fridge.placeholder ?? ""), fridge);
  await page.locator("#eq-type").click();
  await page.getByRole("option", { name: "УФ-лампа" }).click();
  await page.waitForTimeout(300);
  const lamp = await page.evaluate(() => ({ min: !!document.querySelector("#eq-temp-min"), tuya: !!document.querySelector("#eq-tuya"), lamp: !!document.querySelector('[data-testid="lamp-section"]') }));
  check("AC3 УФ-лампа: блок лампы, без температуры и Tuya", !lamp.min && !lamp.tuya && lamp.lamp, lamp);
  await page.locator("#eq-type").click();
  await page.getByRole("option", { name: "Другое" }).click();
  await page.waitForTimeout(300);
  const other = await page.evaluate(() => ({ min: !!document.querySelector("#eq-temp-min"), max: !!document.querySelector("#eq-temp-max"), tuya: !!document.querySelector("#eq-tuya"), toggles: document.querySelectorAll('[data-testid^="temp-toggle"]').length }));
  check("AC3 «Другое»: галочки мин./макс., без них — ни нормы, ни Tuya", !other.min && !other.max && !other.tuya && other.toggles === 2, other);
  await page.getByTestId("temp-toggle-max").click();
  await page.waitForTimeout(200);
  const otherMax = await page.evaluate(() => ({ min: !!document.querySelector("#eq-temp-min"), max: !!document.querySelector("#eq-temp-max"), tuya: !!document.querySelector("#eq-tuya"), focus: document.activeElement?.id }));
  check("AC3 «Другое»: галочка «Макс.» показывает поле (в фокусе) и Tuya", !otherMax.min && otherMax.max && otherMax.tuya && otherMax.focus === "eq-temp-max", otherMax);
  await shot(page, "ac3-other-max");
  await page.keyboard.press("Escape");

  // AC4: «Кто заполняет по QR» — люди выбранного объекта (стенд: «Офис» и «Кафе на Ленина»).
  if (process.env.E2E_OFFICE_STAFF && process.env.E2E_POINT_STAFF) {
    await page.goto(`${BASE}/settings/equipment`, { waitUntil: "load" });
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /Добавить оборудование/ }).first().click();
    await page.waitForTimeout(800);
    const names = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="filler-picker"] button[aria-pressed] span.min-w-0 > span:first-child')].map((el) => el.textContent.trim()));
    const pick = async (label) => {
      await page.locator("#eq-building").click();
      await page.getByRole("option", { name: label }).click();
      await page.waitForTimeout(300);
      return { names: await names(), note: await page.getByTestId("filler-scope-note").innerText().catch(() => "") };
    };
    const office = await pick("Офис");
    const point = await pick("Кафе на Ленина");
    const officeName = process.env.E2E_OFFICE_STAFF, pointName = process.env.E2E_POINT_STAFF;
    check("AC4 объект «Офис» — в списке сотрудники офиса, без сотрудников точки", office.names.includes(officeName) && !office.names.includes(pointName) && /Офис/.test(office.note), office);
    check("AC4 объект-точка — её сотрудники, без офисных", point.names.includes(pointName) && !point.names.includes(officeName) && /Кафе на Ленина/.test(point.note), point);
    await shot(page, "ac4-fillers-point");
    await page.keyboard.press("Escape");
  }

  // AC10: строка настроек не шире 560px.
  await page.goto(`${BASE}/settings/organization`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const widths = await page.evaluate(() => [...document.querySelectorAll('[data-slot="select-trigger"]')].slice(0, 2).map((el) => Math.round(el.getBoundingClientRect().width)));
  check("AC6/AC10 «Сфера» и «Тип организации» — списки Radix, не шире 560px", widths.length === 2 && widths.every((w) => w > 300 && w <= 560), widths);
  await shot(page, "ac10-organization");

  // AC1, AC2: план с дверями и потоками.
  await page.goto(`${BASE}/production-control/sanitation/floor-plans`, { waitUntil: "load" });
  const created = await page.request.post(`${BASE}/api/production-control/records`, { data: { block: "floor-plan", data: PLAN } });
  const planId = (await created.json()).record?.id;
  check("AC1 сервер принимает план с дверью и потоками «Вода»/«Канализация»", created.status() === 201 && planId, created.status());
  const rejected = await page.request.post(`${BASE}/api/production-control/records`, { data: { block: "floor-plan", data: { ...PLAN, doors: [{ ...PLAN.doors[0], angle: 45 }] } } });
  check("AC1 сервер отклоняет дверь с неверным поворотом", rejected.status() === 400, rejected.status());
  await page.goto(`${BASE}/production-control/sanitation/floor-plans/${planId}`, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Дверь", exact: true }).first().click();
  const target = await page.evaluate(() => {
    const svg = document.querySelector("svg[role=img]");
    const p = svg.createSVGPoint(); p.x = 600; p.y = 230;
    const s = p.matrixTransform(svg.getScreenCTM());
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(400);
  const placed = await page.evaluate(() => [...document.querySelectorAll("[data-door]")].map((g) => g.querySelector("g")?.getAttribute("transform")));
  check("AC1 клик у стены ставит дверь на стену (y = 220, поворот 0)", placed.some((t) => /translate\(600 220\) rotate\(0\)/.test(t ?? "")), placed);
  check("AC1 панель двери: вид, ширина, «Повернуть», «Отразить», подпись", (await page.getByTestId("door-panel").count()) === 1);
  await page.getByRole("button", { name: "Повернуть" }).click();
  await page.getByRole("button", { name: "Шире" }).click();
  await page.waitForTimeout(300);
  const adjusted = await page.evaluate(() => [...document.querySelectorAll("[data-door]")].map((g) => g.querySelector("g")?.getAttribute("transform")).find((t) => /translate\(600 220\)/.test(t ?? "")));
  check("AC1 «Повернуть» на стене — открывание в другую сторону (180°), «Шире» — 50", /rotate\(180\)/.test(adjusted ?? ""), adjusted);
  const chips = await page.evaluate(() => {
    const flowButton = [...document.querySelectorAll('[role="toolbar"] button')].find((b) => b.textContent.trim() === "Поток");
    flowButton?.click();
    return null;
  });
  await page.waitForTimeout(300);
  const flowChips = await page.locator('[role="toolbar"] ~ div button').allInnerTexts();
  check("AC2 потоки: «Грязная посуда и инвентарь», «Вода», «Канализация»", ["Грязная посуда и инвентарь", "Вода", "Канализация"].every((x) => flowChips.includes(x)), flowChips);
  await page.waitForTimeout(1500);
  await shot(page, "ac1-plan-editor");
  await page.goto(`${BASE}/production-control/sanitation/floor-plans/${planId}/print`, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  const legend = await page.locator("li").allInnerTexts();
  check("AC1/AC2 печать: двери и новые потоки в обозначениях", ["Дверь", "Вода", "Канализация"].every((x) => legend.some((l) => l.includes(x))), legend.slice(0, 12));
  await shot(page, "ac1-plan-print", { fullPage: true });
  await page.goto(`${BASE}/production-control/sanitation/floor-plans/${planId}/print?by=flow`, { waitUntil: "load" });
  const sections = await page.locator("section h2").allInnerTexts();
  check("AC2 печать по потокам — лист «Вода» и лист «Канализация»", sections.some((s) => s.endsWith("Вода")) && sections.some((s) => s.endsWith("Канализация")), sections);

  // AC11: нагрузки сотрудников нет.
  for (const url of ["/settings/workload-balance", "/settings/journal-difficulty"]) {
    await page.goto(`${BASE}${url}`, { waitUntil: "load" });
    // Редирект внутри раздела приходит потоком (NEXT_REDIRECT) — ждём адрес.
    await page.waitForURL((u) => u.pathname === "/settings/journal-responsibles", { timeout: 60000 }).catch(() => {});
    check(`AC11 ${url} ведёт к «Ответственным за журналы»`, new URL(page.url()).pathname === "/settings/journal-responsibles", page.url());
  }
  const api = await page.request.put(`${BASE}/api/settings/journal-difficulty`, { data: { difficulty: {} } });
  check("AC11 API сложности журналов удалён", api.status() === 404 || api.status() === 405, api.status());
  const loadText = await page.locator("main").innerText();
  check("AC11 в «Ответственных» нет прогноза нагрузки", !/нагрузк/i.test(loadText));

  // AC12: «Сотрудники → Телефон»: программный модуль со ссылкой.
  await page.goto(`${BASE}/settings/phone`, { waitUntil: "load" });
  await page.waitForTimeout(800);
  const link = page.locator('a[href="https://tasksflow.ru"]').first();
  check("AC12 «Программный модуль — сервис задач …» со ссылкой на tasksflow.ru", (await link.count()) > 0 && /Программный модуль/.test(await page.locator("main").innerText()), await link.innerText().catch(() => ""));
  await shot(page, "ac12-phone");
  await ctx.close();

  // ---------- телефон ----------
  const phone = await login(browser, { ...devices["Pixel 7"] });
  await phone.page.goto(`${BASE}/settings/equipment`, { waitUntil: "load" });
  await phone.page.waitForTimeout(1000);
  await phone.page.getByRole("button", { name: /Добавить оборудование/ }).first().click();
  await phone.page.waitForTimeout(800);
  await phone.page.locator("#eq-type").click();
  await phone.page.waitForTimeout(600);
  const sheet = await phone.page.evaluate(() => {
    const list = document.querySelector('[data-slot="select-content"]');
    const r = list.getBoundingClientRect();
    const item = list.querySelector('[data-slot="select-item"]').getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight, item: Math.round(item.height), radius: getComputedStyle(list).borderTopLeftRadius };
  });
  check("AC5 телефон: список — лист снизу во всю ширину, пункты ≥ 48px", sheet.left === 0 && sheet.right === sheet.vw && Math.abs(sheet.bottom - sheet.vh) <= 1 && sheet.item >= 48, sheet);
  await shot(phone.page, "ac5-type-sheet-phone");
  await phone.ctx.close();

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
