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
    execFileSync("xcrun", ["simctl", "io", UDID, "screenshot", path.join(OUT, f)], { stdio: "ignore", timeout: 10000 });
    return f;
  } catch (e) {
    log("screenshot failed", name, e.message);
    return null;
  }
}

/** Кадр без ожидания (simctl в фоне): опрос дерева не стоит, пока снимается экран. */
function shotAsync(name) {
  const f = `${String(++shotN).padStart(3, "0")}-${name}.png`;
  const c = als.getStore();
  try {
    const pr = spawn("xcrun", ["simctl", "io", UDID, "screenshot", path.join(OUT, f)], { stdio: "ignore" });
    pr.on("error", () => undefined);
    if (c) c.r.shots.push(f);
  } catch (e) {
    log("async screenshot failed", name, e.message);
  }
  return f;
}

/**
 * Раунд 7: кадр через WebDriverAgent (XCUIScreen, ~0,3–1 с) — быстрее simctl, пока
 * тост (4 с) ещё на экране. Без строки состояния поверх — это тот же экран.
 */
async function wdaShot(name) {
  const f = `${String(++shotN).padStart(3, "0")}-${name}-wda.png`;
  const c = als.getStore();
  try {
    const b64 = await withTimeout(driver.takeScreenshot(), 8000, "wda screenshot timeout");
    fs.writeFileSync(path.join(OUT, f), Buffer.from(b64, "base64"));
    if (c) c.r.shots.push(f);
    return f;
  } catch (e) {
    log("wda screenshot failed", name, e.message.slice(0, 160));
    return null;
  }
}

/** Низ шапки приложения (строка «WESETUP» с логотипом и колокольчиком) по дереву. */
async function topbarBottom() {
  let bottom = null;
  for (const label of ["На главный экран", "Уведомления", "ИИ-помощник"]) {
    for (const x of await all({ type: ["link", "button"], label }, 5)) {
      if (x.r.y < 200) bottom = Math.max(bottom ?? 0, x.r.y + x.r.height);
    }
  }
  return bottom;
}

/**
 * Раунд 7 (мастер cdebe948): тост должен быть ВИДЕН — не только в дереве. Опрос дерева
 * каждые ~150 мс; как только текст найден — кадр WDA и кадр simctl, рамка, число тостов,
 * низ шапки. Решение «виден» — по кадрам (смотрим глазами) и по рамке ниже шапки.
 */
