// Замер морганий по кадрам: тема, «Что нового», пустые экраны без скелетона, сдвиги вёрстки.
//
// Запуск (сервер уже поднят, посев сделан seed.cjs):
//   node .agent/tasks/site-flicker-2026-09/e2e/flicker-probe.cjs --label before
//   node ... --label after --viewports desk --configs own-dark/db-light --scenarios load,nav
//
// Что пишет: d:/wt/tmp-flicker/<label>/results.json (+ frames/<run>/ для отмеченных прогонов).
//
// Прод (замер «после» выката), без доступа к базе — `--remote`:
//   PROBE_EMAIL=... PROBE_PASSWORD=... node flicker-probe.cjs --remote --base https://wesetup.ru \
//     --label after-prod --journal hygiene --doc <id документа> [--out <папка>]
//   Аккаунт — руководитель своей тестовой организации. Тема профиля и «Что нового» меняются
//   через API этого же аккаунта (/api/me/theme, /api/me/whats-new) и в конце возвращаются.
//   Вход с формы ограничен 5 попытками на почту за 5 минут — сценарий «вход» гоняется только для
//   `--login-configs` (по умолчанию own-dark/db-light).
//
// Как ловим:
//  • журнал DOM на каждом кадре — requestAnimationFrame срабатывает прямо перед отрисовкой кадра,
//    поэтому запись = то, что сейчас будет нарисовано: data-app-theme у .app-shell, фон, окно
//    «Что нового», скелетон (aria-busy), объём содержимого страницы;
//  • кадры CDP `Page.startScreencast` — что реально нарисовано: яркость полей страницы
//    (светлая/тёмная), однородность области под шапкой (пустой экран);
//  • PerformanceObserver('layout-shift') — сдвиги вёрстки.
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const WT = "d:/wt/flicker";
const req = createRequire(path.join(WT, "package.json"));
const { chromium, request } = req("playwright-core");
const { createCanvas, loadImage } = req("@napi-rs/canvas");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const REMOTE = process.argv.includes("--remote");
const LABEL = arg("label", "run");
const BASE = arg("base", "http://localhost:3197");
const OUT = path.join(arg("out", "d:/wt/tmp-flicker"), LABEL);
const SEED = REMOTE
  ? {
      owner: process.env.PROBE_EMAIL,
      password: process.env.PROBE_PASSWORD,
      userId: null,
      journalCode: arg("journal", "hygiene"),
      docId: arg("doc", ""),
      pool: [],
    }
  : JSON.parse(fs.readFileSync("d:/wt/tmp-flicker/seed.json", "utf8"));
if (REMOTE && (!SEED.owner || !SEED.password)) {
  console.error("--remote: нужны PROBE_EMAIL и PROBE_PASSWORD");
  process.exit(2);
}
const LOGIN_CONFIGS = new Set(arg("login-configs", "own-dark/db-light").split(","));
const DB = "postgresql://postgres:postgres@localhost:5432/wesetup_wt_flicker?sslmode=disable";
const CHROME = arg(
  "chrome",
  path.join(process.env.LOCALAPPDATA || "", "ms-playwright/chromium-1232/chrome-win64/chrome.exe"),
);
const WINDOW_MS = Number(arg("window", "1500")); // окно после перехода, в котором ищем моргания
const SETTLE_MS = Number(arg("settle", "2500")); // сколько ждать после перехода до снятия журнала
const FRAMES = arg("frames", "flagged"); // none | flagged | all

const VIEWPORTS = {
  phone: { id: "phone", width: 390, height: 844, isMobile: true, hasTouch: true },
  desk: { id: "desk", width: 1280, height: 800, isMobile: false, hasTouch: false },
};

