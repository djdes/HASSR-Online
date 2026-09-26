// E2E: тема прямо в меню профиля — три карточки «Светлая / Тёмная / Как на устройстве».
// Dev-сервер :3046 (NEXT_DIST_DIR=.next-e2e), своя база wesetup_wt_theme, SMTP пуст.
// Запуск: node .agent/tasks/theme-tiles-2026-09/raw/e2e-theme-tiles.cjs
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const WT = "C:/wt/theme";
const req = createRequire(path.join(WT, "package.json"));
const { chromium } = req("playwright-core");
const { Client } = req("pg");
const bcrypt = req("bcryptjs");

const BASE = "http://localhost:3046";
const TASK = path.join(WT, ".agent/tasks/theme-tiles-2026-09");
const EVID = path.join(TASK, "evidence");
const RESULTS = path.join(TASK, "raw/e2e-results.json");
const CHROME = path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1232/chrome-win64/chrome.exe");
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_theme?sslmode=disable";

const RUN = Date.now().toString(36);
const OWNER = `theme-owner-${RUN}@example.com`;
const COOK = `theme-cook-${RUN}@example.com`;
const CHEF = `theme-chef-${RUN}@example.com`;
const PASSWORD = "ThemeTiles2026!";
const ORG_NAME = "Кафе «Ромашка»";
const MODE_KEY = "wesetup-theme-mode";
const AUTO_KEY = "wesetup-theme-auto-schedule";
const LABELS = ["Светлая", "Тёмная", "Как на устройстве"];

