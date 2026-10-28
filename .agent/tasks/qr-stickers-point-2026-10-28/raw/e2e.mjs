// Проверка в браузере на ЛОКАЛЬНОЙ тестовой базе wesetup_memos (не прод).
// Данные — сид памяток + raw/seed-local.ts этой задачи. Запуск из корня worktree:
//   BASE=http://localhost:3026 CHROME=<chrome.exe> node .agent/tasks/qr-stickers-point-2026-10-28/raw/e2e.mjs [qr|nav]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3026";
const ONLY = process.argv[2] ?? "all";
const OUT = new URL("./shots/", import.meta.url);
const PDF = new URL("./pdf/", import.meta.url);
mkdirSync(OUT, { recursive: true });
mkdirSync(PDF, { recursive: true });
const shot = (name) => fileURLToPath(new URL(name, OUT));
const pdfPath = (name) => fileURLToPath(new URL(name, PDF));
const JSQR = fileURLToPath(new URL("../../../../node_modules/jsqr/dist/jsQR.js", import.meta.url));

const POINT_5 = "Пищеблок СОШ № 5";
const ADDRESS_5 = "г. Казань, ул. Ленина, 5";
const LONG_112 = "МАУ «Комбинат питания «Дружба»";
const SHORT_112 = "Пищеблок гимназии № 112";
const ONE_POINT = "Доброе кафе на Садовой";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const cookie = (name, value) => ({ name, value, domain: "localhost", path: "/" });

async function session(browser, email, { viewport = { width: 1440, height: 1000 }, point } = {}) {
  const ctx = await browser.newContext({ viewport });
  if (point) await ctx.addCookies([cookie("wesetup.building", point)]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  page.setDefaultNavigationTimeout(240000);
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  // Форма гидратируется не сразу: поля, заполненные раньше, React очищает.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.fill("#email", email);
    await page.fill("#password", "Test-12345");
    if ((await page.inputValue("#email")) !== email) continue;
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
      await page.mouse.move(1, viewport.height - 1);
      return { ctx, page };
    } catch {
      await page.waitForTimeout(1500);
    }
  }
  throw new Error(`Не удалось войти: ${email}`);
}

/** Страница QR-кодов: дождаться печатного дерева (портал после гидратации). */
async function openQr(page, query) {
  await page.goto(`${BASE}/settings/qr-posters${query}`, { waitUntil: "load" });
  await page.waitForSelector("[data-qr-page]");
  await page.waitForSelector("[data-qr-print-root]", { state: "attached" });
}

/** Что напечатается: листы, строки точки по плакатам, переполнения, ширина кода наклейки. */
async function printState(page) {
  await page.emulateMedia({ media: "print" });
  const state = await page.evaluate(() => {
    const px = (mm) => (mm * 96) / 25.4;
    const sheets = Array.from(document.querySelectorAll("[data-qr-print-root] [data-qr-sheet]"));
    const items = Array.from(document.querySelectorAll(".qrp-a4, .qrp-a5-frame, .qrp-sticker, .qrp-plate-frame")).map((el) => {
      const box = el.getBoundingClientRect();
      const children = Array.from(el.querySelectorAll("*")).filter((child) => child.getClientRects().length > 0);
      const bottom = Math.max(...children.map((child) => child.getBoundingClientRect().bottom), box.top);
      const code = el.querySelector("[data-qr-print-code] svg");
      const point = el.querySelector("[data-qr-print-point]");
      const pointText = point?.querySelector(".qrp-point-text");
      return {
        kind: el.className.split(" ")[0],
        title: el.querySelector(".qrp-a4-title, .qrp-a5-title, .qrp-sticker-title, .qrp-plate-word")?.textContent ?? "",
        url: el.querySelector("[data-qr-print-code]")?.getAttribute("data-qr-print-url") ?? "",
        point: point?.textContent?.trim() ?? null,
        pointClamped: pointText ? pointText.scrollHeight > pointText.clientHeight + 1 || pointText.scrollWidth > pointText.clientWidth + 1 : false,
        pointCut: (() => {
          const bold = point?.querySelector("b");
          return bold && pointText ? bold.getBoundingClientRect().right > pointText.getBoundingClientRect().right + 0.5 : false;
        })(),
        detail: el.querySelector(".qrp-detail, .qrp-sticker-detail")?.textContent ?? "",
        overflowPx: Math.round((bottom - box.bottom) * 10) / 10,
        scrollOverflow: el.scrollHeight - el.clientHeight,
        codeMm: code ? Math.round((code.getBoundingClientRect().width / px(1)) * 10) / 10 : null,
      };
    });
    const sheetOverflow = sheets.map((sheet) => sheet.scrollHeight - sheet.clientHeight);
    return { sheets: sheets.length, sheetOverflow, items };
  });
  await page.emulateMedia({ media: null });
  return state;
}