// Час «ночью» для смены по времени суток: подбираем часовой пояс Etc/GMT±N, где сейчас 23 ч.
function nightTimezone() {
  const utcHour = new Date().getUTCHours();
  let offset = 23 - utcHour; // локальный = UTC + offset
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  // Etc/GMT-3 = UTC+3 (знак наоборот).
  return offset === 0 ? "Etc/GMT" : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

// Конфигурации темы: что выбрал человек на этом устройстве (localStorage), тема системы,
// и что лежит в профиле (User.themePreference) — с другого устройства или с прошлого раза.
const CONFIGS = {
  "own-light": { mode: "light", scheme: "light", db: "light" },
  "own-dark": { mode: "dark", scheme: "light", db: "dark" },
  "own-light/db-dark": { mode: "light", scheme: "light", db: "dark" },
  "own-dark/db-light": { mode: "dark", scheme: "light", db: "light" },
  "sys-dark/db-light": { mode: "system", scheme: "dark", db: "light" },
  "sys-light/db-dark": { mode: "system", scheme: "light", db: "dark" },
  "auto-night/db-light": { mode: "light", auto: true, scheme: "light", db: "light", tz: nightTimezone() },
};
function expectedTheme(cfg) {
  if (cfg.auto) return "dark"; // часовой пояс подобран так, что сейчас ночь
  return cfg.mode === "system" ? cfg.scheme : cfg.mode;
}

const P = {
  dashboard: "/dashboard",
  journals: "/journals",
  journal: `/journals/${SEED.journalCode}`,
  document: `/journals/${SEED.journalCode}/documents/${SEED.docId}`,
  settings: "/settings",
  balance: "/settings/balance",
};
// Без документа (прод без --doc) — цепочка без него.
const PAGE_KEYS = ["dashboard", "journals", "journal", "document", "settings", "balance"].filter(
  (key) => key !== "document" || SEED.docId,
);
const LOAD_PAGES = PAGE_KEYS;
const NAV_CHAIN = PAGE_KEYS;

const VIEWPORT_IDS = arg("viewports", "phone,desk").split(",");
const CONFIG_IDS = arg("configs", Object.keys(CONFIGS).join(",")).split(",");
const SCENARIOS = new Set(arg("scenarios", "load,nav,refresh,login,logout,mini,wn").split(","));
// Прогоны, для которых сохраняем кадры на диск (доказательства «до/после»).
const FLAG = new Set(
  arg(
    "flag",
    [
      "desk|own-dark/db-light|load:dashboard",
      "phone|sys-dark/db-light|load:journals",
      "desk|own-dark/db-light|login",
      "desk|wn|load:dashboard",
      "phone|wn|load:dashboard",
      "desk|own-light|nav:settings>balance",
      "phone|own-light|nav:settings>balance",
      "desk|own-dark/db-light|refresh:dashboard",
    ].join(","),
  ).split(","),
);

async function sql(text, params = []) {
  const { Client } = req("pg");
  const c = new Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
}

// --remote: настройки профиля — через API того же аккаунта (сессия владельца замера).
let API = null;
async function api(method, url, data) {
  if (!API) {
    API = await request.newContext({ baseURL: BASE, storageState: { cookies: SESSION_COOKIES, origins: [] } });
  }
  const res = method === "GET" ? await API.get(url) : await API.post(url, { data });
  if (!res.ok()) throw new Error(`${method} ${url} → ${res.status()}`);
  return res.json().catch(() => null);
}

// ---------------------------------------------------------------- in-page probe
function initProbe(cfg) {
  // Настройки устройства — один раз на контекст (иначе перетирали бы то, что пишет сайт).
  try {
    if (!localStorage.getItem("__probe_seeded")) {
      localStorage.setItem("__probe_seeded", "1");
      if (cfg.mode) localStorage.setItem("wesetup-theme-mode", cfg.mode);
      localStorage.setItem("wesetup-theme-auto-schedule", cfg.auto ? "1" : "0");
      if (cfg.effective) localStorage.setItem("wesetup-app-theme", cfg.effective);
      if (cfg.whatsNewSeen !== undefined) {
        if (cfg.whatsNewSeen === null) localStorage.removeItem("wesetup.last-seen-build-sha");
        else localStorage.setItem("wesetup.last-seen-build-sha", cfg.whatsNewSeen);
      }
    }
  } catch {}
  const probe = {
    origin: performance.timeOrigin,
    samples: [],
    shifts: [],
    marks: [],
    reset() {
      this.samples = [];
      this.shifts = [];
      this.marks = [];
    },
    dump() {
      return { origin: this.origin, samples: this.samples, shifts: this.shifts, marks: this.marks, now: performance.now() };
    },
  };
  window.__probe = probe;
  const lum = (css) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(css || "");
    if (!m) return null;
    if (m[4] !== undefined && Number(m[4]) === 0) return null; // прозрачный
    return Math.round(0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]);
  };
  function contentLength(main) {
    if (!main) return -1;
    let n = main.textContent.length;
    for (const nav of main.querySelectorAll("nav")) n -= nav.textContent.length;
    return n;
  }
  function snap() {
    try {
      const shell = document.querySelector(".app-shell:not(body)");
      const body = document.body;
      const main = document.querySelector("main");
      const shellBg = shell ? lum(getComputedStyle(shell).backgroundColor) : null;
      const bodyBg = body ? lum(getComputedStyle(body).backgroundColor) : null;
      const busyEl = document.querySelector('main [aria-busy="true"], [aria-busy="true"][data-page-skeleton]');
      const skLabel = busyEl
        ? ((busyEl.querySelector(".sr-only") || {}).textContent || "busy").slice(0, 40) +
          (busyEl.getAttribute("data-page-skeleton") ? `#${busyEl.getAttribute("data-page-skeleton")}` : "")
        : null;
      probe.samples.push({
        sk: skLabel,
        t: Math.round(performance.now()),
        p: location.pathname,
        th: shell ? shell.getAttribute("data-app-theme") : null,
        bth: body ? body.getAttribute("data-app-theme") : null,
        sbg: shellBg,
        bbg: bodyBg,
        wn: Boolean(document.querySelector('[aria-labelledby="whats-new-title"]')),
        busy: Boolean(document.querySelector('main [aria-busy="true"], [aria-busy="true"][data-page-skeleton]')),
        h1: Boolean(main && main.querySelector("h1")),
        ml: contentLength(main),
        ready: document.readyState,
      });
    } catch {}
    requestAnimationFrame(snap);
  }
  requestAnimationFrame(snap);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const sources = (e.sources || []).slice(0, 3).map((s) => {
          const n = s.node;
          const desc = n && n.nodeType === 1
            ? `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}.${String(n.className || "").split(/\s+/).slice(0, 3).join(".")} «${(n.textContent || "").trim().slice(0, 40)}»`
            : n ? `#${n.nodeName}` : "?";
          return { node: desc, dy: Math.round(s.currentRect.y - s.previousRect.y), h: Math.round(s.currentRect.height) };
        });
        probe.shifts.push({ t: Math.round(e.startTime), v: e.value, input: e.hadRecentInput, sources });
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
  // Значок dev-сервера — не часть продукта.
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.head.appendChild(style);
  });
}

