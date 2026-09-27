// E2E задачи dashboard-journals-2026-09 (AC1, AC2, AC4) на локальном dev :3161.
// Телефон 390×844 (touch) и компьютер 1280×800, светлая и тёмная тема.
// Запуск: node .agent/tasks/dashboard-journals-2026-09/e2e/e2e.cjs
// Пишет results.json и снимки final-* в E2E_OUT (вне проекта), в папку задачи — копией после.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const {
  WT,
  BASE,
  DB,
  OUT,
  SHOTS,
  FILLED,
  UNFILLED,
  PHONE,
  DESKTOP,
  launch,
  readCreds,
  resetToday,
  themedContext,
  gotoSettled,
  loadAllThumbs,
} = require("./lib.cjs");

const sharp = createRequire(path.join(WT, "package.json"))("sharp");
const SECTION = 'details[data-storage-key="compliance-grid"]';
const KEY = "wesetup.dashboard.section.compliance-grid";

const results = { startedAt: new Date().toISOString(), checks: [], pageErrors: [], badResponses: [] };
function check(ac, name, ok, detail) {
  results.checks.push({ n: results.checks.length + 1, ac, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  #${results.checks.length} [${ac}] ${name}${detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
}

async function savePng(buffer, name) {
  const out = await sharp(buffer).png({ palette: true, quality: 92, effort: 8, compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(SHOTS, name), out);
  return Math.round(out.length / 1024);
}

/**
 * Журнал «видимых кадров» секции: до скриптов страницы ставим наблюдатель,
 * который с момента появления секции в DOM на каждом кадре (rAF — перед
 * отрисовкой) пишет, видна ли она и открыта ли. Первая видимая запись —
 * то, что человек увидел первым.
 */
function frameLog(context) {
  return context.addInitScript((selector) => {
    window.__sectionFrames = [];
    const t0 = performance.now();
    let el = null;
    const tick = () => {
      if (!el || !el.isConnected) el = document.querySelector(selector);
      if (el) {
        const visible = el.getClientRects().length > 0;
        const last = window.__sectionFrames[window.__sectionFrames.length - 1];
        if (!last || last.visible !== visible || last.open !== el.open) {
          window.__sectionFrames.push({ t: Math.round(performance.now() - t0), visible, open: el.open });
        }
      }
      if (performance.now() - t0 < 180000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new MutationObserver(() => {
      if (!el || !el.isConnected) {
        el = document.querySelector(selector);
        if (el) {
          const visible = el.getClientRects().length > 0;
          window.__sectionFrames.push({ t: Math.round(performance.now() - t0), visible, open: el.open, at: "insert" });
        }
      }
    }).observe(document, { childList: true, subtree: true });
  }, SECTION);
}
const firstVisible = (frames) => frames.find((f) => f.visible && f.at !== "insert") || null;

function watch(page, label) {
  page.on("pageerror", (err) => results.pageErrors.push({ page: label, message: String(err && err.message).slice(0, 300) }));
  page.on("response", (res) => {
    const url = res.url();
    if (res.status() >= 400 && /_next\/image|journal-samples|journal-previews|\/_next\/static/.test(url)) {
      results.badResponses.push({ page: label, status: res.status(), url: url.slice(0, 160) });
    }
  });
}

async function sectionState(page) {
  return page.evaluate(
    ([sel, key]) => {
      const d = document.querySelector(sel);
      return { open: d ? d.open : null, saved: localStorage.getItem(key) };
    },
    [SECTION, KEY],
  );
}

async function inspectList(page) {
  return page.evaluate((sel) => {
    const d = document.querySelector(sel);
    const cs = getComputedStyle(d);
    const parent = d.parentElement.getBoundingClientRect();
    const box = d.getBoundingClientRect();
    const rows = [...document.querySelectorAll("[data-journal-row]")];
    const paper = [...document.querySelectorAll("[data-paper-row]")];
    const rowInfo = (a) => {
      const img = a.querySelector("[data-journal-thumb] img");
      const mark = a.querySelector("[data-journal-mark]");
      const s = getComputedStyle(a);
      const r = a.getBoundingClientRect();
      return {
        code: a.getAttribute("data-journal-row") || a.getAttribute("data-paper-row"),
        status: a.getAttribute("data-journal-status"),
        mark: mark ? mark.getAttribute("data-journal-mark") : null,
        img: img ? { loaded: img.complete && img.naturalWidth > 0, src: img.currentSrc.slice(0, 90) } : null,
        thumb: (() => {
          const t = a.querySelector("[data-journal-thumb] > span");
          if (!t) return null;
          const b = t.getBoundingClientRect();
          return { w: Math.round(b.width), h: Math.round(b.height) };
        })(),
        bg: s.backgroundColor,
        border: s.borderTopWidth + "/" + s.borderLeftWidth,
        x: Math.round(r.left),
        h: Math.round(r.height),
        href: a.getAttribute("href"),
      };
    };
    const h2 = d.querySelector("summary h2");
    return {
      details: {
        layout: d.getAttribute("data-section-layout"),
        border: cs.borderTopWidth,
        bg: cs.backgroundColor,
        shadow: cs.boxShadow,
        radius: cs.borderTopLeftRadius,
        widthDiff: Math.round(parent.width - box.width),
        left: Math.round(box.left),
      },
      heading: { text: h2 ? h2.textContent.trim() : null, height: h2 ? Math.round(h2.getBoundingClientRect().height) : null, iconSquare: !!d.querySelector("summary .rounded-2xl.bg-\\[\\#eef1ff\\]") },
      settingsLink: (() => {
        const a = d.querySelector('summary a[href="/settings/journals"]');
        if (!a) return null;
        const s = getComputedStyle(a);
        return { border: s.borderTopWidth, bg: s.backgroundColor };
      })(),
      actions: [...d.querySelectorAll("[data-journals-actions] button, [data-journals-actions] a")].map((el) => el.textContent.trim()),
      actionsInSummary: !!d.querySelector("summary [data-journals-actions]"),
      search: !!d.querySelector('input[aria-label="Поиск по журналам"]'),
      rows: rows.map(rowInfo),
      paper: paper.map(rowInfo),
      columns: [...new Set(rows.map((a) => Math.round(a.getBoundingClientRect().left)))].length,
      paperCaption: (document.querySelector("[data-paper-list] h3") || {}).textContent || null,
      hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, SECTION);
}

async function scrollToSection(page) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const header = document.querySelector("header");
    const offset = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset - 12));
  }, SECTION);
  await page.waitForTimeout(400);
}

async function toggleSection(page, device) {
  const summary = page.locator(`${SECTION} > summary h2`);
  if (device === "phone") await summary.tap();
  else await summary.click();
  await page.waitForTimeout(500);
}

async function runDevice(browser, creds, deviceName, device) {
  for (const theme of ["light", "dark"]) {
    const tag = `${deviceName}-${theme}`;
    // Чистое устройство: ничего не сохранено — секция по умолчанию открыта.
    const context = await themedContext(browser, device, theme, creds, { [KEY]: null });
    await frameLog(context);
    const page = await context.newPage();
    watch(page, tag);
    await gotoSettled(page, "/dashboard", SECTION, results);
    await loadAllThumbs(page);
    const info = await inspectList(page);
    const st = await sectionState(page);

    check("AC1", `${tag}: секция без карточки (рамка/фон/тень/скругление нет)`, info.details.layout === "flat" && info.details.border === "0px" && info.details.bg === "rgba(0, 0, 0, 0)" && info.details.shadow === "none" && info.details.radius === "0px", info.details);
    check("AC1", `${tag}: во всю ширину контента`, info.details.widthDiff === 0 && info.details.left === (deviceName === "phone" ? 16 : 32), { widthDiff: info.details.widthDiff, left: info.details.left });
    check("AC1", `${tag}: по умолчанию развёрнута`, st.open === true && st.saved === null, st);
    check("AC1", `${tag}: заголовок «Обязательные журналы» + счётчик в строку, без значка в квадрате`, /^Обязательные журналы\s*5\/10$/.test(info.heading.text) && info.heading.height <= 32 && !info.heading.iconSquare, info.heading);
    check("AC1", `${tag}: настройка — тихая иконка без рамки`, info.settingsLink && info.settingsLink.border === "0px", info.settingsLink);
    check("AC1", `${tag}: «Автозаполнить» / «QR-коды» и поиск на месте, кнопки не в строке заголовка`, info.actions.join("|") === "Автозаполнить|QR-коды" && !info.actionsInSummary && info.search, { actions: info.actions, inSummary: info.actionsInSummary });

    const filled = info.rows.filter((r) => r.status === "filled").map((r) => r.code).sort();
    const open = info.rows.filter((r) => r.status === "open").map((r) => r.code).sort();
    check("AC2", `${tag}: 10 строк, отметка по данным (5 ✓, 5 ○)`, info.rows.length === 10 && JSON.stringify(filled) === JSON.stringify([...FILLED].sort()) && JSON.stringify(open) === JSON.stringify([...UNFILLED].sort()) && info.rows.every((r) => r.mark === r.status), { filled, open });
    check("AC2", `${tag}: у каждой строки превью загружено`, info.rows.every((r) => r.img && r.img.loaded) && info.paper.every((r) => r.img && r.img.loaded), info.rows.concat(info.paper).filter((r) => !r.img || !r.img.loaded).map((r) => r.code));
    const thumbSize = deviceName === "phone" ? { w: 64, h: 48 } : { w: 80, h: 60 };
    check("AC2", `${tag}: превью ${thumbSize.w}×${thumbSize.h}`, info.rows.concat(info.paper).every((r) => r.thumb && r.thumb.w === thumbSize.w && r.thumb.h === thumbSize.h), info.rows[0].thumb);
    check("AC2", `${tag}: строки без заливки и рамки`, info.rows.concat(info.paper).every((r) => r.bg === "rgba(0, 0, 0, 0)" && r.border === "0px/0px"), [...new Set(info.rows.map((r) => r.bg + " " + r.border))]);
    check("AC2", `${tag}: бумажные — те же строки с превью, без отметки`, info.paper.length === 5 && info.paper.every((r) => r.mark === null && r.img && /paper_/.test(decodeURIComponent(r.img.src))) && info.paperCaption === "Бумажные журналы", { n: info.paper.length, caption: info.paperCaption });
    check("AC2", `${tag}: ${deviceName === "phone" ? "одна колонка" : "три колонки"}`, info.columns === (deviceName === "phone" ? 1 : 3), { columns: info.columns });
    check("AC2", `${tag}: без горизонтальной прокрутки`, info.hScroll <= 0, { hScroll: info.hScroll });

    // Снимок — секция под шапкой.
    await scrollToSection(page);
    const kb = await savePng(await page.screenshot(), `final-${tag}.png`);
    results[`shot-final-${tag}`] = kb;

    // Сворачивание → запомнено → после перезагрузки свёрнута с первого кадра.
    await toggleSection(page, deviceName);
    const afterCollapse = await sectionState(page);
    const rowsHidden = await page.locator("[data-journal-row]").first().isHidden();
    check("AC1", `${tag}: нажатие на заголовок сворачивает, состояние сохранено`, afterCollapse.open === false && afterCollapse.saved === "0" && rowsHidden, { ...afterCollapse, rowsHidden });
    if (theme === "light") {
      await scrollToSection(page);
      results[`shot-collapsed-${deviceName}`] = await savePng(await page.screenshot(), `final-${deviceName}-collapsed.png`);
    }
    await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
    await gotoSettled(page, "/dashboard", SECTION, results);
    const frames = await page.evaluate(() => window.__sectionFrames);
    const afterReload = await sectionState(page);
    const first = firstVisible(frames);
    check("AC1", `${tag}: после перезагрузки свёрнута, первый видимый кадр — уже свёрнута (без мигания)`, afterReload.open === false && first && first.open === false && frames.filter((f) => f.visible && f.open).length === 0, { afterReload, first, frames: frames.slice(0, 6) });

    // Разворачивание → запомнено → после перезагрузки открыта.
    await toggleSection(page, deviceName);
    const afterExpand = await sectionState(page);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 240000 });
    await gotoSettled(page, "/dashboard", SECTION, results);
    const frames2 = await page.evaluate(() => window.__sectionFrames);
    const afterReload2 = await sectionState(page);
    const first2 = firstVisible(frames2);
    check("AC1", `${tag}: развернули — после перезагрузки открыта с первого кадра`, afterExpand.open === true && afterExpand.saved === "1" && afterReload2.open === true && first2 && first2.open === true && frames2.filter((f) => f.visible && !f.open).length === 0, { afterExpand, afterReload2, first: first2 });

    if (theme === "light") {
      await runInteractions(page, deviceName, tag);
    } else {
      await darkChecks(page, tag);
    }
    await context.close();
  }
}