async function watchToast(ctx, tag, contains, timeoutMs = 5000, { t0 = Date.now() } = {}) {
  const polls = [];
  const frames = [];
  let lastFrame = 0;
  let found = null;
  while (Date.now() - t0 < timeoutMs) {
    // Раунд 7, прогон 1: тост в дереве не нашёлся ни разу, а кадров в окне 0–5 с не было —
    // «виден ли» было не доказать. Теперь кадр WDA каждые ~0,7 с, пока ждём.
    if (Date.now() - lastFrame > 700) {
      lastFrame = Date.now();
      const f = await wdaShot(`${ctx.r.id}-${tag}-t${Date.now() - t0}ms`);
      if (f) frames.push(f);
    }
    const els = await all({ type: "text", contains }, 5).catch(() => []);
    polls.push(Date.now() - t0);
    if (els.length) {
      found = { ms: Date.now() - t0, text: els[0].label, rect: els[0].r, count: new Set(els.map((e) => `${Math.round(e.r.y)}|${e.label}`)).size };
      found.wda = await wdaShot(`${ctx.r.id}-${tag}-toast`);
      found.simctl = shotAsync(`${ctx.r.id}-${tag}-toast-simctl`);
      break;
    }
    await sleep(150);
  }
  ctx.d[`${tag}_toast`] = found;
  ctx.d[`${tag}_toastPolls`] = polls.length;
  ctx.d[`${tag}_toastFrames`] = frames;
  if (!found) return null;
  const tb = await topbarBottom().catch(() => null);
  found.topbarBottom = tb;
  // Второй опрос — тостов с этим текстом ровно один и тот же.
  const again = await all({ type: "text", contains }, 5).catch(() => []);
  found.countAgain = new Set(again.map((e) => `${Math.round(e.r.y)}|${e.label}`)).size;
  ctx.check(`${tag}: тост ниже шапки (верх тоста ${found.rect.y} ≥ низ шапки ${tb})`, tb != null && found.rect.y >= tb - 0.5, { rect: found.rect, topbarBottom: tb });
  ctx.check(`${tag}: тост в пределах экрана`, found.rect.y + found.rect.height <= W.height && found.rect.x >= -1 && found.rect.x + found.rect.width <= W.width + 1, found.rect);
  return found;
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
// Раунд 4: «[next-auth][error][CLIENT_FETCH_ERROR] … Load failed» — запрос сессии оборвался
// при уходе со страницы (выход, удаление аккаунта). Это console.error самой next-auth,
// не необработанное исключение; считаем отдельно и показываем в отчёте.
const NEXTAUTH_FETCH = /CLIENT_FETCH_ERROR|next-auth\.js\.org\/errors#client_fetch_error/;
// Раунд 5: «[error] - {"errorMessage":"Retry"}» — Capacitor пишет в консоль отказ вызова
// плагина (распознавание речи в симуляторе без голоса), даже если страница его поймала.
// Раунд 8: с Capacitor 8 строка — «[error] - {"message":"Retry","errorMessage":"Retry"}» (раунд 7, S12).
const PLUGIN_REJECT = /\[error\] - \{.*"errorMessage":/;
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

/** Раунд 8: отметка длины журналов консоли и новые строки после неё. */
function consoleMark() {
  const m = new Map();
  for (const f of consoleFiles()) m.set(f, fs.statSync(f).size);
  return m;
}
function consoleSince(mark) {
  const out = [];
  for (const f of consoleFiles()) {
    const buf = fs.readFileSync(f);
    out.push(...buf.subarray(mark.get(f) ?? 0).toString("utf8").split("\n"));
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

/**
 * Полоса кадра по высоте (в pt): средняя яркость и доля «индиго» (#5566f6 — активная
 * вкладка нижнего меню, кнопки). Раунд 5, S13: на кадре 027 раунда 4 шапка и нижнее
 * меню были в дереве доступности, но НЕ нарисованы — проверяем по пикселям.
 */
function regionStats(file, y0, y1) {
  try {
    const { w, h, ch, px } = decodePng(fs.readFileSync(path.join(OUT, file)));
    const s = w / W.width;
    let n = 0, lum = 0, indigo = 0, dark = 0;
    for (let y = Math.round(y0 * s); y < Math.min(h, Math.round(y1 * s)); y += 2)
      for (let x = 0; x < w; x += 3) {
        const i = (y * w + x) * ch, r = px[i], g = px[i + 1], b = px[i + 2];
        const l = 0.3 * r + 0.59 * g + 0.11 * b;
        n++;
        lum += l;
        if (l < 90) dark++;
        if (Math.abs(r - 85) + Math.abs(g - 102) + Math.abs(b - 246) < 70) indigo++;
      }
    return { file, y0, y1, meanLum: Math.round(lum / Math.max(1, n)), darkFrac: +(dark / Math.max(1, n)).toFixed(3), indigoFrac: +(indigo / Math.max(1, n)).toFixed(3) };
  } catch (e) {
    return { file, error: e.message };
  }
}

/** Шапка (тёмная полоса 60–112 pt) и нижнее меню (индиго-вкладка 770–845 pt) нарисованы. */
function chromePainted(ctx, label, file) {
  if (!file) return ctx.check(`${label}: кадр снят`, false);
  const top = regionStats(file, 62, 112);
  const nav = regionStats(file, 772, 842);
  ctx.d[`paint_${label}`] = { top, nav };
  const topOk = top.darkFrac >= 0.6;
  const navOk = nav.indigoFrac >= 0.02;
  ctx.check(`${label}: шапка приложения нарисована вверху (тёмных пикселей ${top.darkFrac})`, topOk, top);
  ctx.check(`${label}: нижнее меню нарисовано (индиго ${nav.indigoFrac})`, navOk, nav);
  return topOk && navOk;
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
  // Раунд 7 (кадр 006): вход прошёл, но лист «Уведомления о задачах» прятал меню из дерева.
  const left = await waitFor(async () => !(await onLogin()) && ((await has({ type: "link", begins: "Профиль" })) || (await has({ type: "button", label: "Включить" })) || (await has({ type: "button", label: "Не сейчас" }))), 45000 * SLOW, 800);
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
  // Раунд 5: S11 упал, не удалив повара, — S05/S06/S03a пошли под поваром (меню
  // «Сегодня / Разделы / Профиль», без «Журналов»). У шефа есть вкладка «Журналы».
  if (!(await has({ type: "link", begins: "Журналы" }))) {
    ctx.d.notChef = true;
    if (!(await logout(ctx))) throw new Error("вошёл не шеф и выйти не удалось");
    await signIn(ctx, CHEF, "relogin-chef");
    await sleep(2000);
    await dismissSheets();
  }
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
    // Раунд 7 (кадр 025): шторка «Инструкция» закрыла список документов на всё ожидание.
    if (await has({ type: "button", label: "Понятно" })) await dismissGuide(ctx, 2000);
    if (await has({ type: ["link", "button"], contains: "Распечатать" })) return "doc";
    if (period && (await has({ type: "link", contains: period }))) return "list";
    return null;
  }, 30000 * SLOW);
  ctx.d[`open_${search}`] = doc;
  if (!doc) await source(`${ctx.r.id}-journal-${search}`);
  if (doc === "list") {
    // Раунд 6 (S04, кадр 041): шторка «Инструкция» появилась позже 1,5 с и закрыла список.
    await dismissGuide(ctx, 5000);
    if (!(await tryTap({ type: "link", contains: period }, { scrolls: 4, settle: 3000 * SLOW, timeout: 20000 }))) {
      await dismissGuide(ctx, 5000);
      await tap({ type: "link", contains: period }, { scrolls: 4, settle: 3000 * SLOW });
    }
    let opened = await waitFor(() => has({ type: ["link", "button"], contains: "Распечатать" }), 40000 * SLOW);
    // Раунд 5 (S04, кадры 019/020): после нажатия на карточку документ не открылся
    // за 40 с (переход по ссылке не завершился) — второе нажатие, с кадром.
    if (!opened && (await has({ type: "link", contains: period }))) {
      ctx.d.periodRetap = true;
      stepShot("period-retap");
      await tap({ type: "link", contains: period }, { scrolls: 4, settle: 3000 * SLOW });
      opened = await waitFor(() => has({ type: ["link", "button"], contains: "Распечатать" }), 40000 * SLOW);
    }
  }
  await dismissGuide(ctx);
  await sleep(1500);
  return has({ type: ["link", "button"], contains: "Распечатать" });
}

/**
 * Шторка «Инструкция» журнала при первом заходе (раунд 4, кадр 021: закрыла список
 * документов холодильников) — закрываем «Понятно».
 */
async function dismissGuide(ctx, timeout = 1500) {
  const ok = await tryTap({ type: "button", label: "Понятно" }, { scrolls: 0, anywhere: true, ignoreKeyboard: true, timeout });
  if (ok) {
    ctx.d.guideDismissed = (ctx.d.guideDismissed || 0) + 1;
    await sleep(1000);
  }
}

/** Форма новой записи журнала E2E (голос + фото); true — нужная кнопка на экране. */
async function openE2eForm(ctx, want, { afterTap = null, settle = 3000 } = {}) {
  try {
    await tab("Журналы");
    await waitFor(() => has({ type: "field", label: "Поиск по журналам" }), 30000 * SLOW);
    await tap({ type: "field", label: "Поиск по журналам" }, { scrolls: 3 });
    await typeFocused("E2E");
    await sleep(1200);
    await hideKeyboard();
    await tap({ type: "link", contains: "E2E голос" }, { scrolls: 3, within: (r) => r.y < W.height - 170, settle: 3000 * SLOW });
    await dismissGuide(ctx);
    await waitFor(() => has({ type: "link", contains: "Новая запись" }), 20000 * SLOW);
    // Раунд 5: число записей журнала до формы — после фото/отмены пустой записи быть не должно.
    ctx.d.entriesBefore = await entryCount();
    await tap({ type: "link", contains: "Новая запись" }, { scrolls: 4, settle: settle * SLOW });
    if (afterTap) await afterTap();
    return Boolean(await waitFor(() => has(want), 45000 * SLOW));
  } catch (e) {
    ctx.d.e2eFormError = e.message.slice(0, 200);
    return false;
  }
}

/** Страница журнала: «N запись/записей» и карточки «… г. в ЧЧ:ММ». */
async function entryCount() {
  const chip = await textsWith(["запис"]);
  const m = chip.map((l) => /^(\d+)\s*запис/.exec(l.trim())).find(Boolean);
  const cards = await textsWith([" г. в "]);
  // Раунд 5: «0 записей» в дереве — два текста («0» и «записей»); пустой журнал — «Записей пока нет».
  const empty = chip.some((l) => /Записей пока нет/i.test(l));
  return { chip: m ? Number(m[1]) : empty ? 0 : null, chipLabels: chip.slice(0, 5), cards: cards.length, cardLabels: cards.slice(0, 5) };
}

/** С формы — «Отмена» в липком низу → страница журнала; число записей. */
async function backToJournalCount(ctx) {
  await hideKeyboard();
  if (!(await tryTap({ type: ["button", "link"], label: "Отмена" }, { scrolls: 0, anywhere: true, pick: "lowest", timeout: 4000 }))) await tryTap({ type: "button", label: "Назад" }, { scrolls: 0, anywhere: true, timeout: 3000 });
  // Раунд 6 (кадры 014/018): страница журнала открылась, но «Новая запись» не нашлась как ссылка.
  const back = await waitFor(async () => (await has({ type: ["link", "button"], contains: "Новая запись" })) || (await has({ type: "text", contains: "Записей пока нет" })), 20000 * SLOW);
  await sleep(1500);
  ctx.shot("journal-after-form");
  const c = back ? await entryCount() : null;
  ctx.d.entriesAfter = c;
  return c;
}

const sameCount = (a, b) => a && b && (a.chip ?? 0) === (b.chip ?? 0) && a.cards === b.cards;

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

// Порядок раунда 6: вход, затем доказательства правок мастера (S13k, S08m, S11b), затем
// то, что в раунде 5 не дошло до проверки (S04, S05, S06, S07, S03a). S12 — всегда последним.
// Второй прогон раунда 6: S11b, S07, S03a доказаны в первом (прогон 36352483952) — не повторяем.
// Раунд 8: вход, затем доказательства мастера d0876461 (S04d — печать без «Поделиться») и cd19f8ab (S13k — 3 раза низко + высоко), S08m (тост по кадрам), S12.
const ORDER = (env.ORDER || "S01,S02,S04d,S13k,S08m,S12").split(",");
// Потолок на сценарий (мс); общий бюджет — TEST_BUDGET_MIN.
const LIMITS = { S01: 90000, S02: 300000, S03a: 300000, S03b: 360000, S04: 300000, S05: 420000, S06: 330000, S07: 300000, S08: 240000, S09: 120000, S10: 150000, S11: 360000, S12: 60000, S13: 240000, S13k: 720000, S08m: 180000, S11b: 330000, S14: 150000, S04d: 240000 };
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
  // Раунд 5: главная, разделы, журналы и уборка в светлой теме доказаны в раунде 4
  // (кадры 012–019); не хватало документа холодильников и профиля — только они.
  def("S03a", "Светлая тема: документ холодильников и профиль", async (ctx) => {
    await ready(ctx);
    await profileTheme(ctx, "Светлая");
    const cold = await openJournal(ctx, "холодильн", "холодильного", IDS.docs?.cold?.title);
    ctx.check("light: документ журнала холодильников открылся", cold);
    await toTop();
    checkStrip(ctx, "light: документ холодильников", ctx.shot("fridges-doc-light"));
    await layoutCheck(ctx, "fridges-doc-light");
    await scrollDown();
    await scrollDown();
    checkStrip(ctx, "light: документ холодильников пролистан", ctx.shot("fridges-doc-scrolled-light"));
    await tab("Профиль");
    await waitText({ type: "text", label: "Профиль" });
    await toTop();
    checkStrip(ctx, "light: профиль", ctx.shot("profile-light"));
    await layoutCheck(ctx, "profile-light");
    await scrollDown();
    await scrollDown();
    ctx.shot("profile-light-scrolled");
  });
  def("S03b", "Основные экраны — тёмная тема", async (ctx) => {
    await ready(ctx);
    await profileTheme(ctx, "Тёмная");
    await screenPass(ctx, "dark");
  }, 480000);

  // 4. Печать документа
  def("S04", "Печать документа журнала: системное окно печати iOS", async (ctx) => {
    await ready(ctx);
    // Раунд 6: документ холодильников — в раунде 5 на нём были «Распечатать» и «⋯».
    const ok = await openJournal(ctx, "холодильн", "холодильного", IDS.docs?.cold?.title);
    ctx.check("документ холодильников открыт", ok);
    await toTop();
    const before = await source("S04-before");
    ctx.shot("doc-before-print");
    let p = (await tryTap({ type: ["link", "button"], label: "Распечатать" }, { scrolls: 3, timeout: 15000 })) || (await tryTap({ type: ["link", "button"], contains: "Распечатать" }, { scrolls: 3, timeout: 10000 }));
    ctx.d.printControl = p?.label ?? null;
    if (!p) {
      // Запасной путь: меню «⋯» документа → «Печать».
      await tap({ type: "button", label: "Ещё действия" }, { scrolls: 3 });
      await sleep(1500);
      ctx.shot("more-menu");
      p = await tap({ type: ["button", "other", "link", "XCUIElementTypeMenuItem"], begins: "Печать" }, { scrolls: 2, anywhere: true });
      ctx.d.printControl = `⋯ → ${p.label}`;
    }
    const xml = await waitFor(async () => {
      const s = await source("S04-print");
      const fresh = newLabels(before, s);
      return fresh.some((l) => /Принтер|Printer|Параметры печати|Print Options|Копи|Cop(y|ies)|Печать|Print/i.test(l)) ? s : null;
    }, 25000 * SLOW, 1500);
    const fresh = newLabels(before, xml || (await source("S04-print2")));
    ctx.d.newLabels = fresh.slice(0, 60);
    ctx.shot("print-sheet");
    ctx.check("окно печати iOS появилось", Boolean(xml), fresh.slice(0, 30));
    // Раунд 6 (кадры 030, 033 второго прогона): «Распечатать» в приложении — лист «Поделиться»
    // с PDF; «Напечатать» в нём открывает окно печати iOS («Параметры», «Принтер»).
    if (fresh.includes("ShareSheet.RemoteContainerView") || fresh.includes("Напечатать")) {
      ctx.d.viaShareSheet = true;
      const pr = await tryTap({ label: "Напечатать" }, { scrolls: 0, anywhere: true, ignoreKeyboard: true, timeout: 4000 });
      ctx.d.printAction = Boolean(pr);
      await sleep(3000);
      ctx.shot("print-options");
      const po = await source("S04-print-options");
      ctx.d.printOptionsLabels = newLabels(before, po).filter((l) => /Параметры|Принтер|Копии|Формат бумаги|Printer|Options/i.test(l)).slice(0, 10);
      ctx.check("окно печати iOS («Параметры», «Принтер»)", ctx.d.printOptionsLabels.length > 0, ctx.d.printOptionsLabels);
    }
    const cancel = await tryTap({ type: "button", label: "Отменить" }, { scrolls: 0, anywhere: true, timeout: 3000 }) || (await tryTap({ type: "button", label: "Cancel" }, { scrolls: 0, anywhere: true, timeout: 2000 })) || (await tryTap({ type: "button", label: "Закрыть" }, { scrolls: 0, anywhere: true, timeout: 2000 }));
    if (!(await has({ type: "button", label: "Распечатать" })) && !(await has({ type: "link", label: "Распечатать" }))) {
      // Лист «Поделиться» остался — закрыть жестом вниз.
      await drag(W.height * 0.55, W.height * 0.98, Math.round(W.width / 2));
    }
    ctx.d.cancelled = cancel?.label ?? null;
    await sleep(2000);
    ctx.shot("print-cancelled");
    const after = await source("S04-after");
    // Раунд 6: проверка «закрылось» смотрела только на подписи окна печати, а на экране
    // оставался лист «Поделиться» с PDF (кадр 031) — теперь и его подписи.
    const left = newLabels(before, after).filter((l) => /Принтер|Printer|Параметры печати|Print Options|ActivityListView|ShareSheet|Напечатать|Сохранить в Файлах/i.test(l));
    ctx.check("окно печати закрылось", left.length === 0, left);
    ctx.check("приложение живо, документ на месте", (await appState()) === 4 && (await has({ type: ["link", "button"], contains: "Распечатать" })));
    // Раунд 7: приложение откликается после печати — вкладка «Разделы» открывается.
    await tab("Разделы");
    ctx.check("после печати интерфейс откликается (открылись «Разделы»)", await waitText({ type: "text", label: "Все разделы" }, 20000));
    ctx.shot("after-print-sections");
  });

  // Раунд 8 (мастер d0876461): WebPrint.printFile — «Распечатать» открывает окно печати iOS
  // с PDF сразу, без листа «Поделиться». Кадры WDA каждые ~0,7 с, пока ждём (до 10 с — норма).
  def("S04d", "Печать документа журнала: сразу окно печати iOS с PDF (без листа «Поделиться»), отмена, отклик", async (ctx) => {
    await ready(ctx);
    const ok = await openJournal(ctx, "холодильн", "холодильного", IDS.docs?.cold?.title);
    ctx.check("документ холодильников открыт", ok);
    if (!ok) return;
    await toTop();
    const before = await source("S04d-before");
    ctx.shot("doc-before-print");
    const con0 = consoleMark();
    const PRINT_UI = `type == "XCUIElementTypeStaticText" AND label IN {"Принтер","Параметры","Копии","Формат бумаги","Принтер не выбран"}`;
    const SHARE_UI = `name IN {"ActivityListView","ShareSheet.RemoteContainerView","activityCollectionView"} OR label IN {"Скопировать","Сохранить в Файлах","Сохранить в Файлы","Напечатать"}`;
    const p = (await tryTap({ type: ["link", "button"], label: "Распечатать" }, { scrolls: 3, timeout: 15000, settle: 0 })) || (await tryTap({ type: ["link", "button"], contains: "Распечатать" }, { scrolls: 3, timeout: 10000, settle: 0 }));
    const t0 = Date.now();
    ctx.d.printControl = p?.label ?? null;
    ctx.check("кнопка «Распечатать» нажата", Boolean(p));
    if (!p) return;
    const frames = [];
    let lastFrame = 0;
    let printAt = null;
    let shareAt = null;
    while (Date.now() - t0 < 25000 * SLOW) {
      if (Date.now() - lastFrame > 700 && Date.now() - t0 < 12000) {
        lastFrame = Date.now();
        const f = await wdaShot(`S04d-wait-t${Date.now() - t0}ms`);
        if (f) frames.push(f);
      }
      const pu = await driver.$(`-ios predicate string:${PRINT_UI}`).catch(() => []);
      const su = await driver.$(`-ios predicate string:${SHARE_UI}`).catch(() => []);
      if (su.length && shareAt == null) shareAt = Date.now() - t0;
      if (pu.length) {
        printAt = Date.now() - t0;
        break;
      }
      if (shareAt != null && Date.now() - t0 > shareAt + 3000) break;
      await sleep(200);
    }
    ctx.d.frames = frames;
    ctx.d.printAtMs = printAt;
    ctx.d.shareSheetAtMs = shareAt;
    // Кадр окна печати: сразу и через 1,5 с (превью PDF дорисовывается).
    ctx.d.printFrameWda = await wdaShot("S04d-print-options");
    ctx.shot("print-options");
    await sleep(1500);
    ctx.d.printFrameWda2 = await wdaShot("S04d-print-options-1500ms");
    const xml = await source("S04d-print-options");
    const fresh = newLabels(before, xml);
    ctx.d.newLabels = fresh.slice(0, 80);
    const printLabels = fresh.filter((l) => /^(Параметры|Принтер|Принтер не выбран|Копии|Формат бумаги|Макет|Печать|Print|Printer|Options|Copies)$/i.test(l));
    const preview = fresh.filter((l) => /^Страница \d+ из \d+$|^Page \d+ of \d+$/i.test(l));
    const shareLabels = fresh.filter((l) => /ActivityListView|ShareSheet|activityCollectionView|shareCell|^Скопировать$|Сохранить в Файл|^Напечатать$|AirDrop|PDF-документ/i.test(l));
    const fileRow = fresh.filter((l) => /\.pdf$/i.test(l) || /cold-equipment-journal/i.test(l));
    Object.assign(ctx.d, { printLabels, preview, shareLabels, fileRow });
    ctx.check(`окно печати iOS за 10 с (${printAt} мс): ${printLabels.join(", ")}`, printAt != null && printAt <= 10000 * SLOW && printLabels.length >= 2, { printAt, printLabels });
    ctx.check(`в окне печати превью PDF (${preview.join(", ")})`, preview.length > 0, preview);
    ctx.check("нет листа «Поделиться» (ни «Скопировать», ни «Сохранить в Файлах», ни строки с именем файла)", shareAt == null && shareLabels.length === 0 && fileRow.length === 0, { shareAt, shareLabels, fileRow });
    // Отмена: на iOS 26 кнопка окна печати — «Закрыть» (раунд 6, дерево src-S05-error.xml); «Отменить» — на старых.
    const cancel = (await tryTap({ type: "button", label: "Отменить" }, { scrolls: 0, anywhere: true, ignoreKeyboard: true, timeout: 2500 })) || (await tryTap({ type: "button", label: "Закрыть" }, { scrolls: 0, anywhere: true, ignoreKeyboard: true, timeout: 2500 })) || (await tryTap({ type: "button", label: "Cancel" }, { scrolls: 0, anywhere: true, ignoreKeyboard: true, timeout: 1500 }));
    ctx.d.cancelled = cancel?.label ?? null;
    ctx.check(`окно печати закрыто кнопкой «${ctx.d.cancelled}»`, Boolean(cancel));
    await sleep(2500);
    ctx.shot("print-cancelled");
    const after = await source("S04d-after");
    const left = newLabels(before, after).filter((l) => /^(Параметры|Принтер|Принтер не выбран|Копии|Формат бумаги)$|ActivityListView|ShareSheet|^Скопировать$|Сохранить в Файл/i.test(l));
    ctx.check("окно печати ушло, листа «Поделиться» нет", left.length === 0, left);
    ctx.check("снова приложение: документ с «Распечатать» на месте", (await appState()) === 4 && (await has({ type: ["link", "button"], contains: "Распечатать" })));
    // Консоль: вызов WebPrint.printFile и без отказа плагина / ошибки печати.
    await sleep(500);
    const con = consoleSince(con0);
    const callLine = con.findIndex((l) => /To Native ->\s+WebPrint\s+printFile/.test(l));
    const fsLine = con.findIndex((l) => /To Native ->\s+Filesystem\s+writeFile/.test(l));
    const errs = con.filter((l, i) => i >= Math.max(0, fsLine) && /\[error\]|Не удалось|Uncaught|Unhandled|reject/i.test(l));
    ctx.d.consolePrint = { writeFile: con[fsLine] ?? null, printFile: con[callLine] ?? null, errors: errs.slice(0, 10), tail: con.filter((l) => /⚡️/.test(l)).slice(0, 30) };
    ctx.check(`в консоли «To Native -> WebPrint printFile» (${con[callLine]?.trim().slice(0, 80) ?? "нет"})`, callLine >= 0, ctx.d.consolePrint);
    ctx.check("в консоли PDF записан (Filesystem writeFile) до printFile", fsLine >= 0 && fsLine < callLine, ctx.d.consolePrint);
    ctx.check("после printFile нет [error]/отказа в консоли", errs.length === 0, errs);
    const toastErr = await textsWith(["Не удалось", "Ошибка"]);
    ctx.check("на экране нет сообщения об ошибке печати", toastErr.length === 0, toastErr);
    // Отклик: вкладка меню меняет экран.
    await tab("Разделы");
    ctx.check("после печати нажатие на вкладку меняет экран (открылись «Разделы»)", await waitText({ type: "text", label: "Все разделы" }, 20000));
    ctx.shot("after-print-sections");
  });

  // 5. Скачивание отчёта: лист «Поделиться»
  const shareCheck = async (ctx, tag, ext, before, { timeout = 30000, onClosed = null } = {}) => {
    let fresh = [];
    const xml = await waitFor(async () => {
      const s = await source(`S05-${tag}`);
      fresh = newLabels(before, s);
      return fresh.some((l) => /Сохранить в|Save to|AirDrop|Скопировать|Copy|Напечатать|Print|Файлы|Files|Сообщения|Messages|Правка действий|Edit Actions/i.test(l)) ? s : null;
    }, timeout * SLOW, 1500);
    ctx.shot(`${tag}-share-sheet`);
    ctx.d[`${tag}_newLabels`] = fresh.slice(0, 60);
    ctx.check(`${tag}: лист «Поделиться» появился`, Boolean(xml), fresh.slice(0, 25));
    const names = fresh.filter((l) => l.toLowerCase().includes("." + ext) || /report_|Журнал|отчёт/i.test(l));
    ctx.d[`${tag}_fileNames`] = names;
    ctx.check(`${tag}: имя файла видно в листе (.${ext})`, names.some((n) => n.toLowerCase().includes("." + ext)), names);
    const close = (await tryTap({ type: "button", label: "Закрыть" }, { scrolls: 0, anywhere: true, timeout: 3000 })) || (await tryTap({ type: "button", label: "Close" }, { scrolls: 0, anywhere: true, timeout: 2000 }));
    if (!close) await drag(W.height * 0.35, W.height * 0.95, Math.round(W.width / 2));
    if (onClosed) await onClosed();
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
    // Раунд 7, прогон 1: на медленном симуляторе до формы отчёта по журналу не дошли за
    // 30 с (кадр 023). Теперь — сразу «Скачать архив» в самом низу: листаем, пока кнопка
    // не окажется в видимой полосе.
    const ARCH = { type: "button", contains: "Скачать архив" };
    let archVisible = null;
    for (let i = 0; i < 30 && !archVisible; i++) {
      const l = (await all(ARCH)).filter((f) => f.r.y > band().top && f.r.y + f.r.height < band().bottom);
      if (l.length) archVisible = l[0];
      else await drag(W.height * 0.75, W.height * 0.3, undefined, 2500);
    }
    ctx.d.archScrolls = archVisible ? "found" : "not found";
    ctx.shot("archive-card");
    ctx.check("кнопка «Скачать архив» на экране", Boolean(archVisible));
    if (!archVisible) return;
    await tapXY(archVisible.r.x + archVisible.r.width / 2, archVisible.r.y + archVisible.r.height / 2);
    const tArch = Date.now();
    await watchToast(ctx, "archive-collecting", "Собираем архив", 4000, { t0: tArch });
    const beforeZip = await source("S05-before-zip");
    let done = null;
    await shareCheck(ctx, "archive-zip", "zip", beforeZip, {
      timeout: 120000,
      onClosed: async () => {
        done = await watchToast(ctx, "archive-done", "Архив скачан", 6000);
      },
    });
    ctx.check(`архив: тост «Архив скачан · …» после закрытия листа${done ? ` («${done.text}», ${done.ms} мс)` : ""}`, Boolean(done && /Архив скачан/.test(done.text)), done);
    ctx.d.archiveErrors = await textsWith(["Не удалось", "Ошибка"]);
    ctx.check("архив: без сообщений об ошибке", ctx.d.archiveErrors.length === 0, ctx.d.archiveErrors);
    await tab("Главная");
    ctx.check("после архива интерфейс откликается (открылась «Главная»)", await waitFor(() => has({ type: "link", begins: "Профиль" }), 20000));
    ctx.shot("after-archive-home");
  }, 420000);

  // 6. Внешние ссылки
  def("S06", "Ссылки: почта (mailto) и чужой сайт — системе; приложение остаётся рабочим", async (ctx) => {
    await ready(ctx);
    // Раунд 7: mailto проверен в раунде 6; время — только на чужой https (прогон 1 не уложился).
    let front;
    if (env.S06_MAILTO === "1") {
    await sectionsGo("Отчёт");
    await waitFor(() => has({ type: "link", contains: "Поделиться по email" }), 30000 * SLOW);
    await toTop();
    await tap({ type: "link", contains: "Поделиться по email" }, { scrolls: 3 });
    await sleep(3000);
    const stMail = await appState();
    front = await driver.execute("mobile: activeAppInfo").catch(() => null);
    ctx.d.mailto = { state: stMail, front, alert: await alertButtons(1500) };
    ctx.shot("mailto");
    if (ctx.d.mailto.alert) await driver.execute("mobile: alert", { action: "dismiss" }).catch(() => undefined);
    if (stMail !== 4 || (front && front.bundleId !== BUNDLE)) await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
    await sleep(1500);
    ctx.check("mailto: приложение на месте, страница отчётов та же", (await appState()) === 4 && (await has({ contains: "Поделиться по email" })));
    }
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
    // Раунд 6 (кадр 039): поверх приложения — окно Safari «Выбор поисковой системы»
    // (первый запуск Safari в симуляторе); закрываем «Продолжить».
    const sb = await alertButtons(2000);
    if (sb) {
      ctx.d.alertAfterReturn = { sb, text: await alertText() };
      await driver.execute("mobile: alert", { action: "accept", buttonLabel: sb.find((x) => /Продолжить|Continue/i.test(x)) || sb[sb.length - 1] }).catch(() => undefined);
      await sleep(1000);
    } else if (await tryTap({ type: "button", label: "Продолжить" }, { scrolls: 0, anywhere: true, ignoreKeyboard: true, timeout: 1500 })) {
      ctx.d.alertAfterReturn = "Продолжить";
      await sleep(1000);
    }
    ctx.shot("back-in-app");
    ctx.check("после возврата — та же страница, приложение живо", (await appState()) === 4 && (await has({ type: "link", contains: "tasksflow.ru" })));
    await tab("Профиль");
    ctx.check("после возврата интерфейс откликается (открылся «Профиль»)", await waitText({ type: "text", label: "Профиль" }, 20000));
    ctx.shot("profile-after-return");
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
    // Раунд 4: проверка засчитала «Снять фото» — это подпись кнопки самой формы, а
    // системного листа на кадре 028 не было. Теперь — только подписи листа iOS.
    const sys = labels.filter((l) => /Медиатека|Photo Library|Снять фото или видео|Take Photo|Выбрать файл|Choose File|^Фото$|^Photos$|^Камера$|^Camera$|^Файлы$|^Files$/i.test(l));
    ctx.d.chooserLabels = sys;
    ctx.check("системный выбор фото появился (подписи листа iOS)", Boolean(b) || sys.length > 0, labels.slice(0, 20));
    if (b) await driver.execute("mobile: alert", { action: "dismiss" }).catch(() => undefined);
    const c = (await tryTap({ type: "button", label: "Отменить" }, { scrolls: 0, anywhere: true, timeout: 3000 })) || (await tryTap({ type: "button", label: "Cancel" }, { scrolls: 0, anywhere: true, timeout: 2000 }));
    ctx.d.cancel = c?.label ?? null;
    await sleep(2000);
    const more = await tryTap({ type: "button", label: "Отменить" }, { scrolls: 0, anywhere: true, timeout: 1500 });
    if (more) await sleep(1500);
    // Раунд 5 (кадр 024): в симуляторе без камеры iOS показывает не лист, а меню
    // «Медиатека / Выбрать файл» без «Отменить» — закрывается нажатием мимо меню.
    if (!c && !more && (await has({ label: "Медиатека" }))) {
      await tapXY(W.width / 2, 100);
      await sleep(1500);
      ctx.d.cancel = "нажатие мимо меню";
    }
    ctx.check("меню выбора фото закрылось", !(await has({ label: "Медиатека" })));
    ctx.shot("cancelled");
    ctx.check("после отмены: приложение живо, форма на месте", (await appState()) === 4 && (await has(photoBtn)));
    if (ctx.d.via === "e2e_voice form") {
      const after = await backToJournalCount(ctx);
      ctx.check("пустая запись не сохранилась (записей столько же, сколько до формы)", sameCount(ctx.d.entriesBefore, after), { before: ctx.d.entriesBefore, after });
    }
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

  // 13. Форма «Новая запись»: шапка и нижнее меню нарисованы (раунд 4, кадр 027:
  // вместо шапки — белая полоса, нижнего меню нет, хотя в дереве доступности оба есть).
  def("S13", "Форма «Новая запись»: шапка приложения сверху и нижнее меню — сразу и после клавиатуры", async (ctx) => {
    await ready(ctx);
    const want = { type: "button", label: "Сохранить запись" };
    const frames = [];
    const onForm = await openE2eForm(ctx, want, {
      settle: 300,
      afterTap: async () => {
        // Кадры сразу после нажатия «Новая запись», до любого ввода.
        for (const [tag, wait] of [["open-0s", 0], ["open-1s", 1000], ["open-3s", 2000]]) {
          if (wait) await sleep(wait);
          frames.push(ctx.shot(tag));
        }
      },
    });
    ctx.check("форма «Новая запись» открылась", onForm);
    if (!onForm) return;
    await sleep(2500);
    const f6 = ctx.shot("open-6s");
    const xml = await source("S13-form-open");
    const els = elementsOf(xml);
    const topbar = els.filter((e) => ["На главный экран", "Уведомления", "ИИ-помощник"].includes(e.label)).map((e) => `${e.label} y=${e.y} vis=${e.visible}`);
    const nav = els.filter((e) => e.type === "Link" && ["Главная", "Журналы", "Разделы", "Профиль"].includes(e.label)).map((e) => `${e.label} y=${e.y}`);
    ctx.d.tree = { topbar, nav, wide: els.filter((e) => e.w > W.width + 2).map((e) => `${e.type} «${e.label.slice(0, 30)}» w=${e.w}`).slice(0, 8) };
    ctx.check("в дереве: шапка (логотип, колокольчик) на месте", topbar.length >= 2, topbar);
    ctx.check("в дереве: нижнее меню на месте", nav.length >= 4, nav);
    ctx.d.paintFrames = frames.map((f) => (f ? { f, top: regionStats(f, 62, 112), nav: regionStats(f, 772, 842) } : null));
    // Сразу после открытия (0–3 с) — фиксируем, когда шапка появилась; итог — по кадру 6 с.
    ctx.d.firstPaintedFrame = (ctx.d.paintFrames.find((x) => x && x.top.darkFrac >= 0.6) || {}).f ?? null;
    chromePainted(ctx, "форма открыта (6 с)", f6);
    checkStrip(ctx, "форма открыта", f6);
    // Фокус в «Заметку» — клавиатура; затем «Готово» — клавиатура закрыта.
    await tap({ type: ["XCUIElementTypeTextView", "field"], label: "Заметка" }, { scrolls: 3, maxY: W.height * 0.55 });
    await waitFor(keyboard, 6000);
    await sleep(1200);
    const fk = ctx.shot("keyboard-open");
    checkStrip(ctx, "клавиатура открыта", fk);
    ctx.d.kbOpenTop = regionStats(fk, 62, 112);
    await hideKeyboard();
    await sleep(2000);
    const fc = ctx.shot("keyboard-closed");
    chromePainted(ctx, "клавиатура закрыта", fc);
    await source("S13-kb-closed");
    const after = await backToJournalCount(ctx);
    ctx.check("без ввода запись не сохранилась", sameCount(ctx.d.entriesBefore, after), { before: ctx.d.entriesBefore, after });
  });

  // ─── Раунд 6: доказательства правок мастера 52e647e4 / e5716313 ─────────

  /** Рамки формы: «Сохранить запись», «Отмена», «Заметка», клавиатура, панель ^ v ✓, меню. */
  async function formRects() {
    const pick = async (spec, f = (l) => l[0]) => {
      const l = (await all(spec)).map((x) => x.r);
      return l.length ? f(l) : null;
    };
    const save = await pick({ type: "button", label: "Сохранить запись" }, (l) => l.sort((a, b) => b.y - a.y)[0]);
    const cancel = await pick({ type: ["button", "link"], label: "Отмена" }, (l) => l.sort((a, b) => b.y - a.y)[0]);
    const note = await pick({ type: ["XCUIElementTypeTextView", "field"], label: "Заметка" });
    const kb = await keyboard();
    const bars = (await all({ type: "XCUIElementTypeToolbar" })).map((x) => x.r).filter((r) => !kb || (r.y < kb.y + 2 && r.y > kb.y - 160));
    const bar = bars[0] ?? null;
    const done = await pick({ type: "button", label: "Готово" }, (l) => l.find((r) => !kb || (r.y < kb.y && r.y > kb.y - 160)) ?? null);
    const nav = (await all({ type: "link", begins: "Профиль" })).map((x) => x.r).filter((r) => r.y > W.height - 170)[0] ?? null;
    return { save, cancel, note, kb, bar, done, nav };
  }

  def("S13k", "Форма «Новая запись» с клавиатурой: кнопки прямо над клавиатурой, поле не под кнопками", async (ctx) => {
    await ready(ctx);
    const want = { type: "button", label: "Сохранить запись" };
    // Раунд 8 (мастер cd19f8ab): низкое положение — три раза подряд, каждый раз форма
    // открывается заново (раунд 7: в прогоне 1 «Заметка» ушла под часы, y=12, во втором — нет).
    const freshForm = async (tag) => {
      const onForm = await openE2eForm(ctx, want);
      ctx.check(`${tag}: форма «Новая запись» открыта заново`, onForm);
      if (!onForm) return false;
      await sleep(2000);
      ctx.shot(`${tag}-form-no-keyboard`);
      const r0 = await formRects();
      ctx.d[`${tag}_rectsNoKeyboard`] = r0;
      if (r0.save && r0.nav) ctx.check(`${tag}: без клавиатуры подвал формы над нижним меню`, r0.save.y + r0.save.height <= r0.nav.y + 1, { save: r0.save, nav: r0.nav });
      return true;
    };
    // Два случая iPhone (раунд 6): «Заметка» низко — iOS сдвигает экран к полю
    // (кадр 012 первого прогона: меню вылезло над клавиатурой); «Заметка» у верха —
    // видимая часть просто укорачивается. Меряем оба.
    const measureAt = async (tag) => {
      const rr = await formRects();
      const footerTop = rr.cancel ? Math.min(rr.cancel.y, rr.save ? rr.save.y : 1e9) : W.height * 0.55;
      const note = rr.note;
      if (!note) throw new Error("нет поля «Заметка»");
      const ty = Math.min(note.y + 24, footerTop - 12);
      ctx.d[`${tag}_noteTap`] = { x: Math.round(note.x + note.width * 0.3), y: Math.round(ty), note, footerTop };
      ctx.check(`${tag}: нажатие в «Заметку» выше подвала формы`, ty < footerTop - 8 && ty > 110, ctx.d[`${tag}_noteTap`]);
      if (tag.startsWith("low")) ctx.check(`${tag}: «Заметка» нажата низко (y=${Math.round(ty)} ≥ ${Math.round(W.height * 0.5)})`, ty >= W.height * 0.5, ctx.d[`${tag}_noteTap`]);
      await tapXY(note.x + note.width * 0.3, ty);
      await waitFor(keyboard, 6000);
      await sleep(2000);
      const fk = ctx.shot(`${tag}-keyboard-open`);
      ctx.d[`${tag}_wdaKeyboard`] = await wdaShot(`S13k-${tag}-keyboard-open`);
      await source(`S13k-${tag}-keyboard-open`);
      const r = await formRects();
      ctx.d[`${tag}_rectsKeyboard`] = r;
      ctx.check(`${tag}: клавиатура открыта`, Boolean(r.kb), r.kb);
      ctx.check(`${tag}: в дереве есть «Сохранить запись», «Отмена», «Заметка»`, Boolean(r.save && r.cancel && r.note), r);
      if (!(r.kb && r.save && r.cancel && r.note)) return;
      const barTop = r.bar ? r.bar.y : r.done ? r.done.y - 5 : null;
      const edge = barTop ?? r.kb.y;
      const saveBottom = r.save.y + r.save.height;
      const gap = Math.round((edge - saveBottom) * 10) / 10;
      const footerTopK = Math.min(r.cancel.y, r.save.y);
      const noteTopRoom = Math.round((footerTopK - 12 - (r.note.y + 40)) * 10) / 10;
      const navLinks = (await all({ type: "link", begins: "Главная" })).map((x) => x.r).filter((q) => q.y > 0 && q.y < W.height);
      const m = { tapY: Math.round(ty), saveTop: r.save.y, saveBottom, cancelTop: r.cancel.y, noteTop: r.note.y, noteBottom: r.note.y + r.note.height, barTop, barSource: r.bar ? "Toolbar" : r.done ? "Готово-5" : null, keyboardTop: r.kb.y, gap, noteTopRoom, navOnScreen: navLinks, file: fk };
      ctx.d[`${tag}_measure`] = m;
      log(`   S13k ${tag} measure`, JSON.stringify(m));
      ctx.check(`${tag}: зазор низ «Сохранить запись» → верх ${barTop != null ? "панели ^ v ✓" : "клавиатуры"} = ${gap} pt (0…40)`, gap >= 0 && gap <= 40, m);
      ctx.check(`${tag}: верхние 40 pt «Заметки» выше (верх «Отмена» − 12 pt): запас ${noteTopRoom} pt`, noteTopRoom >= 0, m);
      ctx.check(`${tag}: подвал формы не под клавиатурой`, saveBottom <= r.kb.y + 0.5 && (barTop == null || saveBottom <= barTop + 0.5), m);
      // Раунд 7 (мастер fc537a6f/911dc785): при клавиатуре нижнее меню скрыто (html[data-keyboard-open]),
      // поле с фокусом целиком видно: ниже шапки и выше подвала формы.
      const visTop = edge;
      const navVisible = navLinks.filter((q) => q.y + q.height / 2 < visTop);
      m.navVisible = navVisible;
      ctx.check(`${tag}: нижнее меню не видно при клавиатуре`, navVisible.length === 0, { navLinks, visTop });
      const tb = await topbarBottom().catch(() => null);
      m.topbarBottom = tb;
      // Раунд 7, прогон 1: при «Заметке» внизу iOS сдвинул всю страницу (шапка ушла на y=-310),
      // и проверка сравнивала с низом шапки 0 — поле под часами (y=12) засчиталось видимым.
      const topLimit = Math.max(tb && tb > 0 ? tb : 0, ISLAND_BOTTOM);
      m.topLimit = topLimit;
      m.topbarOnScreen = Boolean(tb && tb > ISLAND_BOTTOM);
      const noteFull = r.note.y >= topLimit - 0.5 && r.note.y + r.note.height <= footerTopK + 0.5;
      ctx.check(`${tag}: «Заметка» с фокусом целиком видна (${r.note.y}…${r.note.y + r.note.height} между верхом ${topLimit} (шапка ${tb}, часы ${ISLAND_BOTTOM}) и подвалом ${footerTopK})`, noteFull, { note: r.note, topbarBottom: tb, topLimit, footerTop: footerTopK });
      // Закрыть клавиатуру: ✓ на панели (или нажатие на заголовок).
      await hideKeyboard();
      if (await keyboard()) {
        await tapXY(W.width / 2, 150);
        await sleep(800);
      }
      await sleep(1500);
      const fc = ctx.shot(`${tag}-keyboard-closed`);
      const rc = await formRects();
      ctx.d[`${tag}_rectsClosed`] = rc;
      ctx.check(`${tag}: клавиатура закрыта`, !(await keyboard()));
      ctx.check(`${tag}: после клавиатуры нижнее меню снова в дереве`, Boolean(rc.nav), rc.nav);
      if (rc.save && rc.nav) ctx.check(`${tag}: после клавиатуры подвал снова над нижним меню`, rc.save.y + rc.save.height <= rc.nav.y + 1, { save: rc.save, nav: rc.nav });
      else ctx.check(`${tag}: после клавиатуры подвал и меню в дереве`, false, rc);
      const nav = regionStats(fc, 772, 842);
      ctx.d[`${tag}_navPaint`] = nav;
      ctx.check(`${tag}: после клавиатуры нижнее меню нарисовано (индиго ${nav.indigoFrac})`, nav.indigoFrac >= 0.02, nav);
    };
    const done = async (tag) => {
      const after = await backToJournalCount(ctx);
      ctx.check(`${tag}: без ввода запись не сохранилась`, sameCount(ctx.d.entriesBefore, after), { before: ctx.d.entriesBefore, after });
    };
    for (const tag of ["low1", "low2", "low3"]) {
      if (!(await freshForm(tag))) continue;
      await measureAt(tag);
      await done(tag);
    }
    // «Заметку» — к верху экрана (под шапку), в свежей форме.
    if (await freshForm("high")) {
      const n1 = (await formRects()).note;
      if (n1 && n1.y > 200) {
        const d = Math.min(n1.y - 150, W.height * 0.5);
        await drag(W.height * 0.62, W.height * 0.62 - d, Math.round(W.width * 0.62), 600);
        await sleep(1200);
      }
      ctx.d.noteBeforeHigh = (await formRects()).note;
      await measureAt("high");
      await done("high");
    }
    ctx.d.summary = ["low1", "low2", "low3", "high"].map((t) => {
      const m = ctx.d[`${t}_measure`];
      return m ? `${t}: tapY=${m.tapY} Заметка ${m.noteTop}…${m.noteBottom}, верх ${m.topLimit} (шапка ${m.topbarBottom}), Отмена ${m.cancelTop}, зазор ${m.gap}, меню видно ${m.navVisible?.length ?? "?"}, кадр ${m.file}` : `${t}: нет замера`;
    });
    for (const line of ctx.d.summary) log("   S13k", line);
  });

  def("S08m", "Голос: «Остановить запись» без речи → «Ничего не расслышали…», микрофон не висит", async (ctx) => {
    await ready(ctx);
    const mic = { type: "button", label: "Голосовой ввод" };
    const onForm = await openE2eForm(ctx, mic);
    ctx.shot("form");
    ctx.check("форма с голосовым вводом открыта", onForm);
    if (!onForm) return;
    await tap(mic, { scrolls: 6, maxY: W.height * 0.55 });
    const alerts = [];
    for (let i = 0; i < 3; i++) {
      const b = await alertButtons(i === 0 ? 8000 : 5000);
      if (!b) break;
      const text = await alertText();
      ctx.shot(`permission-${i + 1}`);
      alerts.push({ b, text, pressed: await acceptAlert(b) });
      await sleep(1200);
    }
    ctx.d.alerts = alerts;
    const listening = await waitFor(async () => (await has({ contains: "Слушаем" })) || (await has({ type: "button", label: "Остановить запись" })), 8000);
    ctx.d.listeningTexts = await textsWith(["Слушаем"]);
    ctx.shot("listening");
    ctx.check("идёт запись: «Слушаем…» / «Остановить запись»", listening, ctx.d.listeningTexts);
    const stop = await tryTap({ type: "button", label: "Остановить запись" }, { scrolls: 2, maxY: W.height * 0.6, settle: 0, timeout: 4000 });
    const t0 = Date.now();
    ctx.d.stopTapped = Boolean(stop);
    // Распознаватель мог остановиться и сам (в симуляторе нет речи) — тогда тост уже мог быть.
    // Раунд 7: опрос дерева + кадр WDA в момент находки (watchToast), проверка «ниже шапки».
    const toast = await watchToast(ctx, "nothing-heard", "расслышали", 5000, { t0 });
    if (!toast) ctx.d.anyToastTexts = await textsWith(["Запись прервалась", "Разрешите", "недоступно", "расслышали"]);
    const xmlToast = await source("S08m-toast");
    ctx.d.toastTreeNeighbours = toast ? elementsOf(xmlToast).filter((e) => e.w > 0 && Math.abs(e.y - toast.rect.y) < 60).map((e) => `${e.type} «${e.label}» y=${e.y} h=${e.h} vis=${e.visible}`).slice(0, 12) : null;
    // Раунд 8: на iOS 26.5 текст sonner в дерево не попадает (раунд 7, прогон 2: 11 опросов —
    // пусто, а на кадрах 016–019 тост есть). Тост оцениваем по кадрам WDA; дерево — справочно.
    ctx.d.treeToast = toast ? { ms: toast.ms, text: toast.text } : "в дереве нет (ожидаемо на iOS 26.5)";
    const fr = ctx.d["nothing-heard_toastFrames"] || [];
    ctx.check(`кадры WDA в окне 0–5 с после «Остановить запись» сняты (${fr.length} шт.) — тост по кадрам`, fr.length >= 5, fr);
    if (toast) ctx.check(`ровно один такой тост (${toast.count} / повторно ${toast.countAgain})`, toast.count === 1 && toast.countAgain <= 1, toast);
    // Раунд 7 (D): поздний отказ плагина после «stopped» не добавляет второй тост — ждём ещё 2,5 с.
    await sleep(2500);
    const f = ctx.shot("toast-later");
    ctx.d.toastTextsLater = await textsWith(["расслышали", "Запись прервалась", "Разрешите", "недоступно", "Не удалось"]);
    ctx.check("через 2,5 с — не больше одного сообщения голосового ввода", ctx.d.toastTextsLater.length <= 1, { texts: ctx.d.toastTextsLater, file: f });
    const hang = await has({ type: "button", label: "Остановить запись" });
    ctx.check("красный микрофон погас (нет «Остановить запись»)", !hang);
    ctx.check("кнопка «Голосовой ввод» снова на месте", await has(mic));
    ctx.check("приложение живо", (await appState()) === 4);
    await backToJournalCount(ctx);
  });

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
  const s11 = async (ctx) => {
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
    if (!(await keyboard())) await tap({ type: "field" }, { scrolls: 0, anywhere: true, pick: "last" });
    await waitFor(keyboard, 6000);
    await sleep(1500);
    // Раунд 5 (мастер 40d4565f): окно с открытой клавиатурой не выше видимой части
    // экрана минус строка состояния — верх окна (значок, заголовок) под часами не прячется.
    const dialogCheck = async (tag) => {
      const f = ctx.shot(tag);
      const kb = await keyboard();
      const title = (await all({ type: "text", contains: "Удалить аккаунт навсегда" }))[0]?.r ?? null;
      const close = (await all({ type: "button", label: "Закрыть" })).map((x) => x.r).filter((r) => r.y < W.height / 2 && r.width < 100).sort((a, b) => a.width * a.height - b.width * b.height)[0] ?? null;
      const cancel = (await all({ type: "button", label: "Отмена" })).map((x) => x.r).sort((a, b) => b.y - a.y)[0] ?? null;
      const input = (await all({ type: "field" })).map((x) => x.r).pop() ?? null;
      const confirm = (await all({ type: "button", label: "Удалить аккаунт" })).map((x) => x.r).sort((a, b) => b.y - a.y)[0] ?? null;
      const kt = await keyboardTop();
      ctx.d[`dialog_${tag}`] = { keyboard: kb, kbTop: kt, title, close, input, confirm, cancel, file: f };
      if (input && cancel) {
        const room = Math.round((cancel.y - 4 - (input.y + input.height)) * 10) / 10;
        ctx.d[`${tag}_inputRoom`] = room;
        ctx.check(`${tag}: поле «введите УДАЛИТЬ» целиком над кнопками окна (низ поля ≤ верх «Отмена» − 4 pt, запас ${room} pt)`, room >= 0, { input, cancel });
      } else ctx.check(`${tag}: поле и «Отмена» найдены`, false, { input, cancel });
      ctx.check(`${tag}: клавиатура открыта`, Boolean(kb));
      ctx.check(`${tag}: заголовок «Удалить аккаунт навсегда?» ниже строки состояния (y ≥ ${ISLAND_BOTTOM})`, title && title.y >= ISLAND_BOTTOM, title);
      if (close) ctx.check(`${tag}: крестик окна ниже строки состояния`, close.y >= ISLAND_BOTTOM - 4, close);
      checkStrip(ctx, `${tag}: под часами — только подложка, окна там нет`, f);
      if (kt && input) ctx.check(`${tag}: поле ввода над клавиатурой`, input.y + input.height <= kt + 1, { input, kt });
      if (kt && confirm) ctx.d[`${tag}_confirmAboveKeyboard`] = confirm.y + confirm.height <= kt + 1;
    };
    await dialogCheck("dialog-keyboard");
    // Раунд 5: поле было под кнопками окна — нажатие «в поле» попало в «Отмена».
    // Нажимаем, только если поле выше кнопок; иначе печатаем в поле с фокусом (autoFocus).
    const dk = ctx.d["dialog_dialog-keyboard"];
    const covered = dk.input && dk.confirm && dk.input.y + dk.input.height > dk.confirm.y - 8;
    ctx.check("dialog-keyboard: поле ввода не закрыто кнопками окна", !covered, { input: dk.input, confirm: dk.confirm });
    if (!covered) await tap({ type: "field" }, { scrolls: 0, anywhere: true, pick: "last", ignoreKeyboard: true });
    await sleep(800);
    // Раунд 5: элемент поля устарел («not present in the current view anymore») — берём свежий.
    lastTapped = (await all({ type: "field" })).pop()?.el ?? null;
    await typeFocused("УДАЛИТЬ");
    const typed = await readValue((await all({ type: "field" })).pop()?.el);
    ctx.d.typedValue = typed;
    if (typed !== "УДАЛИТЬ") {
      // Запас: печать в поле с фокусом клавишами (без ссылки на элемент).
      await ensureLayout("УДАЛИТЬ");
      await driver.keys([..."УДАЛИТЬ"]).catch((e) => (ctx.d.keysError = e.message.slice(0, 160)));
      await sleep(600);
      ctx.d.typedValueKeys = await readValue((await all({ type: "field" })).pop()?.el);
    }
    ctx.shot("dialog-after-typing");
    await sleep(800);
    await dialogCheck("dialog-typed");
    await hideKeyboard();
    await tap({ type: "button", label: "Удалить аккаунт" }, { scrolls: 0, anywhere: true, pick: "lowest" });
    const ok = await waitFor(onLogin, 40000 * SLOW);
    await sleep(1500);
    ctx.shot("deleted-login");
    ctx.check("после удаления — экран входа", ok);
    const note = (await all({ contains: "удал" })).map((e) => e.label);
    ctx.d.note = note;
    ctx.check("надпись «Аккаунт удалён»", note.some((l) => /аккаунт удал/i.test(l || "")), note);
  };
  def("S11", "Удаление аккаунта одноразового повара → «Аккаунт удалён» на входе", s11);
  def("S11b", "Удаление аккаунта с клавиатурой: поле «введите УДАЛИТЬ» над кнопками окна, окно ниже часов → «Аккаунт удалён»", s11);

  // 14. Раунд 7: нет связи — экран «Нет связи» (mobile/www/offline.html) и самовосстановление.
  def("S14", "Нет связи: сервер остановлен → «Нет связи» при запуске; сервер вернулся → приложение само открывает сайт", async (ctx) => {
    const st = env.STATE;
    const stopSh = st && path.join(st, "server-stop.sh");
    const startSh = st && path.join(st, "server-start.sh");
    if (!stopSh || !fs.existsSync(stopSh) || !fs.existsSync(startSh)) {
      ctx.check("скрипты остановки/запуска сервера на месте", false, { st });
      return;
    }
    const probe = () => {
      try {
        return execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", "--cacert", env.CA_PEM, `${env.BASE_URL || "https://localhost:3000"}/mini/login`], { timeout: 10000 }).toString();
      } catch (e) {
        return `err ${String(e.stdout || e.message).slice(0, 60)}`;
      }
    };
    let started = false;
    const startServer = () => {
      if (started) return;
      started = true;
      execFileSync("bash", [startSh], { stdio: "ignore", timeout: 30000 });
    };
    execFileSync("bash", [stopSh], { stdio: "ignore", timeout: 30000 });
    try {
    await sleep(1500);
    ctx.d.probeAfterStop = probe();
    log("   S14 server stopped, probe:", ctx.d.probeAfterStop);
    ctx.check(`сервер остановлен (ответ ${ctx.d.probeAfterStop})`, !/^[23]\d\d$/.test(ctx.d.probeAfterStop));
    await driver.execute("mobile: terminateApp", { bundleId: BUNDLE }).catch(() => undefined);
    await sleep(1000);
    const L = launchWithConsole();
    ctx.d.launchConsole = path.basename(L.file);
    const frames = [];
    let lastFrame = 0;
    const offline = await waitFor(async () => {
      if (Date.now() - lastFrame > 3000) {
        lastFrame = Date.now();
        frames.push(shotAsync(`${ctx.r.id}-offline-t${Math.round((Date.now() - L.t0) / 1000)}s`));
      }
      return (await has({ type: "text", contains: "Нет связи" })) ? Date.now() - L.t0 : null;
    }, 20000, 500);
    ctx.d.offlineMs = offline;
    const fo = ctx.shot("offline-page");
    ctx.d.offlineTexts = await textsWith(["Нет связи", "Проверьте", "Открываем"]);
    ctx.d.retryButton = await has({ type: "button", label: "Повторить" });
    await source("S14-offline");
    ctx.check(`за 20 с — экран «Нет связи с интернетом» (${offline ?? "—"} мс), кнопка «Повторить»`, Boolean(offline) && ctx.d.retryButton, { texts: ctx.d.offlineTexts, file: fo });
    ctx.check("на экране не страница входа/сайт (сервер выключен)", !(await onLogin()) && !(await has({ type: "link", begins: "Профиль" })));
    // Сервер снова запускаем; страница «Нет связи» раз в 10 с проверяет адрес и открывает сайт сама.
    startServer();
    const t1 = Date.now();
    let serverUp = null;
    lastFrame = 0;
    const back = await waitFor(async () => {
      if (!serverUp && /^[23]\d\d$/.test(probe())) serverUp = Date.now() - t1;
      if (Date.now() - lastFrame > 5000) {
        lastFrame = Date.now();
        frames.push(shotAsync(`${ctx.r.id}-recover-t${Math.round((Date.now() - t1) / 1000)}s`));
      }
      // Раунд 7, прогон 1: сайт открылся (кадры 042 «Открываем кабинет…», 043 — главная со
      // скелетоном), но меню «Профиль» ещё не было в дереве — считаем и по шапке сайта.
      if (await has({ type: "text", contains: "Нет связи" })) return null;
      if (await onLogin()) return { screen: "login", ms: Date.now() - t1 };
      if (await has({ type: "link", begins: "Профиль" })) return { screen: "home", ms: Date.now() - t1 };
      if (await has({ type: "link", label: "На главный экран" })) return { screen: "site-shell", ms: Date.now() - t1 };
      if (await has({ type: "text", contains: "Открываем кабинет" })) return { screen: "opening", ms: Date.now() - t1 };
      return null;
    }, 40000, 1000);
    if (back && !["login", "home"].includes(back.screen)) {
      ctx.d.settled = await waitFor(async () => ((await onLogin()) ? "login" : (await has({ type: "link", begins: "Профиль" })) ? "home" : null), 25000, 1000);
    }
    ctx.d.serverUpMs = serverUp;
    ctx.d.recovered = back;
    ctx.d.frames = frames;
    const fr = ctx.shot("recovered");
    await source("S14-recovered");
    ctx.check(`сервер снова отвечает (${serverUp ?? "—"} мс)`, serverUp != null);
    ctx.check(`за 40 с приложение само открыло сайт (${back ? `${back.screen}, ${back.ms} мс` : "нет"})`, Boolean(back), { file: fr, texts: await textsWith(["Нет связи", "Открываем", "Вход"]) });
    if (!back) {
      // Ещё 30 с — для отчёта: восстановилось ли позже; и хвост журнала устройства.
      const later = await waitFor(async () => ((await onLogin()) || (await has({ type: "link", begins: "Профиль" })) ? Date.now() - t1 : null), 30000, 1000);
      ctx.d.recoveredLaterMs = later;
      ctx.shot("recovered-later");
      try {
        const dl = fs.readFileSync(path.join(LOGS, "device.log"), "utf8").split("\n");
        ctx.d.deviceLogTail = dl.filter((l) => /offline|WebView|NSURLError|navigation|provisional|Capacitor|⚡️/i.test(l)).slice(-60);
      } catch (e) {
        ctx.d.deviceLogTail = String(e.message);
      }
    }
    } finally {
      // Сценарий упал до запуска сервера — сервер всё равно поднимаем (иначе S12 и
      // восстановление после провала останутся без сайта).
      if (!started) {
        try {
          startServer();
          ctx.d.serverRestartedInFinally = true;
        } catch (e) {
          ctx.d.serverRestartError = String(e.message).slice(0, 200);
        }
      }
    }
  }, 150000);

  // 12. Консоль
  def("S12", "Консоль: нет ошибок React (#418 и др.) и необработанных ошибок JS", async (ctx) => {
    await sleep(1000);
    const files = consoleFiles();
    const per = {};
    for (const f of files) {
      const txt = fs.readFileSync(f, "utf8");
      per[path.basename(f)] = {
        lines: txt.split("\n").length,
        react: txt.split("\n").filter((l) => /Minified React error|#418|#419|#422|#423|#425|hydrat/i.test(l)).slice(0, 10),
        startup: txt.split("\n").filter((l) => /STARTUP JS ERROR/.test(l)).length,
        errors: txt.split("\n").filter((l) => /\[error\]|Uncaught|Unhandled|TypeError|ReferenceError/.test(l) && !FIREBASE_CI.test(l) && !NEXTAUTH_FETCH.test(l) && !PLUGIN_REJECT.test(l)).slice(0, 25),
        pluginRejects: txt.split("\n").filter((l) => PLUGIN_REJECT.test(l)).slice(0, 10),
        uncaught: txt.split("\n").filter((l) => /Uncaught|Unhandled|STARTUP JS ERROR|ReferenceError|SyntaxError/.test(l)).slice(0, 25),
        nextAuthFetch: txt.split("\n").filter((l) => NEXTAUTH_FETCH.test(l)).slice(0, 10),
        firebaseNotConfigured: txt.split("\n").filter((l) => FIREBASE_CI.test(l)).length,
      };
    }
    ctx.d.console = per;
    const react = Object.values(per).flatMap((p) => p.react);
    const errs = Object.values(per).flatMap((p) => p.errors);
    ctx.check("журналы консоли собраны", files.length > 0, files);
    ctx.check("нет ошибок React (#418/#422/#425 и др.) и предупреждений о гидратации", react.length === 0, react);
    const uncaught = Object.values(per).flatMap((p) => p.uncaught);
    ctx.d.nextAuthFetch = Object.values(per).flatMap((p) => p.nextAuthFetch);
    ctx.d.pluginRejects = Object.values(per).flatMap((p) => p.pluginRejects);
    ctx.check("нет необработанных (uncaught/unhandled) ошибок JS", uncaught.length === 0, uncaught);
    ctx.check("нет других записей [error] в консоли (кроме сбоя fetch next-auth и отказов плагинов — см. nextAuthFetch, pluginRejects)", errs.length === 0, errs);
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
