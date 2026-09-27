// Проба поля «Своё название журнала»: можно ли выделить текст, поставить курсор, выделить всё,
// скопировать/вставить — мышью (1280) и касанием (390, touch). Ничего не сохраняет.
// Запуск: node rename-probe.cjs <label> [chromium|webkit]
const fs = require("node:fs");
const path = require("node:path");
const { OUT, BASE, launch, newContext, quietPage, gotoHydrated } = require("./lib.cjs");

const label = process.argv[2] || "before";
const engine = process.argv[3] || "chromium";
const dir = path.join(OUT, label);
fs.mkdirSync(dir, { recursive: true });
const CODE = "cold_equipment_control";
const INPUT = '[data-testid="journal-rename-dialog"] input';

/** Состояние поля и всё, что может мешать выделению, — в браузере. */
function inspect(sel) {
  const input = document.querySelector(sel);
  if (!input) return { found: false };
  const chain = [];
  for (let el = input; el; el = el.parentElement) {
    const s = getComputedStyle(el);
    const odd = {};
    const us = s.userSelect || s.webkitUserSelect;
    if (us && us !== "auto" && us !== "text") odd.userSelect = us;
    if (s.webkitUserSelect && s.webkitUserSelect !== "auto" && s.webkitUserSelect !== "text") odd.webkitUserSelect = s.webkitUserSelect;
    if (s.pointerEvents !== "auto") odd.pointerEvents = s.pointerEvents;
    if (s.touchAction !== "auto") odd.touchAction = s.touchAction;
    if (s.webkitTouchCallout && s.webkitTouchCallout !== "default") odd.touchCallout = s.webkitTouchCallout;
    if (s.caretColor === "transparent") odd.caret = "transparent";
    if (Object.keys(odd).length) chain.push({ el: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + "." + String(el.className).slice(0, 50), ...odd });
  }
  // Обработчики React на пути всплытия (через портал — по дереву React, а не по DOM).
  const fiberKey = Object.keys(input).find((k) => k.startsWith("__reactFiber"));
  const handlers = [];
  for (let f = fiberKey ? input[fiberKey] : null; f; f = f.return) {
    const p = f.memoizedProps;
    if (!p || typeof p !== "object") continue;
    const keys = Object.keys(p).filter((k) => /^on[A-Z]/.test(k) && typeof p[k] === "function");
    if (!keys.length) continue;
    const name = typeof f.type === "string" ? f.type : (f.type && (f.type.displayName || f.type.name)) || "?";
    handlers.push(`${name}: ${keys.join(",")}`);
  }
  const s = getComputedStyle(input);
  return {
    found: true,
    tag: input.tagName.toLowerCase(),
    dataSlot: input.getAttribute("data-slot"),
    className: input.className,
    readOnly: input.readOnly,
    disabled: input.disabled,
    contentEditable: input.isContentEditable,
    value: input.value,
    focused: document.activeElement === input,
    active: document.activeElement ? document.activeElement.tagName.toLowerCase() + "." + String(document.activeElement.className).slice(0, 40) : null,
    selection: [input.selectionStart, input.selectionEnd],
    fontSize: s.fontSize,
    height: input.getBoundingClientRect().height,
    selectionColors: (() => {
      const ss = getComputedStyle(input, "::selection");
      return { bg: ss.backgroundColor, fg: ss.color };
    })(),
    blockingStyles: chain,
    reactHandlers: handlers,
  };
}

/** x-координата символа `index` в поле (по шрифту поля). */
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
    return i ? { start: i.selectionStart, end: i.selectionEnd, value: i.value, focused: document.activeElement === i } : null;
  }, INPUT);
}

/** Курсор в начало и прокрутка поля к началу — чтобы координаты символов были внутри поля. */
async function home(page) {
  return page.evaluate((s) => {
    const i = document.querySelector(s);
    if (!i) return false;
    i.setSelectionRange(0, 0);
    i.scrollLeft = 0;
    return true;
  }, INPUT);
}

async function at(page, index) {
  if (!(await home(page))) return null;
  return page.evaluate(charX, { sel: INPUT, index });
}

async function openDialog(page, phone) {
  const pencil = page.locator('button[aria-label="Переименовать журнал"]').first();
  await pencil.scrollIntoViewIfNeeded();
  if (phone) await pencil.tap();
  else await pencil.click();
  await page.waitForSelector(INPUT, { timeout: 20000 });
  await page.waitForTimeout(400);
}