// ---------------------------------------------------------------- frames
async function analyzeFrame(b64, vp) {
  const img = await loadImage(Buffer.from(b64, "base64"));
  const W = img.width;
  const H = img.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;
  const L = (x, y) => {
    const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  const scale = W / vp.width;
  // Поля страницы: слева и справа от контента (px-4 на телефоне, px-8 на компьютере).
  const gx = Math.max(1, Math.round((vp.width <= 500 ? 6 : 12) * scale));
  const gutter = [];
  for (const fy of [0.3, 0.42, 0.54, 0.66, 0.78, 0.9]) {
    gutter.push(L(gx, Math.round(H * fy)), L(W - 1 - gx, Math.round(H * fy)));
  }
  gutter.sort((a, b) => a - b);
  const gutterMedian = gutter[Math.floor(gutter.length / 2)];
  // Однородность области под шапкой: сетка 24×24.
  const top = Math.round(H * 0.14);
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let gy = 0; gy < 24; gy++) {
    for (let gxi = 0; gxi < 24; gxi++) {
      const x = Math.round(((gxi + 0.5) / 24) * W);
      const y = top + Math.round(((gy + 0.5) / 24) * (H - top));
      const v = L(x, y);
      sum += v;
      sum2 += v * v;
      n++;
    }
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return {
    gutter: Math.round(gutterMedian),
    tone: gutterMedian > 140 ? "light" : gutterMedian < 100 ? "dark" : "mixed",
    mean: Math.round(mean),
    std: Math.round(std * 10) / 10,
  };
}

// ---------------------------------------------------------------- analysis
function classifyBg(l) {
  if (l === null || l === undefined) return null;
  return l > 140 ? "light" : l < 100 ? "dark" : "mixed";
}

// Разделы с темой кабинета (первый сегмент пути). Публичные страницы (/, /whats-new, /blog,
// /journals-info) и вход живут своей темой — их не проверяем.
const CABINET_SEGMENTS = new Set([
  "dashboard", "journals", "settings", "control-board", "journals-progress", "team", "verifications",
  "reports", "staff", "batches", "capa", "changes", "competencies", "losses", "plans", "sanpin", "ideas",
  "bonuses", "mercury", "orders", "mini", "root", "partner", "master",
]);
function isCabinet(p) {
  if (!p) return false;
  return CABINET_SEGMENTS.has(p.split("/")[1] || "");
}

/**
 * Разбор одного прогона. `fromT` — время (page ms) начала перехода (для полной загрузки 0),
 * `target` — путь, на который шли. Окно разбора — [fromT, fromT + WINDOW_MS], а поздние
 * смены темы/окна ловим до конца журнала.
 */
function analyzeRun({ dump, frames, expected, fromT, target, kind }) {
  const s = dump.samples.filter((x) => x.t >= fromT);
  const end = fromT + WINDOW_MS;
  const res = { samples: s.length };
  // Длительность каждой записи = до следующей.
  const dur = (i) => (i + 1 < s.length ? s[i + 1].t - s[i].t : 16);

  // 1) Чужая тема (DOM): у .app-shell атрибут или фон не той темы. Только страницы кабинета.
  let wrongMs = 0;
  let wrongN = 0;
  let wrongFirst = null;
  let wrongMsLate = 0;
  const wrongKinds = new Set();
  for (let i = 0; i < s.length; i++) {
    const x = s[i];
    if (!isCabinet(x.p)) continue;
    const shellTone = classifyBg(x.sbg);
    const bodyTone = classifyBg(x.bbg);
    let bad = null;
    if (x.th && x.th !== expected) bad = `attr:${x.th}`;
    else if (shellTone && shellTone !== "mixed" && shellTone !== expected) bad = `shellBg:${shellTone}`;
    else if (!x.th && bodyTone && bodyTone !== "mixed" && bodyTone !== expected && x.ready !== "loading") bad = `bodyBg:${bodyTone}`;
    if (bad) {
      wrongKinds.add(bad);
      if (x.t <= end) {
        wrongMs += dur(i);
        wrongN++;
        if (wrongFirst === null) wrongFirst = x.t - fromT;
      } else wrongMsLate += dur(i);
    }
  }
  res.wrongTheme = { frames: wrongN, ms: wrongMs, firstAtMs: wrongFirst, lateMs: wrongMsLate, kinds: [...wrongKinds] };

  // 2) «Что нового»: появления и исчезновения.
  const wnEvents = [];
  let prev = null;
  for (const x of s) {
    if (prev !== null && x.wn !== prev) wnEvents.push(`${x.wn ? "show" : "hide"}@${x.t - fromT}`);
    prev = x.wn;
  }
  const firstWn = s.find((x) => x.wn);
  res.whatsNew = {
    visibleAtStart: s.length ? s[0].wn : false,
    shownAtMs: firstWn ? firstWn.t - fromT : null,
    events: wnEvents,
  };

  // 3) Пустой экран без скелетона: целевой путь уже открыт, скелетона нет, содержимого нет.
  const isContent = (x) => x.h1 || x.ml > 300;
  let blankMs = 0;
  let blankRun = 0;
  let blankMax = 0;
  let firstTargetT = null;
  let skeletonAt = null;
  let contentAt = null;
  // Полная загрузка: пока нет <main>, браузер держит прежний кадр (paint holding) —
  // это время ответа сервера (timing.ttfb), не «пустой экран».
  let mainSeen = kind !== "load";
  for (let i = 0; i < s.length; i++) {
    const x = s[i];
    const atTarget = x.p === target;
    if (x.ml >= 0) mainSeen = true;
    if (atTarget && firstTargetT === null) firstTargetT = x.t;
    if (x.busy && skeletonAt === null) skeletonAt = x.t - fromT;
    if (atTarget && !x.busy && isContent(x) && contentAt === null) contentAt = x.t - fromT;
    const blank = mainSeen && atTarget && !x.busy && !isContent(x);
    if (blank) {
      blankRun += dur(i);
      blankMs += dur(i);
      blankMax = Math.max(blankMax, blankRun);
    } else blankRun = 0;
  }
  // Какие скелетоны показывались и сколько (по подписи sr-only) — «прыгающая» загрузка.
  const skSeq = [];
  for (let i = 0; i < s.length; i++) {
    const x = s[i];
    if (!x.sk) continue;
    const last = skSeq[skSeq.length - 1];
    if (last && last.sk === x.sk && last.end === i - 1) {
      last.ms += dur(i);
      last.end = i;
    } else skSeq.push({ sk: x.sk, atMs: x.t - fromT, ms: dur(i), end: i });
  }
  res.loading = {
    urlAtMs: firstTargetT === null ? null : firstTargetT - fromT,
    skeletonAtMs: skeletonAt,
    contentAtMs: contentAt,
    blankMs,
    blankMaxRunMs: blankMax,
    skeletons: skSeq.map(({ sk, atMs, ms }) => ({ sk, atMs, ms })),
  };

  // 4) CLS после начала перехода (для клиентских переходов input-флаг не учитываем: сдвиг
  // после клика в пределах 500 мс Chrome помечает «после ввода»).
  const shifts = dump.shifts.filter((x) => x.t >= fromT);
  res.cls = {
    all: Math.round(shifts.reduce((a, x) => a + x.v, 0) * 1000) / 1000,
    noInput: Math.round(shifts.filter((x) => !x.input).reduce((a, x) => a + x.v, 0) * 1000) / 1000,
    count: shifts.length,
    top: [...shifts].sort((a, b) => b.v - a.v).slice(0, 2).map((x) => ({ atMs: x.t - fromT, v: Math.round(x.v * 1000) / 1000, sources: x.sources })),
  };

  // 5) Кадры: реально нарисованное.
  if (frames && frames.length) {
    const startEpoch = dump.origin + fromT;
    const fr = frames.filter((f) => f.ts >= startEpoch - 5);
    let fWrongMs = 0;
    let fWrongN = 0;
    let fBlankMs = 0;
    let fBlankMax = 0;
    for (let i = 0; i < fr.length; i++) {
      const f = fr[i];
      const next = i + 1 < fr.length ? fr[i + 1].ts : Math.min(f.ts + 100, startEpoch + WINDOW_MS);
      const d = Math.max(0, Math.min(next, startEpoch + WINDOW_MS) - f.ts);
      if (f.ts > startEpoch + WINDOW_MS) break;
      if (f.path && isCabinet(f.path) && f.a && f.a.tone !== "mixed" && f.a.tone !== expected) {
        fWrongMs += d;
        fWrongN++;
      }
      if (f.a && f.a.std < 2.5 && f.path === target) {
        fBlankMs += d;
        fBlankMax = Math.max(fBlankMax, d);
      }
    }
    res.frames = { count: fr.length, wrongTheme: { frames: fWrongN, ms: Math.round(fWrongMs) }, uniformMs: Math.round(fBlankMs), uniformMaxMs: Math.round(fBlankMax) };
  }
  res.kind = kind;
  return res;
}

// ---------------------------------------------------------------- runner
const results = { label: LABEL, base: BASE, startedAt: new Date().toISOString(), window: WINDOW_MS, runs: [], errors: [] };
function save() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
}

