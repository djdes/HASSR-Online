// E2E journal-page-polish-2026-09 (после правки): зазоры вокруг QR, вкладки, поле переименования.
// Dev-сервер :3143, база wesetup_wt_jpage. Снимки и результаты — OUT/after/.
// Буфер обмена проверяется в chrome-headless-shell (свой буфер в памяти): полный Chrome
// в headless пишет в системный буфер Windows, а трогать его нельзя.
// Запуск: node e2e.cjs
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { OUT, BASE, launch, newContext, quietPage, gotoHydrated, sql, readCreds, loggedInState } = require("./lib.cjs");
const { measureInPage } = require("./measure.cjs");

const req = createRequire("C:/wt/jpage/package.json");
const { chromium } = req("playwright-core");
const SHELL = path.join(
  process.env.LOCALAPPDATA,
  "ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe",
);

const dir = path.join(OUT, "after");
fs.mkdirSync(dir, { recursive: true });
const CODE = "cold_equipment_control";
const OFFICIAL = "Журнал контроля температурного режима холодильного и морозильного оборудования";
const CUSTOM = "Холодильники";
const INPUT = '[data-testid="journal-rename-dialog"] input';
const PENCIL = 'button[aria-label="Переименовать журнал"]';

const checks = [];
function check(id, ac, ok, detail) {
  checks.push({ id, ac, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${ac}] ${id} — ${detail}`);
}

function charX({ sel, index }) {
  const input = document.querySelector(sel);
  const s = getComputedStyle(input);
  const c = document.createElement("canvas").getContext("2d");
  c.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  const b = input.getBoundingClientRect();
  const x = b.left + parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth) + c.measureText(input.value.slice(0, index)).width - input.scrollLeft;
  return { x, y: b.top + b.height / 2 };
}
async function sel(page) {
  return page.evaluate((s) => {
    const i = document.querySelector(s);
    return i ? { start: i.selectionStart, end: i.selectionEnd, dir: i.selectionDirection, scrollLeft: i.scrollLeft, value: i.value, focused: document.activeElement === i } : null;
  }, INPUT);
}
async function at(page, index) {
  await page.evaluate((s) => {
    const i = document.querySelector(s);
    i.setSelectionRange(0, 0);
    i.scrollLeft = 0;
  }, INPUT);
  return page.evaluate(charX, { sel: INPUT, index });
}
async function inputInfo(page) {
  return page.evaluate((s) => {
    const input = document.querySelector(s);
    const blocking = [];
    for (let el = input; el; el = el.parentElement) {
      const st = getComputedStyle(el);
      const us = st.userSelect || st.webkitUserSelect;
      if ((us && us !== "auto" && us !== "text") || st.pointerEvents === "none" || (st.touchAction !== "auto" && st.touchAction !== "manipulation")) {
        blocking.push(`${el.tagName.toLowerCase()}: user-select=${us} pointer-events=${st.pointerEvents} touch-action=${st.touchAction}`);
      }
    }
    const b = input.getBoundingClientRect();
    return {
      slot: input.getAttribute("data-slot"),
      readOnly: input.readOnly,
      contentEditable: input.isContentEditable,
      fontSize: getComputedStyle(input).fontSize,
      height: b.height,
      radius: getComputedStyle(input).borderTopLeftRadius,
      selectionBg: getComputedStyle(input, "::selection").backgroundColor,
      blocking,
    };
  }, INPUT);
}
async function orgNames() {
  const creds = readCreds();
  const [row] = await sql(`select "customNamesJson" from "Organization" where id = $1`, [creds.organizationId]);
  return row?.customNamesJson ?? null;
}
async function h1Text(page) {
  return page.evaluate(() => {
    const h1 = document.querySelector("main h1");
    return h1 ? h1.childNodes[0]?.textContent?.trim() || h1.textContent.trim() : null;
  });
}
async function openDialog(page, phone) {
  const pencil = page.locator(PENCIL).first();
  await pencil.scrollIntoViewIfNeeded();
  if (phone) await pencil.tap();
  else await pencil.click();
  await page.waitForSelector(INPUT, { timeout: 20000 });
  await page.waitForTimeout(300);
}
async function saveVia(page, how, phone) {
  const waitPatch = page.waitForResponse((r) => r.url().includes("/api/settings/custom-names") && r.request().method() === "PATCH", { timeout: 60000 });
  if (how === "enter") await page.keyboard.press("Enter");
  else {
    const btn = page.getByRole("button", { name: "Сохранить", exact: true });
    if (phone) await btn.tap();
    else await btn.click();
  }
  const res = await waitPatch;
  await page.waitForSelector(INPUT, { state: "detached", timeout: 20000 });
  await page.waitForTimeout(800);
  return res.status();
}

(async () => {
  const creds = readCreds();
  const out = { at: new Date().toISOString(), base: BASE, pageErrors: [], checks };
  // Исходное состояние: своего названия у холодильников нет.
  await sql(`update "Organization" set "customNamesJson" = '{}' where id = $1`, [creds.organizationId]);
  await sql(`update "User" set "themePreference" = 'light' where id = $1`, [creds.managerId]);

  const browser = await launch();
  try {
    // ================= Компьютер 1280×800 =================
    {
      const ctx = await newContext(browser, { width: 1280, height: 800 }, "manager");
      const page = await quietPage(ctx, out);
      await gotoHydrated(page, `/journals/${CODE}`, PENCIL);
      const g = await page.evaluate(measureInPage);
      check("gaps-1280", "AC1", g.gaps.qrToRow === 12 && g.gaps.createToGuide === 12, `QR↔ряд ${g.gaps.qrToRow}, «Создать»↔«Инструкция» ${g.gaps.createToGuide} (было 8 / 8)`);
      check("tabs-1280", "AC2", g.gaps.textToUnderline >= 5 && g.gaps.textToUnderline <= 8 && g.gaps.underlineVsTextWidth === 0 && !g.line, `текст→подчёркивание ${g.gaps.textToUnderline} px (было 19), ширина = тексту (${g.gaps.underlineVsTextWidth}), полосы под рядом: ${g.line ? "есть" : "нет"}`);

      await openDialog(page, false);
      let info = await inputInfo(page);
      check("input-is-ui-input:1280", "AC3", info.slot === "input" && !info.readOnly && !info.contentEditable && info.blocking.length === 0, `data-slot=${info.slot}, readOnly=${info.readOnly}, contentEditable=${info.contentEditable}, мешающих стилей: ${info.blocking.length}; ${info.height}px, r=${info.radius}, ${info.fontSize}`);
      let s = await sel(page);
      check("autofocus-selected:1280", "AC3", s.focused && s.start === 0 && s.end === OFFICIAL.length && s.dir === "backward" && s.scrollLeft === 0, `фокус=${s.focused}, выделено ${s.start}..${s.end} из ${OFFICIAL.length}, направление ${s.dir}, прокрутка поля ${s.scrollLeft} (начало названия на виду)`);
      await page.screenshot({ path: path.join(dir, "rename-1280-open.png") });
      // Клик — курсор куда угодно.
      let p = await at(page, 12);
      await page.mouse.click(p.x, p.y);
      s = await sel(page);
      check("click-caret:1280", "AC3", s.start === 12 && s.end === 12, `клик после 12-го символа → курсор ${s.start}..${s.end}`);
      // Протянуть мышью — выделить часть.
      const a = await at(page, 0);
      const b = await page.evaluate(charX, { sel: INPUT, index: 6 });
      await page.mouse.move(a.x + 1, a.y);
      await page.mouse.down();
      await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 4 });
      await page.mouse.move(b.x, b.y, { steps: 4 });
      await page.mouse.up();
      s = await sel(page);
      check("drag-select:1280", "AC3", s.start === 0 && s.end === 6, `мышью протянули по «Журнал» → ${s.start}..${s.end} («${s.value.slice(s.start, s.end)}»)`);
      await page.screenshot({ path: path.join(dir, "rename-1280-drag-select.png") });
      // Двойной клик — слово.
      p = await at(page, 10);
      await page.mouse.dblclick(p.x, p.y);
      s = await sel(page);
      check("dblclick-word:1280", "AC3", s.value.slice(s.start, s.end).trim() === "контроля", `двойной клик → «${s.value.slice(s.start, s.end)}»`);
      // Ctrl+A — всё.
      await page.keyboard.press("Control+A");
      s = await sel(page);
      check("select-all:1280", "AC3", s.start === 0 && s.end === s.value.length, `Ctrl+A → ${s.start}..${s.end}`);
      // Новое название поверх выделенного, Enter — сохранить.
      await page.keyboard.type(CUSTOM);
      const status = await saveVia(page, "enter", false);
      const names = await orgNames();
      check("save-enter:1280", "AC3", status === 200 && (await h1Text(page)) === CUSTOM && names?.journals?.[CODE] === CUSTOM, `Enter → PATCH ${status}, H1 «${await h1Text(page)}», в базе ${JSON.stringify(names)}`);
      await page.screenshot({ path: path.join(dir, "renamed-1280.png") });
      // Снова открыть: своё название выделено; «Вернуть стандартное» → сохранить.
      await openDialog(page, false);
      s = await sel(page);
      check("reopen-selected:1280", "AC3", s.value === CUSTOM && s.start === 0 && s.end === CUSTOM.length, `в поле «${s.value}», выделено ${s.start}..${s.end}`);
      await page.getByRole("button", { name: "Вернуть стандартное" }).click();
      s = await sel(page);
      check("reset-fills-official:1280", "AC3", s.value === OFFICIAL && s.focused, `«Вернуть стандартное» → в поле официальное (${s.value.length} симв.), фокус в поле=${s.focused}`);
      const status2 = await saveVia(page, "button", false);
      const names2 = await orgNames();
      check("reset-saved:1280", "AC3", status2 === 200 && !names2?.journals?.[CODE] && (await h1Text(page)).startsWith("Журнал контроля"), `«Сохранить» → PATCH ${status2}, H1 «${(await h1Text(page)).slice(0, 30)}…», в базе ${JSON.stringify(names2)}`);
      // Esc — закрыть.
      await openDialog(page, false);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      const closed = (await page.locator(INPUT).count()) === 0;
      const focusBack = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), PENCIL);
      check("esc-closes:1280", "AC3", closed && focusBack, `Esc → окно закрыто=${closed}, фокус на карандаше=${focusBack}`);
      await ctx.close();
    }

    // ================= Буфер обмена (chrome-headless-shell) =================
    {
      const shell = await chromium.launch({ executablePath: SHELL, headless: true, args: ["--no-sandbox", "--use-gl=swiftshader"] });
      try {
        const ctx = await shell.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU", reducedMotion: "reduce", storageState: await loggedInState(browser, "manager") });
        const page = await quietPage(ctx, out);
        await gotoHydrated(page, `/journals/${CODE}`, PENCIL);
        await openDialog(page, false);
        const a = await at(page, 0);
        const b = await page.evaluate(charX, { sel: INPUT, index: 6 });
        await page.mouse.move(a.x + 1, a.y);
        await page.mouse.down();
        await page.mouse.move(b.x, b.y, { steps: 6 });
        await page.mouse.up();
        await page.keyboard.press("Control+C");
        // Официальное название — 78 из 80 допустимых символов (maxLength), поэтому
        // вставляем не в конец, а в новое короткое название.
        await page.keyboard.press("Control+A");
        await page.keyboard.type("Холодильный цех — ");
        await page.keyboard.press("Control+V");
        let s = await sel(page);
        check("copy-paste:1280", "AC3", s.value === "Холодильный цех — Журнал", `выделили «Журнал» мышью, Ctrl+C, Ctrl+A, набрали «Холодильный цех — », Ctrl+V → «${s.value}»`);
        await page.keyboard.press("Escape");
        await ctx.close();
      } finally {
        await shell.close();
      }
    }

    // ================= Телефон 390×844, касания (оболочка приложения) =================
    {
      const ctx = await newContext(browser, { width: 390, height: 844 }, "manager");
      await ctx.addCookies([{ name: "ws-shell", value: "mini", domain: new URL(BASE).hostname, path: "/", sameSite: "Lax" }]);
      const page = await quietPage(ctx, out);
      // Экранная клавиатура: подменяем visualViewport, чтобы «открыть» её в Chromium.
      await page.addInitScript(() => {
        const real = window.visualViewport;
        const fake = new EventTarget();
        let kb = 0;
        Object.defineProperty(fake, "height", { get: () => window.innerHeight - kb });
        Object.defineProperty(fake, "offsetTop", { get: () => 0 });
        Object.defineProperty(fake, "width", { get: () => (real ? real.width : window.innerWidth) });
        Object.defineProperty(window, "visualViewport", { configurable: true, get: () => fake });
        window.__keyboard = (px) => {
          kb = px;
          fake.dispatchEvent(new Event("resize"));
        };
      });
      await gotoHydrated(page, `/journals/${CODE}`, PENCIL);
      const g = await page.evaluate(measureInPage);
      check("gaps-390-app", "AC1", g.gaps.titleToQr === 12 && g.gaps.qrToRow === 12 && g.gaps.createToGuide === 12, `оболочка приложения: заголовок→QR ${g.gaps.titleToQr}, QR→ряд ${g.gaps.qrToRow}, «Создать»↔«Инструкция» ${g.gaps.createToGuide} (было 16 / 8 / 8)`);
      check("tabs-390-app", "AC2", g.gaps.textToUnderline >= 5 && g.gaps.textToUnderline <= 8 && !g.line, `текст→подчёркивание ${g.gaps.textToUnderline} px (было 19), полосы: ${g.line ? "есть" : "нет"}`);
      await page.screenshot({ path: path.join(dir, "cold-390-mini.png") });

      await openDialog(page, true);
      let info = await inputInfo(page);
      check("input-is-ui-input:390", "AC3", info.slot === "input" && info.blocking.length === 0 && info.fontSize === "16px", `data-slot=${info.slot}, мешающих стилей: ${info.blocking.length}, кегль ${info.fontSize} (iPhone не увеличивает)`);
      let s = await sel(page);
      check("autofocus-selected:390", "AC3", s.focused && s.start === 0 && s.end === OFFICIAL.length && s.scrollLeft === 0, `касание карандаша → фокус=${s.focused}, выделено ${s.start}..${s.end}, прокрутка ${s.scrollLeft} (раньше на телефоне без фокуса и выделения)`);
      await page.screenshot({ path: path.join(dir, "rename-390-open.png") });
      // Касание — курсор в место касания.
      let p = await at(page, 12);
      await page.touchscreen.tap(p.x, p.y);
      await page.waitForTimeout(300);
      s = await sel(page);
      check("tap-caret:390", "AC3", s.focused && s.start === s.end && Math.abs(s.start - 12) <= 1, `касание после 12-го символа → курсор ${s.start}..${s.end}`);
      // Выделение «двойным касанием»: в эмуляции Chromium жест касания слово не выделяет даже у
      // голого <input> (контроль в control.cjs), поэтому двойное нажатие — событиями мыши в том же
      // сенсорном контексте, проверка — selectionStart/End.
      p = await at(page, 10);
      await page.mouse.dblclick(p.x, p.y);
      s = await sel(page);
      check("double-tap-word:390", "AC3", s.value.slice(s.start, s.end).trim() === "контроля", `двойное нажатие → «${s.value.slice(s.start, s.end)}»`);
      await page.screenshot({ path: path.join(dir, "rename-390-word-selected.png") });
      // Долгое нажатие и ведение пальцем: наверху ничего не отменяет касания и выделение.
      await page.evaluate(() => {
        const seen = { touchstart: 0, touchmove: 0, touchend: 0, selectstart: 0, contextmenu: 0 };
        for (const type of Object.keys(seen)) {
          window.addEventListener(type, (ev) => setTimeout(() => { if (ev.defaultPrevented) seen[type] += 1; }, 0));
        }
        window.__seen = seen;
      });
      const cdp = await ctx.newCDPSession(page);
      p = await at(page, 10);
      await cdp.send("Input.synthesizeTapGesture", { x: p.x, y: p.y, duration: 900, tapCount: 1, gestureSourceType: "touch" });
      const s0 = await at(page, 2);
      const s1 = await page.evaluate(charX, { sel: INPUT, index: 14 });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: s0.x, y: s0.y }] });
      for (let i = 1; i <= 6; i += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: s0.x + ((s1.x - s0.x) * i) / 6, y: s0.y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(400);
      const prevented = await page.evaluate(() => window.__seen);
      const stillOpen = (await page.locator(INPUT).count()) === 1;
      check("no-touch-interception:390", "AC3", stillOpen && Object.values(prevented).every((n) => n === 0), `долгое нажатие + ведение пальцем: окно открыто=${stillOpen}, отменённых событий ${JSON.stringify(prevented)}`);
      // Клавиатура телефона: лист поднимается над ней, поле и кнопки видны.
      const KB = 336;
      await page.evaluate((px) => window.__keyboard(px), KB);
      await page.waitForTimeout(300);
      const lifted = await page.evaluate((sel) => {
        const input = document.querySelector(sel);
        const card = input.closest('[role="dialog"] > div[tabindex="-1"]');
        const saveBtn = Array.from(card.querySelectorAll("button")).find((b) => b.textContent.trim() === "Сохранить");
        return { visibleBottom: window.innerHeight - 336, cardTop: card.getBoundingClientRect().top, cardBottom: card.getBoundingClientRect().bottom, inputBottom: input.getBoundingClientRect().bottom, saveBottom: saveBtn.getBoundingClientRect().bottom };
      }, INPUT);
      check("sheet-above-keyboard:390", "AC3", lifted.cardBottom <= lifted.visibleBottom + 1 && lifted.cardTop >= 0 && lifted.inputBottom <= lifted.visibleBottom && lifted.saveBottom <= lifted.visibleBottom, `клавиатура ${KB} px: низ листа ${Math.round(lifted.cardBottom)} ≤ ${lifted.visibleBottom}, верх ${Math.round(lifted.cardTop)} ≥ 0, поле и «Сохранить» над клавиатурой`);
      await page.screenshot({ path: path.join(dir, "rename-390-keyboard.png") });
      // Переименовать с телефона: всё выделить, напечатать, «Сохранить» касанием.
      await page.evaluate((sel) => { const i = document.querySelector(sel); i.focus(); i.select(); }, INPUT);
      await page.keyboard.insertText(CUSTOM);
      const status = await saveVia(page, "button", true);
      const names = await orgNames();
      check("save-phone:390", "AC3", status === 200 && names?.journals?.[CODE] === CUSTOM && (await h1Text(page)) === CUSTOM, `«Сохранить» касанием → PATCH ${status}, H1 «${await h1Text(page)}»`);
      await page.evaluate(() => window.__keyboard(0));
      await page.screenshot({ path: path.join(dir, "renamed-390-mini.png") });
      // Вернуть стандартное с телефона.
      await openDialog(page, true);
      await page.getByRole("button", { name: "Вернуть стандартное" }).tap();
      const status2 = await saveVia(page, "button", true);
      const names2 = await orgNames();
      check("reset-phone:390", "AC3", status2 === 200 && !names2?.journals?.[CODE], `«Вернуть стандартное» + «Сохранить» → PATCH ${status2}, в базе ${JSON.stringify(names2)}`);
      await ctx.close();
    }

    // ================= Телефон 390 на сайте (без оболочки) — снимок окна =================
    {
      const ctx = await newContext(browser, { width: 390, height: 844 }, "manager");
      const page = await quietPage(ctx, out);
      await gotoHydrated(page, `/journals/${CODE}`, PENCIL);
      await openDialog(page, true);
      const s = await sel(page);
      check("autofocus-selected:390-site", "AC3", s.focused && s.start === 0 && s.end === OFFICIAL.length, `сайт на телефоне: фокус=${s.focused}, выделено ${s.start}..${s.end}`);
      await page.screenshot({ path: path.join(dir, "rename-390-site.png") });
      await page.keyboard.press("Escape");
      await ctx.close();
    }
  } finally {
    await browser.close();
    await sql(`update "Organization" set "customNamesJson" = '{}' where id = $1`, [creds.organizationId]).catch(() => {});
  }
  out.summary = { total: checks.length, pass: checks.filter((c) => c.ok).length, fail: checks.filter((c) => !c.ok).length };
  fs.writeFileSync(path.join(dir, "e2e-results.json"), JSON.stringify(out, null, 2));
  console.log("SUMMARY", JSON.stringify(out.summary), "pageErrors:", out.pageErrors.length);
  if (out.summary.fail) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
