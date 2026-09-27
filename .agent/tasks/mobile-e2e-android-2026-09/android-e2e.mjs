// Сценарии приложения WeSetup на эмуляторе Android (CI, workflow
// mobile-e2e-android.yml). Playwright _android подключается к WebView
// отладочной сборки, adb — для экрана, системных окон, сети и «назад».
// Каждый сценарий: снимок экрана устройства, PASS/FAIL и подробности в
// e2e-out/results.json. Сценарий не прячет ошибки: всё, что увидел, пишет.
import { _android } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.E2E_OUT || "e2e-out";
const HARNESS = process.env.HARNESS || ".agent/tasks/mobile-e2e-android-2026-09";
const MODE = process.env.MODE || "full";
const PKG = "ru.wesetup.app";
const ORIGIN = MODE === "full" ? "http://127.0.0.1:3000" : "https://wesetup.ru";
const PASSWORD = "DemoShots2026!";
const CHEF = "chef@cafe-demo.local";
const COOK = "cook@cafe-demo.local";
const THROWAWAY = "throwaway@cafe-demo.local";

fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });
const ids = MODE === "full" ? JSON.parse(fs.readFileSync(path.join(HARNESS, "ids.json"), "utf8")) : { docs: {} };

// ─── adb ────────────────────────────────────────────────────────────────
function adb(args, { timeout = 60000, binary = false } = {}) {
  return execFileSync("adb", args, { encoding: binary ? undefined : "utf8", maxBuffer: 64 << 20, timeout });
}
function sh(cmd, opts) {
  try {
    return adb(["shell", cmd], opts);
  } catch (e) {
    return String(e.stdout ?? "") + String(e.stderr ?? e.message);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shotN = 0;
function shot(name) {
  shotN += 1;
  const file = `shots/${String(shotN).padStart(2, "0")}-${name}.png`;
  try {
    fs.writeFileSync(path.join(OUT, file), adb(["exec-out", "screencap", "-p"], { binary: true }));
  } catch (e) {
    log(`screencap failed: ${e.message}`);
  }
  return file;
}
function rawUiXml() {
  for (let i = 0; i < 4; i++) {
    const r = sh("uiautomator dump /sdcard/ui.xml 2>&1");
    if (/dumped to/i.test(r)) return sh("cat /sdcard/ui.xml");
  }
  return "";
}
/**
 * Перегруженный эмулятор CI иногда показывает «Pixel Launcher isn't
 * responding» (ANR чужого приложения) — жмём «Wait» и считаем такие случаи.
 */
function uiXml() {
  let xml = rawUiXml();
  for (let i = 0; i < 3 && /aerr_wait/.test(xml); i++) {
    const wait = uiNodes(xml).find((n) => n["resource-id"] === "android:id/aerr_wait");
    results.systemAnrDismissed = (results.systemAnrDismissed ?? 0) + 1;
    results.systemAnrText = (/alertTitle[^>]*text="([^"]*)"/.exec(xml) ?? /text="([^"]*isn't responding[^"]*)"/.exec(xml))?.[1] ?? "?";
    if (wait?.rect) tapNode(wait);
    else key(4);
    execFileSync("sleep", ["1.5"]);
    xml = rawUiXml();
  }
  return xml;
}
function uiNodes(xml = uiXml()) {
  const out = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const attrs = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrs.bounds ?? "");
    if (b) attrs.rect = { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] };
    out.push(attrs);
  }
  return out;
}
function uiSummary(nodes) {
  return nodes
    .filter((n) => n.text || n["content-desc"] || /Button/.test(n.class ?? ""))
    .map((n) => `${n.package}|${n["resource-id"]}|${n.text || n["content-desc"]}`)
    .slice(0, 60);
}
function findNode(nodes, re) {
  return nodes.find((n) => re.test(n.text ?? "") || re.test(n["content-desc"] ?? "") || re.test(n["resource-id"] ?? ""));
}
function tap(x, y) {
  sh(`input tap ${Math.round(x)} ${Math.round(y)}`);
}
function tapNode(n) {
  tap((n.rect.x1 + n.rect.x2) / 2, (n.rect.y1 + n.rect.y2) / 2);
}
function key(code) {
  sh(`input keyevent ${code}`);
}
function topActivity() {
  const r = sh("dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity|ResumedActivity:' | head -3");
  return r.trim();
}
function appPid() {
  return sh(`pidof ${PKG}`).trim();
}
function bringAppToFront() {
  sh(`am start -n ${PKG}/.MainActivity`);
}
/** Системные полосы и клавиатура из dumpsys window (форматы API 29–36). */
function systemInsets() {
  const d = sh("dumpsys window");
  const frame = (re) => {
    const m = re.exec(d);
    return m ? { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] } : null;
  };
  const F = String.raw`[^\n]*?frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]`;
  const res = {
    statusBar: frame(new RegExp(String.raw`type=(?:statusBars|ITYPE_STATUS_BAR)` + F)),
    navBar: frame(new RegExp(String.raw`type=(?:navigationBars|ITYPE_NAVIGATION_BAR)` + F)),
    ime: frame(new RegExp(String.raw`type=(?:ime|ITYPE_IME)` + F)),
    imeShown: null,
    screen: sh("wm size").trim(),
    density: sh("wm density").trim(),
  };
  res.imeShown = Boolean(res.ime && res.ime.y1 > 0 && res.ime.y2 > res.ime.y1);
  return res;
}
function webViewRect() {
  const n = uiNodes().find((x) => x.class === "android.webkit.WebView" && x.package === PKG);
  return n?.rect ?? null;
}