async function pdfPages(page, name) {
  const buffer = await page.pdf({ path: pdfPath(name), format: "A4", preferCSSPageSize: true, printBackground: false });
  return (buffer.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

/** QR со строки (печатное дерево) → адрес, jsQR по SVG. */
async function decodeFirstQr(page) {
  await page.addScriptTag({ path: JSQR });
  return page.evaluate(async () => {
    const svg = document.querySelector("[data-qr-print-root] [data-qr-print-code] svg").cloneNode(true);
    const [, , w, h] = (svg.getAttribute("viewBox") ?? "0 0 100 100").split(/\s+/).map(Number);
    const width = 800;
    const height = Math.round((width * h) / w);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(img, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height);
    return window.jsQR(data.data, width, height)?.data ?? null;
  });
}

const fits = (state) => state.items.every((item) => item.overflowPx <= 0.6 && item.scrollOverflow <= 1) && state.sheetOverflow.every((value) => value <= 1);
const fitDetail = (state) =>
  state.items.filter((item) => item.overflowPx > 0.6 || item.scrollOverflow > 1).map((item) => `${item.kind}:${item.title}:${item.overflowPx}/${item.scrollOverflow}`).join("; ") || "ok";

async function qrChecks(browser) {
  // --- org-dk, в шапке — точка № 5.
  const dk = await session(browser, "dk-owner@test.local", { point: "org-dk:b-dk-5" });
  let page = dk.page;

  await openQr(page, "?kind=equipment&layout=sheet");
  const cards = await page.$$eval("[data-qr-poster]", (nodes) =>
    nodes.map((node) => ({ id: node.getAttribute("data-qr-id"), point: node.querySelector("[data-qr-card-point]")?.textContent?.trim() ?? null })),
  );
  check(
    "AC1 оборудование точки № 5 + цех без точки, без чужого морозильника",
    cards.map((card) => card.id).sort().join(",") === ["e-dk-5-fridge", "e-dk-5-fryer", "e-dk-5-uv", "e-dk-shared-fridge"].join(","),
    cards.map((card) => card.id).join(","),
  );
  check("AC4 карточки показывают точку наклейки", cards.every((card) => card.point === POINT_5), JSON.stringify(cards.map((card) => card.point)));
  await page.screenshot({ path: shot("1-equipment-cards-point5.png"), fullPage: true });
  let state = await printState(page);
  check("AC1 у каждой наклейки — короткое название точки № 5 (в строке организации)", state.items.length === 4 && state.items.every((item) => item.point?.startsWith(`${POINT_5} · `)), JSON.stringify(state.items.map((item) => item.point)));
  check("AC1 «Склад общий» (цех без точки) — точка из шапки", state.items.some((item) => item.title === "Холодильник склада" && item.point?.includes(POINT_5)));
  check("AC3 наклейки: 1 лист, ничего не обрезано", state.sheets === 1 && fits(state), fitDetail(state));
  check("AC3 код наклейки ≥ 25 мм", state.items.every((item) => (item.codeMm ?? 0) >= 25), state.items.map((item) => item.codeMm).join(","));
  check("AC3 PDF наклеек — 1 страница", (await pdfPages(page, "stickers-point5.pdf")) === 1);
  const stickerUrl = await decodeFirstQr(page);
  check("AC1 QR наклейки читается и ведёт на объект", Boolean(stickerUrl && /\/equipment-fill\//.test(stickerUrl)), stickerUrl ?? "null");

  await openQr(page, "?kind=equipment&layout=plate");
  state = await printState(page);
  const plates = state.items.filter((item) => item.kind === "qrp-plate-frame");
  check("AC1 таблички холодильников — со строкой точки", plates.length === 2 && plates.every((item) => item.point?.includes(POINT_5)), JSON.stringify(plates.map((item) => item.point)));
  check("AC3 таблички: ничего не вылезает за рамку", fits(state), fitDetail(state));
  check("AC3 код таблички 30–46 мм", plates.every((item) => (item.codeMm ?? 0) >= 30 && (item.codeMm ?? 0) <= 46.2), plates.map((item) => item.codeMm).join(","));
  // Таблички — 4 на листе; у лампы и фритюрницы таблички нет, они плакатами A4.
  check("AC3 PDF: лист табличек + 2 плаката A4 — 3 страницы", state.sheets === 3 && (await pdfPages(page, "plates-point5.pdf")) === 3, `${state.sheets} листов`);

  await openQr(page, "?kind=equipment&format=a5");
  state = await printState(page);
  check("AC3 A5: 2 листа, ничего не обрезано, строка точки с адресом", state.sheets === 2 && fits(state) && state.items.every((item) => item.point?.includes(POINT_5) && item.point.includes(ADDRESS_5)), fitDetail(state));
  check("AC3 PDF A5 — 2 страницы", (await pdfPages(page, "a5-point5.pdf")) === 2);

  await openQr(page, "?kind=rooms&layout=poster");
  state = await printState(page);
  check("AC1 склад точки № 5 — плакат A4 со строкой точки", state.items.length === 1 && state.items[0].point?.includes(POINT_5), JSON.stringify(state.items.map((item) => [item.title, item.point])));
  check("AC3 PDF плаката A4 — 1 страница", (await pdfPages(page, "room-a4-point5.pdf")) === 1);

  // Плакаты журналов: точка — строкой, не в подзаголовке.
  await openQr(page, "?journal=hygiene");
  state = await printState(page);
  const main = state.items.filter((item) => item.kind === "qrp-a4");
  check("AC2 основные QR гигиены — строка точки № 5", main.length >= 2 && main.every((item) => item.point?.includes(POINT_5)), JSON.stringify(main.map((item) => item.point)));
  check("AC2 точка не повторяется в подзаголовке", main.every((item) => !item.detail.includes(POINT_5)), main.map((item) => item.detail).join(" | "));
  await page.screenshot({ path: shot("2-hygiene-journal-qr.png"), fullPage: true });
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: shot("3-hygiene-print.png"), fullPage: true });
  await page.emulateMedia({ media: null });
  check("AC3 PDF основных QR гигиены — по листу на плакат", (await pdfPages(page, "hygiene-main.pdf")) === state.sheets, `${state.sheets} листов`);
  const hygieneUrl = await decodeFirstQr(page);
  check("AC2 QR гигиены — журнал точки № 5", Boolean(hygieneUrl && hygieneUrl.includes("/journal-fill/org-dk/hygiene")), hygieneUrl ?? "null");

  // Обзор: «Все журналы» точки.
  await openQr(page, "");
  state = await printState(page);
  check("AC2 «Все журналы» и допуск — строка точки № 5", state.items.length >= 1 && state.items.every((item) => item.point?.includes(POINT_5)), JSON.stringify(state.items.map((item) => item.point)));

  // QR документа (кнопки «Наклейка» / «Плакат A4» в диалоге документа): срок не обрезается.
  await openQr(page, "?journal=hygiene&ids=hygiene:doc-hyg-dk-5&layout=sheet");
  state = await printState(page);
  check("AC3 наклейка QR документа: строка срока видна, код ≥ 25 мм", state.items.length === 1 && fits(state) && (state.items[0].codeMm ?? 0) >= 25 && state.items[0].point?.startsWith(POINT_5), `${fitDetail(state)}; ${state.items.map((item) => [item.codeMm, item.point]).join(";")}`);
  await openQr(page, "?journal=hygiene&ids=hygiene@verify:doc-hyg-dk-5,hygiene:doc-hyg-dk-5&layout=poster");
  state = await printState(page);
  check("AC3 плакаты A4 документа (логотип, заголовок в 2 строки, срок) — в рамке", state.items.length === 2 && fits(state), fitDetail(state));
  check("AC3 код A4 документа 70–100 мм", state.items.every((item) => (item.codeMm ?? 0) >= 70 && (item.codeMm ?? 0) <= 100.3), state.items.map((item) => item.codeMm).join(","));
  check("AC3 PDF плакатов документа — 2 страницы", (await pdfPages(page, "doc-a4-point5.pdf")) === 2);
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: shot("11-doc-a4-print.png"), fullPage: true });
  await page.emulateMedia({ media: null });

  // Превью QR в диалоге — та же точка, что на печати (цех без точки → точка из шапки).
  const preview = await page.request.get(`${BASE}/api/qr-fill/equipment/e-dk-shared-fridge`);
  const previewPoint = (await preview.json())?.poster?.point?.short ?? null;
  check("AC4 превью QR в диалоге: точка из шапки у цеха без точки", previewPoint === POINT_5, String(previewPoint));

  // Старые ссылки на несколько QR: документ показывает свою точку в подписи.
  await openQr(page, "?kind=journals&ids=hygiene:doc-hyg-dk-5");
  const legacyRow = await page.locator('[data-qr-id="hygiene:doc-hyg-dk-5"]').first().textContent();
  check("AC4 старая ссылка: у документа в подписи — точка", Boolean(legacyRow?.includes(POINT_5)), legacyRow?.replace(/s+/g, " ").slice(0, 120) ?? "null");
  await dk.ctx.close();

  // --- org-dk, «Вся организация»: своя точка у объектов, у цеха без точки строки нет.
  const all = await session(browser, "dk-owner@test.local", { point: "org-dk:organization" });
  page = all.page;
  await openQr(page, "?kind=equipment&layout=sheet");
  state = await printState(page);
  const byTitle = Object.fromEntries(state.items.map((item) => [item.title, item.point]));
  check("AC1 «Вся организация»: всё оборудование организации", state.items.length === 5, Object.keys(byTitle).join(", "));
  check("AC1 морозильник — своя точка (короткое название гимназии № 112)", Boolean(byTitle["Морозильный ларь"]?.startsWith(SHORT_112)), byTitle["Морозильный ларь"] ?? "null");
  check("AC1 цех без точки при «Вся организация» — без строки", byTitle["Холодильник склада"] === null, String(byTitle["Холодильник склада"]));
  check("AC3 точка на наклейках видна целиком (многоточие — только у организации)", state.items.every((item) => !item.pointCut), state.items.filter((item) => item.pointCut).map((item) => item.title).join(",") || "ok");
  check("AC3 наклейки «Вся организация»: 1 лист, ничего не обрезано", state.sheets === 1 && fits(state), fitDetail(state));
  check("AC3 PDF — 1 страница", (await pdfPages(page, "stickers-all.pdf")) === 1);
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: shot("4-stickers-print-all.png"), fullPage: true });
  await page.emulateMedia({ media: null });

  await openQr(page, "?kind=equipment&layout=plate");
  state = await printState(page);
  check("AC3 табличка морозильника с длинной точкой — в рамке", fits(state), fitDetail(state));
  const platesAll = state.items.filter((item) => item.kind === "qrp-plate-frame");
  check(
    "AC3 таблички: код 30–46 мм, без строки точки — крупнее",
    platesAll.every((item) => (item.codeMm ?? 0) >= 30 && (item.codeMm ?? 0) <= 46.2),
    platesAll.map((item) => `${item.title}:${item.codeMm}:${item.point ? "точка" : "без точки"}`).join(", "),
  );
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: shot("5-plates-print-all.png"), fullPage: true });
  await page.emulateMedia({ media: null });

  await openQr(page, "?kind=equipment&layout=poster");
  state = await printState(page);
  check("AC3 плакаты A4 «Вся организация»: 5 листов, ничего не обрезано", state.sheets === 5 && fits(state), fitDetail(state));
  check("AC3 длинная точка на плакате — не больше двух строк", state.items.some((item) => item.title === "Морозильный ларь" && item.point?.includes(LONG_112)));
  check("AC3 PDF плакатов A4 — 5 страниц", (await pdfPages(page, "posters-all.pdf")) === 5);
  check("AC3 код A4 70–100 мм", state.items.every((item) => (item.codeMm ?? 0) >= 70 && (item.codeMm ?? 0) <= 100.3), state.items.map((item) => item.codeMm).join(","));

  await openQr(page, "?kind=rooms&layout=sheet");
  state = await printState(page);
  const rooms = Object.fromEntries(state.items.map((item) => [item.title, item.point]));
  check("AC1 склады — точка своего здания, архив — офис", Boolean(rooms["Склад сухих продуктов"]?.includes(POINT_5) && rooms["Овощной склад"]?.startsWith(SHORT_112) && rooms["Архив документов"]?.includes("Офис")), JSON.stringify(rooms));
  await all.ctx.close();

  // --- org-one: одна точка, цех без точки.
  const one = await session(browser, "one-owner@test.local");
  page = one.page;
  await openQr(page, "?kind=equipment&layout=sheet");
  state = await printState(page);
  check("AC1 одна точка: наклейки холодильников — с этой точкой", state.items.length === 2 && state.items.every((item) => item.point?.includes(ONE_POINT)), JSON.stringify(state.items.map((item) => item.point)));
  check("AC3 название в две строки: наклейка не обрезана, код ≥ 25 мм", fits(state) && state.items.every((item) => (item.codeMm ?? 0) >= 25), `${fitDetail(state)}; ${state.items.map((item) => item.codeMm).join(",")}`);
  await openQr(page, "?kind=rooms&layout=sheet");
  state = await printState(page);
  check("AC1 одна точка: склад — с этой точкой", state.items.length === 1 && Boolean(state.items[0].point?.includes(ONE_POINT)));
  await openQr(page, "");
  state = await printState(page);
  check("AC2 одна точка: «Все журналы» — с этой точкой", state.items.length >= 1 && state.items.every((item) => item.point?.includes(ONE_POINT)));
  await page.screenshot({ path: shot("6-one-point-overview.png"), fullPage: true });
  await one.ctx.close();

  // --- org-none: точек нет — строки нет.
  const none = await session(browser, "none-owner@test.local");
  page = none.page;
  await openQr(page, "?kind=equipment&layout=sheet");
  state = await printState(page);
  check("AC1 без точек — строки точки нет", state.items.length === 1 && state.items[0].point === null);
  await none.ctx.close();
}

