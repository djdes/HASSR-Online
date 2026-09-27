// Проверка приложения WeSetup для iOS в симуляторе (CI, macOS): Appium XCUITest +
// WebdriverIO. Нативный контекст — системные окна (разрешения, печать,
// «Поделиться», выбор фото, жест «назад»), WEBVIEW — страница сайта.
// Скриншоты — `xcrun simctl io screenshot` (со строкой состояния и Dynamic Island).
// Итог — results.json в OUT_DIR: по сценарию статус, проверки, скриншоты.
//
// Окружение: UDID, OUT_DIR, IDS_JSON, BASE_URL (https://localhost:3000),
// SERVER_STOP_CMD / SERVER_START_CMD (сценарий «нет связи»),
// FIREBASE_INSTALL_CMD / PLAIN_INSTALL_CMD (сборка с тестовым GoogleService-Info.plist
// для нажатия на уведомление), WDA_DD (собранный заранее WebDriverAgent), CA_PEM.
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { execFileSync, execSync } from "node:child_process";
import { remote } from "webdriverio";

const env = process.env;
const UDID = env.UDID;
const BUNDLE = "ru.wesetup.app";
const BASE = env.BASE_URL || "https://localhost:3000";
const OUT = env.OUT_DIR || "out";
const IDS = JSON.parse(fs.readFileSync(env.IDS_JSON, "utf8"));
const PASSWORD = "DemoShots2026!";
const CHEF = "chef@cafe-demo.local";
const COOK = "cook@cafe-demo.local";
const THROWAWAY = "delete-me@cafe-demo.local";
const DEADLINE = Date.now() + Number(env.TEST_BUDGET_MIN || 24) * 60000;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
const netFailures = [];
const crashes = [];
const meta = { base: BASE, udid: UDID, started: new Date().toISOString() };
let shotN = 0;
let driver;
let cur = "NATIVE_APP";
let webOk = true;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function shot(name) {
  const f = `${String(++shotN).padStart(3, "0")}-${name}.png`;
  try {
    execFileSync("xcrun", ["simctl", "io", UDID, "screenshot", path.join(OUT, f)], { stdio: "ignore", timeout: 30000 });
    return f;
  } catch (e) {
    log("screenshot failed", name, e.message);
    return null;
  }
}

function save() {
  fs.writeFileSync(
    path.join(OUT, "results.json"),
    JSON.stringify({ meta, results, crashes, consoleErrors, netFailures }, null, 2)
  );
}

function withTimeout(p, ms, label) {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(label)), ms)))]).finally(() =>
    clearTimeout(t)
  );
}

// ─── Контексты ────────────────────────────────────────────────────────

async function native() {
  if (cur !== "NATIVE_APP") {
    await driver.switchContext("NATIVE_APP");
    cur = "NATIVE_APP";
  }
}

async function contexts() {
  return driver.execute("mobile: getContexts", { waitForWebviewMs: 3000 });
}

async function web(timeout = 60000) {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    try {
      const list = await contexts();
      last = list;
      const webs = (list || []).filter((c) => String(c.id || c).startsWith("WEBVIEW"));
      const ours =
        webs.find((c) => String(c.url || "").startsWith(BASE)) ||
        webs.find((c) => String(c.url || "").startsWith("capacitor://")) ||
        webs[0];
      if (ours) {
        const id = ours.id || ours;
        await driver.switchContext(id);
        cur = id;
        return ours;
      }
    } catch (e) {
      last = String(e.message).slice(0, 300);
    }
    await sleep(1000);
  }
  throw new Error("WEBVIEW не найден: " + JSON.stringify(last)?.slice(0, 600));
}

async function js(script, ...args) {
  let err;
  for (let i = 0; i < 4; i++) {
    try {
      if (cur === "NATIVE_APP") await web(30000);
      return await driver.execute(script, ...args);
    } catch (e) {
      err = e;
      await sleep(1200);
      try {
        await web(15000);
      } catch {
        /* ещё попытка */
      }
    }
  }
  throw err;
}

// ─── Страница ─────────────────────────────────────────────────────────

const FIND = `
  const [sel, text, exact, within, pick] = arguments;
  const roots = within ? Array.from(document.querySelectorAll(within)) : [document];
  const root = roots[roots.length - 1] || document;
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  let c = Array.from(root.querySelectorAll(sel)).filter(vis);
  if (text != null) c = c.filter((e) => { const t = norm(e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || e.value);
    return exact ? t === text : t.includes(text); });
  const el = pick === 'last' ? c[c.length - 1] : c[0];
`;

/** Координаты центра элемента на экране (точки iOS = CSS px, WebView на весь экран). */
async function rectOf(sel, opts = {}) {
  return js(
    FIND +
      `
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const vv = window.visualViewport || { offsetLeft: 0, offsetTop: 0, scale: 1 };
    return { x: (r.left + r.width / 2 - vv.offsetLeft) * vv.scale, y: (r.top + r.height / 2 - vv.offsetTop) * vv.scale,
      top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: norm(el.innerText || el.getAttribute('aria-label')).slice(0, 80) };`,
    sel,
    opts.text ?? null,
    Boolean(opts.exact),
    opts.within ?? null,
    opts.pick ?? "first"
  );
}

/** Нажатие пальцем (нативный tap по координатам элемента страницы). */
async function tapWeb(sel, opts = {}) {
  const r = await rectOf(sel, opts);
  if (!r) throw new Error(`не найден ${sel} ${opts.text ?? ""}`);
  await sleep(250);
  await native();
  await driver.execute("mobile: tap", { x: Math.round(r.x), y: Math.round(r.y) });
  return r;
}

/** Нажатие из JS (там, где палец не нужен). */
async function clickWeb(sel, opts = {}) {
  const ok = await js(
    FIND + `if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true;`,
    sel,
    opts.text ?? null,
    Boolean(opts.exact),
    opts.within ?? null,
    opts.pick ?? "first"
  );
  if (!ok) throw new Error(`не найден ${sel} ${opts.text ?? ""}`);
}

async function exists(sel, opts = {}) {
  return js(FIND + `return !!el;`, sel, opts.text ?? null, Boolean(opts.exact), opts.within ?? null, "first");
}

async function waitFor(fn, timeout = 30000, step = 700) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) {
    try {
      v = await fn();
      if (v) return v;
    } catch {
      /* страница грузится */
    }
    await sleep(step);
  }
  return v;
}

async function setVal(sel, value) {
  return js(
    `const el = Array.from(document.querySelectorAll(arguments[0])).pop(); if (!el) return false;
     const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, arguments[1]);
     el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true;`,
    sel,
    value
  );
}

async function where() {
  return js("return { href: location.href, path: location.pathname + location.search, ready: document.readyState }");
}

