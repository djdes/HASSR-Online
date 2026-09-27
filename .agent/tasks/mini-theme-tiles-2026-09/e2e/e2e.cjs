// E2E: тема в мини-приложении — те же три карточки, что в меню профиля сайта.
// Dev-сервер :3132 (NEXT_DIST_DIR=.next-e2e), база wesetup_wt_minitheme; организация — e2e/seed.cjs.
// Запуск: E2E_OUT=<папка вне проекта> node .agent/tasks/mini-theme-tiles-2026-09/e2e/e2e.cjs > $E2E_OUT/raw/e2e-run.log
// Всё (лог, снимки, результаты) — ВНЕ проекта, в папку задачи — копией после прогона:
// dev-сервер следит за файлами проекта, и каждый записанный в .agent/… файл запускал
// пересборку («[Fast Refresh] rebuilding») — посреди прогона это давало полные
// перезагрузки и недописанные чанки (см. lib.cjs, E2E_OUT).
const fs = require("node:fs");
const path = require("node:path");
const { BASE, EVID, RAW, launch, login, quietPage, gotoHydrated, hydratedOrReload, waitHydrated, settle, contrast, readCreds, sql } = require("./lib.cjs");

const MODE_KEY = "wesetup-theme-mode";
const AUTO_KEY = "wesetup-theme-auto-schedule";
const EFFECTIVE_KEY = "wesetup-app-theme";
const LABELS = ["Светлая", "Тёмная", "Как на устройстве"];
const TILE = '[data-testid="theme-tile-light"]';
const SITE_PROFILE = 'button[aria-label="Профиль"]';