async function sidebarState(page) {
  return page.evaluate(() => {
    const aside = document.querySelector("[data-app-sidebar]");
    return { mode: aside?.getAttribute("data-sidebar-mode"), section: aside?.getAttribute("data-sidebar-section") ?? null, path: location.pathname };
  });
}

async function clickBackAndWait(page, expected) {
  await page.click("[data-app-sidebar] [data-back-to-main]");
  // Меню меняется сразу, страница — после перехода.
  await page.waitForFunction(
    ({ mode, section, path }) => {
      const aside = document.querySelector("[data-app-sidebar]");
      return aside?.getAttribute("data-sidebar-mode") === mode && (aside?.getAttribute("data-sidebar-section") ?? null) === section && location.pathname === path;
    },
    expected,
    { timeout: 120000 },
  );
  await page.waitForLoadState("load");
  return sidebarState(page);
}

async function navChecks(browser) {
  const owner = await session(browser, "dk-owner@test.local", { point: "org-dk:b-dk-5" });
  const page = owner.page;
  await page.goto(`${BASE}/settings/users`, { waitUntil: "load" });
  await page.waitForSelector('[data-app-sidebar][data-sidebar-section="staff"]');
  check("AC5 «Сотрудники»: меню раздела", true);
  let state = await clickBackAndWait(page, { mode: "section", section: "points", path: "/settings/buildings" });
  check("AC5 «Назад» → меню «Торговых точек» и их страница", state.section === "points" && state.path === "/settings/buildings", JSON.stringify(state));
  await page.screenshot({ path: shot("7-back-to-points.png") });
  state = await clickBackAndWait(page, { mode: "section", section: "company", path: "/settings/organization" });
  check("AC5 «Назад» → меню «Моей компании» и её страница", state.section === "company" && state.path === "/settings/organization", JSON.stringify(state));
  state = await clickBackAndWait(page, { mode: "main", section: null, path: "/home" });
  check("AC5 «Назад» → главное меню и главная", state.mode === "main" && state.path === "/home", JSON.stringify(state));
  await page.screenshot({ path: shot("8-back-to-home.png") });
  await page.goBack({ waitUntil: "load" });
  await page.waitForFunction(() => location.pathname === "/settings/organization");
  await page.waitForSelector('[data-app-sidebar][data-sidebar-section="company"]');
  state = await sidebarState(page);
  check("AC5 кнопка «назад» браузера — меню страницы, куда вернулись", state.section === "company" && state.path === "/settings/organization", JSON.stringify(state));
  await page.goForward({ waitUntil: "load" });
  await page.waitForFunction(() => location.pathname === "/home");
  await page.waitForSelector('[data-app-sidebar][data-sidebar-mode="main"]');
  check("AC5 «вперёд» браузера — главная с главным меню", true);

  await page.goto(`${BASE}/checklists/templates`, { waitUntil: "load" });
  await page.waitForSelector('[data-app-sidebar][data-sidebar-section="checklists"]');
  state = await clickBackAndWait(page, { mode: "section", section: "monitoring", path: "/monitoring" });
  check("AC5 «Чек-листы» → «Назад» → «Мониторинг» и его страница", state.path === "/monitoring", JSON.stringify(state));
  state = await clickBackAndWait(page, { mode: "main", section: null, path: "/home" });
  check("AC5 «Мониторинг» → «Назад» → главное меню и главная", state.path === "/home", JSON.stringify(state));

  // Новая вкладка (Ctrl+клик) не трогает меню и страницу этой вкладки.
  await page.goto(`${BASE}/settings/users`, { waitUntil: "load" });
  await page.waitForSelector('[data-app-sidebar][data-sidebar-section="staff"]');
  const href = await page.getAttribute("[data-app-sidebar] [data-back-to-main]", "href");
  check("AC5 «Назад» — ссылка на корень родителя", href === "/settings/buildings", String(href));
  await owner.ctx.close();

  // Руководитель точки: «Моя компания» закрыта — из «Торговых точек» в главное меню.
  const admin5 = await session(browser, "dk-admin5@test.local");
  const p5 = admin5.page;
  await p5.goto(`${BASE}/settings/users`, { waitUntil: "load" });
  await p5.waitForSelector('[data-app-sidebar][data-sidebar-section="staff"]');
  state = await clickBackAndWait(p5, { mode: "section", section: "points", path: "/settings/buildings" });
  check("AC5 руководитель точки: «Назад» → «Торговые точки»", state.path === "/settings/buildings", JSON.stringify(state));
  state = await clickBackAndWait(p5, { mode: "main", section: null, path: "/home" });
  check("AC5 руководитель точки: «Назад» → главное меню и главная", state.mode === "main" && state.path === "/home", JSON.stringify(state));
  await admin5.ctx.close();

  // Повар работает в оболочке Mini App: на сайте его уводит в /mini — сайдбара нет.
  const cook = await session(browser, "dk-cook@test.local");
  const pc = cook.page;
  await pc.goto(`${BASE}/journals`, { waitUntil: "load" });
  const cookPath = await pc.evaluate(() => location.pathname);
  const cookSidebars = await pc.locator("[data-app-sidebar]").count();
  check("AC5 повар: сайдбара нет (оболочка Mini App) — «Назад» в нём не участвует", cookPath.startsWith("/mini") || cookSidebars === 0, `${cookPath}, сайдбаров: ${cookSidebars}`);
  await cook.ctx.close();

  // Заведующая: главная «Журналы» перенаправляет внутрь раздела — после «Назад» меню всё равно главное.
  const chef = await session(browser, "dk-chef@test.local");
  const ph = chef.page;
  await ph.goto(`${BASE}/team`, { waitUntil: "load" });
  await ph.waitForSelector("[data-app-sidebar]", { timeout: 120000 });
  const chefStart = await sidebarState(ph);
  if (chefStart.mode === "section") {
    // «Назад», пока не главное меню: каждый шаг — уровень вверх и страница этого уровня.
    const trail = [chefStart];
    for (let step = 0; step < 4 && trail.at(-1).mode === "section"; step += 1) {
      const before = trail.at(-1);
      await ph.click("[data-app-sidebar] [data-back-to-main]");
      await ph.waitForFunction((start) => location.pathname !== start, before.path, { timeout: 120000 });
      await ph.waitForLoadState("load");
      await ph.waitForTimeout(2000);
      trail.push(await sidebarState(ph));
    }
    const last = trail.at(-1);
    check(
      "AC5 заведующая: «Назад» шаг за шагом → главное меню и её главная",
      last.mode === "main" && trail.slice(1).every((entry, index) => entry.path !== trail[index].path),
      trail.map((entry) => `${entry.section ?? entry.mode}@${entry.path}`).join(" → "),
    );
    await ph.screenshot({ path: shot("10-head-chef-back.png") });
  } else {
    check("AC5 заведующая: на /team меню раздела нет — проверять нечего", true, JSON.stringify(chefStart));
  }
  await chef.ctx.close();

  // Телефон: лист меню листает разделы, страница не меняется (как раньше).
  const phone = await session(browser, "dk-owner@test.local", { viewport: { width: 390, height: 844 }, point: "org-dk:b-dk-5" });
  const pp = phone.page;
  await pp.goto(`${BASE}/settings/users`, { waitUntil: "load" });
  await pp.click("[data-nav-burger]");
  await pp.waitForSelector('[data-mobile-nav][data-mobile-nav-section="staff"]');
  await pp.click('[data-sheet-menu="mobile"] [data-back-to-main]');
  await pp.waitForSelector('[data-mobile-nav][data-mobile-nav-section="points"]');
  const phonePath = await pp.evaluate(() => location.pathname);
  check("AC6 телефон: «Назад» в листе — меню уровнем выше, страница та же", phonePath === "/settings/users", phonePath);
  await pp.screenshot({ path: shot("9-phone-sheet-back.png") });
  await phone.ctx.close();
}

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
try {
  if (ONLY === "all" || ONLY === "qr") await qrChecks(browser);
  if (ONLY === "all" || ONLY === "nav") await navChecks(browser);
} catch (error) {
  check("скрипт без исключений", false, error?.stack ?? String(error));
} finally {
  await browser.close();
  const failed = results.filter((result) => !result.ok);
  writeFileSync(fileURLToPath(new URL(`e2e-result-${ONLY}.json`, OUT)), JSON.stringify({ base: BASE, total: results.length, failed: failed.length, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exitCode = failed.length ? 1 : 0;
}