// Вход ограничен 5 попытками на почту за 5 минут: сессию владельца получаем ОДИН раз
// и кладём её куку в каждый новый контекст.
let SESSION_COOKIES = null;
async function ownerSession(browser) {
  if (SESSION_COOKIES) return SESSION_COOKIES;
  const context = await browser.newContext();
  const csrf = await (await context.request.get(`${BASE}/api/auth/csrf`, { timeout: 120000 })).json();
  const res = await context.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken: csrf.csrfToken, email: SEED.owner, password: SEED.password, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
    timeout: 120000,
  });
  const cookies = await context.cookies();
  await context.close();
  if (!cookies.some((c) => c.name.includes("session-token"))) throw new Error(`login failed ${res.status()}`);
  SESSION_COOKIES = cookies.filter((c) => c.name.includes("session-token") || c.name.includes("csrf") || c.name.includes("callback"));
  return SESSION_COOKIES;
}
async function login(context) {
  await context.addCookies(SESSION_COOKIES);
}
// Пул руководителей для сценария «вход с формы» (seed.cjs --pool).
let poolIndex = 0;
function nextPoolUser() {
  const pool = SEED.pool || [];
  if (!pool.length) return { id: SEED.userId, email: SEED.owner };
  return pool[poolIndex++ % pool.length];
}

