// Проверка раздела «Торговые точки» в браузере (pages-points-2026-10).
// Запуск из корня worktree: node .agent/tasks/pages-points-2026-10/check.mjs [base] [сценарии через запятую]
// Сценарии: menu (меню и подсветка, 1440/390/Mini App), pages (страница точки и мастер,
// 1440/390), wizard (мастер создаёт третью точку), edit (правка, помещение, окно УФ-лампы и удаление
// этой точки), cook (прямой заход повара).
// Пишет скриншоты и results-<сценарий>.json в raw/.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:3072";
const ONLY = (process.argv[3] || "menu,pages,wizard,edit,cook").split(",");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, "raw");
fs.mkdirSync(RAW, { recursive: true });
const PASSWORD = "admin1234";
const ROLES = {
  owner: { title: "руководитель", email: "admin@haccp.local" },
  headchef: { title: "заведующая", email: "chef@haccp.local" },
  cook: { title: "повар", email: "hotcook1@haccp.local" },
};
const LENINA = "fx-building-lenina";
const MIRA = "fx-building-mira";

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", args: ["--lang=ru-RU"] });
  } catch {
    const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
    for (const dir of ["chromium-1243", "chromium_headless_shell-1243"]) {
      const exe = dir.startsWith("chromium_headless_shell")
        ? path.join(base, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe")
        : path.join(base, dir, "chrome-win64", "chrome.exe");
      if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe, args: ["--lang=ru-RU"] });
    }
    throw new Error("нет браузера");
  }
}

const problems = [];
const results = { base: BASE, startedAt: new Date().toISOString() };
function problem(text) {
  problems.push(text);
  console.log("  ✗", text);
}
function ok(text) {
  console.log("  ✓", text);
}

let lastNavigation = 0;
async function throttle() {
  const wait = lastNavigation + 2_700 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNavigation = Date.now();
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const terms = page.locator("div.fixed").filter({ hasText: "Мы обновили условия" }).last();
  if (await terms.isVisible().catch(() => false)) {
    await terms.locator('input[type="checkbox"]').first().check().catch(() => {});
    await terms.getByRole("button", { name: "Принять и продолжить" }).click().catch(() => {});
    await page.waitForTimeout(1_500);
  }
  for (let i = 0; i < 2; i++) {
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.waitForTimeout(400);
}

async function goto(page, href) {
  let response = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    response = await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
    if (response?.status() !== 429) break;
    const retryAfter = Number(response.headers()["retry-after"] || 30);
    console.log(`  … 429 на ${href}, пауза ${retryAfter} с`);
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
  }
  await settle(page);
  return response;
}

function watchErrors(page, tag) {
  page.on("pageerror", (error) => problem(`${tag} ${page.url()}: pageerror ${error.message.slice(0, 160)}`));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && (text.startsWith("[app-error]") || text.includes("MISSING_MESSAGE"))) {
      problem(`${tag} ${page.url()}: ${text.slice(0, 200)}`);
    }
  });
}

async function newContext(browser, kind) {
  const options =
    kind === "desktop"
      ? { viewport: { width: 1440, height: 900 }, locale: "ru-RU" }
      : { viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" };
  return browser.newContext(options);
}

async function signIn(context, page, role, mini = false) {
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email: ROLES[role].email, password: PASSWORD },
    timeout: 600_000,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok() || body?.requiresCode) throw new Error(`вход ${role}: HTTP ${res.status()} ${JSON.stringify(body)}`);
  if (mini) await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
}

async function shot(page, name, fullPage = true) {
  await page.screenshot({ path: path.join(RAW, `${name}.png`), fullPage });
}

async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Пункты меню раздела в сайдбаре: id, адрес, подпись, подсвечен ли. */
async function sidebarItems(page) {
  return page
    .locator('[data-app-sidebar] nav[data-section-menu="points"] [data-menu-item]')
    .evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute("data-menu-item"),
        href: el.getAttribute("href"),
        label: el.textContent.trim(),
        current: el.getAttribute("aria-current") === "page",
      })),
    );
}

async function groupLabels(page) {
  return page
    .locator('[data-app-sidebar] nav[data-section-menu="points"]')
    .evaluate((nav) => Array.from(nav.querySelectorAll("div")).filter((el) => el.children.length === 0 && /^(Мои точки|Все точки|Ещё)$/.test(el.textContent.trim())).map((el) => el.textContent.trim()))
    .catch(() => []);
}

