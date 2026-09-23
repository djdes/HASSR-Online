// Итоговая проверка лендинга с QR-роликом: node verify.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire("d:/www/Wesetup.ru/package.json");
const { chromium } = require("playwright");

const BASE = "http://localhost:3025";
const SHOTS = "d:/www/Wesetup.ru/.agent/tasks/landing-qr-player-2026-09/shots";
const OUT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/6bdc8fdd-ce53-4489-a636-2e1b1e95d14d/scratchpad/a";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const IGNORED = [/status of 401/]; // запрос сессии анонимного посетителя — не ошибка страницы

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function open({ width, night = false, reduced = false }) {
  const context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 }, deviceScaleFactor: 1, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !IGNORED.some((re) => re.test(m.text()))) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  // Тема публичных страниц зависит от часа по Москве: фиксируем и день, и ночь.
  await page.clock.setFixedTime(new Date(night ? "2026-09-23T21:00:00+03:00" : "2026-09-23T12:00:00+03:00"));
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__clsQr = 0;
    window.__clsOther = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          window.__cls += e.value;
          const inQr = (e.sources || []).some((s) => s.node && s.node.nodeType === 1 && s.node.closest && s.node.closest("#qr"));
          if (inQr) window.__clsQr += e.value;
          else window.__clsOther.push((e.sources || []).map((s) => s.node && s.node.nodeType === 1 ? s.node.tagName + "." + String(s.node.className).slice(0, 40) : String(s.node && s.node.nodeName)).join(","));
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
  });
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 180000 });
  await page.waitForTimeout(800);
  return { context, page, errors };
}

const frameOf = (page) => page.locator("[data-qr-player]").getAttribute("data-frame").then(Number);
const playingOf = (page) => page.locator("[data-qr-player]").getAttribute("data-playing");
async function seek(page, value) {
  await page.locator('input[aria-label="Перемотка"]').evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await page.waitForTimeout(150);
}
async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await page.waitForTimeout(200);
}
async function centerPlayer(page) {
  await page.locator("[data-qr-player]").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -140));
  await page.waitForTimeout(700);
}
const overflow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));

// 1. Вёрстка на всех ширинах, днём и ночью
for (const width of [360, 390, 768, 1280, 1440]) {
  for (const night of [false, true]) {
    const tag = `${width}${night ? "-night" : "-day"}`;
    const { context, page, errors } = await open({ width, night });
    const theme = await page.evaluate(() => document.body.getAttribute("data-app-theme"));
    check(`${tag}: тема ${night ? "ночная" : "дневная"}`, night ? theme === "dark" : theme !== "dark", `data-app-theme=${theme}`);
    const top = await overflow(page);
    check(`${tag}: нет горизонтального скролла (верх)`, top.sw <= top.iw, `${top.sw} <= ${top.iw}`);
    if (width === 390 || width === 1440) await page.screenshot({ path: `${SHOTS}/hero-${tag}.png` });
    await centerPlayer(page);
    await page.getByRole("button", { name: "Пауза" }).click().catch(() => {});
    await seek(page, 150);
    const paper = await page.evaluate(() => {
      const table = [...document.querySelectorAll("[data-qr-player] table")][0];
      const sheet = table?.closest("div.absolute");
      return sheet ? getComputedStyle(sheet).backgroundColor : null;
    });
    check(`${tag}: бумага не перекрашена`, paper === "rgb(255, 253, 248)", String(paper));
    await page.screenshot({ path: `${SHOTS}/qr-${tag}.png` });
    const mid = await overflow(page);
    check(`${tag}: нет горизонтального скролла (ролик)`, mid.sw <= mid.iw, `${mid.sw} <= ${mid.iw}`);
    await page.locator("#start").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(1200);
    await page.locator("#start").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(1200);
    if (width === 390 || width === 1440 || width === 768) await page.screenshot({ path: `${SHOTS}/cta-${tag}.png` });
    const end = await overflow(page);
    check(`${tag}: нет горизонтального скролла (низ)`, end.sw <= end.iw, `${end.sw} <= ${end.iw}`);
    const cls = await page.evaluate(() => ({ all: window.__cls, qr: window.__clsQr, other: window.__clsOther.slice(0, 4) }));
    check(`${tag}: CLS от блока #qr < 0.01`, cls.qr < 0.01, `qr=${cls.qr.toFixed(4)}; вся страница при прыжке к #start=${cls.all.toFixed(4)} (${cls.other.join(" | ")})`);
    check(`${tag}: нет ошибок консоли`, errors.length === 0, errors.slice(0, 3).join(" | "));
    await context.close();
  }
}