// ─── Результаты ─────────────────────────────────────────────────────────
const results = { mode: MODE, origin: ORIGIN, startedAt: new Date().toISOString(), device: {}, scenarios: [], console: [], network: [] };
function log(...a) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
}
function save() {
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
}
let current = null;
async function scenario(name, fn) {
  log(`=== ${name}`);
  current = { name, ok: false, details: "", shots: [], data: {} };
  results.scenarios.push(current);
  const t0 = Date.now();
  try {
    const r = await fn(current);
    if (current.ok !== "partial") current.ok = r !== false && !current.failures?.length;
  } catch (e) {
    current.ok = false;
    current.error = String(e?.stack || e).slice(0, 2000);
    current.shots.push(shot(`${slug(name)}-error`));
    log(`ERROR in ${name}:`, e?.message);
  }
  if (current.failures?.length) current.details = [current.details, ...current.failures].filter(Boolean).join(" | ");
  current.ms = Date.now() - t0;
  log(`=== ${name}: ${current.ok ? "PASS" : "FAIL"} ${current.details}`);
  save();
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
function check(cond, msg) {
  if (!cond) (current.failures ??= []).push(msg);
  return cond;
}
function note(msg) {
  current.details = current.details ? `${current.details}; ${msg}` : msg;
}

// ─── WebView ────────────────────────────────────────────────────────────
let device;
let page;
async function connect(timeout = 90000) {
  const deadline = Date.now() + timeout;
  let pid = "";
  while (Date.now() < deadline) {
    pid = appPid();
    if (pid) {
      const wv = device.webViews().find((w) => String(w.pid()) === pid.split(/\s+/)[0]);
      if (wv) {
        const pg = await wv.page().catch(() => null);
        if (pg) {
          page = pg;
          attachListeners(page);
          return page;
        }
      }
    }
    await sleep(1000);
  }
  // Последняя попытка — штатное ожидание Playwright.
  const wv = await device.webView({ pkg: PKG }, { timeout: 30000 });
  page = await wv.page();
  attachListeners(page);
  return page;
}
const attached = new WeakSet();
function attachListeners(p) {
  if (attached.has(p)) return;
  attached.add(p);
  p.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      results.console.push({ at: current?.name, type: m.type(), text: m.text().slice(0, 500), url: p.url() });
  });
  p.on("pageerror", (e) => results.console.push({ at: current?.name, type: "pageerror", text: String(e).slice(0, 500), url: p.url() }));
  p.on("requestfailed", (r) =>
    results.network.push({ at: current?.name, failed: r.failure()?.errorText, url: r.url().slice(0, 300) })
  );
  p.on("response", (r) => {
    if (r.status() >= 400) results.network.push({ at: current?.name, status: r.status(), url: r.url().slice(0, 300) });
  });
}
async function goto(p, url) {
  await p.goto(url.startsWith("http") ? url : ORIGIN + url, { waitUntil: "load", timeout: 90000 });
  await settle(p);
  await dismissPushSheet(p);
}
/** Лист «Уведомления о задачах» мог всплыть позже (медленный эмулятор) — «Не сейчас». */
async function dismissPushSheet(p) {
  const later = p.getByTestId("push-explainer-later");
  if (await later.isVisible().catch(() => false)) {
    results.dismissedPushSheet = (results.dismissedPushSheet ?? 0) + 1;
    await later.click().catch(() => undefined);
    await sleep(600);
  }
}
async function settle(p, ms = 1500) {
  await p.waitForLoadState("load", { timeout: 60000 }).catch(() => undefined);
  await sleep(ms);
}
function pathOf(p) {
  try {
    const u = new URL(p.url());
    return u.pathname + u.search;
  } catch {
    return p.url();
  }
}