// ---- menu: меню, переход, подсветка ---------------------------------------
async function scenarioMenu(browser) {
  const out = {};
  for (const role of ["owner", "headchef"]) {
    console.log(`== menu ${ROLES[role].title} 1440`);
    const context = await newContext(browser, "desktop");
    const page = await context.newPage();
    watchErrors(page, `${role}/desktop`);
    await signIn(context, page, role);
    const visits = {};
    for (const [key, href, expect] of [
      ["overview", "/settings/buildings", "buildings"],
      ["lenina", `/settings/buildings/${LENINA}`, `buildings:${LENINA}`],
      ["mira", `/settings/buildings/${MIRA}`, `buildings:${MIRA}`],
      ["new", "/settings/buildings/new", "add"],
      ["equipment", "/settings/equipment", "equipment"],
    ]) {
      const response = await goto(page, href);
      const items = await sidebarItems(page);
      const current = items.filter((item) => item.current).map((item) => item.id);
      const h1 = await page.locator("main h1").first().innerText().catch(() => "");
      visits[key] = { href, status: response?.status(), items, current, h1, groups: await groupLabels(page) };
      if (response?.status() !== 200) problem(`${role} ${href}: HTTP ${response?.status()}`);
      if (current.length !== 1 || current[0] !== expect) problem(`${role} ${href}: подсвечено ${current.join(",") || "ничего"}, ждали ${expect}`);
      else ok(`${role} ${href}: подсвечен ${expect}, h1=${h1}`);
      await shot(page, `menu-${role}-1440-${key}`, false);
    }
    const ids = visits.lenina.items.map((item) => item.id);
    const expected = [`buildings:${LENINA}`, `buildings:${MIRA}`, "add", "buildings", "areas", "equipment", "qr"];
    if (JSON.stringify(ids.slice(0, expected.length)) !== JSON.stringify(expected)) problem(`${role}: пункты меню ${ids.join(",")}`);
    else ok(`${role}: пункты меню ${ids.join(",")}`);
    // Переход нажатием на пункт точки в меню.
    await goto(page, "/settings/buildings");
    await throttle();
    await page.locator(`[data-app-sidebar] [data-menu-item="buildings:${MIRA}"]`).click();
    await page.waitForURL(`**/settings/buildings/${MIRA}`, { timeout: 120_000 }).catch(() => {});
    await settle(page);
    const clicked = new URL(page.url()).pathname;
    const clickedCurrent = (await sidebarItems(page)).filter((item) => item.current).map((item) => item.id);
    visits.click = { path: clicked, current: clickedCurrent };
    if (clicked !== `/settings/buildings/${MIRA}` || clickedCurrent[0] !== `buildings:${MIRA}`) problem(`${role}: клик по точке → ${clicked}, подсвечено ${clickedCurrent}`);
    else ok(`${role}: клик по «Берёзка на Мира» в меню → её страница, пункт подсвечен`);
    // ⌘K: пункты точек ищутся так же, как остальные пункты меню.
    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder("Найти журнал, сотрудника, оборудование или действие…");
    await input.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
    await input.fill("Берёзка на Мира");
    await page.waitForTimeout(800);
    const paletteText = await page.locator("li", { hasText: "Торговые точки · Берёзка на Мира" }).first().innerText().catch(() => "");
    visits.palette = paletteText;
    await shot(page, `menu-${role}-1440-palette`, false);
    if (!paletteText) problem(`${role}: в ⌘K нет «Торговые точки · Берёзка на Мира»`);
    else ok(`${role}: ⌘K находит «${paletteText.split("\n")[0]}»`);
    await page.keyboard.press("Escape");
    out[`${role}-desktop`] = visits;
    await context.close();
  }

  // Телефон (лист бургера) и Mini App (кнопка меню раздела).
  for (const [tag, mini] of [["mobile", false], ["mini", true]]) {
    for (const role of ["owner", "headchef"]) {
      console.log(`== menu ${ROLES[role].title} ${tag}`);
      const context = await newContext(browser, "phone");
      const page = await context.newPage();
      watchErrors(page, `${role}/${tag}`);
      await signIn(context, page, role, mini);
      await goto(page, `/settings/buildings/${LENINA}`);
      const overflow = await horizontalOverflow(page);
      await shot(page, `menu-${role}-${tag}-lenina-page`, false);
      let items = [];
      if (mini) {
        const button = page.locator("[data-section-menu-button]");
        if (!(await button.isVisible().catch(() => false))) problem(`${role}/mini: нет кнопки меню раздела`);
        else {
          await button.click();
          await page.waitForTimeout(700);
          items = await page.locator('[data-mini-menu-mode="section"] [data-menu-item]').evaluateAll((els) =>
            els.map((el) => ({ id: el.getAttribute("data-menu-item"), current: el.getAttribute("aria-current") === "page", label: el.textContent.trim() })),
          );
        }
      } else {
        await page.locator("[data-nav-burger]").click();
        await page.waitForTimeout(700);
        items = await page.locator("[data-mobile-nav] [data-menu-item]").evaluateAll((els) =>
          els.map((el) => ({ id: el.getAttribute("data-menu-item"), current: el.getAttribute("aria-current") === "page", label: el.textContent.trim() })),
        );
      }
      await shot(page, `menu-${role}-${tag}-sheet`, false);
      const ids = items.map((item) => item.id);
      const current = items.filter((item) => item.current).map((item) => item.id);
      out[`${role}-${tag}`] = { items, overflow };
      if (!ids.includes(`buildings:${LENINA}`) || !ids.includes(`buildings:${MIRA}`) || !ids.includes("add")) problem(`${role}/${tag}: в листе нет точек: ${ids.join(",")}`);
      else ok(`${role}/${tag}: в листе ${ids.slice(0, 4).join(", ")}…`);
      if (current[0] !== `buildings:${LENINA}`) problem(`${role}/${tag}: подсвечено ${current.join(",")}`);
      if (overflow > 0) problem(`${role}/${tag}: горизонтальная прокрутка ${overflow}px`);
      await context.close();
    }
  }
  return out;
}