async function withPage(browser, vp, cfg, cfgId, fn) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    locale: "ru-RU",
    colorScheme: cfg.scheme,
    timezoneId: cfg.tz,
  });
  await context.addInitScript(initProbe, {
    mode: cfg.mode,
    auto: Boolean(cfg.auto),
    effective: cfg.mode === "light" || cfg.mode === "dark" ? cfg.mode : undefined,
    whatsNewSeen: cfg.whatsNewSeen,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e && e.message).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  const cdp = await context.newCDPSession(page);
  const frames = [];
  let currentPath = null;
  cdp.on("Page.screencastFrame", (f) => {
    frames.push({ ts: (f.metadata.timestamp || Date.now() / 1000) * 1000, data: f.data, path: currentPath });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  page.on("framenavigated", (fr) => {
    if (fr === page.mainFrame()) {
      try {
        currentPath = new URL(fr.url()).pathname;
      } catch {}
    }
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: 1 });
  const ctx = { context, page, cdp, frames, consoleErrors, vp, cfg, cfgId, setPath: (p) => (currentPath = p) };
  try {
    await fn(ctx);
  } finally {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await context.close().catch(() => {});
  }
}

async function finishRun(ctx, id, { expected, fromT, target, kind, extra }) {
  const { page, frames, vp, cfgId } = ctx;
  const dump = await page.evaluate(() => (window.__probe ? window.__probe.dump() : null)).catch(() => null);
  if (!dump) {
    results.errors.push({ id, error: "no probe dump" });
    return null;
  }
  // Путь каждого кадра: по журналу DOM (кадр ↔ ближайшая запись до него).
  const fr = frames.splice(0, frames.length);
  for (const f of fr) {
    const t = f.ts - dump.origin;
    let best = null;
    for (const x of dump.samples) {
      if (x.t <= t + 4) best = x;
      else break;
    }
    if (best) f.path = best.p;
  }
  // Анализ кадров окна.
  const startEpoch = dump.origin + fromT;
  const inWindow = fr.filter((f) => f.ts >= startEpoch - 5 && f.ts <= startEpoch + WINDOW_MS + 200);
  for (const f of inWindow) {
    try {
      f.a = await analyzeFrame(f.data, vp);
    } catch (e) {
      f.a = null;
    }
  }
  const runKey = `${vp.id}|${cfgId}|${id}`;
  const res = analyzeRun({ dump, frames: inWindow, expected, fromT, target, kind });
  const run = { key: runKey, viewport: vp.id, config: cfgId, scenario: id, expected, target, ...res, ...(extra || {}) };
  if (FRAMES === "all" || (FRAMES === "flagged" && FLAG.has(runKey))) {
    const dir = path.join(OUT, "frames", runKey.replace(/[|/:>]/g, "_"));
    fs.mkdirSync(dir, { recursive: true });
    const meta = [];
    for (const [i, f] of inWindow.entries()) {
      const rel = Math.round(f.ts - startEpoch);
      const file = `${String(i).padStart(3, "0")}_${rel}ms.jpg`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, "base64"));
      meta.push({ file, ms: rel, path: f.path, a: f.a });
    }
    fs.writeFileSync(path.join(dir, "frames.json"), JSON.stringify({ key: runKey, expected, target, samples: dump.samples.filter((x) => x.t >= fromT - 50 && x.t <= fromT + WINDOW_MS + 500), frames: meta }, null, 2));
    run.framesDir = dir;
  }
  run.consoleErrors = ctx.consoleErrors.splice(0, ctx.consoleErrors.length).slice(0, 5);
  results.runs.push(run);
  const w = run.wrongTheme;
  console.log(
    `${runKey.padEnd(52)} theme✗ ${String(w.frames).padStart(3)}f/${String(w.ms).padStart(4)}ms` +
      (run.frames ? ` (кадры ${run.frames.wrongTheme.frames}/${run.frames.wrongTheme.ms}ms)` : "") +
      ` | wn ${run.whatsNew.events.join(",") || "-"}` +
      ` | url ${run.loading.urlAtMs ?? "-"} skel ${run.loading.skeletonAtMs ?? "-"} content ${run.loading.contentAtMs ?? "-"} blank ${run.loading.blankMaxRunMs}` +
      ` | cls ${run.cls.all}` +
      (run.loading.skeletons.length ? ` | sk ${run.loading.skeletons.map((x) => `${x.sk.replace(/^Загружаем /, "").slice(0, 18)}+${x.ms}`).join(">")}` : ""),
  );
  save();
  return run;
}

async function waitSettled(page, ms = SETTLE_MS) {
  await page.waitForTimeout(ms);
}

