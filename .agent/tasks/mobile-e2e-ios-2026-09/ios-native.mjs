// Проверка приложения WeSetup для iOS в симуляторе (CI, macOS), раунд 2.
// Только НАТИВНОЕ дерево доступности: на iOS 26.5 Appium не подключается к WKWebView
// («Empty page dictionary»), но WebKit отдаёт содержимое страницы элементами
// XCUIElement (StaticText, Button, Link, TextField, SecureTextField, Other c ToggleButton).
// Элементы ищем по подписи и типу, нажимаем пальцем в центр их рамки (mobile: tap),
// печатаем в сфокусированное поле, листаем перетаскиванием. Скриншоты — simctl
// (со строкой состояния и Dynamic Island). Консоль приложения — журналы
// `simctl launch --console-pty` (строки «⚡️»), их разбирает сценарий S12.
// Итог — results.json в OUT_DIR.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { remote } from "webdriverio";

const env = process.env;
const UDID = env.UDID;
const BUNDLE = "ru.wesetup.app";
const OUT = env.OUT_DIR || "out";
const LOGS = env.LOGS || OUT;
const IDS = JSON.parse(fs.readFileSync(env.IDS_JSON, "utf8"));
const PASSWORD = "DemoShots2026!";
const CHEF = "chef@cafe-demo.local";
const THROWAWAY = "delete-me@cafe-demo.local";
const DEV = env.SITE_DEV === "1";
const SLOW = DEV ? 4 : 1; // next dev собирает страницу при первом заходе
const DEADLINE = Date.now() + Number(env.TEST_BUDGET_MIN || 30) * 60000;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const crashes = [];
const meta = { udid: UDID, dev: DEV, started: new Date().toISOString() };
let shotN = 0;
let driver;
let W = { width: 402, height: 874 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const q = (s) => JSON.stringify(s);

function shot(name) {
  const f = `${String(++shotN).padStart(3, "0")}-${name}.png`;
  try {
    execFileSync("xcrun", ["simctl", "io", UDID, "screenshot", path.join(OUT, f)], { stdio: "ignore", timeout: 40000 });
    return f;
  } catch (e) {
    log("screenshot failed", name, e.message);
    return null;
  }
}

function save() {
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ meta, results, crashes }, null, 2));
}

function withTimeout(p, ms, label) {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(label)), ms)))]).finally(() =>
    clearTimeout(t)
  );
}

async function waitFor(fn, timeout = 20000, step = 600) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) {
    try {
      v = await fn();
      if (v) return v;
    } catch {
      /* дерево перестраивается */
    }
    await sleep(step);
  }
  return v;
}

// ─── Дерево доступности ───────────────────────────────────────────────

const T = {
  text: "XCUIElementTypeStaticText",
  button: "XCUIElementTypeButton",
  link: "XCUIElementTypeLink",
  field: "XCUIElementTypeTextField",
  secure: "XCUIElementTypeSecureTextField",
  other: "XCUIElementTypeOther",
  kb: "XCUIElementTypeKeyboard",
};

/** Предикат: типы (массив или строка) и подпись (exact / contains / begins). */
function pred({ type, label, contains, begins, value }) {
  const parts = [];
  if (type) {
    const types = Array.isArray(type) ? type : [type];
    parts.push(`type IN {${types.map((t) => q(T[t] || t)).join(",")}}`);
  }
  if (label != null) parts.push(`label == ${q(label)}`);
  if (contains != null) parts.push(`label CONTAINS[c] ${q(contains)}`);
  if (begins != null) parts.push(`label BEGINSWITH ${q(begins)}`);
  if (value != null) parts.push(`value CONTAINS[c] ${q(value)}`);
  return parts.join(" AND ");
}

async function all(spec) {
  const els = await driver.$$(`-ios predicate string:${pred(spec)}`);
  const out = [];
  for (const el of els) {
    try {
      const r = await driver.getElementRect(el.elementId);
      if (r.width <= 0 || r.height <= 0) continue;
      out.push({ el, r, label: await el.getAttribute("label").catch(() => null) });
    } catch {
      /* элемент исчез */
    }
  }
  return out;
}

async function has(spec) {
  const els = await driver.$$(`-ios predicate string:${pred(spec)}`);
  return els.length > 0;
}

/** Видимая полоса экрана для нажатий: под шапкой и над нижним меню. */
function band() {
  return { top: 120, bottom: W.height - 110 };
}

async function tapXY(x, y) {
  await driver.execute("mobile: tap", { x: Math.round(x), y: Math.round(y) });
}

async function drag(fromY, toY, x = Math.round(W.width * 0.62)) {
  await driver.execute("mobile: dragFromToWithVelocity", {
    pressDuration: 0.05,
    holdDuration: 0.25,
    velocity: 1400,
    fromX: x,
    fromY: Math.round(fromY),
    toX: x,
    toY: Math.round(toY),
  });
  await sleep(500);
}

const scrollDown = () => drag(W.height * 0.72, W.height * 0.32);
const scrollUp = () => drag(W.height * 0.3, W.height * 0.7);

async function toTop() {
  for (let i = 0; i < 6; i++) await drag(W.height * 0.25, W.height * 0.85);
}

/**
 * Найти элемент (при необходимости долистать) и нажать пальцем в центр.
 * pick: "first" | "last" | "lowest" (по y) | функция отбора.
 */
async function tap(spec, { scrolls = 8, pick = "first", within = null, anywhere = false, ignoreKeyboard = false, timeout = 12000 * SLOW, settle = 700 } = {}) {
  const end = Date.now() + timeout;
  let found = [];
  for (let i = 0; ; i++) {
    if (i > 0 && Date.now() > end) break;
    found = await all(spec);
    if (within) found = found.filter((f) => within(f.r, f.label));
    const b = anywhere ? { top: 0, bottom: W.height } : band();
    // Открытая клавиатура закрывает низ экрана: туда не нажимаем и не листаем.
    const kt = ignoreKeyboard ? null : await keyboardTop();
    if (kt) b.bottom = Math.min(b.bottom, kt - 4);
    if (kt && found.length && !found.some((f) => f.r.y + f.r.height / 2 <= b.bottom) && found.some((f) => f.r.y + f.r.height / 2 > b.bottom)) {
      await hideKeyboard();
      continue;
    }
    const visible = found.filter((f) => f.r.y + f.r.height / 2 >= b.top && f.r.y + f.r.height / 2 <= b.bottom && f.r.x + f.r.width / 2 > 0 && f.r.x + f.r.width / 2 < W.width);
    const list = visible.length ? visible : [];
    if (list.length) {
      const f = pick === "last" ? list[list.length - 1] : pick === "lowest" ? list.sort((a, c) => c.r.y - a.r.y)[0] : list[0];
      await tapXY(f.r.x + f.r.width / 2, f.r.y + f.r.height / 2);
      lastTapped = f.el;
      await sleep(settle);
      return f;
    }
    if (found.length && i < scrolls) {
      const f = found[0];
      if (f.r.y + f.r.height / 2 > band().bottom) await scrollDown();
      else await scrollUp();
      continue;
    }
    if (!found.length && i < scrolls && Date.now() > end - timeout / 2) {
      await scrollDown();
      continue;
    }
    if (Date.now() > end) break;
    await sleep(800);
  }
  throw new Error(`не найден: ${pred(spec)}`);
}