async function waitPath(re, timeout = 45000) {
  const rx = re instanceof RegExp ? re : new RegExp("^" + re.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\?|$)");
  const got = await waitFor(async () => {
    const w = await where();
    return w.ready === "complete" && rx.test(w.path) ? w : null;
  }, timeout);
  await sleep(1500);
  return got;
}

async function go(p, expect) {
  await js("window.location.assign(arguments[0]); return 1", BASE + p);
  await sleep(1000);
  return waitPath(expect ?? p.split("?")[0]);
}

async function toasts() {
  return js(
    "return Array.from(document.querySelectorAll('[data-sonner-toast]')).map(t => (t.innerText||'').replace(/\\s+/g,' ').trim()).filter(Boolean)"
  );
}

/** Раскладка экрана: переполнение, шапка под «островом», меню над полоской «домой». */
async function layout() {
  return js(`
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)';
    document.body.appendChild(p); const cs = getComputedStyle(p);
    const safe = { t: parseFloat(cs.paddingTop), b: parseFloat(cs.paddingBottom), l: parseFloat(cs.paddingLeft), r: parseFloat(cs.paddingRight) };
    p.remove();
    const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) }; };
    const title = document.querySelector('.mini-topbar-title');
    const wide = [];
    const all = document.querySelectorAll('body *');
    for (let i = 0; i < all.length && i < 4000 && wide.length < 6; i++) {
      const el = all[i]; const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= innerWidth + 1) continue;
      let a = el.parentElement, clipped = false;
      while (a && a !== document.body) { const o = getComputedStyle(a).overflowX; if (o !== 'visible') { clipped = true; break; } a = a.parentElement; }
      if (!clipped) wide.push((el.tagName + '.' + String(el.className || '').slice(0, 60)) + ' r=' + Math.round(r.right));
    }
    const meta = document.querySelector('meta[name=viewport]');
    return {
      path: location.pathname + location.search, title: document.title,
      h1: (document.querySelector('h1')?.innerText || '').trim().slice(0, 120),
      topbarTitle: title ? title.innerText.trim() : null,
      topbarTitleTruncated: title ? title.scrollWidth > title.clientWidth + 1 : null,
      innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1, wide,
      safe, topbar: rect('.mini-topbar'), topbarRow: rect('.mini-topbar-row'), nav: rect('.mini-nav-rail'),
      viewport: meta ? meta.content : null,
      theme: document.documentElement.getAttribute('data-theme') || document.documentElement.className.slice(0, 80),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      dialogs: Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog]')).map(d => (d.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 100)),
      text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300),
    };`);
}

function checkLayout(ctx, name, L) {
  ctx.d[`layout_${name}`] = L;
  ctx.check(`${name}: нет горизонтальной прокрутки`, !L.overflowX, { scrollWidth: L.scrollWidth, innerWidth: L.innerWidth, wide: L.wide });
  if (L.topbarRow) ctx.check(`${name}: шапка ниже «острова»`, L.topbarRow.top >= L.safe.t - 1, { row: L.topbarRow, safeTop: L.safe.t });
  if (L.nav) ctx.check(`${name}: меню выше полоски «домой»`, L.nav.bottom <= L.innerHeight - L.safe.b + 1, { nav: L.nav, h: L.innerHeight, safeBottom: L.safe.b });
  if (L.topbarTitleTruncated) ctx.d[`${name}_titleTruncated`] = L.topbarTitle;
}

/** Закрыть всплывшее (кроме листа про уведомления): «Что нового», подсказки. */
async function closeOverlays(ctx, tag) {
  for (let i = 0; i < 3; i++) {
    const info = await js(`
      const d = Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog]')).filter(e => e.getBoundingClientRect().height > 0).pop();
      if (!d) return null;
      if (d.querySelector('[data-testid=push-explainer]')) return 'push';
      const txt = (d.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
      const btn = Array.from(d.querySelectorAll('button')).find(b => /^(Понятно|Закрыть|Хорошо|Отлично|Ок|OK|Позже|Пропустить)/i.test((b.innerText || b.getAttribute('aria-label') || '').trim()))
        || d.querySelector('button[aria-label*="Закрыть"]');
      if (btn) { btn.click(); return 'closed: ' + txt; }
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return 'escape: ' + txt;`);
    if (!info || info === "push") return;
    (ctx.d.overlays ??= []).push(`${tag}: ${info}`);
    await sleep(800);
  }
}

// ─── Нативное ─────────────────────────────────────────────────────────

async function appState() {
  await native();
  return driver.execute("mobile: queryAppState", { bundleId: BUNDLE });
}

async function alertButtons(timeout = 8000) {
  await native();
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

async function source(tag) {
  try {
    await native();
    const xml = await driver.getPageSource();
    fs.writeFileSync(path.join(OUT, `src-${tag}.xml`), xml);
    return xml;
  } catch (e) {
    log("source failed", e.message);
    return "";
  }
}

async function nativeButton(labels, timeout = 6000) {
  await native();
  const q = labels.map((l) => `label == ${JSON.stringify(l)} OR name == ${JSON.stringify(l)}`).join(" OR ");
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const els = await driver.$$(`-ios predicate string:(type == "XCUIElementTypeButton") AND (${q})`);
      for (const el of els) if (await el.isDisplayed()) return el;
    } catch {
      /* ещё нет */
    }
    await sleep(500);
  }
  return null;
}

async function recover(tag) {
  try {
    await native();
    const b = await alertButtons(1500);
    if (b) {
      try {
        await driver.execute("mobile: alert", { action: "dismiss" });
      } catch {
        /* */
      }
    }
    const st = await appState();
    if (st !== 4) {
      crashes.push({ tag, state: st, at: new Date().toISOString() });
      await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
      await sleep(5000);
    }
    await web(30000);
  } catch (e) {
    log("recover failed", e.message);
  }
}

async function collectLogs(tag) {
  try {
    if (cur === "NATIVE_APP") await web(10000);
    const c = await driver.getLogs("safariConsole");
    if (c?.length) fs.appendFileSync(path.join(OUT, "safari-console.jsonl"), c.map((x) => JSON.stringify({ tag, ...x })).join("\n") + "\n");
    for (const e of c || []) {
      const s = JSON.stringify(e);
      if (/"level":"(error|warning|SEVERE|WARNING)"|"type":"error"|Error|error/i.test(s)) consoleErrors.push({ tag, e: s.slice(0, 700) });
    }
    const n = await driver.getLogs("safariNetwork");
    if (n?.length) fs.appendFileSync(path.join(OUT, "safari-network.jsonl"), n.map((x) => JSON.stringify({ tag, ...x })).join("\n") + "\n");
    for (const e of n || []) {
      const s = JSON.stringify(e);
      const st = /\\?"status\\?":\s*(\d{3})/.exec(s);
      if ((st && Number(st[1]) >= 400) || /loadingFailed|errorText/.test(s)) netFailures.push({ tag, e: s.slice(0, 700) });
    }
  } catch (e) {
    log("logs failed", e.message.slice(0, 200));
  }
}