// 2. Управление, клавиши, ползунки, пауза вне экрана (1280, день)
{
  const { context, page, errors } = await open({ width: 1280 });
  const before = await frameOf(page);
  check("до прокрутки ролик стоит на кадре 0 (вне экрана)", before === 0 && (await playingOf(page)) === "0", `frame=${before}`);
  await centerPlayer(page);
  await page.waitForTimeout(1200);
  const f1 = await frameOf(page);
  check("в зоне видимости ролик идёт сам", (await playingOf(page)) === "1" && f1 > 0, `frame=${f1}`);
  // вкладка скрыта → пауза
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(300);
  const h1 = await frameOf(page);
  await page.waitForTimeout(700);
  check("скрытая вкладка — пауза", (await playingOf(page)) === "0" && (await frameOf(page)) === h1, `frame ${h1} → ${await frameOf(page)}`);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(500);
  check("вкладка снова видна — ролик продолжает", (await playingOf(page)) === "1");
  // вне экрана → пауза
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  const o1 = await frameOf(page);
  await page.waitForTimeout(700);
  check("вне экрана — пауза", (await playingOf(page)) === "0" && (await frameOf(page)) === o1, `frame ${o1} → ${await frameOf(page)}`);
  await centerPlayer(page);
  await page.getByRole("button", { name: "Пауза" }).click();
  await seek(page, 100);
  check("скраббер: кадр 100", (await frameOf(page)) === 100);
  const stage = page.locator('[aria-roledescription="ролик"]');
  await stage.focus();
  await page.keyboard.press("ArrowRight");
  check("→ = +2 с (кадр 160)", (await frameOf(page)) === 160, String(await frameOf(page)));
  await page.keyboard.press("ArrowLeft");
  check("← = −2 с (кадр 100)", (await frameOf(page)) === 100, String(await frameOf(page)));
  await page.keyboard.press("Shift+ArrowRight");
  check("Shift+→ = следующая глава (кадр 180)", (await frameOf(page)) === 180, String(await frameOf(page)));
  await page.keyboard.press("Space");
  await page.waitForTimeout(500);
  check("Пробел — запуск", (await playingOf(page)) === "1");
  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  const sp = await frameOf(page);
  await page.waitForTimeout(400);
  check("Пробел — пауза", (await playingOf(page)) === "0" && (await frameOf(page)) === sp);
  // детерминированность: одинаковый кадр — одинаковая сцена
  await seek(page, 300);
  const a = await page.locator('[aria-roledescription="ролик"]').innerText();
  await seek(page, 900);
  await seek(page, 300);
  const b = await page.locator('[aria-roledescription="ролик"]').innerText();
  check("кадр детерминирован (300 → 900 → 300 даёт ту же сцену)", a === b);
  // главы: nav + aria-current
  const navRole = await page.locator('nav[aria-label="Главы ролика"]').count();
  const tablist = await page.locator('[data-qr-player] [role="tablist"]').count();
  check("главы — nav, без role=tablist", navRole === 1 && tablist === 0);
  await page.locator('nav[aria-label="Главы ролика"] button', { hasText: "Фритюр" }).click();
  check("чип «Фритюр» → кадр 540", (await frameOf(page)) === 540, String(await frameOf(page)));
  check("aria-current на текущей главе", (await page.locator('nav[aria-label="Главы ролика"] [aria-current="step"]').innerText()).includes("Фритюр"));
  // ползунок холодильника
  await page.locator('nav[aria-label="Главы ролика"] button', { hasText: "Холодильник" }).click();
  await setRange(page, "#qrp-try-fridge", 9);
  const fr = await frameOf(page);
  const stageText = await page.locator('[aria-roledescription="ролик"]').innerText();
  check("холодильник 9 °C: кадр итога (168) и уведомление", fr === 168 && stageText.includes("Температура вышла за норму") && stageText.includes(" вне нормы"), `frame=${fr}`);
  const badCell = await page.evaluate(() => {
    const tds = [...document.querySelectorAll("[data-qr-player] td")].filter((el) => el.textContent.trim() === "9");
    return tds.map((td) => getComputedStyle(td).color + "@" + td.cellIndex).join(",");
  });
  check("строка журнала красная (9 → цвет ячейки)", String(badCell).includes("rgb(163, 52, 44)"), String(badCell));
  await page.screenshot({ path: `${SHOTS}/try-fridge-9C-1280.png` });
  await setRange(page, "#qrp-try-fridge", 4);
  const okText = await page.locator('[aria-roledescription="ролик"]').innerText();
  check("холодильник 4 °C: уведомления нет", !okText.includes("Температура вышла за норму"));
  // ползунок раздевалки
  await page.locator('nav[aria-label="Главы ролика"] button', { hasText: "Раздевалка" }).click();
  await setRange(page, "#qrp-try-body", 37.4);
  const lt = await page.locator('[aria-roledescription="ролик"]').innerText();
  check("37,4 °C: «не допущены» и уведомление заведующей", (await frameOf(page)) === 348 && lt.includes("Сегодня вы не допущены к работе") && lt.includes("не допущен(а) к работе") && lt.includes("Отстранён"), `frame=${await frameOf(page)}`);
  await page.screenshot({ path: `${SHOTS}/try-locker-37_4C-1280.png` });
  await setRange(page, "#qrp-try-body", 37.0);
  const lt2 = await page.locator('[aria-roledescription="ролик"]').innerText();
  check("37,0 °C: «Допущен к работе»", lt2.includes("Допущен к работе") && !lt2.includes("не допущен(а)"));
  await setRange(page, "#qrp-try-body", 37.1);
  check("37,1 °C: уже «не допущен»", (await page.locator('[aria-roledescription="ролик"]').innerText()).includes("не допущен(а) к работе"));
  // кадры глав на 1280 для отчёта
  for (const [i, f] of [[1, 170], [2, 350], [3, 530], [4, 710], [5, 890], [6, 1070]]) {
    await setRange(page, "#qrp-try-body", 36.6).catch(() => {});
    await seek(page, f);
    await page.locator('[aria-roledescription="ролик"]').screenshot({ path: `${SHOTS}/chapter-${i}-1280.png` });
  }
  check("1280 интерактив: нет ошибок консоли", errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();
}

// 3. reduced-motion
for (const width of [390, 1280]) {
  const { context, page, errors } = await open({ width, reduced: true });
  await centerPlayer(page);
  await page.waitForTimeout(1200);
  const f = await frameOf(page);
  check(`${width} reduced: без автозапуска, итоговый кадр главы 1 (179)`, (await playingOf(page)) === "0" && f === 179, `frame=${f}`);
  const label = await page.locator("[data-qr-player]").innerText();
  check(`${width} reduced: подпись «Раскадровка»`, label.includes("Раскадровка"));
  await page.getByRole("button", { name: "Следующая глава" }).click();
  check(`${width} reduced: кнопка листает на итог главы 2 (359)`, (await frameOf(page)) === 359, String(await frameOf(page)));
  await page.screenshot({ path: `${SHOTS}/reduced-${width}.png` });
  check(`${width} reduced: нет ошибок консоли`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();
}

// 4. SSR первого кадра, /features/qr, JSON-LD FAQ
{
  const html = await (await fetch(BASE + "/")).text();
  check("первый кадр отрисован на сервере", html.includes('data-qr-player') && html.includes("Наведите камеру на наклейку") && html.includes('id="qr"'));
  check("блока «Три экрана» нет", !html.includes("Три экрана") && !html.includes("hero-fan"));
  check("id=start на месте", html.includes('id="start"'));
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let faq = null;
  for (const raw of blocks) {
    try {
      const json = JSON.parse(raw);
      const graph = json["@graph"] ?? [json];
      faq = graph.find((node) => node["@type"] === "FAQPage") ?? faq;
    } catch (e) {
      check("JSON-LD парсится", false, String(e));
    }
  }
  const names = faq ? faq.mainEntity.map((q) => q.name) : [];
  check("JSON-LD FAQPage парсится", Boolean(faq), `${names.length} вопросов`);
  for (const q of ["Нужно ли сотрудникам ставить приложение или помнить пароль?", "Что будет, если сотрудник не отсканировал QR и не заполнил журнал?", "Можно ли подделать запись по QR?"]) {
    check(`FAQ JSON-LD: «${q}»`, names.includes(q));
  }
  const res = await fetch(BASE + "/features/qr");
  const fhtml = await res.text();
  check("/features/qr отдаёт 200", res.status === 200, String(res.status));
  check("/features/qr: заголовок", fhtml.includes("Заполнение журналов по QR-коду"));
  const { context, page } = await open({ width: 390 });
  await page.goto(BASE + "/features/qr", { waitUntil: "load" });
  await page.screenshot({ path: `${SHOTS}/features-qr-390.png` });
  const o = await overflow(page);
  check("/features/qr 390: без горизонтального скролла", o.sw <= o.iw, `${o.sw} <= ${o.iw}`);
  await context.close();
}

writeFileSync(`${OUT}/verify-results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\nИтого: ${results.length - failed.length}/${results.length} PASS`);
await browser.close();
process.exit(failed.length ? 1 : 0);