async function tryTap(spec, opts) {
  try {
    return await tap(spec, opts);
  } catch {
    return null;
  }
}

async function source(tag) {
  try {
    const xml = await driver.getPageSource();
    fs.writeFileSync(path.join(OUT, `src-${tag}.xml`), xml);
    return xml;
  } catch (e) {
    log("source failed", e.message.slice(0, 200));
    return "";
  }
}

function labelsOf(xml) {
  const set = new Set();
  for (const m of (xml || "").matchAll(/(?:label|name|value)="([^"]{1,160})"/g)) set.add(m[1]);
  return set;
}

function newLabels(before, after) {
  const b = labelsOf(before);
  return Array.from(labelsOf(after)).filter((l) => !b.has(l));
}

/** Все подписанные элементы страницы с рамками — из XML (один запрос). */
function elementsOf(xml) {
  const out = [];
  const re = /<XCUIElementType(StaticText|Button|Link|TextField|SecureTextField|Switch|Image|Other)\b([^>]*)>/g;
  for (const m of xml.matchAll(re)) {
    const a = m[2];
    const g = (k) => (new RegExp(`\\b${k}="([^"]*)"`).exec(a) || [])[1];
    const label = g("label") || g("value") || "";
    if (!label && m[1] === "Other") continue;
    out.push({ type: m[1], label: label.slice(0, 80), x: +g("x"), y: +g("y"), w: +g("width"), h: +g("height"), visible: g("visible") });
  }
  return out;
}

async function appState() {
  return driver.execute("mobile: queryAppState", { bundleId: BUNDLE });
}

async function alertButtons(timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const b = await driver.execute("mobile: alert", { action: "getButtons" });
      if (Array.isArray(b) && b.length) return b;
    } catch {
      /* окна нет */
    }
    await sleep(500);
  }
  return null;
}

async function alertText() {
  try {
    return await driver.getAlertText();
  } catch {
    return null;
  }
}

async function acceptAlert(buttons) {
  const bad = /не разреш|запрет|don.?t|не сейчас|отмен|cancel/i;
  const pick =
    buttons.find((b) => /^(разрешить|allow|ok|ок)$/i.test(b.trim())) ||
    buttons.find((b) => /разреш|allow|ok|ок/i.test(b) && !bad.test(b)) ||
    buttons[buttons.length - 1];
  await driver.execute("mobile: alert", { action: "accept", buttonLabel: pick });
  return pick;
}

async function keyboard() {
  const k = await all({ type: "kb" });
  return k[0]?.r ?? null;
}

/** Верх видимой области над клавиатурой: панель «Готово» или сама клавиатура. */
async function keyboardTop() {
  const kb = await keyboard();
  if (!kb) return null;
  const bars = await all({ type: "button", label: "Готово" });
  const bar = bars.find((b) => b.r.y < kb.y && b.r.y > kb.y - 160);
  const pw = await all({ type: "button", label: "Passwords" });
  const tops = [kb.y, ...(bar ? [bar.r.y - 6] : []), ...pw.filter((p) => p.r.y < kb.y).map((p) => p.r.y)];
  return Math.min(...tops);
}

async function hideKeyboard() {
  if (!(await keyboard())) return;
  const done = await tryTap({ type: "button", label: "Готово" }, { scrolls: 0, anywhere: true, ignoreKeyboard: true, timeout: 1500 });
  if (!done) {
    try {
      await driver.execute("mobile: hideKeyboard", { keys: ["Готово", "Done", "return"] });
    } catch {
      /* */
    }
  }
  await sleep(600);
}

let lastTapped = null;
/**
 * Раскладка под текст: XCTest печатает только то, что есть на текущей раскладке
 * (раунд 2: пароль «DemoShots2026!» на русской раскладке ушёл как «2026!»).
 * Переключаем глобусом, пока на клавиатуре не появятся нужные буквы.
 */
async function ensureLayout(text) {
  const wantLatin = /[a-z]/i.test(text);
  const wantCyr = /[а-яё]/i.test(text);
  if (!wantLatin && !wantCyr) return;
  const probe = wantLatin ? ["q", "Q", "a", "A"] : ["й", "Й", "ф", "Ф"];
  for (let i = 0; i < 4; i++) {
    const keys = await driver.$$(`-ios predicate string:type == "XCUIElementTypeKey" AND label IN {${probe.map(q).join(",")}}`);
    if (keys.length) return;
    const globe = await driver.$$(`-ios predicate string:type IN {"XCUIElementTypeButton","XCUIElementTypeKey"} AND (label IN {"Следующая клавиатура","Next keyboard"} OR name IN {"Следующая клавиатура","Next keyboard","NextKeyboard"})`);
    if (!globe.length) return;
    await globe[0].click();
    await sleep(600);
  }
}

async function typeFocused(text) {
  await ensureLayout(text);
  const f = await driver.$(`-ios predicate string:type IN {${q(T.field)},${q(T.secure)}} AND hasKeyboardFocus == 1`);
  if (await f.isExisting()) {
    await f.addValue(text);
    return f;
  }
  // Запасной путь: поле, по которому только что нажали.
  if (lastTapped) {
    await lastTapped.addValue(text);
    return lastTapped;
  }
  throw new Error("нет поля с фокусом клавиатуры");
}

// ─── Консоль приложения ───────────────────────────────────────────────

const consoleFiles = () =>
  fs
    .readdirSync(LOGS)
    .filter((f) => /^launch\d+-console\.log$/.test(f))
    .map((f) => path.join(LOGS, f));