// ─── Сценарии ─────────────────────────────────────────────────────────

async function scenario(id, name, fn, timeoutMs = 240000) {
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
      if (!ok) log("   FAIL:", label, JSON.stringify(extra ?? "").slice(0, 300));
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
    await withTimeout(fn(ctx), timeoutMs, `${id}: не уложился в ${timeoutMs / 1000} с`);
    if (r.status === "RUNNING") r.status = r.checks.every((c) => c.ok) ? "PASS" : "FAIL";
  } catch (e) {
    r.status = "FAIL";
    r.error = String(e?.stack || e).slice(0, 2500);
    log("   ERROR:", r.error.slice(0, 400));
    ctx.shot("error");
    await source(`${id}-error`);
  }
  try {
    const st = await appState();
    r.appStateAfter = st;
    if (st === 1) {
      r.status = "FAIL";
      r.crash = true;
      crashes.push({ tag: id, state: st, at: new Date().toISOString() });
    }
  } catch {
    /* */
  }
  await collectLogs(id);
  r.ended = new Date().toISOString();
  save();
  log("<<", id, r.status);
  if (r.status === "FAIL") await recover(id);
}

async function signIn(email, ctx, { nativeTyping = false, tag = "login" } = {}) {
  await go("/mini/login", /^\/mini(\/login)?/);
  let w = await where();
  if (!/\/mini\/login/.test(w.path)) {
    ctx.d[`${tag}_alreadyAt`] = w.path;
    return w;
  }
  await clickWeb('[role=radio]', { text: "Почта", exact: true });
  await sleep(500);
  if (nativeTyping) {
    await tapWeb("#email");
    await sleep(1200);
    await native();
    const f = await driver.$('-ios predicate string:type IN {"XCUIElementTypeTextField","XCUIElementTypeSecureTextField"} AND hasKeyboardFocus == 1');
    await f.addValue(email);
    await tapWeb("#password");
    await sleep(800);
    await native();
    const p = await driver.$('-ios predicate string:type IN {"XCUIElementTypeTextField","XCUIElementTypeSecureTextField"} AND hasKeyboardFocus == 1');
    await p.addValue(PASSWORD);
    ctx.shot(`${tag}-typed`);
    const typed = await js("return [document.querySelector('#email')?.value, (document.querySelector('#password')?.value||'').length]");
    ctx.d[`${tag}_typed`] = typed;
    if (typed[0] !== email || typed[1] !== PASSWORD.length) {
      await setVal("#email", email);
      await setVal("#password", PASSWORD);
      ctx.d[`${tag}_typingFallback`] = true;
    }
  } else {
    await setVal("#email", email);
    await setVal("#password", PASSWORD);
  }
  await sleep(300);
  await clickWeb('form button[type=submit]');
  w = await waitFor(async () => {
    const x = await where();
    return x.ready === "complete" && !/\/mini\/login/.test(x.path) ? x : null;
  }, 40000);
  if (!w) {
    const err = await js("return document.querySelector('[role=alert]')?.innerText || null");
    throw new Error(`вход ${email} не удался: ${err}`);
  }
  await sleep(2000);
  return w;
}

async function signOut(ctx, tag) {
  await go("/mini/me");
  await clickWeb("button, a, [role=button]", { text: "Выйти" });
  await sleep(900);
  ctx.shot(`${tag}-confirm`);
  await clickWeb("[role=dialog] button, [role=alertdialog] button", { text: "Выйти", exact: true, pick: "last" });
  return waitPath(/^\/mini\/login/, 40000);
}

function serverReady(timeout = 120000) {
  const ca = env.CA_PEM ? fs.readFileSync(env.CA_PEM) : undefined;
  const end = Date.now() + timeout;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = https.get(`${BASE}/mini/login`, { ca, timeout: 5000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        again();
      });
      req.on("error", again);
      req.on("timeout", () => req.destroy());
    };
    const again = () => (Date.now() > end ? resolve(false) : setTimeout(tryOnce, 2000));
    tryOnce();
  });
}

// ─── Прогон ───────────────────────────────────────────────────────────