/** Контраст и видимость отметок в тёмной теме. */
async function darkChecks(page, tag) {
  const r = await page.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(parse(a)), lum(parse(b))].sort((p, q) => q - p);
      return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
    };
    const bg = getComputedStyle(document.querySelector(".app-shell")).backgroundColor;
    const name = document.querySelector("[data-journal-row] .line-clamp-2");
    const open = document.querySelector('[data-journal-mark="open"]');
    const filled = document.querySelector('[data-journal-mark="filled"]');
    const badge = document.querySelector("summary h2 .rounded-full");
    return {
      bg,
      name: ratio(getComputedStyle(name).color, bg),
      openRing: ratio(getComputedStyle(open).borderTopColor, bg),
      filledMark: ratio(getComputedStyle(filled).backgroundColor, bg),
      badgeBg: getComputedStyle(badge).backgroundColor,
      badgeText: ratio(getComputedStyle(badge).color, bg),
    };
  });
  check("AC2", `${tag}: тёмная — название читается (≥ 7), пустой кружок виден (≥ 3), ✓ виден (≥ 3)`, r.name >= 7 && r.openRing >= 3 && r.filledMark >= 3, r);
  check("AC2", `${tag}: тёмная — счётчик в заголовке не светлое пятно`, !/255, 25[0-5], 2[34]\d/.test(r.badgeBg) && r.badgeText >= 4.5, { badgeBg: r.badgeBg, badgeText: r.badgeText });
}