const consoleSeen = new Map();
const ERR_RX = /Minified React error|#418|#419|#423|#425|Hydration|hydrat|STARTUP JS ERROR|\[error\]|Uncaught|Unhandled|TypeError|ReferenceError|SyntaxError/i;
function consoleNews() {
  const out = [];
  for (const f of consoleFiles()) {
    const txt = fs.readFileSync(f, "utf8");
    const from = consoleSeen.get(f) ?? 0;
    const lines = txt.slice(from).split("\n");
    consoleSeen.set(f, txt.length);
    for (const l of lines) if (ERR_RX.test(l)) out.push(`${path.basename(f)}: ${l.slice(0, 400)}`);
  }
  return out;
}

let launchN = 1;
/** Запуск приложения с журналом консоли (как первый запуск в workflow). */
function launchWithConsole() {
  launchN += 1;
  const file = path.join(LOGS, `launch${launchN}-console.log`);
  const cmd = `xcrun simctl launch --console-pty --terminate-running-process ${UDID} ${BUNDLE} 2>&1 | perl -MTime::HiRes=time -MPOSIX=strftime -ne '$|=1; my $t=time; printf "%s.%03d %s", strftime("%H:%M:%S",gmtime $t), ($t-int $t)*1000, $_' >> ${file}`;
  const p = spawn("bash", ["-c", cmd], { detached: true, stdio: "ignore" });
  p.unref();
  return { file, t0: Date.now() };
}

// ─── Проверки раскладки ───────────────────────────────────────────────

const ISLAND_BOTTOM = 54; // низ Dynamic Island у iPhone 17 Pro (строка состояния — до ~54 pt)
const HOME_ZONE = 34; // полоска «домой»

async function layoutCheck(ctx, name, xml) {
  xml = xml || (await source(`${ctx.r.id}-${name}`));
  const els = elementsOf(xml).filter((e) => e.w > 0 && e.h > 0 && e.type !== "Other" && e.type !== "Image");
  const onScreen = els.filter((e) => e.y + e.h > 0 && e.y < W.height);
  const underIsland = onScreen.filter((e) => e.y < ISLAND_BOTTOM && e.y + e.h > 8 && e.label);
  const nav = onScreen.filter((e) => e.type === "Link" && ["Главная", "Журналы", "Разделы", "Профиль", "Сегодня"].includes(e.label) && e.y > W.height - 160);
  const navLow = nav.filter((e) => e.y + e.h > W.height - HOME_ZONE + 1);
  const wide = onScreen.filter((e) => e.x + e.w > W.width + 2 || e.x < -2).map((e) => `${e.type} «${e.label.slice(0, 40)}» x=${e.x} w=${e.w}`);
  const d = { underIsland: underIsland.map((e) => `${e.type} «${e.label}» y=${e.y}`), nav: nav.map((e) => `${e.label} y=${e.y} h=${e.h}`), wide: wide.slice(0, 12), wideCount: wide.length };
  ctx.d[`layout_${name}`] = d;
  ctx.check(`${name}: ничего не под «островом» (y<${ISLAND_BOTTOM})`, underIsland.length === 0, d.underIsland);
  if (nav.length) ctx.check(`${name}: нижнее меню над полоской «домой»`, navLow.length === 0, d.nav);
  // Широкие таблицы документа листаются внутри своего блока — там элементы за краем
  // ожидаемы; на остальных экранах за край ничего выходить не должно.
  if (!/doc/.test(name)) ctx.check(`${name}: ничего не выходит за край экрана по ширине`, wide.length === 0, d.wide);
  return d;
}

// ─── Сценарии ─────────────────────────────────────────────────────────

async function scenario(id, name, fn, timeoutMs = 300000) {
  const r = { id, name, status: "RUNNING", checks: [], details: {}, shots: [], started: new Date().toISOString() };
  results.push(r);
  log(">>", id, name);
  const ctx = {
    r,
    d: r.details,
    shot(n) {
      const f = shot(`${id}-${n}`);
      if (f) r.shots.push(f);
      return f;
    },
    check(label, ok, extra) {
      r.checks.push({ label, ok: Boolean(ok), extra });
      log(ok ? "   ok:" : "   FAIL:", label, ok ? "" : JSON.stringify(extra ?? "").slice(0, 300));
      return Boolean(ok);
    },
    skip(reason) {
      r.status = "SKIPPED";
      r.skipReason = reason;
    },
  };
  if (Date.now() > DEADLINE) {
    ctx.skip("время теста вышло");
    save();
    return;
  }
  try {
    await withTimeout(fn(ctx), timeoutMs * SLOW, `${id}: не уложился в ${(timeoutMs * SLOW) / 1000} с`);
    if (r.status === "RUNNING") r.status = r.checks.every((c) => c.ok) ? "PASS" : "FAIL";
  } catch (e) {
    r.status = "FAIL";
    r.error = String(e?.stack || e).slice(0, 2000);
    log("   ERROR:", r.error.slice(0, 400));
    ctx.shot("error");
    await source(`${id}-error`);
  }
  try {
    const st = await appState();
    r.appStateAfter = st;
    if (st !== 4) {
      crashes.push({ tag: id, state: st, at: new Date().toISOString() });
      if (st === 1) {
        r.status = "FAIL";
        r.crash = true;
      }
      await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
      await sleep(3000);
    }
  } catch {
    /* */
  }
  if (r.status === "FAIL") await recover();
  r.console = consoleNews();
  if (r.console.length) log("   console:", r.console.slice(0, 5).join(" | ").slice(0, 600));
  r.ended = new Date().toISOString();
  save();
  log("<<", id, r.status);
}

/** После провала: закрыть системные окна, листы и клавиатуру, вернуть приложение. */
async function recover() {
  try {
    if (await alertButtons(1000)) await driver.execute("mobile: alert", { action: "dismiss" }).catch(() => undefined);
    for (const label of ["Отменить", "Закрыть", "Cancel", "Close", "Отмена", "Не сейчас"]) {
      await tryTap({ type: "button", label }, { scrolls: 0, anywhere: true, ignoreKeyboard: true, timeout: 800 });
    }
    await hideKeyboard();
    if ((await appState()) !== 4) await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
    await sleep(1500);
  } catch (e) {
    log("recover failed", e.message.slice(0, 200));
  }
}

async function onLogin() {
  return has({ type: "text", label: "Вход в кабинет" });
}