async function fullLoad(ctx, name, url, expected) {
  const { page } = ctx;
  await page.goto(`${BASE}${url}`, { waitUntil: "commit", timeout: 120000 });
  await page.waitForLoadState("load", { timeout: 60000 }).catch(() => {});
  await waitSettled(page);
  const nav = await page
    .evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null } : null;
    })
    .catch(() => null);
  // Окно — от первого кадра нового документа (первая запись rAF), а не от начала навигации:
  // пока сервер отвечает, браузер держит прежний кадр.
  const firstT = await page.evaluate(() => (window.__probe && window.__probe.samples.length ? window.__probe.samples[0].t : 0)).catch(() => 0);
  return finishRun(ctx, name, { expected, fromT: firstT, target: new URL(page.url()).pathname, kind: "load", extra: { timing: nav } });
}

/** Клиентский переход: клик по настоящей ссылке (или router.push, если ссылки на странице нет). */
async function clientNav(ctx, name, href, expected) {
  const { page } = ctx;
  await page.evaluate(() => window.__probe && window.__probe.reset());
  const how = await page.evaluate((h) => {
    const a = [...document.querySelectorAll(`a[href="${h}"]`)];
    const visible = a.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const el = visible || a[0];
    window.__probe.marks.push({ name: "nav", t: Math.round(performance.now()) });
    if (el) {
      el.click();
      return visible ? "link" : "hidden-link";
    }
    window.next.router.push(h);
    return "router.push";
  }, href);
  const fromT = await page.evaluate(() => window.__probe.marks.find((m) => m.name === "nav").t);
  await waitSettled(page);
  return finishRun(ctx, name, { expected, fromT, target: href, kind: "nav", extra: { how } });
}

async function historyBack(ctx, name, target, expected) {
  const { page } = ctx;
  await page.evaluate(() => window.__probe && window.__probe.reset());
  const fromT = await page.evaluate(() => {
    const t = Math.round(performance.now());
    window.__probe.marks.push({ name: "nav", t });
    history.back();
    return t;
  });
  await waitSettled(page, 1800);
  return finishRun(ctx, name, { expected, fromT, target, kind: "back" });
}

async function setDbTheme(theme, userId = SEED.userId) {
  if (REMOTE) {
    await api("POST", "/api/me/theme", { theme });
    return;
  }
  await sql('update "User" set "themePreference" = $1 where id = $2', [theme, userId]);
}
async function setShowWhatsNew(on) {
  if (REMOTE) {
    await api("POST", "/api/me/whats-new", { enabled: on });
    return;
  }
  await sql('update "User" set "showWhatsNew" = $1 where id = $2', [on, SEED.userId]);
}