/** Поиск, тап по строке, кнопки, переход внутри приложения (светлая тема). */
async function runInteractions(page, deviceName, tag) {
  const input = page.locator('input[aria-label="Поиск по журналам"]');
  // Поиск по обычным.
  await input.fill("бракераж");
  await page.waitForTimeout(700);
  const found = await page.evaluate(() => ({
    rows: [...document.querySelectorAll("[data-journal-row]")].map((a) => a.getAttribute("data-journal-row")).sort(),
    paper: document.querySelectorAll("[data-paper-row]").length,
    counter: [...document.querySelectorAll("div")].map((d) => d.textContent.trim()).find((t) => /^Найдено \d+ из \d+$/.test(t)) || null,
  }));
  check("AC2", `${tag}: поиск «бракераж» — только два журнала бракеража`, JSON.stringify(found.rows) === JSON.stringify(["finished_product", "perishable_rejection"]) && found.paper === 0 && /^Найдено 2 из \d+$/.test(found.counter || ""), found);
  // Поиск находит отключённый — строка с превью и «Включить».
  await input.fill("витаминиз");
  await page.waitForTimeout(700);
  const disabled = await page.evaluate(() => {
    const row = document.querySelector("[data-disabled-row]");
    const img = row && row.querySelector("[data-journal-thumb] img");
    return {
      code: row ? row.getAttribute("data-disabled-row") : null,
      thumb: img ? img.complete && img.naturalWidth > 0 : false,
      button: row ? (row.querySelector("button") || {}).textContent : null,
      caption: (document.querySelector("[data-disabled-list] h3") || {}).textContent || null,
    };
  });
  const thumbLoaded = await page
    .waitForFunction(() => {
      const img = document.querySelector("[data-disabled-row] img");
      return Boolean(img && img.complete && img.naturalWidth > 0);
    }, null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  disabled.thumb = thumbLoaded;
  check("AC2", `${tag}: поиск находит отключённый журнал — строка с превью и «Включить»`, disabled.code === "vitaminization" && disabled.thumb && /Включить/.test(disabled.button || "") && disabled.caption === "Отключённые", disabled);
  await scrollToSection(page);
  results[`shot-search-${deviceName}`] = await savePng(await page.screenshot(), `final-${deviceName}-search-disabled.png`);
  await input.fill("");
  await page.waitForTimeout(500);
  check("AC2", `${tag}: очистка поиска возвращает весь список`, (await page.locator("[data-journal-row]").count()) === 10, null);

  // «Автозаполнить» открывает окно и не сворачивает секцию.
  await page.locator("[data-autofill-open]").click();
  const dialog = page.locator('[role="dialog"]');
  const dialogOk = await dialog.first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  const stillOpen = (await sectionState(page)).open;
  check("AC1", `${tag}: «Автозаполнить» открывает окно, секция не сворачивается`, dialogOk && stillOpen === true, { dialogOk, stillOpen });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Тап по строке ведёт в журнал.
  const row = page.locator('[data-journal-row="hygiene"]');
  await row.scrollIntoViewIfNeeded();
  if (deviceName === "phone") await row.tap();
  else await row.click();
  const navOk = await page.waitForURL((u) => u.pathname === "/journals/hygiene", { timeout: 120000 }).then(() => true).catch(() => false);
  check("AC2", `${tag}: ${deviceName === "phone" ? "тап" : "клик"} по строке — в журнал`, navOk, { url: page.url() });

  // Свернуть на главной, уйти внутри приложения и вернуться — свёрнута
  // (скрипт при переходе внутри приложения не исполняется — помощник секции).
  if (deviceName === "phone") {
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(SECTION, { timeout: 120000 });
    await page.waitForTimeout(800);
    await toggleSection(page, deviceName);
    const collapsed = await sectionState(page);
    await page.locator(`${SECTION} a[href="/settings/journals"]`).evaluate((a) => a.scrollIntoView({ block: "center" }));
    await page.locator(`${SECTION} a[href="/settings/journals"]`).tap();
    const inSettings = await page.waitForURL((u) => u.pathname === "/settings/journals", { timeout: 120000 }).then(() => true).catch(() => false);
    await page.evaluate(() => {
      window.__sectionFrames = [];
    });
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(SECTION, { timeout: 120000 });
    await page.waitForTimeout(1200);
    const back = await sectionState(page);
    const frames = await page.evaluate(() => window.__sectionFrames);
    check("AC1", `${tag}: переход внутри приложения и назад — секция осталась свёрнутой`, collapsed.saved === "0" && inSettings && back.open === false && back.saved === "0" && frames.filter((f) => f.visible && f.open).length === 0, { collapsed, inSettings, back, frames: frames.slice(0, 4) });
    // Вернуть по умолчанию для следующих прогонов.
    await toggleSection(page, deviceName);
  }
}

/**
 * Скелет загрузки: страница с loading.tsx сначала отдаёт скелет, потом
 * содержимое. Чтобы скелет стоял на снимке, а не мелькал, на время снимка
 * держим блокировку таблицы записей (только локальная база e2e): запросы
 * страницы ждут, скелет уже на экране.
 */
async function holdEntries() {
  const { createRequire } = require("node:module");
  const { Client } = createRequire(path.join(WT, "package.json"))("pg");
  const c = new Client({ connectionString: DB });
  await c.connect();
  await c.query("begin");
  await c.query('lock table "JournalEntry" in access exclusive mode');
  return async () => {
    await c.query("commit").catch(() => {});
    await c.end().catch(() => {});
  };
}

async function skeletonShots(browser, creds) {
  for (const [deviceName, device] of [
    ["phone", PHONE],
    ["desktop", DESKTOP],
  ]) {
    for (const theme of ["light", "dark"]) {
      const context = await themedContext(browser, device, theme, creds);
      const page = await context.newPage();
      watch(page, `${deviceName}-${theme}-skeleton`);
      const release = await holdEntries();
      let shown = false;
      try {
        const nav = page.goto(`${BASE}/dashboard`, { waitUntil: "commit", timeout: 240000 }).catch(() => null);
        shown = await page
          .waitForSelector('[data-skeleton="compliance-grid"]', { state: "visible", timeout: 60000 })
          .then(() => true)
          .catch(() => false);
        if (shown) {
          await page.waitForTimeout(700);
          const kb = await savePng(await page.screenshot(), `final-${deviceName}-${theme}-skeleton.png`);
          results[`shot-skeleton-${deviceName}-${theme}`] = kb;
        }
        await release();
        await nav;
      } finally {
        await release();
      }
      await page.waitForSelector(SECTION, { timeout: 240000 }).catch(() => {});
      check("AC2", `${deviceName}-${theme}: скелет загрузки в новом виде показан`, shown, null);
      await context.close();
    }
  }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const creds = readCreds();
  const filledToday = await resetToday(creds);
  results.filledToday = filledToday;
  const browser = await launch();
  try {
    await runDevice(browser, creds, "phone", PHONE);
    await runDevice(browser, creds, "desktop", DESKTOP);
    await skeletonShots(browser, creds);
  } finally {
    await browser.close();
  }
  check("AC4", "превью и статика без 4xx/5xx", results.badResponses.length === 0, results.badResponses.slice(0, 5));
  check("AC4", "ошибок страницы нет", results.pageErrors.length === 0, results.pageErrors.slice(0, 5));
  results.finishedAt = new Date().toISOString();
  results.summary = { total: results.checks.length, pass: results.checks.filter((c) => c.ok).length };
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\n${results.summary.pass}/${results.summary.total} PASS`);
  if (results.summary.pass !== results.summary.total) process.exit(1);
})().catch((err) => {
  console.error(err);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  process.exit(1);
});