(async () => {
  const out = { label, engine, at: new Date().toISOString(), pageErrors: [], desktop: {}, phone: {} };
  const browser = await launch(engine);
  try {
    // ---------- Компьютер: мышь и клавиатура ----------
    {
      const ctx = await newContext(browser, { width: 1280, height: 800 }, "manager");
      if (engine === "chromium") await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
      const page = await quietPage(ctx, out);
      await gotoHydrated(page, `/journals/${CODE}`, 'button[aria-label="Переименовать журнал"]');
      await openDialog(page, false);
      const d = out.desktop;
      d.atOpen = await page.evaluate(inspect, INPUT);
      await page.screenshot({ path: path.join(dir, `rename-1280-${engine}.png`) });
      const len = d.atOpen.value.length;
      // Клик в середину слова — курсор туда.
      let p = await at(page, 12);
      await page.mouse.click(p.x, p.y);
      d.clickCaret = await sel(page);
      // Протянуть мышью от начала до 6-го символа («Журнал»).
      const a = await at(page, 0);
      const b = await page.evaluate(charX, { sel: INPUT, index: 6 });
      await page.mouse.move(a.x + 1, a.y);
      await page.mouse.down();
      await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 4 });
      await page.mouse.move(b.x, b.y, { steps: 4 });
      await page.mouse.up();
      d.dragSelect = await sel(page);
      // Двойной клик по второму слову («контроля»).
      p = await at(page, 10);
      await page.mouse.dblclick(p.x, p.y);
      d.dblclickWord = await sel(page);
      // Ctrl+A.
      await page.keyboard.press("Control+A");
      d.selectAll = await sel(page);
      // Копировать «Журнал», вставить в конец.
      await page.evaluate((s) => document.querySelector(s).setSelectionRange(0, 6), INPUT);
      await page.keyboard.press("Control+C");
      await page.keyboard.press("End");
      await page.keyboard.press("Control+V");
      d.copyPaste = await sel(page);
      d.copyPasteOk = !!d.copyPaste && d.copyPaste.value.endsWith("Журнал") && d.copyPaste.value.length === len + 6;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      d.closedByEsc = (await page.locator(INPUT).count()) === 0;
      await ctx.close();
    }

    // ---------- Телефон: касания ----------
    {
      const ctx = await newContext(browser, { width: 390, height: 844 }, "manager");
      const page = await quietPage(ctx, out);
      await gotoHydrated(page, `/journals/${CODE}`, 'button[aria-label="Переименовать журнал"]');
      await openDialog(page, true);
      const t = out.phone;
      t.atOpen = await page.evaluate(inspect, INPUT);
      await page.screenshot({ path: path.join(dir, `rename-390-${engine}.png`) });
      let p = await at(page, 12);
      await page.touchscreen.tap(p.x, p.y);
      await page.waitForTimeout(300);
      t.tapCaret = await sel(page);
      if (engine === "chromium") {
        const cdp = await ctx.newCDPSession(page);
        await page.evaluate(() => {
          const seen = { touchstart: 0, touchmove: 0, selectstart: 0, contextmenu: 0, mousedown: 0 };
          for (const type of Object.keys(seen)) {
            window.addEventListener(type, (ev) => {
              setTimeout(() => {
                if (ev.defaultPrevented) seen[type] += 1;
              }, 0);
            });
          }
          window.__probeSeen = seen;
        });
        // Долгое нажатие на слове «контроля» — как палец на телефоне.
        p = await at(page, 10);
        await cdp.send("Input.synthesizeTapGesture", { x: p.x, y: p.y, duration: 900, tapCount: 1, gestureSourceType: "touch" });
        await page.waitForTimeout(600);
        t.longPress = await sel(page);
        // Двойное касание по слову.
        p = await at(page, 10);
        if (p) {
          await cdp.send("Input.synthesizeTapGesture", { x: p.x, y: p.y, tapCount: 2, gestureSourceType: "touch" });
          await page.waitForTimeout(600);
        }
        t.doubleTap = await sel(page);
        // Ведение пальцем по тексту.
        const s0 = await at(page, 2);
        if (s0) {
          const s1 = await page.evaluate(charX, { sel: INPUT, index: 14 });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: s0.x, y: s0.y }] });
          for (let i = 1; i <= 6; i += 1) {
            await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: s0.x + ((s1.x - s0.x) * i) / 6, y: s0.y }] });
          }
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await page.waitForTimeout(400);
        }
        t.touchDrag = await sel(page);
        t.preventedDefaults = await page.evaluate(() => window.__probeSeen);
      }
      t.afterInspect = await page.evaluate(inspect, INPUT);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(dir, `rename-probe-${engine}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2).slice(0, 7000));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