/** Геометрия страницы против системных полос: всё видимое — между ними. */
async function layoutProbe(p, label) {
  let res0Note = null;
  const ins = systemInsets();
  const wv = webViewRect();
  const info = await p.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height, w: b.width };
    };
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;left:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const envTop = cs.paddingTop;
    const envBottom = cs.paddingBottom;
    probe.remove();
    const root = getComputedStyle(document.documentElement);
    const topRow = document.querySelector(".mini-topbar-row");
    const rail = document.querySelector(".mini-nav-rail");
    const tabs = [...document.querySelectorAll(".mini-nav-tab")].map(r);
    const h1 = document.querySelector("h1, .mini-h1, .mini-topbar-title");
    return {
      url: location.href,
      title: document.title,
      dpr: devicePixelRatio,
      innerWidth,
      innerHeight,
      vv: window.visualViewport ? { h: visualViewport.height, w: visualViewport.width, top: visualViewport.offsetTop } : null,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      envTop,
      envBottom,
      capTop: root.getPropertyValue("--safe-area-inset-top").trim(),
      capBottom: root.getPropertyValue("--safe-area-inset-bottom").trim(),
      topRow: r(topRow),
      rail: r(rail),
      tabs,
      heading: h1 ? { text: h1.textContent?.trim().slice(0, 80), rect: r(h1) } : null,
      theme: document.documentElement.getAttribute("data-theme") || document.documentElement.className.slice(0, 80),
      overflowers: [...document.querySelectorAll("body *")]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.right > innerWidth + 1 && getComputedStyle(el).position !== "fixed";
        })
        .slice(0, 5)
        .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`),
    };
  });
  if (!wv) res0Note = "webview bounds unknown (uiautomator)";
  const wvTop = wv?.y1 ?? 0;
  const toScreen = (y) => Math.round(wvTop + y * info.dpr);
  const res = { label, insets: ins, webView: wv, ...info, issues: [], note: res0Note };
  if (info.scrollWidth > info.innerWidth + 1) res.issues.push(`horizontal overflow: scrollWidth ${info.scrollWidth} > ${info.innerWidth} (${info.overflowers.join(", ")})`);
  const sbBottom = wv ? ins.statusBar?.y2 ?? 0 : 0;
  if (info.topRow && toScreen(info.topRow.top) < sbBottom - 1)
    res.issues.push(`top bar content under status bar: row top ${toScreen(info.topRow.top)}px < status bar bottom ${sbBottom}px`);
  if (!info.topRow && info.heading?.rect && info.heading.rect.top >= 0 && toScreen(info.heading.rect.top) < sbBottom - 1)
    res.issues.push(`heading under status bar: ${toScreen(info.heading.rect.top)} < ${sbBottom}`);
  const nbTop = wv && ins.navBar && ins.navBar.y1 > 0 ? ins.navBar.y1 : null;
  if (nbTop && info.tabs.length) {
    const lowest = Math.max(...info.tabs.map((t) => t.bottom));
    if (toScreen(lowest) > nbTop + 1) res.issues.push(`bottom nav under system navigation: tabs bottom ${toScreen(lowest)}px > nav bar top ${nbTop}px`);
  }
  return res;
}

// ─── Шаги приложения ────────────────────────────────────────────────────
async function login(p, email) {
  if (!pathOf(p).startsWith("/mini/login")) await goto(p, "/mini/login");
  await p.getByRole("radio", { name: "Почта" }).click();
  await p.fill("#email", email);
  await p.fill("#password", PASSWORD);
  await p.getByRole("button", { name: "Войти", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/mini/login"), { timeout: 90000 });
  await settle(p, 2500);
}
async function screenTap(p, locator) {
  uiXml(); // закрыть системный ANR, если висит
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  const wv = webViewRect() ?? { x1: 0, y1: 0 };
  const dpr = await p.evaluate(() => devicePixelRatio);
  tap(wv.x1 + (box.x + box.width / 2) * dpr, wv.y1 + (box.y + box.height / 2) * dpr);
}
async function setTheme(p, theme) {
  if (!pathOf(p).startsWith("/mini/me")) await goto(p, "/mini/me");
  await dismissPushSheet(p);
  await p.getByRole("radio", { name: theme === "dark" ? "Тёмная" : "Светлая" }).click();
  await sleep(800);
}
async function buttonsText(p) {
  return p.evaluate(() =>
    [...document.querySelectorAll("button, a[href], [role=button]")]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50))
      .filter(Boolean)
      .slice(0, 80)
  );
}
async function toastText(p) {
  return p.evaluate(() => [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent?.trim()).join(" | ")).catch(() => "");
}
function fatalLines() {
  return sh("logcat -d -b crash").split("\n").filter((l) => /FATAL|AndroidRuntime|ru\.wesetup/.test(l)).slice(0, 40);
}

// ─── Сценарии ───────────────────────────────────────────────────────────
async function main() {
  const sdk = sh("getprop ro.build.version.sdk").trim();
  results.device = {
    sdk,
    release: sh("getprop ro.build.version.release").trim(),
    model: sh("getprop ro.product.model").trim(),
    webview: sh("dumpsys webviewupdate | grep -iE 'Current WebView package|versionName' | head -3").trim(),
  };
  log("device", results.device);
  // Экранная клавиатура показывается и при «аппаратной» клавиатуре эмулятора.
  sh("settings put secure show_ime_with_hard_keyboard 1");
  sh("logcat -c");
  sh("logcat -b crash -c");

  const devices = await _android.devices({ omitDriverInstall: true });
  device = devices[0];
  if (!device) throw new Error("no android device");

  // Видео основного сценария (до 3 минут).
  const rec = spawn("adb", ["shell", "screenrecord", "--time-limit", "180", "--bit-rate", "4000000", "/sdcard/flow.mp4"], { stdio: "ignore" });

  await scenario("1 Cold start: splash -> /mini/login, UA, plugins, insets", async (s) => {
    sh(`am force-stop ${PKG}`);
    const started = Date.now();
    sh(`am start -n ${PKG}/.MainActivity`);
    await sleep(700);
    s.shots.push(shot("cold-start-splash"));
    // Серия кадров первых секунд: видно ли где-нибудь «Открываем кабинет…».
    for (let i = 0; i < 4; i++) {
      await sleep(400);
      s.shots.push(shot(`cold-start-burst-${i}`));
    }
    const p = await connect();
    // Как можно раньше после подключения: что уже на экране и откуда пришёл документ.
    s.data.timeline = [];
    for (let i = 0; i < 40; i++) {
      const snap = await p
        .evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0];
          return {
            href: location.href,
            text: (document.body?.innerText ?? "").slice(0, 80).replace(/\s+/g, " "),
            opening: /Открываем кабинет/.test(document.body?.innerText ?? ""),
            navName: nav?.name,
            redirectCount: nav?.redirectCount,
            hasForm: Boolean(document.querySelector("#password, #phone")),
          };
        })
        .catch((e) => ({ err: String(e).slice(0, 80) }));
      s.data.timeline.push({ t: Date.now() - started, ...snap });
      if (snap.hasForm) break;
      await sleep(250);
    }
    await p
      .waitForFunction(() => Boolean(document.querySelector("#password, #phone")) || /Вход в кабинет|Нет связи/.test(document.body?.innerText ?? ""), null, { timeout: 90000 })
      .catch((e) => note(`login form did not appear: ${String(e).slice(0, 120)}; url ${p.url()}`));
    // /mini?src=app сначала показывает «Открываем кабинет…», затем уводит на вход.
    await p.waitForURL((u) => u.pathname.startsWith("/mini/login"), { timeout: 60000 }).catch(() => undefined);
    await p.waitForSelector("#password", { timeout: 60000 }).catch(() => undefined);
    s.data.loginVisibleMs = Date.now() - started;
    await sleep(3000);
    s.shots.push(shot("cold-start-login"));
    const info = await p.evaluate(() => ({
      ua: navigator.userAgent,
      native: Boolean(window.Capacitor?.isNativePlatform?.()),
      platform: window.Capacitor?.getPlatform?.(),
      plugins: Object.keys(window.Capacitor?.Plugins ?? {}).sort(),
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content"),
      text: document.body.innerText.slice(0, 300),
    }));
    s.data.info = info;
    s.data.layout = await layoutProbe(p, "login");
    check(/WeSetupApp\/\d+\.\d+\.\d+ \(android\)/.test(info.ua), `UA without WeSetupApp suffix: ${info.ua}`);
    check(info.native === true, "Capacitor.isNativePlatform() is not true");
    for (const name of ["WebPrint", "App", "AppLauncher", "Filesystem", "Share", "FirebaseMessaging", "SpeechRecognition", "StatusBar"])
      check(info.plugins.includes(name), `plugin ${name} missing (have ${info.plugins.join(",")})`);
    check(/viewport-fit=cover/.test(info.viewport ?? ""), `viewport meta without viewport-fit=cover: ${info.viewport}`);
    check(pathOf(p).startsWith("/mini/login"), `landed on ${p.url()}`);
    check(/Вход в кабинет/.test(info.text), "login heading not visible");
    for (const i of s.data.layout.issues) check(false, i);
    // Новое во 2-м круге: сервер сразу ведёт на вход, без «Открываем кабинет…».
    const opening = s.data.timeline.filter((x) => x.opening);
    check(!opening.length, `«Открываем кабинет…» seen at cold start: ${JSON.stringify(opening[0])}`);
    const firstNav = s.data.timeline.find((x) => x.navName);
    s.data.firstNav = firstNav;
    check(!firstNav || /\/mini\/login/.test(firstNav.href ?? ""), `first document at ${firstNav?.href} (not /mini/login)`);
    // Экран входа не открывает клавиатуру сам и не ставит фокус в поле.
    const focus = await p.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id }));
    const insNow = systemInsets();
    s.data.focusAtStart = focus;
    s.data.imeAtStart = { shown: insNow.imeShown, ime: insNow.ime };
    check(focus.tag !== "INPUT", `login field focused by itself: #${focus.id}`);
    check(!insNow.imeShown, `keyboard opened by itself on login: ime ${JSON.stringify(insNow.ime)}`);
    // Вход — корневой экран: стрелки «Назад» нет.
    s.data.backArrow = await p.evaluate(() =>
      [...document.querySelectorAll('[aria-label="Назад"]')].filter((el) => el.getBoundingClientRect().width > 0).length
    );
    check(s.data.backArrow === 0, `back arrow visible on /mini/login (${s.data.backArrow})`);
    results.coldStartConsole = sh("logcat -d -s Capacitor/Console:*", { timeout: 60000 }).split(/\r?\n/).filter((l) => /Capacitor\/Console/.test(l));
    s.data.coldStartConsole = results.coldStartConsole.slice(0, 30).map((l) => l.slice(0, 300));
    note(`first doc ${firstNav?.navName} -> ${firstNav?.href} redirects=${firstNav?.redirectCount}; focus ${focus.tag}#${focus.id}; ime ${insNow.imeShown}`);
    note(`login visible after ${s.data.loginVisibleMs}ms; env top=${s.data.layout.envTop} cap top=${s.data.layout.capTop} status bar=${JSON.stringify(s.data.layout.insets.statusBar)}`);
  });

  if (MODE !== "full") {
    await scenario("PROD smoke: https://wesetup.ru/mini/login in the release config", async (s) => {
      const p = page;
      s.data.timeline = [];
      for (let i = 0; i < 20 && !p.url().startsWith("https://wesetup.ru/mini/login"); i++) {
        s.data.timeline.push({ t: i * 2, url: p.url(), text: await p.evaluate(() => document.body?.innerText.slice(0, 120)).catch((e) => String(e).slice(0, 80)) });
        await sleep(2000);
      }
      s.data.fetch = await p.evaluate(async () => { try { const r = await fetch("https://wesetup.ru/mini/login", { mode: "no-cors" }); return r.type + " " + r.status; } catch (e) { return String(e); } }).catch((e) => String(e));
      check(p.url().startsWith("https://wesetup.ru/mini/login"), `url ${p.url()}`);
      s.shots.push(shot("prod-login"));
      note(p.url());
    });
  }

  await scenario("13 Keyboard: login fields stay above the keyboard", async (s) => {
    const p = page;
    await p.getByRole("radio", { name: "Почта" }).click();
    await sleep(500);
    await screenTap(p, p.locator("#email"));
    await sleep(2500);
    const ins = systemInsets();
    const geo = await p.evaluate(() => {
      const r = (sel) => {
        const b = document.querySelector(sel)?.getBoundingClientRect();
        return b ? { top: b.top, bottom: b.bottom } : null;
      };
      const submit = [...document.querySelectorAll("button[type=submit]")][0]?.getBoundingClientRect();
      return {
        focused: document.activeElement?.id,
        vv: window.visualViewport ? { h: visualViewport.height, top: visualViewport.offsetTop } : null,
        innerHeight,
        email: r("#email"),
        password: r("#password"),
        submit: submit ? { top: submit.top, bottom: submit.bottom } : null,
        dpr: devicePixelRatio,
      };
    });
    s.shots.push(shot("keyboard-email"));
    const wv = webViewRect();
    s.data = { ins, geo, wv };
    if (!ins.imeShown) note("keyboard frame not reported right after the first tap");
    const imeTop = ins.ime?.y1 ?? null;
    const toScreen = (y) => (wv?.y1 ?? 0) + y * geo.dpr;
    if (imeTop && geo.email) check(toScreen(geo.email.bottom) <= imeTop + 2, `email field hidden by keyboard: field bottom ${Math.round(toScreen(geo.email.bottom))} > keyboard top ${imeTop}`);
    // Пароль и кнопка: переходим в поле пароля, как человек.
    await screenTap(p, p.locator("#password"));
    await sleep(800);
    // Набираем пароль с экранной клавиатуры, как человек (2-й круг: «Войти» над клавиатурой при наборе).
    sh("input text abc123");
    await sleep(1500);
    const geo2 = await p.evaluate(() => {
      const b = document.querySelector("#password")?.getBoundingClientRect();
      const sb = document.querySelector("button[type=submit]")?.getBoundingClientRect();
      return { password: b && { top: b.top, bottom: b.bottom }, submit: sb && { top: sb.top, bottom: sb.bottom }, vv: visualViewport?.height, innerHeight };
    });
    const ins2 = systemInsets();
    s.shots.push(shot("keyboard-password"));
    s.data.geo2 = geo2;
    s.data.ins2 = ins2;
    const imeTop2 = ins2.ime?.y1 ?? null;
    if (imeTop2 && geo2.password) check(toScreen(geo2.password.bottom) <= imeTop2 + 2, `password field hidden by keyboard (${Math.round(toScreen(geo2.password.bottom))} > ${imeTop2})`);
    check(Boolean(imeTop2), `keyboard not shown while typing the password: ${JSON.stringify(ins2.ime)}`);
    if (imeTop2 && geo2.submit) {
      const overlap = Math.round(toScreen(geo2.submit.bottom) - imeTop2);
      s.data.submitOverlapPx = overlap;
      s.data.submitVisible = overlap <= 2;
      check(overlap <= 2, `"Войти" button under the keyboard by ${overlap}px (button bottom ${Math.round(toScreen(geo2.submit.bottom))} > keyboard top ${imeTop2}); innerHeight ${geo2.innerHeight}, vv ${geo2.vv}`);
      note(`"Войти" bottom vs keyboard top: ${overlap}px (round 1: +11px under the keyboard)`);
    }
    s.data.typed = await p.evaluate(() => document.querySelector("#password")?.value?.length ?? 0);
    await p.fill("#password", "");
    note(`innerHeight with keyboard ${geo2.innerHeight} (was ${geo.innerHeight}), ime ${JSON.stringify(ins2.ime)}`);
    key(4); // спрятать клавиатуру
    await sleep(800);
  });

  await scenario("16 Android back on /mini/login -> app minimizes (root screen)", async (s) => {
    const p = page;
    if (!pathOf(p).startsWith("/mini/login")) await goto(p, "/mini/login");
    await p.evaluate(() => document.activeElement?.blur?.());
    await sleep(800);
    if (systemInsets().imeShown) {
      key(4);
      await sleep(800);
    }
    s.data.before = { path: pathOf(p), top: topActivity(), historyLength: await p.evaluate(() => history.length) };
    s.shots.push(shot("login-before-back"));
    key(4);
    await sleep(2500);
    s.data.afterBack = topActivity();
    s.shots.push(shot("login-after-back"));
    check(!/ru\.wesetup\.app/.test(s.data.afterBack), `app still in front after back on /mini/login: ${s.data.afterBack} (path ${await p.evaluate(() => location.pathname).catch(() => "?")})`);
    check(Boolean(appPid()), "app process died after back on /mini/login (should only minimize)");
    bringAppToFront();
    await sleep(2500);
    s.data.afterReturn = pathOf(p);
    s.shots.push(shot("login-returned"));
    check(pathOf(p).startsWith("/mini/login"), `after returning: ${pathOf(p)}`);
  });

  if (MODE !== "full") {
    await consoleScenario();
    await finish(rec);
    return;
  }

  await scenario("2 Login as chef -> home, push explainer, Включить -> OS permission -> allow", async (s) => {
    const p = page;
    await login(p, CHEF);
    s.shots.push(shot("chef-home"));
    s.data.home = pathOf(p);
    const sheet = await p.waitForSelector('[data-testid="push-explainer"]', { timeout: 45000 }).catch(() => null);
    check(Boolean(sheet), "push explainer sheet did not appear");
    await sleep(800);
    s.shots.push(shot("push-explainer"));
    if (!sheet) return;
    await screenTap(p, p.getByTestId("push-explainer-enable"));
    await sleep(2500);
    let nodes = uiNodes();
    const allow = findNode(nodes, /permission_allow_button|^Allow$|Разрешить/);
    s.shots.push(shot("push-os-permission"));
    s.data.permissionUi = uiSummary(nodes);
    if (Number(results.device.sdk) >= 33) check(Boolean(allow), "OS notification permission dialog did not appear");
    if (allow) tapNode(allow);
    await sleep(6000);
    s.shots.push(shot("push-after-allow"));
    check(Boolean(appPid()), "app process died after allowing notifications");
    const fatal = fatalLines();
    check(!fatal.length, `native crash: ${fatal.slice(0, 5).join(" / ")}`);
    const state = await p.evaluate(() => ({
      spinners: [...document.querySelectorAll(".animate-spin")].filter((e) => e.getBoundingClientRect().width > 0).length,
      sheet: Boolean(document.querySelector('[data-testid="push-explainer"]')),
      toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent),
      perm: null,
    }));
    s.data.after = state;
    s.data.permission = sh(`dumpsys package ${PKG} | grep -A1 POST_NOTIFICATIONS | head -4`).trim();
    check(state.spinners === 0, `${state.spinners} spinner(s) still visible after allowing`);
    check(!state.sheet, "explainer sheet still open");
    check(!state.toasts.length, `unexpected toast(s): ${state.toasts.join(" | ")}`);
  });

  const screens = [
    ["home", null],
    ["sections", "/mini/sections"],
    ["cleaning", ids.docs.cleaning ? `/journals/cleaning/documents/${ids.docs.cleaning}` : "/journals/cleaning"],
    [
      "fridges",
      ids.docs.cold_equipment_control
        ? `/journals/cold_equipment_control/documents/${ids.docs.cold_equipment_control}`
        : "/journals/cold_equipment_control",
    ],
    ["reports", "/reports"],
    ["profile", "/mini/me"],
  ];
  let homePath = "/mini";
  for (const theme of ["light", "dark"]) {
    await scenario(`3 Main screens in the shell (${theme} theme, chef)`, async (s) => {
      const p = page;
      await setTheme(p, theme);
      s.data.screens = [];
      for (const [name, url] of screens) {
        if (url) await goto(p, url);
        else {
          await goto(p, "/mini");
          homePath = pathOf(p);
        }
        await sleep(2500);
        const dialogs = await p.evaluate(() => [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map((d) => (d.textContent || "").trim().slice(0, 80)));
        const file = shot(`${theme}-${name}`);
        s.shots.push(file);
        const lay = await layoutProbe(p, name);
        s.data.screens.push({ name, dialogs, url: pathOf(p), heading: lay.heading?.text, issues: lay.issues, capTop: lay.capTop, envTop: lay.envTop, capBottom: lay.capBottom, theme: lay.theme });
        for (const i of lay.issues) check(false, `${name}: ${i}`);
        if (name === "profile") {
          const push = await p.locator('[data-testid="app-push-settings"]').count();
          check(push > 0, "profile: section «Уведомления на этом телефоне» missing");
          if (push) {
            await p.locator('[data-testid="app-push-settings"]').scrollIntoViewIfNeeded();
            await sleep(500);
            s.shots.push(shot(`${theme}-profile-push`));
            s.data.pushSection = await p.locator('[data-testid="app-push-settings"]').innerText();
          }
          await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await sleep(500);
          s.shots.push(shot(`${theme}-profile-bottom`));
          s.data.profileButtons = await buttonsText(p);
        }
      }
    });
  }
  await setTheme(page, "light").catch(() => undefined);

  await scenario("14a Android back: nested page -> back, home -> minimize", async (s) => {
    const p = page;
    await goto(p, homePath);
    await sleep(3000);
    const homeNow = pathOf(p);
    const tab = p.locator('.mini-nav-tab[href="/mini/sections"], a[href="/mini/sections"]').first();
    if (await tab.count()) await tab.click();
    else await p.evaluate(() => { location.href = "/mini/sections"; });
    await p.waitForURL("**/mini/sections**", { timeout: 60000 });
    await settle(p);
    s.shots.push(shot("back-before"));
    key(4);
    // Медленный эмулятор CI: переход «назад» может занять несколько секунд.
    await p.waitForURL((u) => u.pathname + u.search === homeNow, { timeout: 15000 }).catch(() => undefined);
    await sleep(1500);
    s.data.afterBack = pathOf(p);
    s.shots.push(shot("back-after"));
    check(pathOf(p) === homeNow, `back from /mini/sections went to ${pathOf(p)} (expected ${homeNow})`);
    s.data.beforeHomeBack = await p.evaluate(() => ({
      path: location.pathname,
      historyLength: history.length,
      openDialogs: [...document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')].map((d) => ({
        visible: d.getBoundingClientRect().width > 0,
        text: (d.textContent || "").trim().slice(0, 80),
      })),
    }));
    key(4);
    await sleep(2500);
    s.data.afterBackOnHome = topActivity();
    if (/ru\.wesetup\.app/.test(s.data.afterBackOnHome)) {
      s.data.afterFirstHomeBack = await p.evaluate(() => location.pathname).catch(() => "?");
      s.shots.push(shot("back-on-home-first-press"));
      key(4);
      await sleep(2500);
      s.data.afterSecondHomeBack = topActivity();
      if (!/ru\.wesetup\.app/.test(s.data.afterSecondHomeBack)) note("home back minimized only on the SECOND press");
    }
    s.shots.push(shot("back-on-home"));
    check(!/ru\.wesetup\.app/.test(s.data.afterBackOnHome), `app still in front after back on home: ${s.data.afterBackOnHome}`);
    check(Boolean(appPid()), "app process died after back on home (should only minimize)");
    bringAppToFront();
    await sleep(2500);
    s.data.afterReturn = pathOf(p);
    s.shots.push(shot("back-returned"));
    check(pathOf(p) === homeNow, `after returning to the app: ${pathOf(p)}`);
  });

  await scenario("10 Offline: relaunch without network -> «Нет связи» -> network on -> «Повторить»", async (s) => {
    // Копия сайта идёт через adb reverse, мимо сети телефона: снимаем и его.
    adb(["reverse", "--remove", "tcp:3000"]);
    sh("cmd connectivity airplane-mode enable");
    sh("svc wifi disable");
    sh("svc data disable");
    await sleep(3000);
    sh(`am force-stop ${PKG}`);
    sh(`am start -n ${PKG}/.MainActivity`);
    await sleep(6000);
    const p = await connect();
    await sleep(4000);
    s.data.offlineUrl = p.url();
    s.data.offlineText = await p.evaluate(() => document.body.innerText.slice(0, 200)).catch((e) => String(e));
    s.shots.push(shot("offline"));
    check(/Нет связи с интернетом/.test(s.data.offlineText), `offline page not shown: ${s.data.offlineUrl} «${s.data.offlineText}»`);
    // «Повторить» без сети — остаёмся на экране, без зависания
    sh("cmd connectivity airplane-mode disable");
    adb(["reverse", "tcp:3000", "tcp:3000"]);
    sh("svc wifi enable");
    sh("svc data enable");
    // Сначала без нажатия: экран должен сам открыть сайт, когда сеть вернулась.
    let autoRecovered = false;
    for (let i = 0; i < 12 && !autoRecovered; i++) {
      await sleep(2500);
      autoRecovered = /^https?:\/\/(127\.0\.0\.1|wesetup\.ru)/.test(p.url());
    }
    s.data.autoRecovered = autoRecovered;
    note(autoRecovered ? "recovered by itself after the network returned" : "did not recover by itself; pressing «Повторить»");
    const retry = p.locator("#retry");
    if (!autoRecovered && (await retry.count().catch(() => 0))) await screenTap(p, retry);
    let p2 = p;
    await sleep(8000);
    try {
      await p2.waitForURL((u) => u.origin === ORIGIN, { timeout: 30000 });
    } catch {
      p2 = await connect();
    }
    await settle(p2, 3000);
    s.data.afterRetry = p2.url();
    s.shots.push(shot("offline-retry"));
    // Вошедший человек попадает на свою главную (/control-board, /mini/today…).
    check(p2.url().startsWith(ORIGIN) && !/offline\.html/.test(p2.url()), `after «Повторить»: ${p2.url()}`);
  });

  await scenario("4 Print from a journal document -> system print UI", async (s) => {
    const p = page;
    await goto(p, screens[2][1]);
    let btn = p.getByRole("button", { name: /печат/i }).first();
    if (!(await btn.count())) btn = p.locator('[aria-label*="ечат"], [title*="ечат"]').first();
    if (!(await btn.count())) {
      btn = p.locator("button:has(svg.lucide-printer)").first();
      if (await btn.count()) s.data.printButtonName = await btn.evaluate((b) => b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent?.trim() || "");
    }
    if (!(await btn.count())) {
      s.data.buttons = await buttonsText(p);
      check(false, `no «Печать» button on ${pathOf(p)}`);
      s.shots.push(shot("print-no-button"));
      return;
    }
    await btn.click();
    await sleep(1500);
    // Может открыться меню печати сайта (варианты) — выбираем первый пункт.
    const menuItem = p.getByRole("menuitem").first();
    if (await menuItem.count().catch(() => 0)) {
      s.data.menu = await p.getByRole("menuitem").allInnerTexts();
      await menuItem.click();
    }
    await sleep(5000);
    const nodes = uiNodes();
    s.shots.push(shot("print-system-ui"));
    s.data.ui = uiSummary(nodes);
    const spooler = nodes.some((n) => /printspooler/.test(n.package ?? ""));
    const shareSheet = nodes.some((n) => /intentresolver|^android$/.test(n.package ?? ""));
    s.data.outcome = spooler ? "print dialog" : shareSheet ? "share sheet" : "nothing";
    s.data.shareTargets = nodes.filter((n) => /intentresolver|^android$/.test(n.package ?? "")).map((n) => n.text).filter(Boolean);
    check(spooler, `system print UI not shown — ${s.data.outcome} (top: ${topActivity().split(String.fromCharCode(10))[0]}; toast: ${await toastText(p)})`);
    key(4);
    await sleep(2500);
    if (nodes.some((n) => /printspooler/.test(n.package ?? "")) && /printspooler/.test(topActivity())) key(4);
    s.shots.push(shot("print-dismissed"));
    check(/ru\.wesetup\.app/.test(topActivity()), `app not back after dismissing print: ${topActivity()}`);
  });

  await scenario("5 Report download -> share sheet with a file name", async (s) => {
    const p = page;
    await goto(p, "/reports");
    s.data.buttons = await buttonsText(p);
    let target = p.getByRole("button", { name: /Excel|PDF|Скачать/i }).first();
    if (!(await target.count())) target = p.getByRole("link", { name: /Excel|PDF|Скачать/i }).first();
    if (!(await target.count())) {
      check(false, "no Excel/PDF/Скачать control on /reports");
      s.shots.push(shot("reports-no-download"));
      return;
    }
    s.data.clicked = await target.innerText();
    await target.click();
    let nodes = [];
    for (let i = 0; i < 10; i++) {
      await sleep(2000);
      nodes = uiNodes();
      if (nodes.some((n) => /intentresolver|^android$/.test(n.package ?? "") && n.package !== PKG)) break;
    }
    s.shots.push(shot("share-sheet"));
    s.data.ui = uiSummary(nodes);
    const sheet = nodes.some((n) => /intentresolver|^android$/.test(n.package ?? ""));
    check(sheet, `share sheet not shown (top ${topActivity()}, toast «${await toastText(p)}»)`);
    const fileName = nodes.map((n) => n.text).find((t) => /\.(xlsx|pdf|csv|zip|docx)\b/i.test(t ?? ""));
    s.data.fileName = fileName ?? null;
    if (sheet) check(Boolean(fileName), "share sheet shows no file name");
    if (fileName) check(!/^(WeSetup|download|file)\.\w+$/i.test(fileName) , `generic file name ${fileName}`);
    key(4);
    await sleep(2000);
    s.shots.push(shot("share-dismissed"));
    check(/ru\.wesetup\.app/.test(topActivity()), `app not in front after closing the share sheet: ${topActivity()}`);
    s.data.toastAfter = await toastText(p);
    check(!/Не удалось/.test(s.data.toastAfter), `error toast after closing share sheet: ${s.data.toastAfter}`);
  });

  await scenario("6 External links: tel:, mailto:, foreign https, internal target=_blank", async (s) => {
    const p = page;
    await goto(p, "/mini/sections");
    const addLink = (id, href, target) =>
      p.evaluate(
        ([id, href, target]) => {
          document.getElementById(id)?.remove();
          const a = document.createElement("a");
          a.id = id;
          a.href = href;
          if (target) a.target = target;
          a.textContent = id;
          a.style.cssText = "position:fixed;left:16px;top:45%;z-index:2147483647;padding:24px;background:#ff0;color:#000;font-size:20px";
          document.body.appendChild(a);
        },
        [id, href, target]
      );
    const outcomes = {};
    for (const [id, href] of [
      ["e2e-tel", "tel:+79990001122"],
      ["e2e-mailto", "mailto:support@example.com"],
      ["e2e-https", "https://example.com/"],
    ]) {
      await addLink(id, href);
      await screenTap(p, p.locator(`#${id}`));
      await sleep(4000);
      const top = topActivity();
      const nodes = uiNodes();
      outcomes[id] = { top: top.split("\n")[0], ui: uiSummary(nodes).slice(0, 8), url: pathOf(p), toast: await toastText(p) };
      s.shots.push(shot(`link-${id}`));
      bringAppToFront();
      await sleep(2000);
      check(Boolean(appPid()), `app died after ${id}`);
      check(pathOf(p).startsWith("/mini/sections"), `${id}: app left its page (${pathOf(p)})`);
      await p.evaluate((id) => document.getElementById(id)?.remove(), id).catch(() => undefined);
    }
    s.data.outcomes = outcomes;
    check(!/ru\.wesetup\.app/.test(outcomes["e2e-tel"].top), `tel: not handed to the dialer (${outcomes["e2e-tel"].top})`);
    check(!/ru\.wesetup\.app/.test(outcomes["e2e-https"].top), `https link not handed to a browser (${outcomes["e2e-https"].top})`);
    if (/ru\.wesetup\.app/.test(outcomes["e2e-mailto"].top)) note(`mailto: nothing opened (no mail app on the emulator?), toast «${outcomes["e2e-mailto"].toast}»`);
    await addLink("e2e-blank", "/mini/me", "_blank");
    await p.locator("#e2e-blank").click();
    await p.waitForURL("**/mini/me", { timeout: 30000 }).catch(() => undefined);
    await settle(p);
    s.shots.push(shot("link-internal-blank"));
    check(pathOf(p).startsWith("/mini/me") && /ru\.wesetup\.app/.test(topActivity()), `internal _blank: ${pathOf(p)} / ${topActivity()}`);
  });

  await scenario("7 Photo input (camera icon) -> camera/gallery", async (s) => {
    const p = page;
    const candidates = [
      ...Object.entries(ids.docs)
        .filter(([code]) => /incoming|acceptance|fryer|finished|metal|writeoff|cleaning|med_book/.test(code))
        .map(([code, id]) => `/journals/${code}/documents/${id}`),
      ...(ids.photoJournals ?? []).slice(0, 3).map((c) => `/journals/${c}/new`),
    ];
    s.data.tried = [];
    let found = null;
    if (ids.docs.cold_equipment_control) candidates.unshift(`/journals/cold_equipment_control/documents/${ids.docs.cold_equipment_control}`);
    for (const url of candidates) {
      await goto(p, url).catch(() => undefined);
      const info = await p.evaluate(() => {
        const ocr = document.querySelector('[data-testid="display-ocr-button"]');
        if (ocr) {
          ocr.setAttribute("data-e2e-photo", "1");
          const input = ocr.parentElement?.querySelector('input[type="file"]');
          return { capture: input?.getAttribute("capture") ?? null, accept: input?.accept ?? null, trigger: ocr.getAttribute("aria-label") };
        }
        const inputs = [...document.querySelectorAll('input[type="file"]')].filter((i) => /image/.test(i.accept || ""));
        for (const input of inputs) {
          let trigger =
            input.closest("label") ||
            (input.id && document.querySelector(`label[for="${input.id}"]`)) ||
            input.parentElement?.querySelector("button") ||
            input.parentElement?.parentElement?.querySelector("button");
          if (trigger && trigger.getBoundingClientRect().width > 0) {
            trigger.setAttribute("data-e2e-photo", "1");
            return { capture: input.getAttribute("capture"), accept: input.accept, trigger: trigger.textContent?.trim().slice(0, 40) };
          }
        }
        return { inputs: inputs.length };
      });
      s.data.tried.push({ url, info });
      if (info.trigger !== undefined) {
        found = info;
        break;
      }
    }
    if (!found) {
      check(false, "no visible photo control found on the tried pages");
      s.shots.push(shot("photo-not-found"));
      return;
    }
    s.data.found = found;
    await p.locator("[data-e2e-photo]").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(800);
    await screenTap(p, p.locator("[data-e2e-photo]").first());
    await sleep(3000);
    let nodes = uiNodes();
    s.shots.push(shot("photo-first-system-ui"));
    s.data.ui1 = uiSummary(nodes);
    const allow = findNode(nodes, /permission_allow_foreground_only_button|permission_allow_one_time_button|permission_allow_button|While using the app|Only this time/);
    if (allow) {
      s.data.cameraPermission = true;
      tapNode(allow);
      await sleep(3500);
      nodes = uiNodes();
      s.shots.push(shot("photo-after-camera-permission"));
      s.data.ui2 = uiSummary(nodes);
    }
    const top = topActivity();
    s.data.top = top;
    const pkgs = [...new Set(nodes.map((n) => n.package))];
    s.data.packages = pkgs;
    check(pkgs.some((x) => x && x !== PKG && x !== "com.android.systemui"), `no camera/chooser opened (${pkgs.join(",")}; ${top})`);
    for (let i = 0; i < 3 && !/ru\.wesetup\.app/.test(topActivity()); i++) {
      key(4);
      await sleep(1500);
    }
    s.shots.push(shot("photo-dismissed"));
    check(/ru\.wesetup\.app/.test(topActivity()), `app not back after dismissing the photo UI: ${topActivity()}`);
    check(Boolean(appPid()), "app died after photo UI");
    s.data.toast = await toastText(p);
  });

  await scenario("8 Voice input: fridge journal mic and text-field mic", async (s) => {
    const p = page;
    s.data.cases = [];
    const targets = [
      [screens[3][1], 'button[aria-label="Голосовой ввод"]'],
      ...(ids.textJournals ?? []).slice(0, 4).map((c) => [`/journals/${c}/new`, 'button[title="Голосовой ввод"]']),
    ];
    let tested = 0;
    for (const [url, sel] of targets) {
      if (tested >= 2) break;
      await goto(p, url).catch(() => undefined);
      const btn = p.locator(sel).first();
      // Кнопка микрофона появляется после гидратации (проверка Web Speech).
      await btn.waitFor({ state: "attached", timeout: 20000 }).catch(() => undefined);
      if (!(await btn.count())) {
        s.data.cases.push({ url, found: false });
        continue;
      }
      tested += 1;
      await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await sleep(800);
      await screenTap(p, btn);
      const c = { url, found: true, steps: [] };
      for (let i = 0; i < 4; i++) {
        await sleep(3000);
        const nodes = uiNodes();
        const pk = [...new Set(nodes.map((n) => n.package))].filter(Boolean);
        const allow = findNode(nodes, /permission_allow_foreground_only_button|permission_allow_one_time_button|permission_allow_button/);
        c.steps.push({ pk, ui: uiSummary(nodes).slice(0, 10) });
        s.shots.push(shot(`voice-${tested}-step${i}`));
        if (allow) {
          tapNode(allow);
          continue;
        }
        if (pk.includes(PKG) && pk.length <= 2) break;
        // Системное окно распознавания (Google) — закрываем.
        key(4);
      }
      await sleep(3000);
      await btn.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => undefined);
      await sleep(800);
      c.near = await btn.evaluate((el) => (el.parentElement?.parentElement?.textContent || "").trim().slice(0, 300)).catch((e) => String(e));
      c.page = await p.evaluate(() => ({
        toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent?.trim()),
        texts: [...document.querySelectorAll("[role=alert]")].map((t) => t.textContent?.trim()).filter(Boolean).slice(0, 5),
        pulsing: [...document.querySelectorAll(".animate-pulse")].filter((e) => e.getBoundingClientRect().width > 0).length,
      }));
      s.shots.push(shot(`voice-${tested}-result`));
      s.data.cases.push(c);
      const msgs = [...c.page.toasts, ...c.page.texts, c.near].join(" | ");
      check(c.page.pulsing === 0, `${url}: mic still «listening» (hang)`);
      check(!/[a-z]{4,}/i.test(msgs.replace(/WeSetup/g, "")) , `${url}: technical/English text shown: «${msgs}»`);
      check(!/браузер/i.test(msgs), `${url}: message talks about the browser inside the app: «${msgs}»`);
      note(`${url}: «${msgs || "no message"}»`);
      for (let i = 0; i < 2 && !/ru\.wesetup\.app/.test(topActivity()); i++) {
        key(4);
        await sleep(1000);
      }
    }
    check(tested > 0, "no mic button found");
  });

  await scenario("9 Deep links: warm (appUrlOpen) and cold (getLaunchUrl)", async (s) => {
    const p = page;
    await goto(p, "/mini/sections");
    sh(`am start -W -a android.intent.action.VIEW -d "https://wesetup.ru/mini/me" ${PKG}`);
    await p.waitForURL("**/mini/me**", { timeout: 30000 }).catch(() => undefined);
    await settle(p);
    s.data.warm = p.url();
    s.shots.push(shot("deeplink-warm"));
    check(p.url().startsWith(`${ORIGIN}/mini/me`), `warm deep link: ${p.url()}`);
    sh(`am force-stop ${PKG}`);
    await sleep(1500);
    sh(`am start -W -a android.intent.action.VIEW -d "https://wesetup.ru/journals/cleaning" ${PKG}`);
    const p2 = await connect();
    await p2.waitForURL("**/journals/cleaning**", { timeout: 60000 }).catch(() => undefined);
    await settle(p2, 2500);
    s.data.cold = p2.url();
    s.shots.push(shot("deeplink-cold"));
    check(p2.url().startsWith(`${ORIGIN}/journals/cleaning`), `cold deep link ended at ${p2.url()}`);
    s.data.fatal = fatalLines();
    note("push notification tap not testable without Firebase in the test build (same handler as the warm link)");
  });

  await scenario("11 Logout from profile -> login; log in again (cook) -> «Сегодня»", async (s) => {
    const p = page;
    await goto(p, "/mini/me");
    await p.getByRole("button", { name: /Выйти/ }).first().click();
    await sleep(800);
    s.shots.push(shot("logout-confirm"));
    await p.getByRole("alertdialog").getByRole("button", { name: "Выйти" }).or(p.getByRole("dialog").getByRole("button", { name: "Выйти" })).first().click();
    await p.waitForURL("**/mini/login**", { timeout: 60000 });
    await settle(p);
    s.shots.push(shot("logout-login-screen"));
    check(pathOf(p).startsWith("/mini/login"), `after logout: ${pathOf(p)}`);
    await login(p, COOK);
    s.data.cookHome = pathOf(p);
    await sleep(2000);
    // лист push у повара — «Не сейчас»
    const later = p.getByTestId("push-explainer-later");
    if (await later.count().catch(() => 0)) {
      s.data.cookSawExplainer = true;
      await later.click().catch(() => undefined);
    }
    for (const theme of ["light", "dark"]) {
      await setTheme(p, theme);
      await goto(p, "/mini/today");
      const lay = await layoutProbe(p, `today-${theme}`);
      s.shots.push(shot(`cook-today-${theme}`));
      s.data[`today_${theme}`] = { url: pathOf(p), heading: lay.heading?.text, issues: lay.issues };
      for (const i of lay.issues) check(false, `today ${theme}: ${i}`);
    }
    await setTheme(p, "light");
    await goto(p, "/mini/me");
    await p.getByRole("button", { name: /Выйти/ }).first().click();
    await sleep(600);
    await p.getByRole("alertdialog").getByRole("button", { name: "Выйти" }).or(p.getByRole("dialog").getByRole("button", { name: "Выйти" })).first().click();
    await p.waitForURL("**/mini/login**", { timeout: 60000 });
  });

  await scenario("12 Delete account (throwaway cook) -> «Аккаунт удалён», login fails", async (s) => {
    const p = page;
    await login(p, THROWAWAY);
    await sleep(1500);
    const later = p.getByTestId("push-explainer-later");
    if (await later.count().catch(() => 0)) await later.click().catch(() => undefined);
    await goto(p, "/mini/me");
    await p.getByTestId("me-delete-account").scrollIntoViewIfNeeded();
    await p.getByTestId("me-delete-account").click();
    await sleep(1000);
    s.shots.push(shot("delete-dialog"));
    const dialog = p.getByRole("alertdialog").or(p.getByRole("dialog")).first();
    await dialog.locator("input").first().fill("УДАЛИТЬ");
    await sleep(400);
    s.shots.push(shot("delete-typed"));
    await dialog.getByRole("button", { name: "Удалить аккаунт" }).click();
    await p.waitForURL("**/mini/login?deleted=1**", { timeout: 60000 });
    await settle(p);
    s.shots.push(shot("delete-done"));
    check(await p.getByTestId("mini-login-account-deleted").isVisible(), "«Аккаунт удалён» not shown");
    await p.getByRole("radio", { name: "Почта" }).click();
    await p.fill("#email", THROWAWAY);
    await p.fill("#password", PASSWORD);
    await p.getByRole("button", { name: "Войти", exact: true }).click();
    await sleep(5000);
    s.shots.push(shot("delete-login-again"));
    s.data.after = { url: pathOf(p), alert: await p.locator("[role=alert]").allInnerTexts().catch(() => []) };
    check(pathOf(p).startsWith("/mini/login"), `deleted account could log in: ${pathOf(p)}`);
  });

  await consoleScenario();
  await finish(rec);
}

