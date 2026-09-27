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
import { AsyncLocalStorage } from "node:async_hooks";
import zlib from "node:zlib";
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

// Сценарий, у которого вышло время, продолжает жить в фоне — его шаги прерываем:
// каждый sleep/нажатие проверяет, жив ли сценарий (раунд 2: один сбой тянул за собой все).
const als = new AsyncLocalStorage();
function alive() {
  const c = als.getStore();
  if (c && c.dead) throw new Error(`${c.r.id}: сценарий прерван по времени`);
}
const sleep = (ms) =>
  new Promise((r) => setTimeout(r, ms)).then(() => {
    alive();
  });
/** Кадр в текущий сценарий (если он есть). */
function stepShot(name) {
  const c = als.getStore();
  if (c && !c.dead) return c.shot(name);
  return null;
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const q = (s) => JSON.stringify(s);

function shot(name) {
  const f = `${String(++shotN).padStart(3, "0")}-${name}.png`;
  try {
    execFileSync("xcrun", ["simctl", "io", UDID, "screenshot", path.join(OUT, f)], { stdio: "ignore", timeout: 15000 });
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
    alive();
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

async function all(spec, max = 30) {
  alive();
  const els = await driver.$$(`-ios predicate string:${pred(spec)}`);
  const out = [];
  for (const el of els.slice(0, max)) {
    alive();
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

/** Подписи текстов, содержащие любое из слов, — один запрос. */
async function textsWith(words) {
  const cond = words.map((w) => `label CONTAINS[c] ${q(w)}`).join(" OR ");
  const els = await driver.$$(`-ios predicate string:type == ${q(T.text)} AND (${cond})`);
  const out = [];
  for (const el of els.slice(0, 10)) out.push(await el.getAttribute("label").catch(() => null));
  return out.filter(Boolean);
}

async function has(spec) {
  alive();
  const els = await driver.$$(`-ios predicate string:${pred(spec)}`);
  return els.length > 0;
}

/** Видимая полоса экрана для нажатий: под шапкой и над нижним меню. */
function band() {
  return { top: 120, bottom: W.height - 110 };
}

async function tapXY(x, y) {
  alive();
  await driver.execute("mobile: tap", { x: Math.round(x), y: Math.round(y) });
}

async function drag(fromY, toY, x = Math.round(W.width * 0.62), velocity = 1400) {
  await driver.execute("mobile: dragFromToWithVelocity", {
    pressDuration: 0.05,
    holdDuration: 0.25,
    velocity,
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
async function tap(spec, { scrolls = 8, pick = "first", within = null, anywhere = false, ignoreKeyboard = false, timeout = 30000 * SLOW, settle = 700, maxY = null } = {}) {
  const end = Date.now() + timeout;
  let found = [];
  for (let i = 0; ; i++) {
    if (i > 0 && Date.now() > end) break;
    found = await all(spec);
    if (within) found = found.filter((f) => within(f.r, f.label));
    const b = anywhere ? { top: 0, bottom: W.height } : band();
    if (maxY) b.bottom = Math.min(b.bottom, maxY);
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
      // Листаем ровно на расстояние до цели (раунд 3: полный экран перелетал тему
      // оформления в профиле туда-обратно, пока не кончилось время).
      const f = found[0];
      const bb = band();
      if (maxY) bb.bottom = Math.min(bb.bottom, maxY);
      const mid = (bb.top + bb.bottom) / 2;
      const delta = f.r.y + f.r.height / 2 - mid;
      const dist = Math.max(120, Math.min(Math.abs(delta), W.height * 0.45));
      if (delta > 0) await drag(mid + dist / 2, mid - dist / 2, undefined, 700);
      else await drag(mid - dist / 2, mid + dist / 2, undefined, 700);
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
  const rr = k[0]?.r ?? null;
  // Раунд 3: после clearValue (WDA шлёт аппаратные клавиши) iOS решила, что подключена
  // аппаратная клавиатура, и увела экранную за нижний край (y=952 при высоте 874).
  if (rr && rr.y >= W.height - 20) return null;
  return rr;
}

/**
 * Очистить поле экранной клавишей «delete», а не clearValue: clearValue в WDA —
 * аппаратные клавиши, после них iOS прячет экранную клавиатуру до конца сессии.
 */
async function softClear(el) {
  const v = await readValue(el);
  const ph = await el.getAttribute("placeholderValue").catch(() => null);
  const n = v && v !== ph ? [...v].length : 0;
  if (!n) return "empty";
  const rr = await driver.getElementRect(el.elementId);
  await tapXY(rr.x + rr.width * 0.72, rr.y + rr.height / 2); // курсор в конец текста
  await sleep(400);
  const del = await driver.$$(`-ios predicate string:type == "XCUIElementTypeKey" AND (name == "delete" OR label IN {"delete","удалить","Удалить"})`);
  const kb = await keyboard();
  const d = del.length ? await driver.getElementRect(del[0].elementId).catch(() => null) : null;
  if (kb && d && d.y < W.height) {
    for (let i = 0; i < n + 2; i++) await tapXY(d.x + d.width / 2, d.y + d.height / 2);
    await sleep(300);
    const left = await readValue(el);
    if (!left || left === ph) return "delete-key";
  }
  await el.clearValue().catch(() => undefined);
  return "clearValue";
}

/** Клавиша ввода экранной клавиатуры — пальцем; нет экранной — «\n». */
async function pressReturn(el) {
  const kb = await keyboard();
  if (kb) {
    const names = ["return", "Return", "next", "Next", "Next:", "go", "Go", "Go:", "done", "Done", "search", "Search", "Далее", "Перейти", "Готово", "Найти", "Ввод", "Возврат"];
    const list = names.map(q).join(",");
    const els = await driver.$$(`-ios predicate string:type IN {"XCUIElementTypeButton","XCUIElementTypeKey"} AND (label IN {${list}} OR name IN {${list}})`);
    for (const e of els) {
      const rr = await driver.getElementRect(e.elementId).catch(() => null);
      if (rr && rr.y >= kb.y - 2 && rr.y < W.height) {
        await tapXY(rr.x + rr.width / 2, rr.y + rr.height / 2);
        return "key";
      }
    }
  }
  await el.addValue("\n").catch(() => undefined);
  return "newline";
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
let kbDumped = false;
/**
 * Раскладка под текст: XCTest печатает только то, что есть на текущей раскладке
 * (раунд 2: пароль «DemoShots2026!» на русской раскладке ушёл как «2026!»).
 * Переключаем глобусом, пока на клавиатуре не появятся нужные буквы.
 */
async function ensureLayout(text) {
  const wantLatin = /[a-z]/i.test(text);
  const wantCyr = /[а-яё]/i.test(text);
  if (!wantLatin && !wantCyr) return true;
  if (!kbDumped && (await keyboard())) {
    kbDumped = true;
    await source("keyboard-tree");
  }
  const probe = wantLatin ? ["q", "Q", "a", "A", "w", "W"] : ["й", "Й", "ф", "Ф", "ц", "Ц"];
  for (let i = 0; i < 5; i++) {
    const keys = await driver.$$(`-ios predicate string:type == "XCUIElementTypeKey" AND label IN {${probe.map(q).join(",")}}`);
    if (keys.length) return true;
    const globe = await driver.$$(
      `-ios predicate string:type IN {"XCUIElementTypeButton","XCUIElementTypeKey"} AND (label CONTAINS[c] "клавиатур" OR name CONTAINS[c] "keyboard" OR label CONTAINS[c] "keyboard" OR name CONTAINS[c] "globe")`
    );
    if (!globe.length) return false;
    await globe[0].click().catch(() => undefined);
    await sleep(700);
  }
  return false;
}

async function readValue(el) {
  try {
    return await el.getAttribute("value");
  } catch {
    return null;
  }
}

/** Вставка через буфер обмена: simctl pbcopy → «Вставить» в меню поля. */
async function pasteInto(el, text) {
  execFileSync("xcrun", ["simctl", "pbcopy", UDID], { input: text, timeout: 20000 });
  await sleep(400);
  const r = await driver.getElementRect(el.elementId);
  const cx = r.x + Math.min(r.width / 2, 60);
  const cy = r.y + r.height / 2;
  const menu = () => driver.$$(`-ios predicate string:label IN {"Вставить","Paste"}`);
  for (const how of ["tap", "hold", "tap2"]) {
    if (how === "tap" || how === "tap2") await tapXY(cx, cy);
    else await driver.execute("mobile: touchAndHold", { x: Math.round(cx), y: Math.round(cy), duration: 1.2 });
    await sleep(900);
    const items = await menu();
    if (items.length) {
      await items[0].click();
      await sleep(800);
      // iOS может спросить «Разрешить вставку?».
      const b = await alertButtons(1500);
      if (b) {
        const allow = b.find((x) => /вставк|paste|разреш|allow/i.test(x)) || b[b.length - 1];
        await driver.execute("mobile: alert", { action: "accept", buttonLabel: allow }).catch(() => undefined);
        await sleep(800);
      }
      return how;
    }
  }
  return null;
}

/**
 * Ввести текст и убедиться, что в поле ровно он (для пароля — число точек).
 * Путь: раскладка → addValue → проверка; не совпало — очистить и вставить из буфера.
 */
async function typeVerified(el, text, { secure = false, clear = true } = {}) {
  const ok = (v) => (secure ? typeof v === "string" && [...v].length === [...text].length : v === text);
  const tries = [];
  if (clear) tries.push({ clear: await softClear(el) });
  const layout = await ensureLayout(text);
  await el.addValue(text).catch((e) => tries.push(`addValue: ${e.message.slice(0, 120)}`));
  await sleep(300);
  let v = await readValue(el);
  tries.push({ method: "keys", layout, value: secure ? `len ${v ? [...v].length : null}` : v });
  if (ok(v)) return { ok: true, method: "keys", tries };
  tries.push({ clear: await softClear(el) });
  await sleep(300);
  const how = await pasteInto(el, text).catch((e) => `paste error: ${e.message.slice(0, 120)}`);
  v = await readValue(el);
  tries.push({ method: `paste(${how})`, value: secure ? `len ${v ? [...v].length : null}` : v });
  return { ok: ok(v), method: "paste", tries };
}

/** Поле, по которому только что нажали (или поле с фокусом), — ввод с проверкой. */
async function typeFocused(text) {
  let el = lastTapped;
  if (!el) {
    const f = await driver.$(`-ios predicate string:type IN {${q(T.field)},${q(T.secure)}} AND focused == 1`);
    if (await f.isExisting().catch(() => false)) el = f;
  }
  if (!el) throw new Error("нет поля для ввода");
  const res = await typeVerified(el, text);
  const c = als.getStore();
  if (c) c.d[`typed_${text}`] = res;
  if (!res.ok) log("   typing mismatch", text, JSON.stringify(res.tries).slice(0, 300));
  return el;
}

// ─── Консоль приложения ───────────────────────────────────────────────

const consoleFiles = () =>
  fs
    .readdirSync(LOGS)
    .filter((f) => /^launch\d+-console\.log$/.test(f))
    .map((f) => path.join(LOGS, f));
const consoleSeen = new Map();
// Сборка App.app в CI — без GoogleService-Info.plist (секретов нет): плагин push пишет
// «Firebase is not configured». Это условие стенда, не ошибка страницы — считаем отдельно.
const FIREBASE_CI = /Firebase is not configured: GoogleService-Info.plist is missing/;
const ERR_RX = /Minified React error|#418|#419|#423|#425|Hydration|hydrat|STARTUP JS ERROR|\[error\]|Uncaught|Unhandled|TypeError|ReferenceError|SyntaxError/i;
function consoleNews() {
  const out = [];
  for (const f of consoleFiles()) {
    const txt = fs.readFileSync(f, "utf8");
    const from = consoleSeen.get(f) ?? 0;
    const lines = txt.slice(from).split("\n");
    consoleSeen.set(f, txt.length);
    for (const l of lines) if (ERR_RX.test(l) && !FIREBASE_CI.test(l)) out.push(`${path.basename(f)}: ${l.slice(0, 400)}`);
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
  // visible="false" — WebKit сам считает элемент скрытым (прокручен под шапку, за край ленты).
  const onScreen = els.filter((e) => e.y + e.h > 0 && e.y < W.height && e.visible !== "false");
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
  if (Date.now() > DEADLINE && id !== "S12") {
    ctx.skip("время теста вышло");
    save();
    return;
  }
  try {
    const lim = Math.min(timeoutMs * SLOW, Math.max(45000, DEADLINE - Date.now()));
    r.limitMs = lim;
    await withTimeout(als.run(ctx, () => fn(ctx)), lim, `${id}: не уложился в ${lim / 1000} с`);
    if (r.status === "RUNNING") r.status = r.checks.every((c) => c.ok) ? "PASS" : "FAIL";
  } catch (e) {
    r.status = "FAIL";
    r.error = String(e?.stack || e).slice(0, 2000);
    log("   ERROR:", r.error.slice(0, 400));
    ctx.shot("error");
    await source(`${id}-error`);
  }
  ctx.dead = true; // шаги сценария, оставшиеся в фоне, дальше не выполняются
  try {
    const st = await appState();
    r.appStateAfter = st;
    if (st !== 4) {
      crashes.push({ tag: id, state: st, at: new Date().toISOString() });
      if (st === 1) {
        r.status = "FAIL";
        r.crash = true;
        launchWithConsole(); // упало — новый журнал консоли
      } else await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
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
  } catch (e) {
    log("recover: dismiss failed", e.message.slice(0, 200));
  }
  // Известное состояние: перезапуск приложения (листы печати/«Поделиться» и зависшие
  // экраны уходят вместе с процессом; вход сохраняется в cookies).
  try {
    await driver.execute("mobile: terminateApp", { bundleId: BUNDLE }).catch(() => undefined);
    await sleep(1500);
    launchWithConsole();
    const ok = await waitFor(async () => (await onLogin()) || (await has({ type: "link", begins: "Профиль" })), 60000 * SLOW, 1000);
    log("recover: relaunched,", ok ? "screen ready" : "screen NOT ready");
    await sleep(1500);
  } catch (e) {
    log("recover: relaunch failed", e.message.slice(0, 200));
  }
}

async function onLogin() {
  return has({ type: "text", label: "Вход в кабинет" });
}

/** Нижнее меню: ссылка с точной подписью внизу экрана. */
async function tab(label) {
  const f = await tap({ type: "link", begins: label }, { scrolls: 0, anywhere: true, within: (r) => r.y > W.height - 170, settle: 1500 * SLOW });
  stepShot(`tab-${label}`);
  return f;
}

async function waitText(spec, timeout = 25000) {
  return waitFor(() => has(spec), timeout * SLOW);
}

const emailField = () => driver.$(`-ios predicate string:${pred({ type: "field", contains: "почт" })}`);
/** Поле пароля: скрытое (Secure) или, после «Показать пароль», обычное. */
async function passField({ shown = false } = {}) {
  if (!shown) {
    const sec = await driver.$$(`-ios predicate string:type == ${q(T.secure)}`);
    if (sec.length) return sec[0];
  }
  const t = await driver.$$(`-ios predicate string:type == ${q(T.field)} AND NOT (label CONTAINS[c] "почт") AND NOT (label CONTAINS[c] "телефон")`);
  return t[0] ?? null;
}

/** Минимальный PNG-декодер (8 бит, RGB/RGBA, без чересстрочности) — кадры simctl. */
function decodePng(buf) {
  let p = 8, w, h, bd, ct, il;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; il = d[12]; }
    else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bd !== 8 || il !== 0 || (ct !== 2 && ct !== 6)) throw new Error(`png: bd=${bd} ct=${ct} il=${il}`);
  const ch = ct === 6 ? 4 : 3, stride = w * ch, raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[o + x - ch] : 0, b = y ? px[o - stride + x] : 0, c = y && x >= ch ? px[o - stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + x] = v & 255;
    }
  }
  return { w, h, ch, px };
}

/**
 * Полоса строки состояния на кадре (0…54 pt): доля тёмной подложки #0b1024 среди
 * пикселей, кроме белых (часы, значки) и чёрных («остров»). Текст страницы под
 * часами (раунд 2, кадры 005/006) даёт другие цвета — доля падает.
 */
function statusStripOf(file) {
  try {
    const { w, ch, px } = decodePng(fs.readFileSync(path.join(OUT, file)));
    const s = w / W.width;
    const H = Math.round(ISLAND_BOTTOM * s);
    const hist = new Map();
    const pix = [];
    let bright = 0, total = 0;
    for (let y = 2; y < H; y++)
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * ch, r = px[i], g = px[i + 1], b = px[i + 2], lum = 0.3 * r + 0.59 * g + 0.11 * b;
        total++;
        if (lum > 200) { bright++; continue; } // часы и значки
        if (lum < 6) continue; // «остров»
        pix.push([r, g, b]);
        const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        hist.set(k, (hist.get(k) || 0) + 1);
      }
    let top = 0, topN = -1;
    for (const [k, n] of hist) if (n > topN) { top = k; topN = n; }
    const dom = [((top >> 10) & 31) * 8 + 4, ((top >> 5) & 31) * 8 + 4, (top & 31) * 8 + 4];
    const near = (c, t, tol) => Math.abs(c[0] - t[0]) + Math.abs(c[1] - t[1]) + Math.abs(c[2] - t[2]) <= tol;
    const uniform = pix.filter((c) => near(c, dom, 36)).length / Math.max(1, pix.length);
    const brand = pix.filter((c) => near(c, [11, 16, 36], 45)).length / Math.max(1, pix.length);
    const domLum = 0.3 * dom[0] + 0.59 * dom[1] + 0.11 * dom[2];
    return { file, dominant: dom, domLum: Math.round(domLum), uniform: +uniform.toFixed(3), brandFrac: +brand.toFixed(3), brightFrac: +(bright / total).toFixed(3), stripPx: H };
  } catch (e) {
    return { file, error: e.message };
  }
}

function checkStrip(ctx, label, file) {
  if (!file) return ctx.check(`${label}: кадр снят`, false);
  const st = statusStripOf(file);
  ctx.d[`strip_${label}`] = st;
  // Под часами — одна тёмная заливка (подложка #0b1024): доминирующий цвет тёмный и
  // занимает ≥ 90 % полосы (кроме часов/значков и «острова»). Текст страницы даёт другие цвета.
  return ctx.check(`${label}: под часами ровная тёмная подложка, текста страницы нет (однородность ${st.uniform ?? st.error}, яркость ${st.domLum})`, st.domLum < 45 && st.uniform >= 0.9, st);
}

/** Подпись клавиши ввода на открытой клавиатуре (зависит от enterKeyHint поля). */
async function returnKeyLabel() {
  try {
    const kb = await keyboard();
    if (!kb) return null;
    const names = ["return", "Return", "next", "Next", "go", "Go", "done", "Done", "search", "Search", "Далее", "Перейти", "Вперед", "Вперёд", "Войти", "Ввод", "Готово", "Найти", "Поиск", "Возврат"];
    const list = names.map(q).join(",");
    const els = await driver.$$(`-ios predicate string:type IN {"XCUIElementTypeButton","XCUIElementTypeKey"} AND (label IN {${list}} OR name IN {${list}})`);
    for (const e of els) {
      const r = await driver.getElementRect(e.elementId).catch(() => null);
      if (r && r.y >= kb.y - 2) return (await e.getAttribute("label").catch(() => null)) || (await e.getAttribute("name").catch(() => null));
    }
  } catch (e) {
    log("returnKeyLabel", e.message.slice(0, 160));
  }
  return null;
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
  const ef = await tap({ type: "field", contains: "почт" }, { scrolls: 2 });
  await waitFor(keyboard, 6000);
  await sleep(900);
  const s1 = ctx.shot(`${tag}-kb-email`);
  checkStrip(ctx, `${tag}: почта в фокусе`, s1);
  const kbTop1 = await keyboardTop();
  const btn1 = (await all({ type: "button", label: "Войти" }))[0]?.r;
  ctx.d[`${tag}_kb_email`] = { kbTop: kbTop1, submit: btn1 };
  // После выхода форма помнит прошлую почту (раунд 2: «chef@…delete-me@…») — typeVerified очищает.
  const te = await typeVerified(ef.el, email);
  ctx.d[`${tag}_emailTyping`] = te;
  const emailVal = await readValue(await emailField());
  ctx.check(`${tag}: почта набрана точно`, emailVal === email, { emailVal, te });
  // Клавиша ввода в почте ведёт к паролю (enterKeyHint="next").
  const retBefore = await returnKeyLabel();
  ctx.d[`${tag}_enterInEmailVia`] = await pressReturn(ef.el);
  await sleep(1200);
  let pf = await passField();
  if (!pf) throw new Error("нет поля пароля");
  // Куда ушёл фокус: атрибут focused у веб-полей на iOS не работает, поэтому смотрим
  // на клавишу ввода — у почты «next» (Далее), у пароля «go» (Перейти/Go) — и на то,
  // осталась ли клавиатура.
  const retAfter = await returnKeyLabel();
  const kbAfter = Boolean(await keyboard());
  const pfFocused = kbAfter && retAfter != null && retAfter !== retBefore && !/^(next|далее)$/i.test(retAfter);
  ctx.d[`${tag}_enterInEmail`] = { returnKeyBefore: retBefore, returnKeyAfter: retAfter, keyboard: kbAfter };
  ctx.shot(`${tag}-after-enter-in-email`);
  ctx.check(`${tag}: клавиша ввода в почте перевела фокус на пароль`, pfFocused === true, ctx.d[`${tag}_enterInEmail`]);
  if (pfFocused !== true) {
    await tap({ type: "secure" }, { scrolls: 2 });
    pf = await passField();
  }
  let tp = await typeVerified(pf, PASSWORD, { secure: true });
  // Точная проверка: «Показать пароль» — поле становится обычным и отдаёт значение.
  let exact = null;
  const eye = await tryTap({ type: "button", label: "Показать пароль" }, { scrolls: 1, anywhere: true, ignoreKeyboard: true, timeout: 3000 });
  if (eye) {
    await sleep(700);
    const shownEl = await passField({ shown: true });
    exact = shownEl ? await readValue(shownEl) : null;
    if (shownEl && exact !== PASSWORD) {
      tp = await typeVerified(shownEl, PASSWORD);
      exact = await readValue(shownEl);
    }
    ctx.d[`${tag}_passwordShown`] = exact === PASSWORD ? "совпадает" : exact == null ? null : `не совпадает, длина ${String(exact).length}`;
    await tryTap({ type: "button", label: "Скрыть пароль" }, { scrolls: 1, anywhere: true, ignoreKeyboard: true, timeout: 3000 });
    await sleep(500);
  }
  ctx.d[`${tag}_passwordTyping`] = tp;
  ctx.check(
    `${tag}: пароль набран точно (${exact === PASSWORD ? "сверено при «Показать пароль»" : "по числу точек"})`,
    exact === PASSWORD || (exact == null && tp.ok),
    { exactLen: exact == null ? null : String(exact).length, tp }
  );
  // Фокус в пароль: «Войти» должна быть над клавиатурой, под часами — тёмная подложка.
  await tap({ type: "secure" }, { scrolls: 2 });
  await waitFor(keyboard, 5000);
  await sleep(1200);
  const s2 = ctx.shot(`${tag}-kb-password`);
  checkStrip(ctx, `${tag}: пароль в фокусе`, s2);
  const kbTop = await keyboardTop();
  const btn = (await all({ type: "button", label: "Войти" }))[0]?.r;
  ctx.d[`${tag}_kb_password`] = { kbTop, submit: btn };
  if (kbTop && btn) ctx.check(`${tag}: «Войти» над клавиатурой (пароль в фокусе)`, btn.y + btn.height <= kbTop + 1, { button: btn, kbTop });
  else ctx.check(`${tag}: клавиатура открыта и «Войти» найдена`, Boolean(kbTop && btn), { kbTop, btn });
  ctx.d[`${tag}_returnKeyPassword`] = await returnKeyLabel();
  // Вход клавишей ввода (enterKeyHint="go"); не ушли за 12 с — нажимаем «Войти».
  const t0 = Date.now();
  const sp = await passField();
  if (sp) ctx.d[`${tag}_submitKeyVia`] = await pressReturn(sp);
  const leftOnEnter = await waitFor(async () => !(await onLogin()), 12000 * SLOW, 800);
  ctx.d[`${tag}_submitVia`] = leftOnEnter ? "клавиша ввода" : "кнопка «Войти»";
  ctx.check(`${tag}: клавиша ввода в пароле отправляет форму`, leftOnEnter);
  if (!leftOnEnter) {
    ctx.shot(`${tag}-enter-did-not-submit`);
    await hideKeyboard();
    await tryTap({ type: "button", label: "Войти" });
  }
  const left = await waitFor(async () => !(await onLogin()) && (await has({ type: "link", begins: "Профиль" })), 45000 * SLOW, 800);
  ctx.d[`${tag}_loginMs`] = Date.now() - t0;
  if (!left) {
    ctx.shot(`${tag}-login-failed`);
    const errs = await textsWith(["невер", "ошиб", "не удалось", "не найден"]);
    throw new Error(`вход ${email} не удался: ${errs.join(" | ")}`);
  }
  await sleep(1500);
  // iOS может предложить сохранить пароль — это не наше окно, закрываем.
  const pw = await alertButtons(1500);
  if (pw) {
    const t = (await alertText()) || "";
    ctx.d[`${tag}_systemAlertAfterLogin`] = { t, pw };
    if (/пароль|password|связк|keychain/i.test(t)) {
      const no = pw.find((b) => /не сейчас|not now|никогда|never/i.test(b));
      await driver.execute("mobile: alert", { action: no ? "accept" : "dismiss", ...(no ? { buttonLabel: no } : {}) }).catch(() => undefined);
      await sleep(800);
    }
  }
}

/** Профиль → «Выйти» → подтверждение; true — на экране входа. */
async function logout(ctx) {
  await tab("Профиль");
  await waitText({ type: "text", label: "Профиль" });
  await tap({ type: "button", begins: "Выйти" }, { scrolls: 10 });
  await sleep(1200);
  ctx.shot("logout-confirm");
  await tap({ type: "button", label: "Выйти" }, { scrolls: 0, anywhere: true, pick: "lowest" });
  return waitFor(onLogin, 30000 * SLOW);
}

async function dismissSheets() {
  if (await has({ type: "button", label: "Не сейчас" })) await tryTap({ type: "button", label: "Не сейчас" }, { scrolls: 0, anywhere: true, timeout: 2000 });
  await hideKeyboard();
}

/** Известное состояние перед сценарием: приложение на экране, шеф вошёл, листов и клавиатуры нет. */
async function ready(ctx) {
  if ((await appState()) !== 4) {
    await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
    await sleep(2000);
  }
  await dismissSheets();
  if (await onLogin()) {
    ctx.d.reLogin = true;
    await signIn(ctx, CHEF, "relogin");
    await sleep(2000);
    await dismissSheets();
  }
  if (!(await waitFor(() => has({ type: "link", begins: "Профиль" }), 20000 * SLOW))) throw new Error("нет нижнего меню — приложение не в рабочем состоянии");
}

async function profileTheme(ctx, name) {
  await tab("Профиль");
  await waitText({ type: "text", label: "Профиль" }, 20000);
  await toTop();
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
    await dismissGuide(ctx);
    await tap({ type: "link", contains: period }, { scrolls: 4, settle: 3000 * SLOW });
    await waitFor(() => has({ type: ["link", "button"], contains: "Распечатать" }), 40000 * SLOW);
  }
  await dismissGuide(ctx);
  await sleep(1500);
  return has({ type: ["link", "button"], contains: "Распечатать" });
}

/**
 * Шторка «Инструкция» журнала при первом заходе (раунд 4, кадр 021: закрыла список
 * документов холодильников) — закрываем «Понятно».
 */
async function dismissGuide(ctx) {
  const ok = await tryTap({ type: "button", label: "Понятно" }, { scrolls: 0, anywhere: true, ignoreKeyboard: true, timeout: 1500 });
  if (ok) {
    ctx.d.guideDismissed = (ctx.d.guideDismissed || 0) + 1;
    await sleep(1000);
  }
}

/** Форма новой записи журнала E2E (голос + фото); true — нужная кнопка на экране. */
async function openE2eForm(ctx, want) {
  try {
    await tab("Журналы");
    await waitFor(() => has({ type: "field", label: "Поиск по журналам" }), 30000 * SLOW);
    await tap({ type: "field", label: "Поиск по журналам" }, { scrolls: 3 });
    await typeFocused("E2E");
    await sleep(1200);
    await hideKeyboard();
    await tap({ type: "link", contains: "E2E голос" }, { scrolls: 3, within: (r) => r.y < W.height - 170, settle: 3000 * SLOW });
    await dismissGuide(ctx);
    await tap({ type: "link", contains: "Новая запись" }, { scrolls: 4, settle: 3000 * SLOW });
    return Boolean(await waitFor(() => has(want), 30000 * SLOW));
  } catch (e) {
    ctx.d.e2eFormError = e.message.slice(0, 200);
    return false;
  }
}

async function sectionsGo(label) {
  await tab("Разделы");
  const SEARCH = { type: ["field", "XCUIElementTypeSearchField"], label: "Поиск раздела" };
  await waitFor(() => has(SEARCH), 20000 * SLOW);
  await tap(SEARCH, { scrolls: 2 });
  await sleep(500);
  await typeFocused(label);
  await sleep(1000);
  await hideKeyboard();
  return tap({ type: "link", contains: label }, { scrolls: 3, within: (r) => r.y < W.height - 170, settle: 3000 * SLOW });
}

// Порядок раунда 4: вход, затем самое ценное; S12 — всегда последним.
const ORDER = (env.ORDER || "S01,S02,S03a,S04,S05,S07,S08,S06,S09,S10,S11,S03b,S12").split(",");
// Потолок на сценарий (мс); общий бюджет — TEST_BUDGET_MIN.
const LIMITS = { S01: 90000, S02: 300000, S03a: 420000, S03b: 360000, S04: 180000, S05: 240000, S06: 200000, S07: 200000, S08: 240000, S09: 120000, S10: 150000, S11: 240000, S12: 60000 };
const plan = new Map();
function def(id, name, fn, timeoutMs) {
  plan.set(id, { name, fn, timeoutMs: LIMITS[id] ?? timeoutMs ?? 300000 });
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
  driver.options.connectionRetryTimeout = 150000;
  await driver.updateSettings({ snapshotMaxDepth: 62, customSnapshotTimeout: 30, pageSourceExcludedAttributes: "", waitForIdleTimeout: 0, animationCoolOffTimeout: 0 }).catch((e) => log("settings", e.message));
  await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
  await sleep(1500);
  W = await driver.getWindowRect();
  meta.window = W;
  consoleNews(); // строки первого запуска разберёт S01 отдельно

  // 1. Холодный запуск (первый — в workflow до Appium; здесь — состояние и повторный замер)
  def("S01", "Холодный запуск: сразу экран входа, без клавиатуры и стрелки «назад»", async (ctx) => {
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
    // Повторный замер холодного запуска доказан в раунде 3 — в раунде 4 не повторяем.
  });

  // 2. Вход шефа и уведомления
  def("S02", "Вход по «Почте» (клавиатура не закрывает «Войти»), лист уведомлений, разрешение iOS", async (ctx) => {
    if (!(await onLogin())) {
      // S01 мог оставить приложение не на входе — перезапуск.
      await recover();
    }
    try {
      await signIn(ctx, CHEF, "chef");
    } catch (e) {
      // Вторая попытка (ввод по буферу обмена сработает, если клавиатура подвела).
      ctx.d.firstLoginError = e.message.slice(0, 300);
      if (!(await onLogin())) throw e;
      await hideKeyboard();
      await signIn(ctx, CHEF, "chef-retry");
    }
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
    const errToast = await textsWith(["не удалось", "ошибк", "error"]);
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
    checkStrip(ctx, `${theme}: главная`, ctx.shot(`home-${theme}`));
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
    checkStrip(ctx, `${theme}: документ уборки пролистан`, ctx.shot(`cleaning-doc-scrolled-${theme}`));
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
  def("S03a", "Основные экраны — светлая тема", async (ctx) => {
    await ready(ctx);
    await profileTheme(ctx, "Светлая");
    await screenPass(ctx, "light");
  }, 480000);
  def("S03b", "Основные экраны — тёмная тема", async (ctx) => {
    await ready(ctx);
    await profileTheme(ctx, "Тёмная");
    await screenPass(ctx, "dark");
  }, 480000);

  // 4. Печать документа
  def("S04", "Печать документа журнала: системное окно печати iOS", async (ctx) => {
    await ready(ctx);
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
  def("S05", "Скачивание отчёта Excel и PDF: лист «Поделиться» с понятным именем файла", async (ctx) => {
    await ready(ctx);
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
  def("S06", "Ссылки: почта (mailto) и чужой сайт — системе; приложение остаётся рабочим", async (ctx) => {
    await ready(ctx);
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
  def("S07", "Фото в журнале: системный выбор (камера / медиатека / файлы) и отмена", async (ctx) => {
    await ready(ctx);
    let photoBtn = { type: "button", contains: "Снять фото" };
    let btn = await openE2eForm(ctx, photoBtn);
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
    // Раунд 4: кнопка фото была под липким низом формы («Сохранить запись»), нажатие
    // ушло в «Сохранить» и создало пустую запись. Нажимаем только в верхних 55 % экрана.
    await tap(photoBtn, { scrolls: 6, maxY: W.height * 0.55 });
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
  def("S08", "Голосовой ввод в поле «Заметка»: разрешения iOS и итог без зависания", async (ctx) => {
    await ready(ctx);
    const tryMic = async (tag) => {
      const before = await source(`S08-${tag}-before`);
      await tap({ type: "button", label: "Голосовой ввод" }, { scrolls: 6, maxY: W.height * 0.55 });
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
    // Раунд 4: в документе холодильников кнопки «Голосовой ввод» нет (там «Снять
    // показание с дисплея») — голос проверяем в поле «Заметка» формы E2E.
    const mic = { type: "button", label: "Голосовой ввод" };
    const onForm = await openE2eForm(ctx, mic);
    ctx.d.onForm = onForm;
    ctx.shot("form");
    ctx.check("форма с голосовым вводом открыта", onForm);
    if (!onForm) return;
    const a = await tryMic("textarea");
    ctx.check("textarea: iOS спросил разрешения (речь / микрофон)", a.alerts.length >= 1, a.alerts);
    ctx.check("textarea: итог — текст в поле или понятная русская подсказка", a.fresh.length > 0 || a.rec, a.fresh);
  }, 360000);

  // 9. Жест «назад»
  def("S09", "Жест «назад» от левого края возвращает на предыдущий экран", async (ctx) => {
    await ready(ctx);
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
  def("S10", "Выход из профиля → экран входа", async (ctx) => {
    await ready(ctx);
    const ok = await logout(ctx);
    await sleep(1500);
    ctx.shot("login-after-logout");
    ctx.check("после выхода — экран входа", ok);
    ctx.check("на входе нет стрелки «Назад»", !(await has({ type: "button", label: "Назад" })));
    ctx.check("клавиатура не открылась сама", !(await keyboard()));
  });

  // 11. Удаление аккаунта одноразового повара
  def("S11", "Удаление аккаунта одноразового повара → «Аккаунт удалён» на входе", async (ctx) => {
    await dismissSheets();
    if (!(await onLogin())) {
      ctx.d.loggedOutFirst = true;
      if (!(await logout(ctx))) throw new Error("не удалось выйти к экрану входа");
    }
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
  def("S12", "Консоль: нет ошибок React (#418 и др.) и необработанных ошибок JS", async (ctx) => {
    await sleep(1000);
    const files = consoleFiles();
    const per = {};
    for (const f of files) {
      const txt = fs.readFileSync(f, "utf8");
      per[path.basename(f)] = {
        lines: txt.split("\n").length,
        react: txt.split("\n").filter((l) => /Minified React error|#418|Hydration/i.test(l)).slice(0, 10),
        startup: txt.split("\n").filter((l) => /STARTUP JS ERROR/.test(l)).length,
        errors: txt.split("\n").filter((l) => /\[error\]|Uncaught|Unhandled|TypeError|ReferenceError/.test(l) && !FIREBASE_CI.test(l)).slice(0, 25),
        firebaseNotConfigured: txt.split("\n").filter((l) => FIREBASE_CI.test(l)).length,
      };
    }
    ctx.d.console = per;
    const react = Object.values(per).flatMap((p) => p.react);
    const errs = Object.values(per).flatMap((p) => p.errors);
    ctx.check("журналы консоли собраны", files.length > 0, files);
    ctx.check("нет ошибок React (#418 и др.)", react.length === 0, react);
    ctx.check("нет необработанных ошибок JS", errs.length === 0, errs);
  });

  meta.order = ORDER;
  for (const id of ORDER) {
    const p = plan.get(id);
    if (p) await scenario(id, p.name, p.fn, p.timeoutMs);
  }
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