async function runConfig(browser, vp, cfgId) {
  const cfg = CONFIGS[cfgId];
  const expected = expectedTheme(cfg);
  await setDbTheme(cfg.db);
  await setShowWhatsNew(false);
  await withPage(browser, vp, cfg, cfgId, async (ctx) => {
    await login(ctx.context);
    const { page } = ctx;
    // Прогрев: первая загрузка — без учёта (компиляция/кеши сервера).
    await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 180000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await setDbTheme(cfg.db); // прогрев мог записать тему в профиль — вернуть расхождение

    if (SCENARIOS.has("load")) {
      // Первый заход этого устройства: куки темы ещё нет — сервер рисует тему профиля, первый
      // кадр правит скрипт внутри .app-shell (после выката 2026-09-30).
      await ctx.context.clearCookies({ name: "wesetup-theme" }).catch(() => {});
      await setDbTheme(cfg.db);
      await fullLoad(ctx, "load-nocookie:dashboard", P.dashboard, expected);
      for (const key of LOAD_PAGES) {
        await setDbTheme(cfg.db);
        await fullLoad(ctx, `load:${key}`, P[key], expected);
      }
    }
    if (SCENARIOS.has("nav")) {
      await setDbTheme(cfg.db);
      await page.goto(`${BASE}${P.dashboard}`, { waitUntil: "load", timeout: 120000 });
      await waitSettled(page, 2000);
      for (let i = 1; i < NAV_CHAIN.length; i++) {
        const from = NAV_CHAIN[i - 1];
        const to = NAV_CHAIN[i];
        await clientNav(ctx, `nav:${from}>${to}`, P[to], expected);
      }
      for (let i = NAV_CHAIN.length - 2; i >= 0; i--) {
        const to = NAV_CHAIN[i];
        await historyBack(ctx, `back:>${to}`, P[to], expected);
      }
    }
    if (SCENARIOS.has("refresh")) {
      // Профиль поменяли с другого устройства, страница перечитала себя (router.refresh).
      await page.goto(`${BASE}${P.dashboard}`, { waitUntil: "load", timeout: 120000 });
      await waitSettled(page, 2000);
      await setDbTheme(cfg.db === "dark" ? "light" : "dark");
      await page.evaluate(() => window.__probe.reset());
      const fromT = await page.evaluate(() => {
        const t = Math.round(performance.now());
        window.__probe.marks.push({ name: "nav", t });
        window.next.router.refresh();
        return t;
      });
      await waitSettled(page);
      await finishRun(ctx, "refresh:dashboard", { expected, fromT, target: P.dashboard, kind: "refresh" });
      await setDbTheme(cfg.db);
    }
  });

  if (SCENARIOS.has("login") && (!REMOTE || LOGIN_CONFIGS.has(cfgId))) {
    // Вход с формы: /login → клиентский переход в кабинет (router.push + refresh).
    const user = nextPoolUser();
    await setDbTheme(cfg.db, user.id);
    await withPage(browser, vp, cfg, cfgId, async (ctx) => {
      const { page } = ctx;
      await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 120000 });
      await page.waitForFunction(() => {
        const el = document.querySelector("#email");
        return Boolean(el && Object.keys(el).some((k) => k.startsWith("__react")));
      }, null, { timeout: 60000 });
      await page.fill("#email", user.email);
      await page.fill("#password", SEED.password);
      await page.evaluate(() => window.__probe.reset());
      const fromT = await page.evaluate(() => {
        const t = Math.round(performance.now());
        window.__probe.marks.push({ name: "nav", t });
        const form = [...document.querySelectorAll("form")].find((f) => !f.hidden && f.querySelector("#password"));
        form.querySelector('button[type="submit"]').click();
        return t;
      });
      await page.waitForURL((u) => u.pathname !== "/login", { timeout: 60000 }).catch(() => {});
      await waitSettled(page, 3000);
      await finishRun(ctx, "login", { expected, fromT, target: new URL(page.url()).pathname, kind: "login" });
    });
  }

  if (SCENARIOS.has("logout") && (cfgId === "own-dark" || cfgId === "own-light")) {
    await setDbTheme(cfg.db);
    await withPage(browser, vp, cfg, cfgId, async (ctx) => {
      await login(ctx.context);
      const { page, frames } = ctx;
      await page.goto(`${BASE}${P.dashboard}`, { waitUntil: "load", timeout: 120000 });
      await waitSettled(page, 2000);
      frames.splice(0, frames.length);
      const clickEpoch = Date.now();
      // Выход: на компьютере — кнопка в шапке, на телефоне — лист профиля.
      if (vp.width > 700) {
        await page.locator('button[aria-label="Выйти"]').first().click();
      } else {
        await page.locator('button[aria-label="Профиль"]').first().click();
        await page.waitForTimeout(400);
        frames.splice(0, frames.length);
        await page.getByText("Выйти", { exact: true }).last().click();
      }
      await page.waitForURL((u) => u.pathname === "/login", { timeout: 60000 }).catch(() => {});
      await waitSettled(page, 2000);
      // Старый документ при выходе уходит вместе с журналом DOM — разбираем только кадры:
      // последовательность «тон + однородность» от клика до формы входа.
      const fr = frames.splice(0, frames.length).filter((f) => f.ts >= clickEpoch - 50);
      const seq = [];
      for (let i = 0; i < fr.length; i++) {
        const a = await analyzeFrame(fr[i].data, vp).catch(() => null);
        const next = i + 1 < fr.length ? fr[i + 1].ts : fr[i].ts + 100;
        const cls = a ? `${a.tone}${a.std < 2.5 ? "·пусто" : ""}` : "?";
        const d = Math.round(next - fr[i].ts);
        const last = seq[seq.length - 1];
        if (last && last.cls === cls) last.ms += d;
        else seq.push({ cls, atMs: Math.round(fr[i].ts - clickEpoch), ms: d });
      }
      const runKey = `${vp.id}|${cfgId}|logout`;
      const run = { key: runKey, viewport: vp.id, config: cfgId, scenario: "logout", kind: "logout", finalPath: new URL(page.url()).pathname, sequence: seq, frames: fr.length };
      if (FRAMES === "all" || (FRAMES === "flagged" && FLAG.has(runKey))) {
        const dir = path.join(OUT, "frames", runKey.replace(/[|/:>]/g, "_"));
        fs.mkdirSync(dir, { recursive: true });
        for (const [i, f] of fr.entries()) {
          fs.writeFileSync(path.join(dir, `${String(i).padStart(3, "0")}_${Math.round(f.ts - clickEpoch)}ms.jpg`), Buffer.from(f.data, "base64"));
        }
        run.framesDir = dir;
      }
      results.runs.push(run);
      console.log(`${runKey.padEnd(52)} ${seq.map((x) => `${x.cls}@${x.atMs}+${x.ms}`).join(" → ")}`);
      save();
    });
  }
}

/**
 * Мини-приложение (оболочка `ws-shell=mini`): свои экраны `/mini/*` и страницы кабинета в оболочке
 * живут в РАЗНЫХ layout'ах — при переходе между ними оболочка с темой монтируется заново.
 * Порядок темы у мини свой: смена по времени и «как на устройстве» → профиль → выбор устройства.
 */
async function runMini(browser, vp, cfgId) {
  const cfg = CONFIGS[cfgId];
  const expected = cfg.auto ? "dark" : cfg.mode === "system" ? cfg.scheme : cfg.db;
  await setDbTheme(cfg.db);
  await setShowWhatsNew(false);
  await withPage(browser, vp, cfg, `mini:${cfgId}`, async (ctx) => {
    await login(ctx.context);
    await ctx.context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    const { page } = ctx;
    await page.goto(`${BASE}/mini`, { waitUntil: "load", timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await setDbTheme(cfg.db);
    const home = new URL(page.url()).pathname;
    await fullLoad(ctx, `load:${home}`, home, expected);
    // Вкладки нижнего меню по очереди, потом назад.
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll("nav a[href^='/']")]
        .map((a) => a.getAttribute("href"))
        .filter((h, i, all) => h && all.indexOf(h) === i)
        .slice(0, 5),
    );
    let prev = home;
    for (const href of tabs) {
      if (href === prev) continue;
      await clientNav(ctx, `nav:${prev}>${href}`, href, expected);
      prev = href;
    }
    await historyBack(ctx, "back:1", null, expected);
    await historyBack(ctx, "back:2", null, expected);
  });
}