/** Ошибки React (#418 гидратация и т.п.) и прочие ошибки страницы в WebView за весь прогон. */
async function consoleScenario() {
  await scenario("17 WebView console: no React errors (#418 etc.) at cold start and during the flow", async (s) => {
    const reactRe = /Minified React error|react\.dev\/errors|#41[5-9]|#42[0-9]|[Hh]ydrat/;
    // Capacitor пишет консоль WebView в logcat с самого запуска (до подключения Playwright).
    const lc = sh("logcat -d -s Capacitor/Console:*", { timeout: 60000 }).split(/\r?\n/).filter((l) => /Capacitor\/Console/.test(l));
    const lcAll = [...new Set([...(results.coldStartConsole ?? []), ...lc])];
    const lcErrors = lcAll.filter((l) => /\sE\s|^E\/|error/i.test(l));
    const pwErrors = results.console.filter((c) => c.type === "error" || c.type === "pageerror");
    s.data.logcatConsoleLines = lcAll.length;
    s.data.logcatErrors = lcErrors.slice(0, 40).map((l) => l.slice(0, 400));
    s.data.playwrightErrors = pwErrors.slice(0, 40);
    const reactLc = lcErrors.filter((l) => reactRe.test(l));
    const reactPw = pwErrors.filter((c) => reactRe.test(c.text));
    s.data.react = { logcat: reactLc.slice(0, 10), playwright: reactPw.slice(0, 10) };
    check(!reactLc.length && !reactPw.length, `React errors: ${[...reactLc.slice(0, 2), ...reactPw.slice(0, 2).map((c) => `${c.at}: ${c.text}`)].join(" / ").slice(0, 600)}`);
    note(`logcat console lines ${lcAll.length}, errors ${lcErrors.length}; playwright errors ${pwErrors.length}`);
  });
}

async function finish(rec) {
  try {
    rec.kill("SIGINT");
  } catch {}
  sh("pkill -INT screenrecord");
  await sleep(3000);
  try {
    execFileSync("adb", ["pull", "/sdcard/flow.mp4", path.join(OUT, "flow.mp4")], { timeout: 60000 });
  } catch (e) {
    log("no video", e.message);
  }
  fs.writeFileSync(path.join(OUT, "logcat.txt"), sh("logcat -d", { timeout: 60000 }));
  fs.writeFileSync(path.join(OUT, "logcat-crash.txt"), sh("logcat -d -b crash"));
  results.fatal = fatalLines();
  results.finishedAt = new Date().toISOString();
  save();
  const failed = results.scenarios.filter((s) => !s.ok);
  log(`DONE: ${results.scenarios.length - failed.length}/${results.scenarios.length} passed`);
  await device?.close().catch(() => undefined);
}

main()
  .catch((e) => {
    results.fatalError = String(e?.stack || e);
    save();
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 2000));