const results = { startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
function check(ac, name, ok, detail) {
  results.checks.push({ n: results.checks.length + 1, ac, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  #${results.checks.length} [${ac}] ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
}

/** Переход + ожидание, пока страница успокоится (dev-сервер иногда перезагружает её сам). */
async function go(page, url, selector) {
  await gotoHydrated(page, url, selector, results);
  await settle(page, selector, results);
}

const miniTheme = (page) =>
  page.evaluate(() => {
    const el = document.getElementById("mini-root");
    return el ? { theme: el.getAttribute("data-theme"), app: el.getAttribute("data-app-theme") } : null;
  });
const siteTheme = (page) => page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-app-theme") ?? null);
const storage = (page) =>
  page.evaluate(([m, a, e]) => ({ mode: localStorage.getItem(m), auto: localStorage.getItem(a), effective: localStorage.getItem(e) }), [MODE_KEY, AUTO_KEY, EFFECTIVE_KEY]);
async function waitMini(page, expected, timeout = 15000) {
  await page.waitForFunction(
    (t) => {
      const el = document.getElementById("mini-root");
      return el && el.getAttribute("data-theme") === t && el.getAttribute("data-app-theme") === t;
    },
    expected,
    { timeout },
  );
}
const dbTheme = async (email) => (await sql('select "themePreference" from "User" where email = $1', [email]))[0].themePreference;
const setDbTheme = (email, theme) => sql('update "User" set "themePreference" = $1 where email = $2', [theme, email]);

async function tileStates(page, scope = page.locator("body")) {
  return scope.evaluate((root) =>
    ["light", "dark", "system"].map((m) => {
      const el = root.querySelector(`[data-testid="theme-tile-${m}"]`);
      return el ? { mode: m, checked: el.getAttribute("aria-checked"), role: el.getAttribute("role"), label: el.textContent.trim(), tabIndex: el.tabIndex } : null;
    }),
  );
}
const checkedModes = (states) => states.filter((s) => s && s.checked === "true").map((s) => s.mode);

/** Все POST /api/me/theme, пока идёт действие. */
function recordPosts(page) {
  const posts = [];
  const onResponse = (resp) => {
    const req = resp.request();
    if (req.url().endsWith("/api/me/theme") && req.method() === "POST") posts.push({ theme: req.postDataJSON()?.theme, status: resp.status() });
  };
  page.on("response", onResponse);
  return {
    posts,
    /** Ждём `minCount` ответов (dev-сервер бывает медленным), потом ещё `settleMs` — вдруг придут лишние. */
    stop: async (settleMs = 1500, minCount = 0, timeout = 30000) => {
      const until = Date.now() + timeout;
      while (posts.length < minCount && Date.now() < until) await page.waitForTimeout(100);
      await page.waitForTimeout(settleMs);
      page.off("response", onResponse);
      return posts;
    },
  };
}

async function clickTile(page, mode, expected) {
  const rec = recordPosts(page);
  const t0 = Date.now();
  await page.getByTestId(`theme-tile-${mode}`).click();
  if (expected) await waitMini(page, expected);
  const ms = Date.now() - t0;
  const posts = await rec.stop(1500, expected ? 1 : 0);
  return { ms, posts };
}

async function reloadMini(page, expected) {
  const rec = recordPosts(page);
  await page.evaluate(() => {
    window.__themeFlips = [];
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
  await hydratedOrReload(page, TILE, results);
  if (expected) await waitMini(page, expected, 20000).catch(() => {});
  const posts = await rec.stop(2000);
  return {
    theme: await miniTheme(page),
    storage: await storage(page),
    checked: checkedModes(await tileStates(page)),
    flips: await page.evaluate(() => window.__themeFlips),
    posts,
  };
}
const flipThemes = (flips) => [...new Set(flips.map((f) => f.split("=").pop()))];

async function centerTheme(page) {
  await page.getByTestId("mini-theme").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
}

async function measureMini(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-testid="mini-theme"]');
    const group = card.querySelector('[role="radiogroup"]');
    const tiles = [...card.querySelectorAll("[data-theme-tile]")];
    return {
      viewport: window.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      cardBg: getComputedStyle(card).backgroundColor,
      groupRole: group?.getAttribute("role"),
      groupLabel: group?.getAttribute("aria-label"),
      columns: getComputedStyle(group).gridTemplateColumns.split(" ").length,
      tiles: tiles.map((el) => {
        const r = el.getBoundingClientRect();
        const label = el.lastElementChild;
        const range = document.createRange();
        range.selectNodeContents(label);
        const lr = label.getBoundingClientRect();
        const textRects = [...range.getClientRects()];
        return {
          mode: el.getAttribute("data-theme-tile"),
          checked: el.getAttribute("aria-checked"),
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          label: label.textContent.trim(),
          labelFont: getComputedStyle(label).fontSize,
          labelWeight: getComputedStyle(label).fontWeight,
          labelLines: new Set(textRects.map((x) => Math.round(x.top))).size,
          // Текст не выходит за карточку и не обрезан.
          labelFits: label.scrollWidth <= label.clientWidth && textRects.every((x) => x.left >= lr.left - 0.5 && x.right <= lr.right + 0.5),
          labelOverflow: getComputedStyle(label).textOverflow,
          frameBorder: getComputedStyle(el.firstElementChild).borderTopColor,
          labelColor: getComputedStyle(label).color,
        };
      }),
    };
  });
}

/**
 * Клиент Telegram для настоящего telegram-web-app.js: мост, через который
 * клиент (Android) принимает события страницы. Сам скрипт Telegram — настоящий,
 * параметры запуска — в адресе, как их передаёт Telegram.
 */
function telegramClientInit() {
  window.__tgEvents = [];
  window.TelegramWebviewProxy = {
    postEvent: (type, data) => {
      window.__tgEvents.push([type, data]);
    },
  };
}
const TG_DARK = { bg_color: "#212121", text_color: "#ffffff", hint_color: "#aaaaaa", link_color: "#8774e1", button_color: "#8774e1", button_text_color: "#ffffff", secondary_bg_color: "#181818" };
const TG_LIGHT = { bg_color: "#ffffff", text_color: "#000000", hint_color: "#999999", link_color: "#2481cc", button_color: "#3390ec", button_text_color: "#ffffff", secondary_bg_color: "#f4f4f5" };
const tgLaunchHash = (theme) => `#tgWebAppVersion=8.0&tgWebAppPlatform=ios&tgWebAppThemeParams=${encodeURIComponent(JSON.stringify(theme))}`;
/** Последний цвет фона, который страница попросила у Telegram. */
const tgBackground = (page) =>
  page.evaluate(() => {
    const last = window.__tgEvents.filter((e) => e[0] === "web_app_set_background_color").pop();
    return last ? JSON.parse(last[1]).color : null;
  });
/** Клиент Telegram сменил тему — так он сообщает об этом странице. */
const tgThemeChanged = (page, theme) => page.evaluate((p) => window.Telegram.WebView.receiveEvent("theme_changed", { theme_params: p }), theme);

(async () => {
  fs.mkdirSync(EVID, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });
  const creds = readCreds();
  results.run = creds.run;
  const browser = await launch();
  try {
    await setDbTheme(creds.owner, "light");

    // ================= A. Владелец, телефон 360×800, обычный браузер =================
    const ctxA = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU", colorScheme: "light" });
    await login(ctxA, creds.owner, creds.password);
    // Прогрев: dev-сервер компилирует маршрут при первом запросе (секунды).
    await ctxA.request.get(`${BASE}/api/me/theme`, { timeout: 240000 });
    const a = await quietPage(ctxA, "owner-360", results);
    await go(a, "/mini/me", TILE);
    await a.waitForTimeout(800);
    let m = await measureMini(a);
    let states = await tileStates(a);
    const oldSwitch = await a.locator('[aria-label="Тема Mini App"], [data-testid="mini-theme"] .mini-seg').count();
    const profileText = await a.locator("main").innerText();
    check(
      "AC1",
      "360: в профиле три карточки «Светлая / Тёмная / Как на устройстве» в один ряд (radiogroup), старой переключалки нет",
      states.every(Boolean) &&
        states.map((s) => s.label).join("|") === LABELS.join("|") &&
        states.every((s) => s.role === "radio") &&
        m.groupRole === "radiogroup" &&
        m.columns === 3 &&
        new Set(m.tiles.map((t) => t.y)).size === 1 &&
        oldSwitch === 0,
      { tiles: m.tiles.map(({ mode, x, y, w, h }) => ({ mode, x, y, w, h })), columns: m.columns, oldSwitch },
    );
    check(
      "AC1",
      "360: подписи не обрезаны и не вылезают, «Как на устройстве» — в две строки, горизонтальной прокрутки нет",
      m.tiles.every((t) => t.labelFits && t.labelOverflow !== "ellipsis") && m.tiles[2].labelLines <= 2 && m.pageScrollWidth <= m.viewport,
      { labels: m.tiles.map(({ mode, labelFont, labelLines, labelFits }) => ({ mode, labelFont, labelLines, labelFits })), pageScrollWidth: m.pageScrollWidth },
    );
    const brandingHref = await a.getByTestId("theme-branding-link").getAttribute("href").catch(() => null);
    check(
      "AC1",
      "строки «Внешний вид · логотип и цвета» нет; под карточками — «Логотип и цвета», ведёт туда же, что на сайте",
      !profileText.includes("Внешний вид") && (await a.locator('main a[href="/settings/appearance"]').count()) === 0 && brandingHref === "/settings/organization#branding",
      { hasAppearanceRow: profileText.includes("Внешний вид"), brandingHref },
    );
    const startA = { theme: await miniTheme(a), storage: await storage(a), checked: checkedModes(states) };
    check("AC2", "старт: тема профиля (светлая), выбрана «Светлая»", startA.theme.theme === "light" && startA.checked.join() === "light", startA);
    let light = m.tiles.find((t) => t.mode === "light");
    check(
      "AC1",
      "светлая тема: выбранная заметна — рамка #5566f6 (≥ 3:1 к карточке) и индиго-подпись (≥ 4.5:1)",
      light.frameBorder === "rgb(85, 102, 246)" && contrast(light.frameBorder, m.cardBg) >= 3 && contrast(light.labelColor, m.cardBg) >= 4.5 && light.labelWeight === "600",
      { selected: { frame: light.frameBorder, label: light.labelColor, weight: light.labelWeight }, cardBg: m.cardBg, frameContrast: contrast(light.frameBorder, m.cardBg), labelContrast: contrast(light.labelColor, m.cardBg) },
    );
    // Верх ссылки «Логотип и цвета» нажимается как ссылка: невидимой подложки
    // переключателя (inset −10px) у карточек нет. withPad — как было бы с ней.
    const hit = await a.evaluate(() => {
      const link = document.querySelector('[data-testid="theme-branding-link"]');
      link.scrollIntoView({ block: "center" });
      const r = link.getBoundingClientRect();
      const probe = () => {
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + 2);
        return el?.closest("[data-testid]")?.getAttribute("data-testid") ?? el?.tagName ?? null;
      };
      const now = probe();
      const style = document.createElement("style");
      style.textContent = '.mini-root main [data-theme-tile]::after{content:"";position:absolute;inset:-10px}';
      document.head.appendChild(style);
      const withPad = probe();
      style.remove();
      return { now, withPad, tileAfter: getComputedStyle(document.querySelector("[data-theme-tile]"), "::after").content, linkHeight: Math.round(r.height) };
    });
    check("AC1", "ссылка «Логотип и цвета» нажимается целиком (48px), карточки над ней не перехватывают нажатие", hit.now === "theme-branding-link" && hit.tileAfter === "none" && hit.linkHeight >= 48, hit);

    await centerTheme(a);
    await a.screenshot({ path: path.join(EVID, "after-mini-light-360.png"), animations: "disabled" });
    await a.getByTestId("mini-theme").screenshot({ path: path.join(EVID, "after-mini-theme-light-360.png"), animations: "disabled" });

    // Каждая карточка: атрибуты темы, localStorage, профиль, после перезагрузки — то же.
    let r = await clickTile(a, "dark", "dark");
    let st = await storage(a);
    check(
      "AC2",
      "«Тёмная»: data-theme и data-app-theme → dark сразу; localStorage dark/0/dark; POST dark → 200 (один)",
      (await miniTheme(a)).app === "dark" && st.mode === "dark" && st.auto === "0" && st.effective === "dark" && r.posts.length === 1 && r.posts[0].theme === "dark" && r.posts[0].status === 200 && r.ms < 2000,
      { ms: r.ms, posts: r.posts, storage: st, db: await dbTheme(creds.owner) },
    );
    m = await measureMini(a);
    const darkTile = m.tiles.find((t) => t.mode === "dark");
    check(
      "AC1",
      "тёмная тема: выбранная заметна — рамка #7081f8 (≥ 3:1 к карточке), подпись #a3adff (≥ 4.5:1), превью «Светлая» остаётся белой",
      darkTile.frameBorder === "rgb(112, 129, 248)" && contrast(darkTile.frameBorder, m.cardBg) >= 3 && contrast(darkTile.labelColor, m.cardBg) >= 4.5 &&
        (await a.getByTestId("theme-tile-light").evaluate((el) => getComputedStyle(el.querySelectorAll("svg rect")[1]).fill)) === "rgb(255, 255, 255)",
      { selected: { frame: darkTile.frameBorder, label: darkTile.labelColor }, unselectedLabel: m.tiles[0].labelColor, cardBg: m.cardBg, frameContrast: contrast(darkTile.frameBorder, m.cardBg), labelContrast: contrast(darkTile.labelColor, m.cardBg) },
    );
    await centerTheme(a);
    await a.screenshot({ path: path.join(EVID, "after-mini-dark-360.png"), animations: "disabled" });
    await a.getByTestId("mini-theme").screenshot({ path: path.join(EVID, "after-mini-theme-dark-360.png"), animations: "disabled" });
    let rl = await reloadMini(a, "dark");
    check("AC2", "«Тёмная» после перезагрузки: тёмная, выбрана «Тёмная», без мигания и без POST", rl.theme.theme === "dark" && rl.checked.join() === "dark" && flipThemes(rl.flips).join() === "dark/dark" && rl.posts.length === 0, rl);

    r = await clickTile(a, "light", "light");
    rl = await reloadMini(a, "light");
    check(
      "AC2",
      "«Светлая» → перезагрузка: светлая, выбрана «Светлая», в профиле light, без мигания",
      r.posts.map((p) => p.theme).join() === "light" && rl.theme.theme === "light" && rl.checked.join() === "light" && flipThemes(rl.flips).join() === "light/light" && rl.posts.length === 0 && (await dbTheme(creds.owner)) === "light",
      { click: r, reload: rl },
    );

    // «Как на устройстве» вне Telegram — по prefers-color-scheme, на лету.
    await a.emulateMedia({ colorScheme: "light" });
    r = await clickTile(a, "system", "light");
    st = await storage(a);
    const sysChecked = checkedModes(await tileStates(a));
    rl = await reloadMini(a, "light");
    check(
      "AC2",
      "«Как на устройстве» (система светлая): светлая, localStorage system/0/light — как у сайта; после перезагрузки выбрана она же",
      st.mode === "system" && st.auto === "0" && st.effective === "light" && sysChecked.join() === "system" && rl.checked.join() === "system" && rl.theme.theme === "light" && r.posts.map((p) => p.theme).join() === "light",
      { storage: st, posts: r.posts, reload: rl },
    );
    let live = recordPosts(a);
    await a.emulateMedia({ colorScheme: "dark" });
    await waitMini(a, "dark");
    const toDark = { theme: await miniTheme(a), storage: await storage(a) };
    await a.emulateMedia({ colorScheme: "light" });
    await waitMini(a, "light");
    const toLight = { theme: await miniTheme(a), storage: await storage(a) };
    let livePosts = await live.stop(1500, 2);
    check(
      "AC2",
      "«Как на устройстве»: система стала тёмной → тёмная без перезагрузки, обратно → светлая; действующая тема записана и ушла в профиль, как на сайте",
      toDark.theme.theme === "dark" && toDark.storage.effective === "dark" && toLight.theme.theme === "light" && toLight.storage.effective === "light" && livePosts.map((p) => p.theme).join() === "dark,light" && livePosts.every((p) => p.status === 200),
      { toDark, toLight, posts: livePosts },
    );

    // Профиль (другое устройство) говорит «светлая», а телефон в «как на устройстве» и система тёмная:
    // первый кадр уже тёмный (скрипт до гидрации), лишних POST при загрузке нет — как у сайта.
    await a.emulateMedia({ colorScheme: "dark" });
    await waitMini(a, "dark");
    await a.waitForTimeout(1500);
    await setDbTheme(creds.owner, "light");
    rl = await reloadMini(a, "dark");
    check(
      "AC2",
      "«Как на устройстве» + система тёмная, в профиле светлая: после перезагрузки тёмная с первого кадра, выбрана «Как на устройстве», 0 POST",
      rl.theme.theme === "dark" && rl.checked.join() === "system" && flipThemes(rl.flips).join() === "dark/dark" && rl.posts.length === 0,
      { ...rl, db: await dbTheme(creds.owner) },
    );

    // Согласование с сайтом в той же вкладке: ширина компьютера, «Открыть полную версию сайта»
    // в профиле приложения (снимает куку оболочки и открывает /dashboard — обычный сайт).
    await a.setViewportSize({ width: 1280, height: 800 });
    await a.waitForTimeout(500);
    const fullSite = a.locator("main button").filter({ hasText: "Открыть полную версию сайта" });
    await fullSite.scrollIntoViewIfNeeded();
    await Promise.all([a.waitForURL(/\/dashboard$/, { timeout: 240000 }), fullSite.click()]);
    await settle(a, SITE_PROFILE, results);
    await a.waitForTimeout(1000);
    const siteBefore = { theme: await siteTheme(a), storage: await storage(a) };
    await a.locator(SITE_PROFILE).click();
    let menu = a.locator('[data-slot="dropdown-menu-content"]');
    await menu.getByTestId("theme-tiles").waitFor({ timeout: 60000 });
    await a.waitForTimeout(400);
    const siteStates = await tileStates(a, menu);
    check(
      "AC2",
      "сайт /dashboard (1280) в той же вкладке видит выбор мини-приложения: «Как на устройстве», тёмная по системе",
      siteBefore.theme === "dark" && checkedModes(siteStates).join() === "system" && siteBefore.storage.mode === "system",
      { siteBefore, checked: checkedModes(siteStates) },
    );
    r = { posts: [] };
    live = recordPosts(a);
    await menu.getByTestId("theme-tile-light").click();
    await a.waitForFunction(() => document.querySelector(".app-shell")?.getAttribute("data-app-theme") === "light", null, { timeout: 15000 });
    livePosts = await live.stop(1500, 1);
    const siteAfter = { theme: await siteTheme(a), storage: await storage(a), posts: livePosts };
    await a.keyboard.press("Escape");
    await a.setViewportSize({ width: 360, height: 800 });
    await go(a, "/mini/me", TILE);
    await waitMini(a, "light").catch(() => {});
    const backInMini = { theme: await miniTheme(a), checked: checkedModes(await tileStates(a)) };
    check(
      "AC2",
      "обратно: «Светлая» на сайте → мини-приложение открылось светлым, выбрана «Светлая»",
      siteAfter.theme === "light" && siteAfter.storage.mode === "light" && backInMini.theme.theme === "light" && backInMini.checked.join() === "light",
      { siteAfter, backInMini },
    );

    // Страницы сайта внутри оболочки: «Настройки → Внешний вид» — та же тема (мост useSiteTheme).
    await go(a, "/settings/appearance", 'main [data-testid="theme-tile-light"]');
    await a.waitForTimeout(800);
    const shellInfo = await a.evaluate(() => ({ shell: Boolean(document.getElementById("mini-root")), header: Boolean(document.querySelector('button[aria-label="Профиль"]')) }));
    const shellStates = await tileStates(a, a.locator("main"));
    results.shellAppearanceColumns = await a
      .locator('main [role="radiogroup"]')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    await a.locator("main section").first().screenshot({ path: path.join(EVID, "shell-appearance-360.png"), animations: "disabled" });
    await a.locator("main").getByTestId("theme-tile-system").click();
    await waitMini(a, "dark");
    const shellAfter = { theme: await miniTheme(a), storage: await storage(a), checked: checkedModes(await tileStates(a, a.locator("main"))) };
    await go(a, "/mini/me", TILE);
    const meAfterShell = checkedModes(await tileStates(a));
    check(
      "AC2",
      "в оболочке приложения «Настройки → Внешний вид» показывает тот же выбор и переключает ту же тему (там «Как на устройстве» → профиль видит его)",
      shellInfo.shell && !shellInfo.header && checkedModes(shellStates).join() === "light" && shellAfter.theme.theme === "dark" && shellAfter.storage.mode === "system" && shellAfter.checked.join() === "system" && meAfterShell.join() === "system",
      { shellInfo, before: checkedModes(shellStates), shellAfter, meAfterShell },
    );

    // Смена по времени суток, включённая на сайте: мини-приложение её уважает.
    await a.evaluate((k) => localStorage.setItem(k, "1"), AUTO_KEY);
    const byHour = await a.evaluate(() => {
      const h = new Date().getHours();
      return h >= 7 && h < 19 ? "light" : "dark";
    });
    const opposite = byHour === "light" ? "dark" : "light";
    rl = await reloadMini(a, byHour);
    let note = a.getByTestId("theme-auto-note");
    const autoOn = { theme: rl.theme, checked: rl.checked, flips: rl.flips, posts: rl.posts, noteState: await note.getAttribute("data-state"), note: (await note.innerText()).trim() };
    check(
      "AC2",
      "смена по времени суток (ключ сайта = 1): тема по часу с первого кадра, ни одна карточка не выбрана, подсказка «выбор выключит смену»",
      autoOn.theme.theme === byHour && flipThemes(rl.flips).join() === `${byHour}/${byHour}` && autoOn.checked.length === 0 && autoOn.noteState === "on" && autoOn.note.includes("по времени суток"),
      { byHour, ...autoOn },
    );
    await centerTheme(a);
    await a.getByTestId("mini-theme").screenshot({ path: path.join(EVID, `after-mini-auto-note-360-${byHour}.png`), animations: "disabled" });
    r = await clickTile(a, opposite, opposite);
    note = a.getByTestId("theme-auto-note");
    const autoOff = { theme: await miniTheme(a), storage: await storage(a), checked: checkedModes(await tileStates(a)), noteState: await note.getAttribute("data-state"), posts: r.posts };
    check(
      "AC2",
      "нажатие на карточку выключает смену по времени (как на сайте): ключ 0, выбран режим, строка «выключена», в профиль — ОДИН POST с итоговой темой",
      autoOff.storage.auto === "0" && autoOff.storage.mode === opposite && autoOff.theme.theme === opposite && autoOff.checked.join() === opposite && autoOff.noteState === "turned-off" && r.posts.length === 1 && r.posts[0].theme === opposite,
      autoOff,
    );
    live = recordPosts(a);
    await a.getByTestId("theme-auto-restore").click();
    await waitMini(a, byHour);
    livePosts = await live.stop(1500, 1);
    const restored = { theme: await miniTheme(a), storage: await storage(a), checked: checkedModes(await tileStates(a)), noteState: await a.getByTestId("theme-auto-note").getAttribute("data-state"), posts: livePosts };
    check("AC2", "«Включить снова» возвращает смену по времени суток (ключ 1, тема по часу)", restored.storage.auto === "1" && restored.theme.theme === byHour && restored.checked.length === 0 && restored.noteState === "on", restored);
    r = await clickTile(a, "light", "light");
    check("AC2", "снова карточка «Светлая» → смена по времени выключена", (await storage(a)).auto === "0" && (await miniTheme(a)).theme === "light", { storage: await storage(a), posts: r.posts });

    // Клавиатура: radiogroup со стрелками, как на сайте.
    await a.getByTestId("theme-tile-light").focus();
    await a.keyboard.press("ArrowRight");
    await waitMini(a, "dark");
    const kbd1 = { focused: await a.evaluate(() => document.activeElement?.getAttribute("data-theme-tile")), checked: checkedModes(await tileStates(a)) };
    await a.keyboard.press("ArrowLeft");
    await waitMini(a, "light");
    const kbd2 = { focused: await a.evaluate(() => document.activeElement?.getAttribute("data-theme-tile")), checked: checkedModes(await tileStates(a)), tabIndex: (await tileStates(a)).map((s) => s.tabIndex) };
    check("AC1", "клавиатура: стрелка вправо — «Тёмная» (фокус и выбор), влево — «Светлая»; Tab-остановка одна — на выбранной", kbd1.focused === "dark" && kbd1.checked.join() === "dark" && kbd2.focused === "light" && kbd2.checked.join() === "light" && kbd2.tabIndex.join() === "0,-1,-1", { kbd1, kbd2 });

    // «Логотип и цвета» → «Настройки → Организация», блок «Брендинг» (в оболочке приложения).
    await a.getByTestId("theme-branding-link").click();
    await a.waitForURL(/\/settings\/organization#branding$/, { timeout: 240000 });
    await a.locator("#branding").waitFor({ timeout: 240000 });
    await a.waitForTimeout(1500);
    const branding = await a.evaluate(() => {
      const el = document.getElementById("branding");
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), text: el.innerText.slice(0, 40), shell: Boolean(document.getElementById("mini-root")) };
    });
    check("AC1", "«Логотип и цвета» открывает «Брендинг» в настройках организации (внутри приложения)", branding.text.startsWith("Брендинг") && branding.top >= 0 && branding.top < 800 && branding.shell, { url: a.url(), branding });

    // ================= B. Внутри Telegram: настоящий telegram-web-app.js, параметры запуска в адресе =================
    // Next загружает скрипт Telegram уже после разбора страницы — как в жизни: скрипт до
    // гидрации его не застаёт и берёт тему из параметров запуска.
    await setDbTheme(creds.owner, "light");
    const ctxB = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU", colorScheme: "light" });
    await ctxB.addInitScript(telegramClientInit);
    await login(ctxB, creds.owner, creds.password);
    const b = await quietPage(ctxB, "telegram-360", results);
    await go(b, `/mini/me${tgLaunchHash(TG_DARK)}`, TILE);
    await b.waitForTimeout(800);
    const tgStart = {
      theme: await miniTheme(b),
      checked: checkedModes(await tileStates(b)),
      sdk: await b.evaluate(() => ({ platform: window.Telegram.WebApp.platform, colorScheme: window.Telegram.WebApp.colorScheme, version: window.Telegram.WebApp.version })),
    };
    r = await clickTile(b, "system", "dark");
    const tgSystem = { theme: await miniTheme(b), storage: await storage(b), checked: checkedModes(await tileStates(b)), posts: r.posts, bg: await tgBackground(b) };
    check(
      "AC2",
      "Telegram (настоящий telegram-web-app.js; тема Telegram тёмная, система светлая): «Как на устройстве» → тёмная по Telegram, фон Telegram #2b2841, POST dark",
      tgStart.sdk.platform === "ios" && tgStart.sdk.colorScheme === "dark" && tgStart.theme.theme === "light" && tgSystem.theme.theme === "dark" && tgSystem.storage.mode === "system" && tgSystem.checked.join() === "system" && tgSystem.bg === "#2b2841" && r.posts.map((p) => p.theme).join() === "dark",
      { tgStart, tgSystem },
    );
    live = recordPosts(b);
    await tgThemeChanged(b, TG_LIGHT);
    await waitMini(b, "light");
    const tgLight = { theme: await miniTheme(b), storage: await storage(b), sdkScheme: await b.evaluate(() => window.Telegram.WebApp.colorScheme), bg: await tgBackground(b) };
    await b.emulateMedia({ colorScheme: "dark" });
    await b.waitForTimeout(1200);
    const tgIgnoresOs = await miniTheme(b);
    await tgThemeChanged(b, TG_DARK);
    await waitMini(b, "dark");
    livePosts = await live.stop(1500, 2);
    check(
      "AC2",
      "Telegram: клиент сменил тему (theme_changed → themeChanged) → светлая, потом тёмная без перезагрузки; системная тема внутри Telegram не решает",
      tgLight.theme.theme === "light" && tgLight.sdkScheme === "light" && tgLight.storage.effective === "light" && tgLight.bg === "#fafbff" && tgIgnoresOs.theme === "light" && (await miniTheme(b)).theme === "dark" && livePosts.map((p) => p.theme).join() === "light,dark",
      { tgLight, tgIgnoresOs, posts: livePosts },
    );
    await b.emulateMedia({ colorScheme: "light" });
    await setDbTheme(creds.owner, "light");
    rl = await reloadMini(b, "dark");
    check(
      "AC2",
      "Telegram: перезагрузка («Как на устройстве», Telegram тёмный, система и профиль светлые) — тёмная с первого кадра, без POST",
      rl.theme.theme === "dark" && rl.checked.join() === "system" && flipThemes(rl.flips).join() === "dark/dark" && rl.posts.length === 0,
      rl,
    );
    await centerTheme(b);
    await b.screenshot({ path: path.join(EVID, "after-mini-telegram-system-dark-360.png"), animations: "disabled" });

    // Тему Telegram сменили на светлую → перезагрузка: в адресе всё ещё тёмная тема запуска, но
    // Telegram берёт последнюю сохранённую — и скрипт до гидрации тоже. Затем переход без
    // параметров в адресе (как внутри приложения), система тёмная: тема — сохранённая Telegram.
    live = recordPosts(b);
    await tgThemeChanged(b, TG_LIGHT);
    await waitMini(b, "light");
    // Сохранение этой смены в профиль должно доехать до перезагрузки (dev-сервер бывает медленным).
    await live.stop(1500, 1);
    await b.emulateMedia({ colorScheme: "dark" });
    await b.waitForTimeout(1500);
    const rlStored = await reloadMini(b, "light");
    const sdkAfterReload = await b.evaluate(() => window.Telegram.WebApp.colorScheme);
    await b.evaluate(() => {
      window.__themeFlips = [];
    });
    await go(b, "/mini/me", TILE);
    await waitMini(b, "light").catch(() => {});
    const noHash = {
      url: b.url(),
      theme: await miniTheme(b),
      checked: checkedModes(await tileStates(b)),
      flips: await b.evaluate(() => window.__themeFlips),
      sdk: await b.evaluate(() => ({ platform: window.Telegram.WebApp.platform, colorScheme: window.Telegram.WebApp.colorScheme })),
    };
    check(
      "AC2",
      "Telegram: после смены темы в Telegram и перезагрузки — последняя тема Telegram с первого кадра; переход без параметров в адресе — тоже (как считает сам Telegram)",
      rlStored.theme.theme === "light" && sdkAfterReload === "light" && flipThemes(rlStored.flips).join() === "light/light" && rlStored.posts.length === 0 &&
        !noHash.url.includes("#") && noHash.sdk.platform === "ios" && noHash.sdk.colorScheme === "light" && noHash.theme.theme === "light" && noHash.checked.join() === "system" && flipThemes(noHash.flips).join() === "light/light",
      { reload: rlStored, sdkAfterReload, noHash },
    );
    await b.emulateMedia({ colorScheme: "light" });

    // ================= B2. Приложение WeSetup (WebView: приписка WeSetupApp в User-Agent) =================
    await setDbTheme(creds.owner, "light");
    const ctxApp = await browser.newContext({
      viewport: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
      locale: "ru-RU",
      colorScheme: "light",
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 WeSetupApp/1.4.0 (android)",
    });
    await login(ctxApp, creds.owner, creds.password);
    const e = await quietPage(ctxApp, "app-360", results);
    await go(e, "/mini/me", TILE);
    r = await clickTile(e, "system", "light");
    live = recordPosts(e);
    await e.emulateMedia({ colorScheme: "dark" });
    await waitMini(e, "dark");
    livePosts = await live.stop(1500, 1);
    const appInfo = {
      theme: await miniTheme(e),
      storage: await storage(e),
      checked: checkedModes(await tileStates(e)),
      inTelegram: await e.evaluate(() => {
        const w = window.Telegram && window.Telegram.WebApp;
        return Boolean(w && ((w.initData || "").length > 0 || (w.platform && w.platform !== "unknown")));
      }),
      shellCookie: (await ctxApp.cookies()).some((c) => c.name === "ws-shell" && c.value === "mini"),
      posts: [...r.posts, ...livePosts],
    };
    check(
      "AC2",
      "приложение WeSetup (Android WebView, не Telegram): «Как на устройстве» следует теме телефона (prefers-color-scheme) без перезагрузки",
      !appInfo.inTelegram && appInfo.shellCookie && appInfo.theme.theme === "dark" && appInfo.storage.mode === "system" && appInfo.checked.join() === "system" && appInfo.posts.map((p) => p.theme).join() === "light,dark",
      appInfo,
    );
    await ctxApp.close();

    // ================= C. Повар и шеф: карточки есть, «Логотип и цвета» — нет =================
    const roleChecks = {};
    for (const [label, email] of [
      ["cook", creds.cook],
      ["chef", creds.chef],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: "ru-RU", colorScheme: "light" });
      await login(ctx, email, creds.password);
      const p = await quietPage(ctx, `${label}-360`, results);
      await go(p, "/mini/me", TILE);
      await p.waitForTimeout(600);
      const start = await miniTheme(p);
      const target = start.theme === "dark" ? "light" : "dark";
      const rr = await clickTile(p, target, target);
      roleChecks[label] = {
        tiles: (await tileStates(p)).filter(Boolean).length,
        brandingLink: await p.getByTestId("theme-branding-link").count(),
        appearanceRow: await p.locator('main a[href="/settings/appearance"]').count(),
        switchedTo: target,
        posts: rr.posts,
        db: await dbTheme(email),
      };
      await ctx.close();
    }
    check(
      "AC1",
      "повар и шеф: карточки есть и работают (тема личная), «Логотип и цвета» нет — настройки организации им закрыты (раньше шеф видел «Внешний вид»)",
      Object.values(roleChecks).every((c) => c.tiles === 3 && c.brandingLink === 0 && c.appearanceRow === 0 && c.db === c.switchedTo),
      roleChecks,
    );

    // ================= D. Сайт после выноса: меню профиля как раньше (снимки «после») =================
    await setDbTheme(creds.owner, "light");
    const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU", colorScheme: "light" });
    await login(desk, creds.owner, creds.password);
    const d = await quietPage(desk, "site-1280", results);
    await go(d, "/dashboard", SITE_PROFILE);
    await d.locator(SITE_PROFILE).click();
    menu = d.locator('[data-slot="dropdown-menu-content"]');
    await menu.getByTestId("theme-tiles").waitFor({ timeout: 60000 });
    await d.waitForTimeout(500);
    await menu.screenshot({ path: path.join(EVID, "after-site-menu-1280.png"), animations: "disabled" });
    const deskStates = await tileStates(d, menu);
    r = { posts: [] };
    live = recordPosts(d);
    await menu.getByTestId("theme-tile-dark").click();
    await d.waitForFunction(() => document.querySelector(".app-shell")?.getAttribute("data-app-theme") === "dark", null, { timeout: 15000 });
    livePosts = await live.stop(1500, 1);
    // Сайтовый провайдер (не менялся) сохраняет внутри функции-обновления setState — в dev
    // React StrictMode вызывает её дважды, поэтому запросов может быть два, оба с той же темой.
    check(
      "AC3",
      "сайт 1280: в меню профиля те же карточки (menuitemradio), «Тёмная» работает как раньше",
      checkedModes(deskStates).join() === "light" && deskStates.every((s) => s && s.role === "menuitemradio") && livePosts.length >= 1 && livePosts.every((p) => p.theme === "dark" && p.status === 200),
      { deskStates, posts: livePosts },
    );
    await d.keyboard.press("Escape");

    await setDbTheme(creds.owner, "light");
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU", colorScheme: "light" });
    await login(phone, creds.owner, creds.password);
    const s = await quietPage(phone, "site-390", results);
    await go(s, "/dashboard", SITE_PROFILE);
    await s.locator(SITE_PROFILE).click();
    const sheet = s.locator('[role="dialog"]').filter({ has: s.getByTestId("theme-tiles") });
    await sheet.waitFor({ timeout: 60000 });
    await s.waitForTimeout(800);
    await sheet.screenshot({ path: path.join(EVID, "after-site-sheet-390.png"), animations: "disabled" });
    const sheetStates = await tileStates(s, sheet);
    check("AC3", "сайт 390: лист профиля — те же карточки (radio), выбрана «Светлая»", checkedModes(sheetStates).join() === "light" && sheetStates.every((x) => x && x.role === "radio"), { sheetStates });
  } catch (err) {
    check("error", "сценарий упал", false, { message: String(err && err.stack ? err.stack : err).slice(0, 2500) });
  } finally {
    results.finishedAt = new Date().toISOString();
    results.total = results.checks.length;
    results.passed = results.checks.filter((c) => c.ok).length;
    fs.writeFileSync(path.join(RAW, "e2e-results.json"), JSON.stringify(results, null, 2));
    console.log(`\n${results.passed}/${results.total} checks passed; page errors: ${results.pageErrors.length}`);
    await browser.close();
  }
})();