async function runWhatsNew(browser, vp) {
  // Заметки изменились: у человека в браузере отмечена прошлая версия, окно включено.
  const cfg = { mode: "light", scheme: "light", db: "light", whatsNewSeen: "old-version" };
  await setDbTheme("light");
  await setShowWhatsNew(true);
  await withPage(browser, vp, cfg, "wn", async (ctx) => {
    await login(ctx.context);
    // Кука версии «прошлой» — для кода, где решение по куке (после правки); до правки кука не читается.
    await ctx.context.addCookies([{ name: "wesetup-whats-new", value: "old-version", url: BASE }]);
    const { page } = ctx;
    await fullLoad(ctx, "load:dashboard", P.dashboard, "light");
    for (let i = 1; i < NAV_CHAIN.length; i++) {
      await clientNav(ctx, `nav:${NAV_CHAIN[i - 1]}>${NAV_CHAIN[i]}`, P[NAV_CHAIN[i]], "light");
    }
    await historyBack(ctx, "back:>settings", P.settings, "light");
    // Уход из кабинета (публичная страница, другой layout) и возврат: оболочка кабинета
    // монтируется заново — окно не должно исчезать и всплывать снова.
    await clientNav(ctx, "nav:settings>whats-new(public)", "/whats-new", "light");
    await historyBack(ctx, "back:>settings(remount)", P.settings, "light");
    // Закрыть окно и проверить, что оно больше не приходит (переходы и перезагрузка).
    const closed = await page
      .locator('[aria-labelledby="whats-new-title"] button', { hasText: "Спасибо" })
      .first()
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(500);
    await clientNav(ctx, "after-close:nav>dashboard", P.dashboard, "light");
    await fullLoad(ctx, "after-close:reload", P.dashboard, "light");
    results.runs[results.runs.length - 1].closedByButton = closed;
  });
  // Старый браузер: версия отмечена только в localStorage, куки ещё нет (первый заход после
  // выката). Две загрузки подряд, потом закрыть и загрузить ещё раз.
  await withPage(browser, vp, cfg, "wn-legacy", async (ctx) => {
    await login(ctx.context);
    const { page } = ctx;
    await fullLoad(ctx, "load1:dashboard", P.dashboard, "light");
    await fullLoad(ctx, "load2:dashboard", P.dashboard, "light");
    const closed = await page
      .locator('[aria-labelledby="whats-new-title"] button', { hasText: "Спасибо" })
      .first()
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(500);
    await fullLoad(ctx, "after-close:reload", P.dashboard, "light");
    results.runs[results.runs.length - 1].closedByButton = closed;
  });
  await setShowWhatsNew(false);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--use-gl=swiftshader"] });
  // Что вернуть в профиль в конце: локально — светлая и окно выключено (как в посеве), на проде —
  // тема, которая была до замера, и окно «Что нового» — по `--whats-new-after` (по умолчанию вкл.).
  let restoreTheme = "light";
  const restoreWhatsNew = REMOTE ? arg("whats-new-after", "on") !== "off" : false;
  try {
    await ownerSession(browser);
    if (REMOTE) {
      const me = await api("GET", "/api/me/theme").catch(() => null);
      if (me && (me.theme === "light" || me.theme === "dark")) restoreTheme = me.theme;
    }
    for (const vpId of VIEWPORT_IDS) {
      const vp = VIEWPORTS[vpId];
      for (const cfgId of CONFIG_IDS) {
        if (!CONFIGS[cfgId]) continue;
        try {
          await runConfig(browser, vp, cfgId);
        } catch (e) {
          results.errors.push({ vp: vpId, cfg: cfgId, error: String(e && e.stack || e).slice(0, 800) });
          console.error("ERR", vpId, cfgId, e && e.message);
          save();
        }
      }
      if (SCENARIOS.has("mini") && vp.id === "phone") {
        for (const cfgId of ["sys-dark/db-light", "sys-light/db-dark", "own-dark/db-light"]) {
          if (!CONFIG_IDS.includes(cfgId)) continue;
          try {
            await runMini(browser, vp, cfgId);
          } catch (e) {
            results.errors.push({ vp: vpId, cfg: `mini:${cfgId}`, error: String(e && e.stack || e).slice(0, 800) });
            console.error("ERR", vpId, "mini", cfgId, e && e.message);
            save();
          }
        }
      }
      if (SCENARIOS.has("wn")) {
        try {
          await runWhatsNew(browser, vp);
        } catch (e) {
          results.errors.push({ vp: vpId, cfg: "wn", error: String(e && e.stack || e).slice(0, 800) });
          console.error("ERR", vpId, "wn", e && e.message);
          save();
        }
      }
    }
  } finally {
    results.finishedAt = new Date().toISOString();
    save();
    await browser.close();
    await setDbTheme(restoreTheme).catch(() => {});
    await setShowWhatsNew(restoreWhatsNew).catch(() => {});
    if (API) await API.dispose().catch(() => {});
  }
})();