async function main() {
  const caps = {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": UDID,
    "appium:bundleId": BUNDLE,
    "appium:noReset": true,
    "appium:forceAppLaunch": true,
    "appium:autoAcceptAlerts": false,
    "appium:autoDismissAlerts": false,
    "appium:newCommandTimeout": 900,
    "appium:wdaLaunchTimeout": 360000,
    "appium:wdaConnectionTimeout": 360000,
    "appium:showSafariConsoleLog": true,
    "appium:showSafariNetworkLog": true,
    "appium:webviewConnectTimeout": 60000,
    "appium:simulatorStartupTimeout": 300000,
    "appium:shouldTerminateApp": true,
  };
  if (env.WDA_DD && fs.existsSync(path.join(env.WDA_DD, "Build"))) {
    caps["appium:usePrebuiltWDA"] = true;
    caps["appium:derivedDataPath"] = env.WDA_DD;
  }
  meta.caps = caps;
  driver = await remote({
    hostname: "127.0.0.1",
    port: 4723,
    path: "/",
    logLevel: "warn",
    connectionRetryTimeout: 900000,
    connectionRetryCount: 1,
    capabilities: caps,
  });
  log("session", driver.sessionId);

  // 1. Холодный запуск
  await scenario("S01", "Холодный запуск: заставка, вход, приложение узнаёт себя", async (ctx) => {
    await sleep(2500);
    ctx.shot("after-launch");
    await native();
    const win = await driver.getWindowRect();
    ctx.d.window = win;
    const xml = await source("S01-native");
    const webViews = (xml.match(/<XCUIElementTypeWebView\b/g) || []).length;
    ctx.d.nativeWebViews = webViews;
    ctx.check("ровно один WebView в окне", webViews === 1, { webViews });
    let wv;
    try {
      wv = await web(90000);
    } catch (e) {
      webOk = false;
      throw e;
    }
    const all = await contexts();
    ctx.d.contexts = all;
    const ours = (all || []).filter((c) => String(c.id).startsWith("WEBVIEW") && String(c.bundleId || BUNDLE) === BUNDLE);
    ctx.check("одна страница WebView (один мост)", ours.length === 1, all);
    const w = await waitPath(/^\/mini(\/login)?/, 60000);
    ctx.d.where = w;
    ctx.check("открылся экран входа /mini/login", w && /^\/mini\/login/.test(w.path), w);
    const info = await js(`
      const names = ['WebPrint','App','AppLauncher','Filesystem','Share','FirebaseMessaging','SpeechRecognition','StatusBar','SplashScreen'];
      const C = window.Capacitor || {};
      return { ua: navigator.userAgent, native: !!(C.isNativePlatform && C.isNativePlatform()), platform: C.getPlatform && C.getPlatform(),
        plugins: Object.fromEntries(names.map(n => [n, !!(C.isPluginAvailable && C.isPluginAvailable(n))])),
        viewport: document.querySelector('meta[name=viewport]')?.content, dpr: devicePixelRatio, w: innerWidth, h: innerHeight,
        sw: 'serviceWorker' in navigator };`);
    ctx.d.info = info;
    ctx.check("User-Agent с приписькой WeSetupApp/… (ios)", /WeSetupApp\/[\d.]+ \(ios\)/.test(info.ua), info.ua);
    ctx.check("Capacitor.isNativePlatform() и платформа ios", info.native && info.platform === "ios", info);
    for (const [n, ok] of Object.entries(info.plugins)) ctx.check(`плагин ${n}`, ok);
    ctx.check("viewport-fit=cover", /viewport-fit=cover/.test(info.viewport || ""), info.viewport);
    ctx.check("WebView на весь экран", info.w === win.width && info.h === win.height, { css: [info.w, info.h], win });
    const L = await layout();
    checkLayout(ctx, "login", L);
    const form = await rectOf("form");
    ctx.d.formRect = form;
    ctx.check("форма входа ниже «острова»", form && form.top >= L.safe.t, { form, safe: L.safe });
    ctx.shot("login");
  });

  if (!webOk) {
    log("WEBVIEW недоступен — дальше без страницы нельзя");
    save();
    return;
  }

  // 13. Клавиатура
  await scenario("S13", "Клавиатура: поле и кнопка «Войти» над клавиатурой", async (ctx) => {
    await go("/mini/login", /^\/mini(\/login)?/);
    for (const mode of ["Телефон", "Почта"]) {
      await clickWeb('[role=radio]', { text: mode, exact: true });
      await sleep(500);
      const field = mode === "Телефон" ? "#phone" : "#email";
      await tapWeb(field);
      await sleep(1800);
      await native();
      const kb = await driver.$("-ios class chain:**/XCUIElementTypeKeyboard");
      const kbShown = await kb.isExisting();
      const kbRect = kbShown ? await kb.getLocation().then(async (l) => ({ ...l, ...(await kb.getSize()) })) : null;
      ctx.shot(`keyboard-${mode === "Телефон" ? "phone" : "email"}`);
      const m = await js(
        `const vv = window.visualViewport; const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect();
          return { top: Math.round(b.top - vv.offsetTop), bottom: Math.round(b.bottom - vv.offsetTop) }; };
         return { field: r(arguments[0]), password: r('#password'), button: r('form button[type=submit]'), vvH: Math.round(vv.height), vvTop: Math.round(vv.offsetTop), focused: document.activeElement?.id };`,
        field
      );
      ctx.d[`kb_${mode}`] = { kbShown, kbRect, m };
      ctx.check(`${mode}: клавиатура появилась`, kbShown, kbRect);
      if (kbRect && m.field) {
        ctx.check(`${mode}: поле над клавиатурой`, m.field.bottom <= kbRect.y, { field: m.field, kbTop: kbRect.y });
        ctx.check(`${mode}: кнопка «Войти» над клавиатурой`, m.button && m.button.bottom <= kbRect.y, { button: m.button, kbTop: kbRect.y });
      }
      try {
        await driver.execute("mobile: hideKeyboard", { keys: ["Готово", "Done", "return"] });
      } catch {
        await js("document.activeElement?.blur(); return 1");
      }
      await sleep(800);
    }
  });

  // 2. Вход шефа и лист про уведомления
  await scenario("S02", "Вход шеф-повара, лист «Уведомления о задачах», разрешение ОС", async (ctx) => {
    const w = await signIn(CHEF, ctx, { nativeTyping: true, tag: "chef" });
    ctx.d.afterLogin = w;
    ctx.check("после входа — домашний экран /mini", /^\/mini(\?|$|\/)/.test(w.path) && !/login/.test(w.path), w);
    ctx.shot("home-after-login");
    const sheet = await waitFor(() => exists("[data-testid=push-explainer]"), 12000);
    ctx.check("лист «Уведомления о задачах» показан", sheet);
    ctx.shot("push-explainer");
    if (!sheet) {
      ctx.d.dialogs = (await layout()).dialogs;
      return;
    }
    await tapWeb("[data-testid=push-explainer-enable]");
    const buttons = await alertButtons(12000);
    ctx.d.alertButtons = buttons;
    ctx.d.alertText = await alertText();
    ctx.shot("os-permission");
    ctx.check("системное окно разрешения появилось", Boolean(buttons));
    if (buttons) ctx.d.pressed = await acceptAlert(buttons);
    await sleep(5000);
    ctx.shot("after-allow");
    const st = await appState();
    ctx.check("приложение не упало", st === 4, st);
    const after = await js(
      "return { sheet: !!document.querySelector('[data-testid=push-explainer]'), spinners: document.querySelectorAll('.animate-spin').length, path: location.pathname }"
    );
    ctx.d.after = after;
    ctx.d.toasts = await toasts();
    ctx.check("лист закрылся, бесконечного ожидания нет", !after.sheet && after.spinners === 0, after);
    ctx.check("без сообщений об ошибке (Firebase в тестовой сборке нет — молча)", ctx.d.toasts.length === 0, ctx.d.toasts);
    const perm = await js("return window.Capacitor.Plugins.FirebaseMessaging.checkPermissions().then(r => r.receive)");
    ctx.d.permissionAfter = perm;
    ctx.check("разрешение на уведомления — granted", perm === "granted", perm);
  });

  // 3. Основные экраны (светлая тема)
  const screens = [
    ["home", "/mini", /^\/mini(\?|$)/],
    ["sections", "/mini/sections", null],
    ["cleaning-list", "/mini/journals/cleaning", /^\/mini\/(journals|documents)/],
    ["fridges-list", "/mini/journals/cold_equipment_control", /^\/mini\/(journals|documents)/],
    ["profile", "/mini/me", null],
  ];
  async function screenPass(ctx, theme) {
    for (const [name, url, rx] of screens) {
      await go(url, rx ?? undefined);
      await closeOverlays(ctx, name);
      ctx.shot(`${name}-${theme}`);
      checkLayout(ctx, `${name}-${theme}`, await layout());
      if (name.endsWith("-list")) {
        const here = await where();
        ctx.d[`${name}-landed`] = here.path;
        const doc = /\/documents\//.test(here.path) ? null : await rectOf("a[href*='/documents/']");
        ctx.d[`${name}-docLink`] = doc;
        const code = name === "cleaning-list" ? "cleaning" : "cold";
        const target = doc
          ? null
          : IDS.docs?.[code]?.id
            ? `/journals/${code === "cold" ? "cold_equipment_control" : "cleaning"}/documents/${IDS.docs[code].id}`
            : null;
        if (/\/documents\//.test(here.path)) {
          /* список сразу открыл документ */
        } else if (doc) await clickWeb("a[href*='/documents/']");
        else if (target) await go(target);
        const w = await waitPath(/\/documents\//, 45000);
        ctx.d[`${name}-doc`] = w;
        ctx.check(`${name}: документ открылся`, Boolean(w), w);
        await closeOverlays(ctx, `${name}-doc`);
        ctx.shot(`${name.replace("-list", "")}-doc-${theme}`);
        checkLayout(ctx, `${name.replace("-list", "")}-doc-${theme}`, await layout());
        await js("window.scrollTo(0, document.body.scrollHeight); return 1");
        await sleep(800);
        ctx.shot(`${name.replace("-list", "")}-doc-bottom-${theme}`);
      }
    }
  }
  await scenario("S03a", "Основные экраны в оболочке (светлая тема)", (ctx) => screenPass(ctx, "light"), 400000);

  // 6. Ссылки
  await scenario("S06", "Ссылки: почта, звонок, чужой сайт — системе; своя target=_blank и window.open — внутри", async (ctx) => {
    await go("/mini/sections");
    const inject = `
      document.querySelectorAll('[data-e2e-link]').forEach(e => e.remove());
      const add = (id, href, label, target, top) => { const a = document.createElement('a'); a.id = id; a.href = href; a.textContent = label;
        a.setAttribute('data-e2e-link', ''); if (target) a.target = target;
        a.style.cssText = 'position:fixed;left:16px;right:16px;z-index:2147483647;background:#fff;color:#000;border:2px solid #5566f6;border-radius:12px;padding:12px;font:16px/1.2 -apple-system;display:block;top:' + top + 'px';
        document.body.appendChild(a); };
      add('e2e-mail', 'mailto:support@wesetup.ru', 'mailto: почта', null, 140);
      add('e2e-tel', 'tel:+79990000000', 'tel: звонок', null, 200);
      add('e2e-ext', 'https://example.com/', 'https://example.com', null, 260);
      add('e2e-blank', '/mini/me', 'своя ссылка target=_blank', '_blank', 320);
      return 1;`;
    await js(inject);
    ctx.shot("links");
    const direct = await js(`
      const L = window.Capacitor.Plugins.AppLauncher; const out = {};
      for (const u of ['mailto:support@wesetup.ru', 'tel:+79990000000', 'https://example.com/']) {
        try { out[u] = await L.canOpenUrl({ url: u }); } catch (e) { out[u] = 'ERR ' + e.message; } }
      return out;`);
    ctx.d.canOpen = direct;
    for (const id of ["e2e-mail", "e2e-tel"]) {
      await tapWeb(`#${id}`);
      await sleep(2500);
      const st = await appState();
      ctx.d[`${id}_state`] = st;
      ctx.shot(id);
      const b = await alertButtons(1500);
      if (b) {
        ctx.d[`${id}_alert`] = { b, text: await alertText() };
        await driver.execute("mobile: alert", { action: "dismiss" }).catch(() => undefined);
      }
      if (st !== 4) await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
      await sleep(1000);
      const w = await where();
      ctx.check(`${id}: приложение на месте, страница та же`, /^\/mini\/sections/.test(w.path), w);
      await js(inject);
    }
    await tapWeb("#e2e-ext");
    await sleep(3500);
    const stExt = await appState();
    ctx.d.extState = stExt;
    ctx.shot("external-opened");
    let front = null;
    try {
      front = await driver.execute("mobile: activeAppInfo");
    } catch {
      /* */
    }
    ctx.d.extActiveApp = front;
    ctx.check("чужой сайт открылся не в приложении (Safari)", stExt !== 4 || (front && front.bundleId !== BUNDLE), { stExt, front });
    await driver.execute("mobile: activateApp", { bundleId: BUNDLE });
    await sleep(2500);
    ctx.shot("back-from-safari");
    const w2 = await where();
    ctx.check("после возврата приложение живо, страница та же", /^\/mini\/sections/.test(w2.path), w2);
    await js(inject);
    await tapWeb("#e2e-blank");
    const w3 = await waitPath("/mini/me", 30000);
    ctx.shot("blank-inside");
    ctx.check("своя ссылка target=_blank открылась внутри", Boolean(w3), w3);
    ctx.check("после target=_blank приложение на переднем плане", (await appState()) === 4);
    await js("window.open('/mini/sections', '_blank'); return 1");
    const w4 = await waitPath("/mini/sections", 30000);
    ctx.shot("window-open-inside");
    ctx.check("window.open на свой адрес — внутри", Boolean(w4), w4);
    ctx.check("после window.open приложение на переднем плане", (await appState()) === 4);
    const ctxs = await contexts();
    ctx.d.contextsAfter = ctxs;
    ctx.check("не появилось второго WebView", ctxs.filter((c) => String(c.id).startsWith("WEBVIEW")).length === 1, ctxs);
  });

  await scenario("S06b", "Жест «назад» от левого края", async (ctx) => {
    await go("/mini/sections");
    await tapWeb('a[data-nav-href="/mini/me"]');
    const w = await waitPath("/mini/me", 30000);
    ctx.check("перешли в профиль из меню", Boolean(w), w);
    ctx.shot("before-swipe");
    await native();
    const win = await driver.getWindowRect();
    const y = Math.round(win.height / 2);
    await driver.performActions([
      {
        type: "pointer",
        id: "finger",
        parameters: { pointerType: "touch" },
        actions: [
          { type: "pointerMove", duration: 0, x: 1, y },
          { type: "pointerDown", button: 0 },
          { type: "pause", duration: 60 },
          { type: "pointerMove", duration: 350, x: Math.round(win.width * 0.8), y },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
    await driver.releaseActions().catch(() => undefined);
    let back = await waitFor(async () => {
      const x = await where();
      return /^\/mini\/sections/.test(x.path) ? x : null;
    }, 8000);
    ctx.d.method = "w3c";
    if (!back) {
      await native();
      await driver.execute("mobile: dragFromToWithVelocity", {
        pressDuration: 0.05,
        holdDuration: 0.05,
        velocity: 2000,
        fromX: 1,
        fromY: y,
        toX: Math.round(win.width * 0.85),
        toY: y,
      }).catch((e) => (ctx.d.dragErr = e.message));
      ctx.d.method = "dragFromToWithVelocity";
      back = await waitFor(async () => {
        const x = await where();
        return /^\/mini\/sections/.test(x.path) ? x : null;
      }, 8000);
    }
    ctx.shot("after-swipe");
    ctx.check("свайп от левого края вернул на «Разделы»", Boolean(back), back ?? (await where()));
  });

  // 4. Печать
  await scenario("S04", "Печать: системное окно печати", async (ctx) => {
    await go("/journals/hygiene/guide");
    await closeOverlays(ctx, "guide");
    ctx.shot("guide");
    const hasBtn = await exists("button", { text: "Распечатать журнал" });
    ctx.d.button = hasBtn;
    if (hasBtn) await tapWeb("button", { text: "Распечатать журнал" });
    else await js("window.print(); return 1");
    await sleep(3500);
    const xml = await source("S04-print");
    ctx.shot("print-sheet");
    const shown = /Принтер|Printer|Параметры|Options|Печать|Print/.test(xml);
    ctx.check("окно печати появилось", shown);
    const cancel = await nativeButton(["Отменить", "Отмена", "Cancel", "Закрыть", "Close"], 5000);
    ctx.d.cancel = Boolean(cancel);
    if (cancel) await cancel.click();
    else await driver.execute("mobile: tap", { x: 30, y: 80 });
    await sleep(2000);
    ctx.shot("print-dismissed");
    const after = await source("S04-after");
    ctx.check("окно печати закрылось", !/Принтер|Printer/.test(after));
    ctx.check("приложение живо", (await appState()) === 4);
    ctx.d.toasts = await toasts();
  });

  // 5. Файлы
  async function shareCheck(ctx, tag, ext) {
    const xml = await waitFor(async () => {
      const s = await source(`S05-${tag}`);
      return /ActivityListView|Сохранить в|Save to Files|AirDrop|Скопировать|Copy|Напечатать|Print/.test(s) ? s : null;
    }, 25000, 1500);
    ctx.shot(`${tag}-share-sheet`);
    ctx.check(`${tag}: лист «Поделиться» появился`, Boolean(xml));
    const names = xml ? Array.from(new Set((xml.match(new RegExp(`[^"<>]{1,120}\\.${ext}`, "gi")) || []).map((s) => s.trim()))) : [];
    ctx.d[`${tag}_fileNames`] = names;
    ctx.check(`${tag}: имя файла .${ext} видно в листе`, names.length > 0, names);
    const close = await nativeButton(["Закрыть", "Close", "Отменить", "Cancel", "Готово", "Done"], 4000);
    if (close) await close.click();
    else await driver.execute("mobile: tap", { x: 200, y: 90 });
    await sleep(2000);
    ctx.shot(`${tag}-dismissed`);
    ctx.check(`${tag}: приложение живо`, (await appState()) === 4);
    ctx.d[`${tag}_toasts`] = await toasts();
  }
  await scenario("S05", "Скачивание: PDF документа и Excel отчёта — лист «Поделиться»", async (ctx) => {
    const id = IDS.docs?.cleaning?.id;
    if (id) {
      await go(`/journals/cleaning/documents/${id}`);
      await closeOverlays(ctx, "doc");
      const pdf = await exists("[data-testid=print-pdf-link]");
      ctx.d.pdfLink = pdf;
      if (pdf) {
        await tapWeb("[data-testid=print-pdf-link]");
        await shareCheck(ctx, "doc-pdf", "pdf");
      } else ctx.check("кнопка PDF у документа уборки", false);
    }
    await go("/reports");
    await closeOverlays(ctx, "reports");
    ctx.shot("reports");
    const combo = await exists('[role="combobox"]');
    ctx.d.combobox = combo;
    if (combo) {
      await tapWeb('[role="combobox"]');
      await sleep(1200);
      ctx.shot("reports-select");
      await tapWeb('[role="option"]');
      await sleep(800);
    }
    const excel = await exists("button", { text: "Excel" });
    ctx.d.excel = excel;
    if (!excel) {
      ctx.check("кнопка Excel на /reports", false, (await layout()).text);
      return;
    }
    await tapWeb("button", { text: "Excel" });
    await shareCheck(ctx, "report-xlsx", "xlsx");
  });

  // 7 и 8: фото и голос в полевом журнале
  await scenario("S07", "Фото в журнале: выбор камеры или галереи", async (ctx) => {
    await go("/journals/e2e_voice/new");
    await closeOverlays(ctx, "form");
    ctx.shot("form");
    const btn = await exists("button", { text: "Снять фото" });
    ctx.d.button = btn;
    if (!btn) return ctx.check("кнопка «Снять фото»", false, (await layout()).text);
    const inputs = await js("return Array.from(document.querySelectorAll('input[type=file]')).map(i => ({ accept: i.accept, capture: i.getAttribute('capture') }))");
    ctx.d.inputs = inputs;
    await tapWeb("button", { text: "Снять фото" });
    await sleep(3000);
    const xml = await source("S07-chooser");
    ctx.shot("chooser");
    const b = await alertButtons(1500);
    ctx.d.alert = b ? { b, text: await alertText() } : null;
    const labels = Array.from(new Set((xml.match(/label="([^"]{2,60})"/g) || []).map((s) => s.slice(7, -1)))).slice(0, 80);
    ctx.d.labels = labels;
    const chooser = /Медиатека|Photo Library|Снять фото|Take Photo|Выбрать файл|Choose File|Фото|Photos|Камера|Camera/.test(xml) || Boolean(b);
    ctx.check("системный выбор фото появился", chooser);
    if (b) await driver.execute("mobile: alert", { action: "accept", buttonLabel: b.find((x) => /ok|ок/i.test(x)) ?? b[b.length - 1] }).catch(() => undefined);
    const cancel = await nativeButton(["Отменить", "Отмена", "Cancel", "Закрыть", "Close"], 4000);
    if (cancel) await cancel.click();
    else await driver.execute("mobile: tap", { x: 200, y: 120 });
    await sleep(2500);
    const more = await nativeButton(["Отменить", "Отмена", "Cancel"], 1500);
    if (more) await more.click();
    await sleep(1000);
    ctx.shot("dismissed");
    ctx.check("приложение живо после отмены", (await appState()) === 4);
    const w = await where();
    ctx.check("остались на форме", /e2e_voice/.test(w.path), w);
  });

  await scenario("S08", "Голосовой ввод: разрешения и результат или понятная ошибка", async (ctx) => {
    const w0 = await where();
    if (!/e2e_voice/.test(w0.path)) await go("/journals/e2e_voice/new");
    const mic = await exists('button[title="Голосовой ввод"]');
    ctx.d.mic = mic;
    if (!mic) return ctx.check("кнопка «Голосовой ввод»", false);
    await tapWeb('button[title="Голосовой ввод"]');
    const alerts = [];
    for (let i = 0; i < 3; i++) {
      const b = await alertButtons(i === 0 ? 8000 : 5000);
      if (!b) break;
      const text = await alertText();
      ctx.shot(`permission-${i + 1}`);
      const pressed = await acceptAlert(b);
      alerts.push({ b, text, pressed });
      await sleep(1200);
    }
    ctx.d.alerts = alerts;
    ctx.check("система спросила разрешения (речь/микрофон)", alerts.length >= 1, alerts);
    await sleep(4000);
    ctx.shot("listening");
    let st = await appState();
    ctx.d.stateAfterStart = st;
    if (st !== 4) {
      ctx.check("приложение не упало при старте записи", false, st);
      return;
    }
    const s1 = await js(
      "return { rec: !!document.querySelector('button[title=\"Остановить запись\"]'), text: document.querySelector('textarea')?.value || '', toasts: Array.from(document.querySelectorAll('[data-sonner-toast]')).map(t => t.innerText.trim()) }"
    );
    ctx.d.s1 = s1;
    if (s1.rec) {
      await tapWeb('button[title="Остановить запись"]');
      await sleep(2500);
    }
    ctx.shot("after");
    st = await appState();
    const s2 = await js(
      "return { rec: !!document.querySelector('button[title=\"Остановить запись\"]'), text: document.querySelector('textarea')?.value || '', toasts: Array.from(document.querySelectorAll('[data-sonner-toast]')).map(t => t.innerText.trim()) }"
    );
    ctx.d.s2 = s2;
    ctx.check("приложение живо", st === 4, st);
    ctx.check("нет зависания: запись остановилась", !s2.rec, s2);
    const msgs = [...s1.toasts, ...s2.toasts];
    ctx.check(
      "итог: текст или понятная русская ошибка",
      Boolean(s2.text) || s1.rec || msgs.some((m) => /[а-яё]/i.test(m) && !/[a-z]{4,}/i.test(m.replace(/WeSetup/g, ""))),
      { text: s2.text, msgs }
    );

    // Микрофон у температуры (Web Speech API во встроенном браузере).
    const id = IDS.docs?.cold?.id;
    if (id) {
      await go(`/journals/cold_equipment_control/documents/${id}`);
      await closeOverlays(ctx, "cold");
      const speech = await js("return { sr: 'SpeechRecognition' in window, wsr: 'webkitSpeechRecognition' in window, mics: document.querySelectorAll('[title^=\"Голосовой ввод\"]').length }");
      ctx.d.coldSpeech = speech;
      ctx.shot("cold-doc");
    }
  });

  // 3b. Тёмная тема
  await scenario("S03b", "Основные экраны в оболочке (тёмная тема)", async (ctx) => {
    await go("/mini/me");
    await tapWeb('[role=radio]', { text: "Тёмная" });
    await sleep(1500);
    ctx.shot("profile-dark-switched");
    await screenPass(ctx, "dark");
    await go("/mini/me");
    const sec = await exists("[data-testid=app-push-settings]");
    ctx.d.pushSection = sec;
    if (sec) {
      await js("document.querySelector('[data-testid=app-push-settings]').scrollIntoView({block:'center'}); return 1");
      await sleep(700);
      ctx.shot("profile-push-section-dark");
      ctx.d.pushSectionText = await js("return document.querySelector('[data-testid=app-push-settings]').innerText");
    }
    ctx.check("раздел «Уведомления на этом телефоне» в профиле", sec);
    await tapWeb('[role=radio]', { text: "Светлая" });
    await sleep(1500);
    if (sec) {
      await js("document.querySelector('[data-testid=app-push-settings]').scrollIntoView({block:'center'}); return 1");
      await sleep(700);
      ctx.shot("profile-push-section-light");
    }
  }, 400000);

  // 10. Нет связи
  await scenario("S10", "Нет связи: экран «Нет связи с интернетом», «Повторить»", async (ctx) => {
    if (!env.SERVER_STOP_CMD) return ctx.skip("нет команды остановки сервера");
    execSync(env.SERVER_STOP_CMD, { stdio: "inherit" });
    await sleep(2000);
    await native();
    await driver.execute("mobile: terminateApp", { bundleId: BUNDLE });
    await driver.execute("mobile: launchApp", { bundleId: BUNDLE });
    await sleep(7000);
    ctx.shot("offline");
    await web(40000);
    const o = await waitFor(async () => {
      const x = await js("return { href: location.href, text: document.body.innerText }");
      return /Нет связи/.test(x.text) ? x : null;
    }, 20000);
    ctx.d.offline = o;
    ctx.check("экран «Нет связи с интернетом» с «Повторить»", o && /Повторить/.test(o.text), o);
    await tapWeb("#retry");
    await sleep(6000);
    ctx.shot("retry-while-down");
    const o2 = await js("return { href: location.href, text: document.body.innerText, btn: document.querySelector('#retry')?.textContent, disabled: document.querySelector('#retry')?.disabled }").catch((e) => ({ err: e.message }));
    ctx.d.retryWhileDown = o2;
    ctx.check("«Повторить» без сети не зависает на «Открываем…»", o2 && /Нет связи/.test(o2.text || "") && !o2.disabled, o2);
    execSync(env.SERVER_START_CMD, { stdio: "inherit" });
    const ready = await serverReady(150000);
    ctx.d.serverBack = ready;
    await web(20000);
    await tapWeb("#retry");
    const w = await waitFor(async () => {
      const x = await where();
      return x.ready === "complete" && x.href.startsWith(BASE) ? x : null;
    }, 60000);
    await sleep(2000);
    ctx.shot("back-online");
    ctx.check("после «Повторить» приложение снова открылось", Boolean(w), w);
  });

  // 11. Выход и вход повара, «Сегодня»
  await scenario("S11", "Выход из профиля, вход снова (повар), экран «Сегодня»", async (ctx) => {
    const w = await signOut(ctx, "chef");
    ctx.shot("login-after-logout");
    ctx.check("после выхода — экран входа", Boolean(w), w);
    const w2 = await signIn(COOK, ctx, { tag: "cook" });
    ctx.check("вход повара", !/login/.test(w2.path), w2);
    await sleep(1500);
    const sheet = await exists("[data-testid=push-explainer]");
    ctx.d.explainerForCook = sheet;
    if (sheet) await clickWeb("[data-testid=push-explainer-later]");
    ctx.shot("cook-home");
    await go("/mini/today");
    await closeOverlays(ctx, "today");
    ctx.shot("today-cook");
    checkLayout(ctx, "today-cook", await layout());
    await js("window.scrollTo(0, document.body.scrollHeight); return 1");
    await sleep(700);
    ctx.shot("today-cook-bottom");
  });

  // 9. Нажатие на уведомление
  await scenario("S09", "Нажатие на уведомление открывает нужный экран", async (ctx) => {
    if (!env.FIREBASE_INSTALL_CMD) return ctx.skip("нет сборки с Firebase");
    await native();
    await driver.execute("mobile: terminateApp", { bundleId: BUNDLE });
    execSync(env.FIREBASE_INSTALL_CMD, { stdio: "inherit" });
    await driver.execute("mobile: launchApp", { bundleId: BUNDLE });
    await sleep(6000);
    ctx.shot("firebase-build-launched");
    ctx.check("сборка с Firebase запустилась", (await appState()) === 4);
    await web(40000);
    const w0 = await waitFor(async () => {
      const x = await where();
      return x.ready === "complete" && /^\/mini/.test(x.path) ? x : null;
    }, 40000);
    ctx.d.start = w0;
    const payload = (url, body) => {
      const f = path.join(OUT, `push-${Date.now()}.json`);
      fs.writeFileSync(
        f,
        JSON.stringify({ "Simulator Target Bundle": BUNDLE, aps: { alert: { title: "WeSetup", body }, sound: "default" }, url })
      );
      return f;
    };
    // В фоне: «домой», уведомление, нажатие на баннер.
    await native();
    await driver.execute("mobile: pressButton", { name: "home" });
    await sleep(1500);
    execFileSync("xcrun", ["simctl", "push", UDID, BUNDLE, payload("/mini/me", "Проверка: открыть профиль")]);
    await sleep(1800);
    ctx.shot("banner-background");
    const banner = await driver.$('-ios predicate string:label CONTAINS "Проверка: открыть профиль"');
    ctx.d.bannerFound = await banner.isExisting().catch(() => false);
    if (ctx.d.bannerFound) await banner.click();
    else {
      const win = await driver.getWindowRect();
      await driver.execute("mobile: tap", { x: Math.round(win.width / 2), y: 95 });
    }
    await sleep(5000);
    ctx.shot("after-tap-background");
    ctx.d.stateAfterTap = await appState();
    await web(30000);
    const w1 = await waitFor(async () => {
      const x = await where();
      return /^\/mini\/me/.test(x.path) ? x : null;
    }, 20000);
    ctx.d.afterBackgroundTap = w1 ?? (await where());
    ctx.check("из фона: нажатие открыло профиль", Boolean(w1), ctx.d.afterBackgroundTap);
    // На переднем плане: баннер внутри приложения.
    await go("/mini");
    await native();
    execFileSync("xcrun", ["simctl", "push", UDID, BUNDLE, payload("/mini/sections", "Проверка: открыть разделы")]);
    await sleep(1500);
    ctx.shot("banner-foreground");
    const b2 = await driver.$('-ios predicate string:label CONTAINS "Проверка: открыть разделы"');
    ctx.d.banner2Found = await b2.isExisting().catch(() => false);
    if (ctx.d.banner2Found) await b2.click();
    else {
      const win = await driver.getWindowRect();
      await driver.execute("mobile: tap", { x: Math.round(win.width / 2), y: 95 });
    }
    await sleep(4000);
    const w2 = await waitFor(async () => {
      const x = await where();
      return /^\/mini\/sections/.test(x.path) ? x : null;
    }, 15000);
    ctx.shot("after-tap-foreground");
    ctx.d.afterForegroundTap = w2 ?? (await where());
    ctx.check("на переднем плане: нажатие открыло «Разделы»", Boolean(w2), ctx.d.afterForegroundTap);
  });

  // 12. Удаление аккаунта (одноразовый повар)
  await scenario("S12", "Удаление аккаунта одноразового повара", async (ctx) => {
    await signOut(ctx, "cook");
    const w = await signIn(THROWAWAY, ctx, { tag: "throwaway" });
    ctx.check("вход одноразового повара", !/login/.test(w.path), w);
    if (await exists("[data-testid=push-explainer]")) await clickWeb("[data-testid=push-explainer-later]");
    await go("/mini/me");
    await js("document.querySelector('[data-testid=me-delete-account]')?.scrollIntoView({block:'center'}); return 1");
    await sleep(600);
    ctx.shot("profile-delete-row");
    await tapWeb("[data-testid=me-delete-account]");
    await sleep(1500);
    ctx.shot("delete-dialog");
    const inDialog = await exists("[role=dialog] input, [role=alertdialog] input");
    ctx.check("окно подтверждения с полем ввода", inDialog);
    await tapWeb("[role=dialog] input, [role=alertdialog] input");
    await sleep(1200);
    await native();
    const f = await driver.$('-ios predicate string:type IN {"XCUIElementTypeTextField","XCUIElementTypeSecureTextField"} AND hasKeyboardFocus == 1');
    if (await f.isExisting()) await f.addValue("УДАЛИТЬ");
    let typed = await js("return Array.from(document.querySelectorAll('[role=dialog] input, [role=alertdialog] input')).pop()?.value");
    ctx.d.typed = typed;
    if (typed !== "УДАЛИТЬ") {
      await setVal("[role=dialog] input, [role=alertdialog] input", "УДАЛИТЬ");
      ctx.d.typingFallback = true;
    }
    ctx.shot("delete-typed");
    await clickWeb("[role=dialog] button, [role=alertdialog] button", { text: "Удалить аккаунт", pick: "last" });
    const w2 = await waitPath(/^\/mini\/login/, 40000);
    await sleep(1000);
    ctx.shot("deleted-login");
    ctx.check("после удаления — экран входа", Boolean(w2), w2 ?? (await where()));
    const note = await js("return document.querySelector('[data-testid=mini-login-account-deleted]')?.innerText || null");
    ctx.d.note = note;
    ctx.check("надпись «Аккаунт удалён»", Boolean(note) && /удал/i.test(note), note);
    await clickWeb('[role=radio]', { text: "Почта", exact: true });
    await sleep(400);
    await setVal("#email", THROWAWAY);
    await setVal("#password", PASSWORD);
    await clickWeb("form button[type=submit]");
    await sleep(4000);
    const after = await js("return { path: location.pathname, err: document.querySelector('[role=alert]')?.innerText || null }");
    ctx.d.relogin = after;
    ctx.shot("relogin-fails");
    ctx.check("войти удалённым аккаунтом нельзя", /\/mini\/login/.test(after.path) && Boolean(after.err), after);
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
    const failed = results.filter((r) => r.status === "FAIL").length;
    log(`done: ${results.length} scenarios, ${failed} failed`);
    process.exit(0);
  });