fs.mkdirSync(EVID, { recursive: true });
const results = { run: RUN, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
function check(ac, name, ok, detail) {
  results.checks.push({ ac, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${ac}] ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
}

async function sql(text, params = []) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
}

async function login(context, email, password) {
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`, { timeout: 240000 })).json();
  const res = await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
    timeout: 240000,
  });
  const cookies = await context.cookies();
  return { status: res.status(), session: cookies.some((c) => c.name.includes("session-token")) };
}

async function quietPage(context, label) {
  const page = await context.newPage();
  // «Что нового» — не часть проверки.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("wesetup.last-seen-build-sha", "e2e");
    } catch {}
    // Значок dev-сервера Next.js («N · 1 Issue») — не часть продукта, на
    // снимках он закрывал подвал листа.
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
    // Журнал смен темы на странице: что было при DOMContentLoaded и каждое
    // следующее изменение data-app-theme у .app-shell (повторы схлопнуты).
    window.__themeFlips = [];
    const t0 = performance.now();
    const push = (entry, value) => {
      const last = window.__themeFlips[window.__themeFlips.length - 1];
      if (!last || !last.endsWith(":" + value)) window.__themeFlips.push(entry);
    };
    document.addEventListener("DOMContentLoaded", () => {
      const v = document.querySelector(".app-shell")?.getAttribute("data-app-theme");
      push(`dcl@${Math.round(performance.now() - t0)}:${v}`, v);
    });
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.target.classList && m.target.classList.contains("app-shell")) {
          const v = m.target.getAttribute("data-app-theme");
          push(`${Math.round(performance.now() - t0)}:${v}`, v);
        }
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-app-theme"] });
  });
  page.on("pageerror", (err) => results.pageErrors.push({ page: label, message: String(err && err.message).slice(0, 300) }));
  return page;
}

/** SSR-разметка видна раньше гидратации — кликать можно, когда React повесил обработчики. */
async function waitHydrated(page, selector, timeout = 240000) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el && Object.keys(el).some((k) => k.startsWith("__reactProps")));
    },
    selector,
    { timeout },
  );
}

async function gotoHydrated(page, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  try {
    await waitHydrated(page, 'button[aria-label="Профиль"]', 120000);
  } catch {
    // Dev-сервер иногда теряет чанк, пока компилирует другой маршрут: одна перезагрузка.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
    await waitHydrated(page, 'button[aria-label="Профиль"]', 240000);
  }
}

const appTheme = (page) => page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-app-theme") ?? null);
const storage = (page) =>
  page.evaluate(([m, a]) => ({ mode: localStorage.getItem(m), auto: localStorage.getItem(a), effective: localStorage.getItem("wesetup-app-theme") }), [MODE_KEY, AUTO_KEY]);
async function waitTheme(page, expected, timeout = 15000) {
  await page.waitForFunction((t) => document.querySelector(".app-shell")?.getAttribute("data-app-theme") === t, expected, { timeout });
}
const dbTheme = async (email) => (await sql('select "themePreference" from "User" where email = $1', [email]))[0].themePreference;

async function openDesktopMenu(page) {
  const menu = page.locator('[data-slot="dropdown-menu-content"]');
  await page.locator('button[aria-label="Профиль"]').click();
  try {
    await menu.getByTestId("theme-tiles").waitFor({ timeout: 20000 });
  } catch {
    await page.keyboard.press("Escape").catch(() => {});
    await page.locator('button[aria-label="Профиль"]').click();
    await menu.getByTestId("theme-tiles").waitFor({ timeout: 60000 });
  }
  await page.waitForTimeout(350);
  return menu;
}

async function openSheet(page) {
  await page.locator('button[aria-label="Профиль"]').click();
  const sheet = page.locator('[role="dialog"]').filter({ has: page.getByTestId("theme-tiles") });
  await sheet.waitFor({ timeout: 60000 });
  await page.waitForTimeout(700);
  return sheet;
}

async function tileStates(scope) {
  return scope.evaluate((root) =>
    ["light", "dark", "system"].map((m) => {
      const el = root.querySelector(`[data-testid="theme-tile-${m}"]`);
      return el ? { mode: m, checked: el.getAttribute("aria-checked"), label: el.textContent.trim(), role: el.getAttribute("role") } : null;
    }),
  );
}
const checkedModes = (states) => states.filter((s) => s && s.checked === "true").map((s) => s.mode);

async function measureTiles(scope) {
  return scope.evaluate((root) => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const tiles = ["light", "dark", "system"].map((m) => root.querySelector(`[data-testid="theme-tile-${m}"]`));
    const labels = tiles.map((t) => t.lastElementChild);
    const lines = labels.map((l) => {
      const range = document.createRange();
      range.selectNodeContents(l);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    return {
      viewport: window.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      rootScroll: { client: root.clientWidth, scroll: root.scrollWidth },
      tiles: tiles.map(rect),
      frames: tiles.map((t) => rect(t.firstElementChild)),
      labels: labels.map((l) => l.textContent.trim()),
      labelFontSize: getComputedStyle(labels[0]).fontSize,
      labelLines: lines,
    };
  });
}

async function tileColors(scope) {
  return scope.evaluate((root) => {
    const q = (m) => root.querySelector(`[data-testid="theme-tile-${m}"]`);
    const info = (m) => {
      const t = q(m);
      return {
        checked: t.getAttribute("aria-checked"),
        frameBorder: getComputedStyle(t.firstElementChild).borderTopColor,
        labelColor: getComputedStyle(t.lastElementChild).color,
        labelWeight: getComputedStyle(t.lastElementChild).fontWeight,
      };
    };
    const card = (m, i = 0) => getComputedStyle(q(m).querySelectorAll("svg")[i].querySelectorAll("rect")[1]).fill;
    const dot = (m, i = 0) => getComputedStyle(q(m).querySelectorAll("svg")[i].querySelector("circle")).fill;
    const split = q("system").querySelectorAll("svg");
    return {
      panelBg: getComputedStyle(root).backgroundColor,
      light: info("light"),
      dark: info("dark"),
      system: info("system"),
      previews: {
        lightCard: card("light"),
        lightDot: dot("light"),
        darkCard: card("dark"),
        darkDot: dot("dark"),
        systemLayers: split.length,
        systemLightCard: card("system", 0),
        systemDarkCard: card("system", 1),
        systemClip: getComputedStyle(split[1].parentElement).clipPath,
      },
    };
  });
}

function parseRgb(s) {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b] = m[1].split(",").map((x) => parseFloat(x));
  return [r, g, b];
}
function luminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [x, y] = [luminance(parseRgb(a)), luminance(parseRgb(b))].sort((p, q) => q - p);
  return Number(((x + 0.05) / (y + 0.05)).toFixed(2));
}

async function shot(locator, file) {
  await locator.page().waitForTimeout(300);
  await locator.screenshot({ path: path.join(EVID, file), animations: "disabled" });
}

async function clickTile(page, scope, mode, expectedTheme) {
  // Ждём ответа сервера, а не только запроса: следующий шаг — перезагрузка,
  // и сервер должен успеть записать тему в профиль.
  const isThisPost = (req) => req.url().endsWith("/api/me/theme") && req.method() === "POST" && req.postDataJSON()?.theme === expectedTheme;
  const sent = page.waitForRequest(isThisPost, { timeout: 20000 }).then(() => true).catch(() => false);
  const post = page
    .waitForResponse((r) => isThisPost(r.request()), { timeout: 90000 })
    .then((r) => ({ ...r.request().postDataJSON(), status: r.status() }))
    .catch(() => null);
  const t0 = Date.now();
  await scope.getByTestId(`theme-tile-${mode}`).click();
  if (expectedTheme) await waitTheme(page, expectedTheme);
  const ms = Date.now() - t0;
  if (!expectedTheme) return { ms, post: null };
  const wasSent = await sent;
  return { ms, post: wasSent ? await post : null };
}

/** Перезагрузка: итоговая тема, какие темы мелькали и что ушло на сервер. */
async function reloadAndSettle(page, expected) {
  const posts = [];
  const onRequest = (r) => {
    if (r.url().endsWith("/api/me/theme") && r.method() === "POST") posts.push(r.postDataJSON().theme);
  };
  page.on("request", onRequest);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
  try {
    await waitHydrated(page, 'button[aria-label="Профиль"]', 120000);
  } catch {
    // Dev-сервер иногда отдаёт битый чанк («Loading chunk … failed») — одна перезагрузка.
    results.devReloadRetries = (results.devReloadRetries || 0) + 1;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
    await waitHydrated(page, 'button[aria-label="Профиль"]', 240000);
  }
  await waitTheme(page, expected, 20000).catch(() => {});
  await page.waitForTimeout(1500);
  page.off("request", onRequest);
  return { theme: await appTheme(page), storage: await storage(page), posts, flips: await page.evaluate(() => window.__themeFlips) };
}
const flipValues = (flips) => [...new Set(flips.map((f) => f.split(":").pop()))];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--use-gl=swiftshader"] });
  try {
    // ---------- Свежая организация: владелец, повар и шеф ----------
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU", colorScheme: "light" });
    const reg = await desk.request.post(`${BASE}/api/auth/instant-register`, { data: { email: OWNER, consent: true }, timeout: 240000 });
    const regBody = await reg.json().catch(() => null);
    check("setup", "мгновенная регистрация владельца → новая организация и вход", reg.status() === 200 && regBody && regBody.created === true, { status: reg.status() });
    const [me] = await sql('select id, "organizationId", "legalVersion", role, "themePreference" from "User" where email = $1', [OWNER]);
    const ORG = me.organizationId;
    const hash = bcrypt.hashSync(PASSWORD, 10);
    // Анкета заполнена (иначе поверх — «Завершите регистрацию»), пароль известен для входа с телефона.
    await sql('update "Organization" set name = $1 where id = $2', [ORG_NAME, ORG]);
    await sql('update "User" set name = $1, phone = $2, "showWhatsNew" = false, "passwordHash" = $3 where id = $4', ["Анна Смирнова", "+79990001122", hash, me.id]);
    for (const [id, email, name, role] of [
      [`th2${RUN}`, COOK, "Пётр Повар", "cook"],
      [`th3${RUN}`, CHEF, "Ольга Шеф", "head_chef"],
    ]) {
      await sql(
        'insert into "User" (id, email, name, phone, "passwordHash", role, "organizationId", "journalAccessMigrated", "showWhatsNew", "legalVersion") values ($1,$2,$3,$4,$5,$6,$7,true,false,$8)',
        [id, email, name, "+79990002233", hash, role, ORG, me.legalVersion],
      );
    }
    check("setup", "владелец организации, тема в профиле по умолчанию", Boolean(me.role), { role: me.role, themePreference: me.themePreference });

    // ================= AC2: компьютер 1440 =================
    const page = await quietPage(desk, "owner-1440");
    await gotoHydrated(page, "/dashboard");
    const start = { theme: await appTheme(page), storage: await storage(page) };
    let menu = await openDesktopMenu(page);
    let states = await tileStates(menu);
    let m = await measureTiles(menu);
    const menuText = await menu.innerText();
    check(
      "AC2",
      "1440: в меню профиля блок «Тема» — три карточки в ряд, подписи «Светлая / Тёмная / Как на устройстве»",
      states.every(Boolean) && states.map((s) => s.label).join("|") === LABELS.join("|") && new Set(m.tiles.map((t) => t.y)).size === 1 && menuText.includes("ТЕМА"),
      { states, tiles: m.tiles, frames: m.frames, labelFontSize: m.labelFontSize, labelLines: m.labelLines },
    );
    check("AC2", "1440: выбрана карточка текущей темы (светлая), остальные — нет", checkedModes(states).join() === "light" && start.theme === "light", { start, checked: checkedModes(states) });
    check(
      "AC2",
      "1440: пункта «Внешний вид» в меню больше нет; владельцу — маленькая ссылка «Логотип и цвета» в «Брендинг»",
      !menuText.includes("Внешний вид") && (await menu.getByTestId("theme-branding-link").getAttribute("href")) === "/settings/organization#branding",
      { hasAppearanceItem: menuText.includes("Внешний вид"), brandingHref: await menu.getByTestId("theme-branding-link").getAttribute("href") },
    );
    let colors = await tileColors(menu);
    check("AC4", "1440 светлая: выбранная — рамка #5566f6 и индиго-подпись; контраст подписи ≥ 4.5", colors.light.frameBorder === "rgb(85, 102, 246)" && colors.light.labelColor === "rgb(56, 72, 199)" && contrast(colors.light.labelColor, colors.panelBg) >= 4.5, {
      selected: colors.light,
      unselected: colors.dark,
      panelBg: colors.panelBg,
      labelContrast: contrast(colors.light.labelColor, colors.panelBg),
      unselectedContrast: contrast(colors.dark.labelColor, colors.panelBg),
    });
    await shot(menu, "ac4-1440-light-menu.png");

    let r = await clickTile(page, menu, "dark", "dark");
    states = await tileStates(menu);
    check("AC2", "1440: «Тёмная» — кабинет тёмный сразу, меню не закрылось, выбрана «Тёмная»", (await menu.isVisible()) && checkedModes(states).join() === "dark" && r.ms < 2000, { ms: r.ms, checked: checkedModes(states) });
    check("AC2", "сохранение как раньше: POST /api/me/theme { theme: 'dark' }, в localStorage режим dark", r.post && r.post.theme === "dark" && (await storage(page)).mode === "dark", { post: r.post, storage: await storage(page) });
    colors = await tileColors(menu);
    check(
      "AC4",
      "1440 тёмная: превью не перекрашиваются (светлая карточка белая), рамка и подпись выбранной — индиго тёмной темы, контраст ≥ 4.5",
      colors.previews.lightCard === "rgb(255, 255, 255)" && colors.previews.darkCard === "rgb(58, 55, 87)" && colors.dark.frameBorder === "rgb(112, 129, 248)" && contrast(colors.dark.labelColor, colors.panelBg) >= 4.5,
      { previews: colors.previews, selected: colors.dark, panelBg: colors.panelBg, labelContrast: contrast(colors.dark.labelColor, colors.panelBg), unselectedContrast: contrast(colors.light.labelColor, colors.panelBg) },
    );
    await shot(menu, "ac4-1440-dark-menu.png");

    // Клавиатура в меню: влево — к «Светлой», Enter — выбрать, меню остаётся.
    await page.keyboard.press("ArrowLeft");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-theme-tile"));
    await page.keyboard.press("Enter");
    await waitTheme(page, "light");
    states = await tileStates(menu);
    check("AC2", "1440: клавиатура — стрелка влево ведёт по ряду, Enter выбирает, меню не закрывается", focused === "light" && checkedModes(states).join() === "light" && (await menu.isVisible()), { focusedAfterArrowLeft: focused, checked: checkedModes(states) });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const lastTile = await page.evaluate(() => document.activeElement?.getAttribute("data-theme-tile"));
    await page.keyboard.press("ArrowDown");
    // Radix переводит фокус по вверх-вниз в setTimeout — ждём, а не читаем сразу.
    await page
      .waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "theme-branding-link", null, { timeout: 3000 })
      .catch(() => {});
    const afterDown = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    check("AC2", "1440: вверх-вниз карточки — обычные пункты меню: с последней карточки стрелка вниз ведёт к «Логотип и цвета»", lastTile === "system" && afterDown === "theme-branding-link" && (await appTheme(page)) === "light", { lastTile, afterDown });

    r = await clickTile(page, menu, "dark", "dark");
    const afterReload = { ...(await reloadAndSettle(page, "dark")), db: await dbTheme(OWNER) };
    check("AC2", "1440: после перезагрузки тема тёмная (localStorage + User.themePreference), без мигания светлой и без лишних POST", afterReload.theme === "dark" && afterReload.storage.mode === "dark" && afterReload.db === "dark" && flipValues(afterReload.flips).join() === "dark" && afterReload.posts.length === 0, afterReload);

    // ================= AC3: «Как на устройстве» и смена по времени суток =================
    await page.emulateMedia({ colorScheme: "light" });
    menu = await openDesktopMenu(page);
    r = await clickTile(page, menu, "system", "light");
    const sysLight = { theme: await appTheme(page), storage: await storage(page), checked: checkedModes(await tileStates(menu)) };
    await page.emulateMedia({ colorScheme: "dark" });
    await waitTheme(page, "dark");
    const sysDark = await appTheme(page);
    await page.emulateMedia({ colorScheme: "light" });
    await waitTheme(page, "light");
    const sysBack = await appTheme(page);
    check("AC3", "«Как на устройстве» следует системной теме на лету (prefers-color-scheme light → dark → light)", sysLight.theme === "light" && sysLight.storage.mode === "system" && sysLight.checked.join() === "system" && sysDark === "dark" && sysBack === "light", { sysLight, sysDark, sysBack });
    await page.keyboard.press("Escape");
    // Старая страница в режиме «как на устройстве» сама отправит тёмную на
    // сервер, когда система станет тёмной, — ждём этого до перезагрузки.
    const osPost = page
      .waitForResponse((resp) => resp.url().endsWith("/api/me/theme") && resp.request().postDataJSON()?.theme === "dark", { timeout: 20000 })
      .then((resp) => resp.status())
      .catch(() => null);
    await page.emulateMedia({ colorScheme: "dark" });
    await waitTheme(page, "dark");
    const osPostStatus = await osPost;
    const sysReload = { ...(await reloadAndSettle(page, "dark")), db: await dbTheme(OWNER) };
    check("AC3", "«Как на устройстве»: система стала тёмной — страница сама перешла на тёмную и сохранила её; после перезагрузки тёмная, без мигания и лишних POST", osPostStatus === 200 && sysReload.theme === "dark" && sysReload.storage.mode === "system" && sysReload.db === "dark" && flipValues(sysReload.flips).join() === "dark" && sysReload.posts.length === 0, { osPostStatus, ...sysReload });

    // Смена по времени суток включена → подсказка, ни одна карточка не выбрана.
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate((k) => localStorage.setItem(k, "1"), AUTO_KEY);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
    await waitHydrated(page, 'button[aria-label="Профиль"]');
    const byHour = await page.evaluate(() => {
      const h = new Date().getHours();
      return h >= 7 && h < 19 ? "light" : "dark";
    });
    const opposite = byHour === "light" ? "dark" : "light";
    menu = await openDesktopMenu(page);
    let note = menu.getByTestId("theme-auto-note");
    const autoOn = { theme: await appTheme(page), checked: checkedModes(await tileStates(menu)), note: (await note.innerText()).trim(), state: await note.getAttribute("data-state") };
    check("AC3", "включена смена по времени суток: тема по часу, ни одна карточка не выбрана, подсказка «выбор выключит смену»", autoOn.theme === byHour && autoOn.checked.length === 0 && autoOn.state === "on" && autoOn.note.includes("по времени суток") && autoOn.note.includes("выключится"), { byHour, ...autoOn });
    await shot(menu.getByTestId("profile-theme"), "ac3-1440-auto-note.png");

    r = await clickTile(page, menu, opposite, opposite);
    note = menu.getByTestId("theme-auto-note");
    const autoOff = { theme: await appTheme(page), storage: await storage(page), checked: checkedModes(await tileStates(menu)), note: (await note.innerText()).trim(), state: await note.getAttribute("data-state") };
    check("AC3", "нажатие на карточку выключает смену по времени суток — и меню говорит «выключена»", autoOff.storage.auto === "0" && autoOff.storage.mode === opposite && autoOff.theme === opposite && autoOff.checked.join() === opposite && autoOff.state === "turned-off" && autoOff.note.includes("выключена"), autoOff);
    await shot(menu.getByTestId("profile-theme"), "ac3-1440-auto-turned-off.png");

    await menu.getByTestId("theme-auto-restore").click();
    await waitTheme(page, byHour);
    const restored = { theme: await appTheme(page), storage: await storage(page), checked: checkedModes(await tileStates(menu)), state: await menu.getByTestId("theme-auto-note").getAttribute("data-state") };
    check("AC3", "«Включить снова» возвращает смену по времени суток", restored.storage.auto === "1" && restored.theme === byHour && restored.checked.length === 0 && restored.state === "on", restored);
    r = await clickTile(page, menu, "light", "light");
    check("AC3", "снова карточка → смена по времени выключена, «Светлая»", (await storage(page)).auto === "0" && (await appTheme(page)) === "light", await storage(page));
    await page.keyboard.press("Escape");

    // Страница «Настройки → Внешний вид» — те же карточки, галочка на месте.
    await gotoHydrated(page, "/settings/appearance");
    const settingsTiles = page.locator("main").getByTestId("theme-tiles");
    await settingsTiles.waitFor({ timeout: 60000 });
    const autoBox = page.getByRole("checkbox", { name: /Менять по времени суток/ });
    await autoBox.check();
    const settingsAuto = { checked: checkedModes(await tileStates(settingsTiles)), storage: await storage(page), note: await settingsTiles.getByTestId("theme-auto-note").count() };
    await settingsTiles.getByTestId("theme-tile-light").click();
    await waitTheme(page, "light");
    const settingsAfter = { box: await autoBox.isChecked(), storage: await storage(page), checked: checkedModes(await tileStates(settingsTiles)) };
    check("AC3", "/settings/appearance: те же карточки; галочка «Менять по времени суток» снимается нажатием на карточку", settingsAuto.storage.auto === "1" && settingsAuto.checked.length === 0 && settingsAuto.note === 0 && settingsAfter.box === false && settingsAfter.storage.auto === "0" && settingsAfter.checked.join() === "light", { settingsAuto, settingsAfter });
    await shot(page.locator("main section").first(), "settings-appearance-1440.png");

    // ================= AC1: телефон 390 =================
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU", colorScheme: "light" });
    const pl = await login(phone, OWNER, PASSWORD);
    check("setup", "вход владельца с телефона", pl.session, pl);
    const p = await quietPage(phone, "owner-390");
    await gotoHydrated(p, "/dashboard");
    const phoneStart = { theme: await appTheme(p), db: await dbTheme(OWNER) };
    let sheet = await openSheet(p);
    states = await tileStates(sheet);
    m = await measureTiles(sheet);
    const sheetText = await sheet.innerText();
    check(
      "AC1",
      "390: в меню профиля (лист снизу) подзаголовок «Тема» и три карточки в один ряд, крупные",
      states.every(Boolean) && states.map((s) => s.label).join("|") === LABELS.join("|") && states.every((s) => s.role === "radio") && new Set(m.tiles.map((t) => t.y)).size === 1 && m.tiles.every((t) => t.w >= 100 && t.h >= 90) && sheetText.includes("ТЕМА"),
      { tiles: m.tiles, frames: m.frames, labelFontSize: m.labelFontSize, labelLines: m.labelLines },
    );
    check("AC1", "390: строки «Внешний вид» нет; «Логотип и цвета» — маленькая ссылка под карточками (владельцу)", !sheetText.includes("Внешний вид") && (await sheet.getByTestId("theme-branding-link").isVisible()), { hasAppearanceRow: sheetText.includes("Внешний вид") });
    // Высота листа ограничена 88dvh: у владельца с пунктами «Добавить / демо-организация»
    // середина листа прокручивается — фиксируем, насколько (для отчёта, не критерий).
    const sheetScroll = await sheet.evaluate((root) => {
      const body = root.querySelector('[class*="overflow-y-auto"]');
      return { sheetHeight: Math.round(root.getBoundingClientRect().height), bodyClient: body.clientHeight, bodyScroll: body.scrollHeight };
    });
    check("AC1", "390: без горизонтальной прокрутки", m.pageScrollWidth <= m.viewport && m.rootScroll.scroll <= m.rootScroll.client + 1, { pageScrollWidth: m.pageScrollWidth, root: m.rootScroll, sheetScroll });
    check("AC1", "390: новая сессия телефона открылась в теме из профиля (другое устройство)", phoneStart.theme === phoneStart.db, phoneStart);

    r = await clickTile(p, sheet, "light", phoneStart.theme === "light" ? null : "light");
    if (phoneStart.theme !== "light") await waitTheme(p, "light");
    await p.waitForTimeout(400);
    colors = await tileColors(sheet);
    check("AC4", "390 светлая: выбранная карточка — рамка #5566f6 и индиго-подпись, контраст ≥ 4.5", colors.light.frameBorder === "rgb(85, 102, 246)" && contrast(colors.light.labelColor, colors.panelBg) >= 4.5, { selected: colors.light, panelBg: colors.panelBg, labelContrast: contrast(colors.light.labelColor, colors.panelBg) });
    await shot(sheet, "ac4-390-light-sheet.png");

    r = await clickTile(p, sheet, "dark", "dark");
    check("AC1", "390: нажатие «Тёмная» — тема сразу тёмная, лист остаётся открытым, сохранено на сервер", (await sheet.isVisible()) && checkedModes(await tileStates(sheet)).join() === "dark" && r.post && r.post.theme === "dark" && r.ms < 2000, { ms: r.ms, post: r.post });
    await p.waitForTimeout(400);
    colors = await tileColors(sheet);
    check("AC4", "390 тёмная: превью остаются собой, подпись выбранной читается (контраст ≥ 4.5)", colors.previews.lightCard === "rgb(255, 255, 255)" && contrast(colors.dark.labelColor, colors.panelBg) >= 4.5, { previews: colors.previews, selected: colors.dark, panelBg: colors.panelBg, labelContrast: contrast(colors.dark.labelColor, colors.panelBg) });
    const separators = await sheet.evaluate((root) =>
      [...root.querySelectorAll('[class*="border-[#f0f1f7]"]')].map((el) => getComputedStyle(el).borderTopColor),
    );
    check("AC4", "390 тёмная: разделители листа — тёмная линия темы, а не белая полоса", separators.length >= 1 && separators.every((c) => c === "rgba(255, 255, 255, 0.12)"), { separators });
    await shot(sheet, "ac4-390-dark-sheet.png");
    await p.screenshot({ path: path.join(EVID, "ac4-390-dark-full.png"), animations: "disabled" });

    const phoneReload1 = { ...(await reloadAndSettle(p, "dark")), db: await dbTheme(OWNER) };
    sheet = await openSheet(p);
    const phoneChecked1 = checkedModes(await tileStates(sheet));
    r = await clickTile(p, sheet, "light", "light");
    const phoneReload2 = { ...(await reloadAndSettle(p, "light")), db: await dbTheme(OWNER) };
    check(
      "AC1",
      "390: выбор сохраняется после перезагрузки (тёмная → перезагрузка → тёмная; светлая → перезагрузка → светлая), без мигания и лишних POST",
      phoneReload1.theme === "dark" && phoneReload1.db === "dark" && phoneChecked1.join() === "dark" && flipValues(phoneReload1.flips).join() === "dark" && phoneReload1.posts.length === 0 &&
        phoneReload2.theme === "light" && phoneReload2.db === "light" && flipValues(phoneReload2.flips).join() === "light" && phoneReload2.posts.length === 0,
      { phoneReload1, phoneChecked1, phoneReload2 },
    );

    // Клавиатура в листе: стрелки выбирают соседнюю, как у radio.
    sheet = await openSheet(p);
    await sheet.getByTestId("theme-tile-light").focus();
    await p.keyboard.press("ArrowRight");
    await waitTheme(p, "dark");
    const kbd = { focused: await p.evaluate(() => document.activeElement?.getAttribute("data-theme-tile")), checked: checkedModes(await tileStates(sheet)) };
    await p.keyboard.press("ArrowLeft");
    await waitTheme(p, "light");
    check("AC1", "390: клавиатура в листе — стрелка вправо выбирает «Тёмную», влево — обратно", kbd.focused === "dark" && kbd.checked.join() === "dark" && (await appTheme(p)) === "light", kbd);

    // «Логотип и цвета» → настройки организации, блок «Брендинг».
    await sheet.getByTestId("theme-branding-link").click();
    await p.waitForURL(/\/settings\/organization#branding$/, { timeout: 240000 });
    await p.locator("#branding").waitFor({ timeout: 240000 });
    await p.waitForTimeout(1500);
    const branding = await p.evaluate(() => {
      const el = document.getElementById("branding");
      const rct = el.getBoundingClientRect();
      return { top: Math.round(rct.top), text: el.innerText.slice(0, 60), sheetOpen: Boolean(document.querySelector('[role="dialog"] [data-testid="theme-tiles"]')) };
    });
    check("AC1", "«Логотип и цвета» ведёт в «Настройки → Организация», блок «Брендинг» (логотип и цвет — там), лист закрыт", branding.text.startsWith("Брендинг") && branding.top >= 0 && branding.top < 844 && !branding.sheetOpen, { url: p.url(), branding });

    // ================= Права: повар и шеф =================
    const cookCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU" });
    await login(cookCtx, COOK, PASSWORD);
    const cp = await quietPage(cookCtx, "cook-390");
    // /journals повара уводит в мини-приложение (нет journals.view); /settings/balance — страница кабинета.
    await gotoHydrated(cp, "/settings/balance");
    const cookSheet = await openSheet(cp);
    const cookStates = await tileStates(cookSheet);
    const cookLink = await cookSheet.getByTestId("theme-branding-link").count();
    const cookStart = await appTheme(cp);
    const target = cookStart === "dark" ? "light" : "dark";
    const cr = await clickTile(cp, cookSheet, target, target);
    check("AC1", "повар: карточки темы есть и работают (тема личная), ссылки «Логотип и цвета» нет", cookStates.every(Boolean) && cookLink === 0 && cr.post && cr.post.theme === target && (await dbTheme(COOK)) === target, { cookLink, switchedTo: target, db: await dbTheme(COOK) });

    const chefCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU" });
    await login(chefCtx, CHEF, PASSWORD);
    const hp = await quietPage(chefCtx, "chef-1440");
    // Дом шефа — /control-board (с /journals его туда и уводит).
    await gotoHydrated(hp, "/control-board");
    await hp.waitForLoadState("load");
    await hp.waitForTimeout(1500);
    const chefMenu = await openDesktopMenu(hp);
    const chefStates = await tileStates(chefMenu);
    const chefLink = await chefMenu.getByTestId("theme-branding-link").count();
    await hp.keyboard.press("Escape");
    await hp.goto(`${BASE}/settings/organization`, { waitUntil: "domcontentloaded", timeout: 240000 });
    // redirect() на странице внутри потокового layout'а уводит уже на клиенте.
    await hp.waitForURL((url) => !url.pathname.startsWith("/settings/organization"), { timeout: 120000 }).catch(() => {});
    const chefUrl = hp.url();
    check("AC2", "шеф (без admin.full): карточки есть, ссылки «Логотип и цвета» нет — страница его всё равно не пускает", chefStates.every(Boolean) && chefLink === 0 && !chefUrl.includes("/settings/organization"), { chefLink, redirectedTo: chefUrl });
  } catch (err) {
    check("error", "сценарий упал", false, { message: String(err && err.stack ? err.stack : err).slice(0, 2000) });
  } finally {
    results.finishedAt = new Date().toISOString();
    results.total = results.checks.length;
    results.passed = results.checks.filter((c) => c.ok).length;
    fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));
    console.log(`\n${results.passed}/${results.total} checks passed; page errors: ${results.pageErrors.length}`);
    await browser.close();
  }
})();