/** Нижнее меню: ссылка с точной подписью внизу экрана. */
async function tab(label) {
  const f = await tap({ type: "link", begins: label }, { scrolls: 0, anywhere: true, within: (r) => r.y > W.height - 170, settle: 1500 * SLOW });
  return f;
}

async function waitText(spec, timeout = 25000) {
  return waitFor(() => has(spec), timeout * SLOW);
}

async function signIn(ctx, email, tag) {
  if (!(await onLogin())) throw new Error("не экран входа");
  // «Почта» — Other c признаком ToggleButton (radio). Нажимаем пальцем в центр.
  const mail = await tap({ type: "other", label: "Почта" }, { scrolls: 0 });
  let switched = await waitFor(() => has({ type: "field", contains: "почт" }), 4000);
  if (!switched) {
    await mail.el.click().catch(() => undefined);
    switched = await waitFor(() => has({ type: "field", contains: "почт" }), 4000);
  }
  ctx.check(`${tag}: вкладка «Почта» переключила поле`, switched);
  await tap({ type: "field", contains: "почт" }, { scrolls: 2 });
  await waitFor(keyboard, 6000);
  await sleep(900);
  ctx.shot(`${tag}-kb-email`);
  const kbTop1 = await keyboardTop();
  const btn1 = (await all({ type: "button", label: "Войти" }))[0]?.r;
  ctx.d[`${tag}_kb_email`] = { kbTop: kbTop1, submit: btn1 };
  // После выхода форма помнит прошлую почту (раунд 2: «chef@…delete-me@…») — сначала очистить.
  if (lastTapped) await lastTapped.clearValue().catch(() => undefined);
  await typeFocused(email);
  await tap({ type: "secure" }, { scrolls: 2 });
  await sleep(700);
  await typeFocused(PASSWORD);
  await sleep(1200);
  ctx.shot(`${tag}-kb-password`);
  const kbTop = await keyboardTop();
  const btn = (await all({ type: "button", label: "Войти" }))[0]?.r;
  const emailVal = await (await driver.$(`-ios predicate string:${pred({ type: "field", contains: "почт" })}`)).getAttribute("value").catch(() => null);
  ctx.d[`${tag}_kb_password`] = { kbTop, submit: btn, emailVal };
  ctx.check(`${tag}: почта набрана`, emailVal === email, emailVal);
  if (kbTop && btn) ctx.check(`${tag}: «Войти» над клавиатурой (пароль в фокусе)`, btn.y + btn.height <= kbTop + 1, { button: btn, kbTop });
  else ctx.check(`${tag}: клавиатура открыта и «Войти» найдена`, Boolean(kbTop && btn), { kbTop, btn });
  const t0 = Date.now();
  if (btn && kbTop && btn.y + btn.height <= kbTop) await tapXY(btn.x + btn.width / 2, btn.y + btn.height / 2);
  else {
    await hideKeyboard();
    await tap({ type: "button", label: "Войти" });
  }
  const left = await waitFor(async () => !(await onLogin()) && (await has({ type: "link", begins: "Профиль" })), 45000 * SLOW, 800);
  ctx.d[`${tag}_loginMs`] = Date.now() - t0;
  if (!left) {
    const errs = (await all({ type: "text" })).map((e) => e.label).filter((l) => /невер|ошиб|не удалось|не найден/i.test(l || ""));
    throw new Error(`вход ${email} не удался: ${errs.join(" | ")}`);
  }
  await sleep(1500);
}

async function profileTheme(ctx, name) {
  await tab("Профиль");
  await waitText({ type: "text", label: "Профиль" }, 20000);
  const t = await tap({ type: ["other", "button"], begins: name }, { scrolls: 8 });
  ctx.d[`theme_${name}`] = t?.label;
  await sleep(1500);
  await toTop();
}

async function openJournal(ctx, search, cardText, docTitle) {
  await tab("Журналы");
  await waitFor(() => has({ type: "field", label: "Поиск по журналам" }), 30000 * SLOW);
  await tap({ type: "field", label: "Поиск по журналам" }, { scrolls: 3 });
  await sleep(600);
  await typeFocused(search);
  await sleep(1200);
  await hideKeyboard();
  await tap({ type: "link", contains: cardText }, { scrolls: 4, within: (r) => r.y < W.height - 170, settle: 2500 * SLOW });
  // Список документов журнала — открыть документ по периоду из названия.
  const period = docTitle ? docTitle.split(" · ").pop() : null;
  const doc = await waitFor(async () => {
    if (await has({ type: ["link", "button"], contains: "Распечатать" })) return "doc";
    if (period && (await has({ type: "link", contains: period }))) return "list";
    return null;
  }, 30000 * SLOW);
  ctx.d[`open_${search}`] = doc;
  if (!doc) await source(`${ctx.r.id}-journal-${search}`);
  if (doc === "list") {
    await tap({ type: "link", contains: period }, { scrolls: 4, settle: 3000 * SLOW });
    await waitFor(() => has({ type: ["link", "button"], contains: "Распечатать" }), 40000 * SLOW);
  }
  await sleep(1500);
  return has({ type: ["link", "button"], contains: "Распечатать" });
}

async function sectionsGo(label) {
  await tab("Разделы");
  await waitFor(() => has({ type: "field", label: "Поиск раздела" }), 20000 * SLOW);
  await tap({ type: "field", label: "Поиск раздела" }, { scrolls: 2 });
  await sleep(500);
  await typeFocused(label);
  await sleep(1000);
  await hideKeyboard();
  return tap({ type: "link", contains: label }, { scrolls: 3, within: (r) => r.y < W.height - 170, settle: 3000 * SLOW });
}