// ---- pages: страница точки и мастер на 1440 и 390 -------------------------
async function scenarioPages(browser) {
  const out = {};
  for (const role of ["owner", "headchef"]) {
    for (const kind of ["desktop", "phone"]) {
      const tag = kind === "desktop" ? "1440" : "390";
      console.log(`== pages ${ROLES[role].title} ${tag}`);
      const context = await newContext(browser, kind);
      const page = await context.newPage();
      watchErrors(page, `${role}/${tag}`);
      await signIn(context, page, role);
      for (const [key, href] of [
        ["lenina", `/settings/buildings/${LENINA}`],
        ["mira", `/settings/buildings/${MIRA}`],
        ["new", "/settings/buildings/new"],
        ["overview", "/settings/buildings"],
      ]) {
        const response = await goto(page, href);
        const overflow = await horizontalOverflow(page);
        const blocks = await page.locator("[data-point-block]").evaluateAll((els) => els.map((el) => el.getAttribute("data-point-block")));
        const h1 = await page.locator("main h1").first().innerText().catch(() => "");
        const info = { status: response?.status(), overflow, blocks, h1 };
        if (key === "lenina" || key === "mira") {
          info.rooms = await page.locator("[data-point-room]").count();
          info.equipment = await page.locator("[data-point-equipment]").count();
          info.lamps = await page.locator("[data-point-lamp]").count();
          info.stickers = await page.locator("[data-point-stickers]").getAttribute("data-point-stickers").catch(() => null);
          info.stickersHref = await page.locator('[data-point-qr="stickers"]').getAttribute("href").catch(() => null);
          const expectBlocks = ["head", "rooms", "equipment", "uv", "qr", "delete"];
          if (JSON.stringify(blocks) !== JSON.stringify(expectBlocks)) problem(`${role}/${tag} ${href}: блоки ${blocks.join(",")}`);
        }
        if (key === "overview") {
          info.openLinks = await page.locator("[data-open-point]").count();
          info.headerAdd = await page.locator("[data-add-point-header]").getAttribute("href").catch(() => null);
          if (info.openLinks < 2) problem(`${role}/${tag}: на обзоре ссылок «Открыть точку» ${info.openLinks}`);
          if (info.headerAdd !== "/settings/buildings/new") problem(`${role}/${tag}: в шапке обзора нет «+ Добавить точку»`);
        }
        out[`${role}-${tag}-${key}`] = info;
        if (response?.status() !== 200) problem(`${role}/${tag} ${href}: HTTP ${response?.status()}`);
        if (overflow > 0) problem(`${role}/${tag} ${href}: горизонтальная прокрутка ${overflow}px`);
        else ok(`${role}/${tag} ${href}: h1=${h1} блоки=${blocks.length} без прокрутки`);
        await shot(page, `page-${role}-${tag}-${key}`);
      }
      await context.close();
    }
  }
  // Mini App: страница точки в оболочке приложения.
  {
    const context = await newContext(browser, "phone");
    const page = await context.newPage();
    watchErrors(page, "owner/mini");
    await signIn(context, page, "owner", true);
    const response = await goto(page, `/settings/buildings/${MIRA}`);
    out["owner-mini-mira"] = { status: response?.status(), overflow: await horizontalOverflow(page) };
    await shot(page, "page-owner-mini-mira");
    await goto(page, "/settings/buildings/new");
    await shot(page, "page-owner-mini-new");
    await context.close();
  }
  return out;
}