async function main() {
  const caps = {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": UDID,
    // Без bundleId: драйвер 12.13 не находил установленное приложение («App with bundle
    // identifier unknown») — сессия цепляется к тому, что на экране (наше приложение).
    // isHeadless — чтобы Appium не перезапускал симулятор с окном (это убивало приложение
    // и журнал его консоли).
    "appium:isHeadless": true,
    "appium:noReset": true,
    "appium:forceAppLaunch": false,
    "appium:shouldTerminateApp": false,
    "appium:autoAcceptAlerts": false,
    "appium:autoDismissAlerts": false,
    "appium:newCommandTimeout": 900,
    "appium:wdaLaunchTimeout": 360000,
    "appium:wdaConnectionTimeout": 360000,
    "appium:simulatorStartupTimeout": 300000,
    "appium:includeSafariInWebviews": false,
  };
  if (env.WDA_DD && fs.existsSync(path.join(env.WDA_DD, "Build"))) {
    caps["appium:usePrebuiltWDA"] = true;
    caps["appium:derivedDataPath"] = env.WDA_DD;
  }
  meta.caps = caps;
  driver = await remote({ hostname: "127.0.0.1", port: 4723, path: "/", logLevel: "warn", connectionRetryTimeout: 900000, connectionRetryCount: 1, capabilities: caps });
  log("session", driver.sessionId);
  await driver.updateSettings({ snapshotMaxDepth: 62, customSnapshotTimeout: 30, pageSourceExcludedAttributes: "" }).catch((e) => log("settings", e.message));
  await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
  await sleep(1500);
  W = await driver.getWindowRect();
  meta.window = W;
  consoleNews(); // строки первого запуска разберёт S01 отдельно

  // 1. Холодный запуск (первый — в workflow до Appium; здесь — состояние и повторный замер)
  await scenario("S01", "Холодный запуск: сразу экран входа, без клавиатуры и стрелки «назад»", async (ctx) => {
    ctx.shot("state-after-first-launch");
    const xml = await source("S01-first");
    ctx.check("первый запуск: экран входа «Вход в кабинет»", await onLogin());
    ctx.check("нет «Открываем кабинет…»", !(await has({ contains: "Открываем" })));
    ctx.check("клавиатура сама не открылась", !(await keyboard()));
    ctx.check("нет стрелки «Назад» на входе", !(await has({ type: "button", label: "Назад" })));
    await layoutCheck(ctx, "login", xml);
    const logo = (await all({ type: "link", label: "На главный экран" }))[0]?.r ?? null;
    ctx.d.topbarLink = logo;
    if (logo) ctx.check("шапка ниже Dynamic Island", logo.y >= ISLAND_BOTTOM, logo);
    const launch1 = path.join(LOGS, "launch1-console.log");
    if (fs.existsSync(launch1)) {
      const txt = fs.readFileSync(launch1, "utf8");
      ctx.d.launch1Errors = txt.split("\n").filter((l) => ERR_RX.test(l)).slice(0, 20);
      ctx.d.launch1Bridges = (txt.match(/Loading app at/g) || []).length;
    }
    // Повторный холодный запуск с замером: запуск → «Вход в кабинет» в дереве.
    await driver.execute("mobile: terminateApp", { bundleId: BUNDLE });
    await sleep(1500);
    const { t0 } = launchWithConsole();
    const frames = [];
    let loginAt = null;
    let sawOpening = false;
    while (Date.now() - t0 < 25000) {
      const dt = Date.now() - t0;
      if (frames.length < 6 && dt > frames.length * 700) frames.push(ctx.shot(`relaunch-${String(dt).padStart(5, "0")}ms`));
      try {
        if (await has({ contains: "Открываем" })) sawOpening = true;
        if (await onLogin()) {
          loginAt = Date.now() - t0;
          break;
        }
      } catch {
        /* приложение ещё запускается */
      }
      await sleep(250);
    }
    ctx.shot("relaunch-login");
    ctx.d.relaunchToLoginMs = loginAt;
    ctx.check("повторный запуск: экран входа меньше чем за 8 с", loginAt != null && loginAt < 8000 * SLOW, loginAt);
    ctx.check("повторный запуск: «Открываем кабинет…» не показывался", !sawOpening);
    await sleep(1500);
    ctx.check("повторный запуск: клавиатура не открылась сама", !(await keyboard()));
  });

  // 2. Вход шефа и уведомления
  await scenario("S02", "Вход по «Почте» (клавиатура не закрывает «Войти»), лист уведомлений, разрешение iOS", async (ctx) => {
    await signIn(ctx, CHEF, "chef");
    ctx.shot("home-after-login");
    const sheet = await waitFor(() => has({ type: "button", label: "Включить" }), 15000 * SLOW);
    ctx.shot("push-explainer");
    ctx.check("лист «Уведомления о задачах» с «Включить»", sheet);
    ctx.d.sheetTitle = await has({ contains: "Уведомления о задачах" });
    if (!sheet) return;
    await tap({ type: "button", label: "Включить" }, { scrolls: 0, anywhere: true });
    const buttons = await alertButtons(12000);
    ctx.d.alertButtons = buttons;
    ctx.d.alertText = await alertText();
    ctx.shot("ios-alert");
    ctx.check("системное окно iOS «…хочет отправлять уведомления»", Boolean(buttons));
    if (buttons) ctx.d.pressed = await acceptAlert(buttons);
    await sleep(4000);
    ctx.shot("after-allow");
    ctx.check("приложение живо", (await appState()) === 4);
    ctx.check("лист закрылся", !(await has({ type: "button", label: "Включить" })));
    const errToast = (await all({ type: "text" })).map((e) => e.label).filter((l) => /не удалось|ошибк|error/i.test(l || ""));
    ctx.d.errorTexts = errToast;
    ctx.check("без сообщений об ошибке", errToast.length === 0, errToast);
    // Страница откликается: вкладка «Разделы» открывается.
    await tab("Разделы");
    ctx.check("после разрешения интерфейс откликается (открылись «Разделы»)", await waitText({ type: "text", label: "Все разделы" }, 20000));
  });

  // 3. Основные экраны: светлая и тёмная
  const screenPass = async (ctx, theme) => {
    await tab("Главная");
    await sleep(2500 * SLOW);
    ctx.shot(`home-${theme}`);
    await layoutCheck(ctx, `home-${theme}`);
    await tab("Разделы");
    await waitText({ type: "text", label: "Все разделы" });
    ctx.shot(`sections-${theme}`);
    await layoutCheck(ctx, `sections-${theme}`);
    await tab("Журналы");
    await waitFor(() => has({ type: "field", label: "Поиск по журналам" }), 30000 * SLOW);
    await sleep(1000);
    ctx.shot(`journals-${theme}`);
    await layoutCheck(ctx, `journals-${theme}`);
    const cl = await openJournal(ctx, "уборки", "Журнал уборки", IDS.docs?.cleaning?.title);
    ctx.check(`${theme}: документ «Журнал уборки» открылся`, cl);
    await toTop();
    ctx.shot(`cleaning-doc-${theme}`);
    await layoutCheck(ctx, `cleaning-doc-${theme}`);
    await scrollDown();
    await scrollDown();
    ctx.shot(`cleaning-doc-scrolled-${theme}`);
    const cold = await openJournal(ctx, "холодильн", "холодильного", IDS.docs?.cold?.title);
    ctx.check(`${theme}: документ журнала холодильников открылся`, cold);
    await toTop();
    ctx.shot(`fridges-doc-${theme}`);
    await layoutCheck(ctx, `fridges-doc-${theme}`);
    await scrollDown();
    await scrollDown();
    ctx.shot(`fridges-doc-scrolled-${theme}`);
    await tab("Профиль");
    await waitText({ type: "text", label: "Профиль" });
    await toTop();
    ctx.shot(`profile-${theme}`);
    await layoutCheck(ctx, `profile-${theme}`);
  };
  await scenario("S03a", "Основные экраны — светлая тема", async (ctx) => {
    await profileTheme(ctx, "Светлая");
    await screenPass(ctx, "light");
  }, 480000);
  await scenario("S03b", "Основные экраны — тёмная тема", async (ctx) => {
    await profileTheme(ctx, "Тёмная");
    await screenPass(ctx, "dark");
  }, 480000);

  // 4. Печать документа
  await scenario("S04", "Печать документа журнала: системное окно печати iOS", async (ctx) => {
    const ok = await openJournal(ctx, "уборки", "Журнал уборки", IDS.docs?.cleaning?.title);
    ctx.check("документ уборки открыт", ok);
    await toTop();
    const before = await source("S04-before");
    const p = (await tryTap({ type: ["link", "button"], label: "Распечатать" }, { scrolls: 3 })) || (await tap({ type: ["link", "button"], contains: "Распечатать" }, { scrolls: 3 }));
    ctx.d.printControl = p.label;
    const xml = await waitFor(async () => {
      const s = await source("S04-print");
      const fresh = newLabels(before, s);
      return fresh.some((l) => /Принтер|Printer|Параметры печати|Print Options|Копи|Cop(y|ies)|Печать|Print/i.test(l)) ? s : null;
    }, 25000 * SLOW, 1500);
    const fresh = newLabels(before, xml || (await source("S04-print2")));
    ctx.d.newLabels = fresh.slice(0, 60);
    ctx.shot("print-sheet");
    ctx.check("окно печати iOS появилось", Boolean(xml), fresh.slice(0, 30));
    const cancel = await tryTap({ type: "button", label: "Отменить" }, { scrolls: 0, anywhere: true, timeout: 3000 }) || (await tryTap({ type: "button", label: "Cancel" }, { scrolls: 0, anywhere: true, timeout: 2000 })) || (await tryTap({ type: "button", label: "Закрыть" }, { scrolls: 0, anywhere: true, timeout: 2000 }));
    ctx.d.cancelled = cancel?.label ?? null;
    await sleep(2000);
    ctx.shot("print-cancelled");
    const after = await source("S04-after");
    const left = newLabels(before, after).filter((l) => /Принтер|Printer|Параметры печати|Print Options/i.test(l));
    ctx.check("окно печати закрылось", left.length === 0, left);
    ctx.check("приложение живо, документ на месте", (await appState()) === 4 && (await has({ type: ["link", "button"], contains: "Распечатать" })));
  });

  // 5. Скачивание отчёта: лист «Поделиться»
  const shareCheck = async (ctx, tag, ext, before) => {
    let fresh = [];
    const xml = await waitFor(async () => {
      const s = await source(`S05-${tag}`);
      fresh = newLabels(before, s);
      return fresh.some((l) => /Сохранить в|Save to|AirDrop|Скопировать|Copy|Напечатать|Print|Файлы|Files|Сообщения|Messages|Правка действий|Edit Actions/i.test(l)) ? s : null;
    }, 30000 * SLOW, 1500);
    ctx.shot(`${tag}-share-sheet`);
    ctx.d[`${tag}_newLabels`] = fresh.slice(0, 60);
    ctx.check(`${tag}: лист «Поделиться» появился`, Boolean(xml), fresh.slice(0, 25));
    const names = fresh.filter((l) => l.toLowerCase().includes("." + ext) || /report_|Журнал|отчёт/i.test(l));
    ctx.d[`${tag}_fileNames`] = names;
    ctx.check(`${tag}: имя файла видно в листе (.${ext})`, names.some((n) => n.toLowerCase().includes("." + ext)), names);
    const close = (await tryTap({ type: "button", label: "Закрыть" }, { scrolls: 0, anywhere: true, timeout: 3000 })) || (await tryTap({ type: "button", label: "Close" }, { scrolls: 0, anywhere: true, timeout: 2000 }));
    if (!close) await drag(W.height * 0.35, W.height * 0.95, Math.round(W.width / 2));
    await sleep(2000);
    ctx.shot(`${tag}-closed`);
    ctx.check(`${tag}: лист закрылся, приложение живо`, (await appState()) === 4 && !(await has({ contains: "AirDrop" })));
  };
  await scenario("S05", "Скачивание отчёта Excel и PDF: лист «Поделиться» с понятным именем файла", async (ctx) => {
    await sectionsGo("Отчёт");
    const form = await waitFor(() => has({ contains: "Выберите журнал" }), 30000 * SLOW);
    ctx.shot("reports");
    ctx.check("страница отчётов открылась", form);
    await tap({ type: ["button", "other"], contains: "Выберите журнал" }, { scrolls: 6 });
    await sleep(1200);
    ctx.shot("reports-select");
    await tap({ contains: "Журнал уборки" }, { scrolls: 4, within: (r) => r.y > 60, pick: "last" });
    await sleep(1000);
    let before = await source("S05-before-xlsx");
    await tap({ type: "button", contains: "Скачать Excel" }, { scrolls: 6 });
    await shareCheck(ctx, "report-xlsx", "xlsx", before);
    before = await source("S05-before-pdf");
    await tap({ type: "button", contains: "Скачать PDF" }, { scrolls: 6 });
    await shareCheck(ctx, "report-pdf", "pdf", before);
  }, 360000);

  // 6. Внешние ссылки
  await scenario("S06", "Ссылки: почта (mailto) и чужой сайт — системе; приложение остаётся рабочим", async (ctx) => {
    await sectionsGo("Отчёт");
    await waitFor(() => has({ type: "link", contains: "Поделиться по email" }), 30000 * SLOW);
    await toTop();
    await tap({ type: "link", contains: "Поделиться по email" }, { scrolls: 3 });
    await sleep(3000);
    const stMail = await appState();
    let front = await driver.execute("mobile: activeAppInfo").catch(() => null);
    ctx.d.mailto = { state: stMail, front, alert: await alertButtons(1500) };
    ctx.shot("mailto");
    if (ctx.d.mailto.alert) await driver.execute("mobile: alert", { action: "dismiss" }).catch(() => undefined);
    if (stMail !== 4 || (front && front.bundleId !== BUNDLE)) await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
    await sleep(1500);
    ctx.check("mailto: приложение на месте, страница отчётов та же", (await appState()) === 4 && (await has({ contains: "Поделиться по email" })));
    // Чужой https: tasksflow.ru на странице интеграции.
    await sectionsGo("TasksFlow");
    const ext = await waitFor(() => has({ type: "link", contains: "tasksflow.ru" }), 30000 * SLOW);
    ctx.shot("tasksflow-page");
    ctx.check("ссылка tasksflow.ru на странице", ext);
    if (!ext) return;
    await tap({ type: "link", contains: "tasksflow.ru" }, { scrolls: 3 });
    await sleep(4000);
    const st = await appState();
    front = await driver.execute("mobile: activeAppInfo").catch(() => null);
    ctx.d.external = { state: st, front };
    ctx.shot("external-opened");
    ctx.check("чужой сайт открылся в Safari, не в приложении", st !== 4 || (front && front.bundleId !== BUNDLE), ctx.d.external);
    await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
    await sleep(2500);
    ctx.shot("back-in-app");
    ctx.check("после возврата — та же страница, приложение живо", (await appState()) === 4 && (await has({ type: "link", contains: "tasksflow.ru" })));
    await tab("Профиль");
    ctx.check("после возврата интерфейс откликается (открылся «Профиль»)", await waitText({ type: "text", label: "Профиль" }, 20000));
  });

  // 7. Фото
  await scenario("S07", "Фото в журнале: системный выбор (камера / медиатека / файлы) и отмена", async (ctx) => {
    await tab("Журналы");
    await waitFor(() => has({ type: "field", label: "Поиск по журналам" }), 30000 * SLOW);
    await tap({ type: "field", label: "Поиск по журналам" }, { scrolls: 3 });
    await typeFocused("E2E");
    await sleep(1200);
    await hideKeyboard();
    let photoBtn = { type: "button", contains: "Снять фото" };
    let btn = false;
    try {
      await tap({ type: "link", contains: "E2E голос" }, { scrolls: 3, within: (r) => r.y < W.height - 170, settle: 3000 * SLOW });
      await tap({ type: "link", contains: "Новая запись" }, { scrolls: 4, settle: 3000 * SLOW });
      btn = await waitFor(() => has(photoBtn), 30000 * SLOW);
    } catch (e) {
      ctx.d.e2eFormError = e.message.slice(0, 200);
    }
    ctx.d.via = "e2e_voice form";
    if (!btn) {
      // Запасной путь: «Снять показание с дисплея» в журнале холодильников.
      await hideKeyboard();
      await openJournal(ctx, "холодильн", "холодильного", IDS.docs?.cold?.title);
      photoBtn = { type: "button", contains: "Снять показание с дисплея" };
      btn = await waitFor(() => has(photoBtn), 15000 * SLOW);
      ctx.d.via = "fridge display photo";
    }
    ctx.shot("form");
    ctx.check("кнопка фото на экране", btn);
    if (!btn) return;
    const before = await source("S07-before");
    await tap(photoBtn, { scrolls: 6 });
    await sleep(3000);
    const b = await alertButtons(1500);
    ctx.d.alert = b ? { b, text: await alertText() } : null;
    const xml = await source("S07-chooser");
    ctx.shot("chooser");
    const labels = newLabels(before, xml).slice(0, 80);
    ctx.d.labels = labels;
    ctx.check("системный выбор фото появился", Boolean(b) || labels.some((l) => /Медиатека|Photo Library|Снять фото|Take Photo|Выбрать файл|Choose File|Фото|Photos|Камера|Camera/i.test(l)), labels.slice(0, 20));
    if (b) await driver.execute("mobile: alert", { action: "dismiss" }).catch(() => undefined);
    const c = (await tryTap({ type: "button", label: "Отменить" }, { scrolls: 0, anywhere: true, timeout: 3000 })) || (await tryTap({ type: "button", label: "Cancel" }, { scrolls: 0, anywhere: true, timeout: 2000 }));
    ctx.d.cancel = c?.label ?? null;
    await sleep(2000);
    const more = await tryTap({ type: "button", label: "Отменить" }, { scrolls: 0, anywhere: true, timeout: 1500 });
    if (more) await sleep(1500);
    ctx.shot("cancelled");
    ctx.check("после отмены: приложение живо, экран на месте", (await appState()) === 4 && (await has(photoBtn)));
  });

  // 8. Голос
  await scenario("S08", "Голосовой ввод (текстовое поле и температура холодильника): разрешения и итог без зависания", async (ctx) => {
    const tryMic = async (tag) => {
      const before = await source(`S08-${tag}-before`);
      await tap({ type: "button", label: "Голосовой ввод" }, { scrolls: 6 });
      const alerts = [];
      for (let i = 0; i < 3; i++) {
        const b = await alertButtons(i === 0 ? 8000 : 5000);
        if (!b) break;
        const text = await alertText();
        ctx.shot(`${tag}-permission-${i + 1}`);
        alerts.push({ b, text, pressed: await acceptAlert(b) });
        await sleep(1200);
      }
      ctx.d[`${tag}_alerts`] = alerts;
      await sleep(3000);
      ctx.shot(`${tag}-listening`);
      const rec = await has({ type: "button", label: "Остановить запись" });
      ctx.d[`${tag}_recording`] = rec;
      if (rec) {
        await tap({ type: "button", label: "Остановить запись" }, { scrolls: 2 });
        await sleep(2500);
      }
      await sleep(1500);
      const after = await source(`S08-${tag}-after`);
      ctx.shot(`${tag}-after`);
      const fresh = newLabels(before, after).filter((l) => /[а-яё]/i.test(l));
      ctx.d[`${tag}_newTexts`] = fresh.slice(0, 20);
      const hang = await has({ type: "button", label: "Остановить запись" });
      ctx.check(`${tag}: приложение живо`, (await appState()) === 4);
      ctx.check(`${tag}: запись не зависла`, !hang);
      return { alerts, rec, fresh };
    };
    const onForm = await has({ type: "button", contains: "Снять фото" });
    ctx.d.onForm = onForm;
    if (onForm && (await has({ type: "button", label: "Голосовой ввод" }))) {
      const a = await tryMic("textarea");
      ctx.check("textarea: iOS спросил разрешения (речь / микрофон)", a.alerts.length >= 1, a.alerts);
    }
    const cold = await openJournal(ctx, "холодильн", "холодильного", IDS.docs?.cold?.title);
    ctx.check("документ холодильников открыт", cold);
    const f = await tryMic("fridge");
    ctx.check(
      "fridge: итог — число/текст или понятная русская подсказка",
      f.fresh.length > 0 || f.rec,
      f.fresh
    );
  }, 360000);

  // 9. Жест «назад»
  await scenario("S09", "Жест «назад» от левого края возвращает на предыдущий экран", async (ctx) => {
    await tab("Разделы");
    await waitText({ type: "text", label: "Все разделы" });
    await tab("Профиль");
    await waitText({ type: "text", label: "Профиль" });
    ctx.shot("before-swipe");
    const y = Math.round(W.height / 2);
    await driver.execute("mobile: dragFromToWithVelocity", { pressDuration: 0.05, holdDuration: 0.05, velocity: 1800, fromX: 1, fromY: y, toX: Math.round(W.width * 0.85), toY: y });
    let back = await waitFor(() => has({ type: "text", label: "Все разделы" }), 8000);
    ctx.d.method = "dragFromToWithVelocity";
    if (!back) {
      await driver.performActions([{ type: "pointer", id: "finger", parameters: { pointerType: "touch" }, actions: [
        { type: "pointerMove", duration: 0, x: 2, y }, { type: "pointerDown", button: 0 }, { type: "pause", duration: 50 },
        { type: "pointerMove", duration: 300, x: Math.round(W.width * 0.85), y }, { type: "pointerUp", button: 0 } ] }]);
      await driver.releaseActions().catch(() => undefined);
      back = await waitFor(() => has({ type: "text", label: "Все разделы" }), 8000);
      ctx.d.method = "w3c";
    }
    ctx.shot("after-swipe");
    ctx.check("свайп от левого края вернул на «Разделы»", back);
  });

  // 10. Выход
  await scenario("S10", "Выход из профиля → экран входа", async (ctx) => {
    await tab("Профиль");
    await waitText({ type: "text", label: "Профиль" });
    await tap({ type: "button", begins: "Выйти" }, { scrolls: 10 });
    await sleep(1200);
    ctx.shot("confirm");
    await tap({ type: "button", label: "Выйти" }, { scrolls: 0, anywhere: true, pick: "lowest" });
    const ok = await waitFor(onLogin, 30000 * SLOW);
    await sleep(1500);
    ctx.shot("login-after-logout");
    ctx.check("после выхода — экран входа", ok);
    ctx.check("на входе нет стрелки «Назад»", !(await has({ type: "button", label: "Назад" })));
    ctx.check("клавиатура не открылась сама", !(await keyboard()));
  });

  // 11. Удаление аккаунта одноразового повара
  await scenario("S11", "Удаление аккаунта одноразового повара → «Аккаунт удалён» на входе", async (ctx) => {
    if (!(await onLogin())) throw new Error("не на экране входа");
    await signIn(ctx, THROWAWAY, "throwaway");
    const later = await waitFor(() => has({ type: "button", label: "Не сейчас" }), 5000);
    if (later) await tap({ type: "button", label: "Не сейчас" }, { scrolls: 0, anywhere: true });
    ctx.shot("throwaway-home");
    await tab("Профиль");
    await waitText({ type: "text", label: "Профиль" });
    await tap({ type: "button", begins: "Удалить аккаунт" }, { scrolls: 12 });
    await sleep(1500);
    ctx.shot("delete-dialog");
    const field = await waitFor(() => has({ type: "field" }), 5000);
    ctx.check("окно подтверждения с полем ввода", field);
    await tap({ type: "field" }, { scrolls: 0, anywhere: true, pick: "last" });
    await sleep(800);
    await typeFocused("УДАЛИТЬ");
    await sleep(800);
    ctx.shot("delete-typed");
    await hideKeyboard();
    await tap({ type: "button", label: "Удалить аккаунт" }, { scrolls: 0, anywhere: true, pick: "lowest" });
    const ok = await waitFor(onLogin, 40000 * SLOW);
    await sleep(1500);
    ctx.shot("deleted-login");
    ctx.check("после удаления — экран входа", ok);
    const note = (await all({ contains: "удал" })).map((e) => e.label);
    ctx.d.note = note;
    ctx.check("надпись «Аккаунт удалён»", note.some((l) => /аккаунт удал/i.test(l || "")), note);
  });

  // 12. Консоль
  await scenario("S12", "Консоль: нет ошибок React (#418 и др.) и необработанных ошибок JS", async (ctx) => {
    await sleep(1000);
    const files = consoleFiles();
    const per = {};
    for (const f of files) {
      const txt = fs.readFileSync(f, "utf8");
      per[path.basename(f)] = {
        lines: txt.split("\n").length,
        react: txt.split("\n").filter((l) => /Minified React error|#418|Hydration/i.test(l)).slice(0, 10),
        startup: txt.split("\n").filter((l) => /STARTUP JS ERROR/.test(l)).length,
        errors: txt.split("\n").filter((l) => /\[error\]|Uncaught|Unhandled|TypeError|ReferenceError/.test(l)).slice(0, 25),
      };
    }
    ctx.d.console = per;
    const react = Object.values(per).flatMap((p) => p.react);
    const errs = Object.values(per).flatMap((p) => p.errors);
    ctx.check("журналы консоли собраны", files.length > 0, files);
    ctx.check("нет ошибок React (#418 и др.)", react.length === 0, react);
    ctx.check("нет необработанных ошибок JS", errs.length === 0, errs);
  });

  meta.ended = new Date().toISOString();
  save();
}

main()
  .catch((e) => {
    meta.fatal = String(e?.stack || e).slice(0, 3000);
    log("FATAL", meta.fatal);
    shot("fatal");
  })
  .finally(async () => {
    save();
    try {
      await driver?.deleteSession();
    } catch {
      /* */
    }
    log(`done: ${results.length} scenarios, ${results.filter((r) => r.status === "FAIL").length} failed`);
    process.exit(0);
  });