// ---- wizard: мастер создаёт третью точку ----------------------------------
async function scenarioWizard(browser) {
  console.log("== wizard руководитель 1440");
  const context = await newContext(browser, "desktop");
  const page = await context.newPage();
  watchErrors(page, "owner/wizard");
  await signIn(context, page, "owner");
  const name = `Точка проверки ${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
  // Вход в мастер — пунктом меню «+ Добавить точку».
  await goto(page, "/settings/buildings");
  await throttle();
  await page.locator('[data-app-sidebar] [data-menu-item="add"]').click();
  await page.waitForURL("**/settings/buildings/new", { timeout: 120_000 });
  await settle(page);
  await shot(page, "wizard-1-head-empty", false);
  // Шаг 1: пустое название не пускает дальше; занятое — тоже.
  await page.locator("[data-wizard-next]").click();
  const emptyError = await page.locator('[data-point-wizard] [role="alert"]').innerText({ timeout: 10_000 }).catch(() => "");
  await page.locator("#wizard-name").fill("Берёзка на Мира");
  await page.locator("[data-wizard-next]").click();
  const takenError = await page.locator('[data-point-wizard] [role="alert"]').innerText({ timeout: 10_000 }).catch(() => "");
  await page.locator("#wizard-name").fill(name);
  await page.locator("#wizard-address").fill("ул. Проверочная, 1");
  await shot(page, "wizard-1-head", false);
  await page.locator("[data-wizard-next]").click();
  // Шаг 2: типовой набор + «Основное производство» + своё помещение.
  await page.locator('[data-wizard-room="production"]').check();
  await page.locator("#wizard-custom-room").fill("Кондитерский цех");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await shot(page, "wizard-2-rooms", false);
  // Режим «как в другой точке» показывает помещения донора.
  await page.getByRole("radio", { name: /Как в другой точке/ }).click();
  await shot(page, "wizard-2-rooms-copy", false);
  await page.getByRole("radio", { name: /Типовой набор/ }).click();
  await page.locator("[data-wizard-next]").click();
  // Шаг 3: +1 холодильник, +1 УФ-лампа, +1 фритюрница.
  for (const type of ["refrigerator", "uv_lamp", "fryer"]) {
    await page.locator(`[data-wizard-equipment="${type}"] button[aria-label^="Больше"]`).click();
  }
  await shot(page, "wizard-3-equipment", false);
  await page.locator("[data-wizard-next]").click();
  const summary = await page.locator("[data-wizard-summary]").innerText();
  await shot(page, "wizard-4-summary", false);
  await page.locator("[data-wizard-create]").click();
  await page.waitForURL(/\/settings\/buildings\/(?!new)[^/]+$/, { timeout: 180_000 });
  await settle(page);
  const pointPath = new URL(page.url()).pathname;
  const pointId = pointPath.split("/").pop();
  const items = await sidebarItems(page);
  const current = items.filter((item) => item.current).map((item) => item.id);
  const out = {
    name,
    emptyError,
    takenError,
    summary,
    pointPath,
    menu: items.map((item) => item.id),
    current,
    rooms: await page.locator("[data-point-room]").count(),
    equipment: await page.locator("[data-point-equipment]").count(),
    lamps: await page.locator("[data-point-lamp]").count(),
    h1: await page.locator("main h1").first().innerText().catch(() => ""),
  };
  await shot(page, "wizard-5-point-page");
  if (!emptyError || !takenError) problem(`wizard: нет ошибок шага 1 (${emptyError} / ${takenError})`);
  if (!items.some((item) => item.id === `buildings:${pointId}` && item.label === name)) problem(`wizard: новой точки нет в меню (${out.menu.join(",")})`);
  else ok(`wizard: «${name}» — в меню`);
  if (current[0] !== `buildings:${pointId}`) problem(`wizard: подсвечено ${current.join(",")}`);
  if (out.rooms !== 7) problem(`wizard: помещений ${out.rooms}, ждали 7`);
  if (out.equipment !== 4) problem(`wizard: оборудования ${out.equipment}, ждали 4 (2 холодильника, морозильник, фритюрница)`);
  if (out.lamps !== 1) problem(`wizard: УФ-ламп ${out.lamps}, ждали 1`);
  ok(`wizard: создано помещений ${out.rooms}, оборудования ${out.equipment}, ламп ${out.lamps}`);
  fs.writeFileSync(path.join(RAW, "wizard-point-id.txt"), `${pointId}\n${name}\n`);
  await context.close();
  return out;
}

// ---- edit: правка точки, помещение, окно УФ-лампы, удаление точки ---------
// Работает на точке, созданной сценарием wizard (raw/wizard-point-id.txt).
async function scenarioEdit(browser) {
  console.log("== edit руководитель 1440");
  const [pointId, pointName] = fs.readFileSync(path.join(RAW, "wizard-point-id.txt"), "utf8").trim().split("\n");
  const context = await newContext(browser, "desktop");
  const page = await context.newPage();
  watchErrors(page, "owner/edit");
  await signIn(context, page, "owner");
  await goto(page, `/settings/buildings/${pointId}`);
  const out = { pointId, pointName };

  // 1. Название и адрес — окном, через PATCH точки; название в меню обновляется.
  const renamed = `${pointName} ред`;
  await page.locator('[data-point-block="head"] button', { hasText: "Изменить" }).click();
  await page.locator("#point-name").fill(renamed);
  await page.locator("#point-phone").fill("+7 900 000-00-00");
  await page.locator("#point-kpp").fill("771001001");
  await shot(page, "edit-1-head-dialog", false);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await page.waitForFunction((name) => document.querySelector("main h1")?.textContent?.includes(name), renamed, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
  const menuLabel = await page.locator(`[data-app-sidebar] [data-menu-item="buildings:${pointId}"]`).innerText().catch(() => "");
  const headText = await page.locator('[data-point-block="head"]').innerText();
  out.rename = { menuLabel, h1: await page.locator("main h1").first().innerText(), phoneShown: headText.includes("+7 900 000-00-00"), kppShown: headText.includes("771001001") };
  if (!menuLabel.includes(renamed)) problem(`edit: в меню не новое название (${menuLabel})`);
  else ok(`edit: переименована — в меню «${menuLabel}»`);
  if (!out.rename.phoneShown || !out.rename.kppShown) problem("edit: телефон/КПП не показаны после сохранения");
  await shot(page, "edit-2-head-saved", false);

  // 2. Помещение — существующим API, появляется в списке.
  const before = await page.locator("[data-point-room]").count();
  await page.locator("#point-room-name").fill("Тестовая комната");
  await page.getByRole("button", { name: "Добавить помещение" }).click();
  await page.waitForFunction((n) => document.querySelectorAll("[data-point-room]").length > n, before, { timeout: 60_000 }).catch(() => {});
  out.rooms = { before, after: await page.locator("[data-point-room]").count() };
  if (out.rooms.after !== before + 1) problem(`edit: помещение не добавилось (${before} → ${out.rooms.after})`);
  else ok(`edit: помещений ${before} → ${out.rooms.after}`);

  // 3. «Добавить УФ-лампу» — окно оборудования с типом «УФ-лампа» и этой точкой.
  await page.getByRole("button", { name: "Добавить УФ-лампу" }).click();
  await page.waitForTimeout(800);
  out.uvDialog = {
    type: await page.locator("#eq-type").innerText().catch(() => ""),
    building: await page.locator("#eq-building").innerText().catch(() => ""),
    lampSection: await page.locator('[data-testid="lamp-section"]').isVisible().catch(() => false),
  };
  await shot(page, "edit-3-uv-dialog", false);
  if (!out.uvDialog.type.includes("УФ") || !out.uvDialog.lampSection) problem(`edit: окно УФ-лампы без типа (${JSON.stringify(out.uvDialog)})`);
  else ok(`edit: окно УФ-лампы — тип «${out.uvDialog.type}», точка «${out.uvDialog.building}»`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // 4. Удаление — ConfirmDialog с вводом названия и последствиями.
  await page.locator('[data-point-block="delete"] button', { hasText: "Удалить точку" }).click();
  await page.waitForTimeout(600);
  const dialog = page.locator('[role="dialog"], [role="alertdialog"]').last();
  out.deleteDialog = await dialog.innerText().catch(() => "");
  await shot(page, "edit-4-delete-dialog", false);
  const confirm = dialog.getByRole("button", { name: "Удалить точку" });
  out.confirmDisabledBeforeTyping = await confirm.isDisabled().catch(() => null);
  await dialog.getByPlaceholder(renamed).fill(renamed);
  await confirm.click();
  await page.waitForURL("**/settings/buildings", { timeout: 120_000 }).catch(() => {});
  await settle(page);
  await page.waitForTimeout(1_500);
  const menuAfter = (await sidebarItems(page)).map((item) => item.id);
  out.afterDelete = { path: new URL(page.url()).pathname, menu: menuAfter };
  await shot(page, "edit-5-after-delete", false);
  if (out.confirmDisabledBeforeTyping !== true) problem("edit: кнопка удаления доступна без ввода названия");
  if (menuAfter.includes(`buildings:${pointId}`)) problem("edit: удалённая точка осталась в меню");
  else ok(`edit: точка удалена, меню ${menuAfter.slice(0, 3).join(", ")}…, адрес ${out.afterDelete.path}`);
  await context.close();
  return out;
}

// ---- cook: прямой заход повара -------------------------------------------
async function scenarioCook(browser) {
  console.log("== cook");
  const out = {};
  const context = await newContext(browser, "desktop");
  const page = await context.newPage();
  await signIn(context, page, "cook");
  for (const href of [`/settings/buildings/${LENINA}`, "/settings/buildings/new", "/settings/buildings"]) {
    const response = await goto(page, href);
    // Повара уводят дальше (`/journals` → его стартовая страница) — ждём, пока адрес устоится.
    let sections = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.waitForTimeout(2_000);
      await settle(page);
      try {
        sections = await page.locator("[data-nav-section]").evaluateAll((els) => els.map((el) => el.getAttribute("data-nav-section")));
        break;
      } catch {
        /* навигация ещё идёт */
      }
    }
    const finalPath = new URL(page.url()).pathname;
    out[href] = { status: response?.status(), finalPath, pointsInMenu: sections.includes("points") };
    if (finalPath.startsWith("/settings/buildings")) problem(`cook ${href}: страница открылась (${finalPath})`);
    else ok(`cook ${href} → ${finalPath}`);
    await shot(page, `cook-${href.split("/").pop()}`, false);
  }
  await context.close();
  return out;
}

const browser = await launch();
try {
  for (const name of ONLY) {
    const run = { menu: scenarioMenu, pages: scenarioPages, wizard: scenarioWizard, edit: scenarioEdit, cook: scenarioCook }[name];
    if (!run) continue;
    results[name] = await run(browser);
    fs.writeFileSync(path.join(RAW, `results-${name}.json`), JSON.stringify({ ...results[name], problems }, null, 2));
  }
} finally {
  await browser.close();
}
results.finishedAt = new Date().toISOString();
results.problems = problems;
fs.writeFileSync(path.join(RAW, `results-${ONLY.join("-")}.json`), JSON.stringify(results, null, 2));
console.log(problems.length ? `ПРОБЛЕМ: ${problems.length}` : "OK: проблем нет");
process.exit(problems.length ? 1 : 0);
