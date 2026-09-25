/* eslint-disable no-console */
/**
 * Скриншоты и замеры кабинета на 390 и 1440 — до и после правки.
 *
 *   E2E_BASE=http://localhost:3040 npx tsx .agent/tasks/mobile-cabinet-2026-09/e2e/measure.ts before
 *   E2E_BASE=http://localhost:3040 npx tsx .agent/tasks/mobile-cabinet-2026-09/e2e/measure.ts after
 *
 * Нужны запущенный dev-сервер и фикстура (seed.ts → fixture.json).
 *
 * 390 (телефон): высота шапки и её кнопок-иконок; все видимые кнопки,
 * ссылки-кнопки, поля и выпадающие списки вне таблиц журналов — высота
 * (≥ 48), шрифт полей (≥ 16), зазоры между соседними кликабельными (≥ 8);
 * распределение кегля текста; элементы, вылезшие за край экрана (их
 * срезал бы `overflow-x: clip` у body), и ширина документа.
 *
 * 1440 (десктоп): геометрия каждого видимого элемента страницы — для
 * сравнения «до/после» (compare.ts) — и скриншот первого экрана.
 *
 * Итог — results-<phase>.json рядом со скриптом, PNG — в ../evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";

const BASE = process.env.E2E_BASE ?? "http://localhost:3040";
const PHASE = process.argv[2] === "after" ? "after" : "before";
const TASK_DIR = path.resolve(__dirname, "..");
const SHOTS = path.join(TASK_DIR, "evidence");
const CHROME =
  process.env.E2E_CHROME ??
  path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture.json"), "utf8")) as {
  ownerEmail: string;
  masterEmail: string;
  password: string;
  documents: Array<{ code: string; id: string }>;
};

fs.mkdirSync(SHOTS, { recursive: true });

const hygiene = fixture.documents.find((d) => d.code === "hygiene");
if (!hygiene) throw new Error("fixture: no hygiene document");

const PAGES = [
  { key: "01-dashboard", path: "/dashboard", as: "owner" },
  { key: "02-journals", path: "/journals", as: "owner" },
  { key: "03-journal-doc", path: `/journals/hygiene/documents/${hygiene.id}`, as: "owner" },
  { key: "04-settings", path: "/settings", as: "owner" },
  { key: "05-staff", path: "/settings/users", as: "owner" },
  { key: "06-qr-posters", path: "/settings/qr-posters", as: "owner" },
  { key: "07-orders", path: "/orders", as: "owner" },
  { key: "08-master", path: "/master", as: "master" },
] as const;

// Дополнительные страницы кабинета — только замеры (без скриншотов: мало
// места на диске). Правило «крупнее» глобальное, поэтому ловим регрессии
// шире восьми страниц из спецификации: вылеты, спрятанные за край
// вкладки, изменения десктопа.
const health = fixture.documents.find((d) => d.code === "health_check");
const fryer = fixture.documents.find((d) => d.code === "fryer_oil");
const EXTRA = [
  "/journals/hygiene",
  "/journals/health_check",
  ...(health ? [`/journals/health_check/documents/${health.id}`] : []),
  ...(fryer ? [`/journals/fryer_oil/documents/${fryer.id}`] : []),
  "/settings/journals",
  "/settings/organization",
  "/settings/equipment",
  "/settings/areas",
  "/settings/journal-responsibles",
  "/settings/permissions",
  "/settings/subscription",
  "/settings/appearance",
  "/settings/notifications",
  "/settings/master-cabinet",
  "/reports",
  "/control-board",
  "/journals-progress",
  "/team",
  "/verifications",
  "/capa",
  "/batches",
  "/losses",
  "/competencies",
  "/sanpin",
].map((p, i) => ({ key: `x${String(i + 1).padStart(2, "0")}`, path: p, as: "owner" as const }));

type Viewport = { name: "390" | "1440"; width: number; height: number; mobile: boolean };
// PHONE_W=360 ONLY_PHONE=1 — дополнительный прогон узкого телефона (DASHBOARD.md:
// «ничего не уезжает по горизонтали на 360 px»): только телефон, без
// дополнительных страниц, отдельный файл results-<phase>-360.json. Значение
// ключа в JSON остаётся "390" — это слот «телефон».
const PHONE_W = Number(process.env.PHONE_W ?? 390);
const ONLY_PHONE = process.env.ONLY_PHONE === "1";
const SUFFIX = PHONE_W === 390 ? "" : `-${PHONE_W}`;
const VIEWPORTS: Viewport[] = [
  { name: "390", width: PHONE_W, height: 844, mobile: true },
  ...(ONLY_PHONE ? [] : [{ name: "1440" as const, width: 1440, height: 900, mobile: false }]),
];

const consoleErrors: string[] = [];

async function newContext(browser: Awaited<ReturnType<typeof chromium.launch>>, vp: Viewport, email: string) {
  const ctx = await browser.newContext({
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    reducedMotion: "reduce",
  });
  ctx.setDefaultTimeout(120_000);
  ctx.setDefaultNavigationTimeout(180_000);
  ctx.on("page", (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`${vp.name} ${page.url()} :: ${m.text().slice(0, 300)}`);
    });
    page.on("pageerror", (err) => consoleErrors.push(`${vp.name} ${page.url()} :: pageerror ${String(err).slice(0, 300)}`));
  });
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: fixture.password }, timeout: 120_000 });
  if (res.status() !== 200) throw new Error(`login ${email}: ${res.status()}`);
  return ctx;
}

async function open(page: Page, url: string) {
  // Dev-сервер иногда перезагружает страницу посреди захода (досборка
  // маршрута) — тогда «Execution context was destroyed»: повторяем заход.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(`${BASE}${url}`, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
      // Индикатор dev-сборки Next.js в углу — не часть страницы.
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      // tsx (esbuild keepNames) оборачивает функции в `__name(...)` — в
      // странице такого хелпера нет.
      await page.evaluate("globalThis.__name = (f) => f");
      await page.waitForTimeout(900);
      return;
    } catch (err) {
      if (attempt >= 3 || !/context was destroyed|navigation/i.test(String(err))) throw err;
      await page.waitForTimeout(2_000);
    }
  }
}

/** Замеры телефона — выполняются в странице. */
function mobileProbe() {
  const vw = window.innerWidth;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    // Содержимое закрытого <details> Chrome прячет через content-visibility:
    // рамки у него есть, а на экране его нет.
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    for (let n: Element | null = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false;
      if (n.getAttribute("aria-hidden") === "true") return false;
    }
    return true;
  };
  const label = (el: Element) => {
    const text = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("placeholder") || el.getAttribute("title") || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 6).join(".");
    return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}${el.getAttribute("data-slot") ? `[slot=${el.getAttribute("data-slot")}]` : ""} «${text}»${text ? "" : ` .${cls}`}`;
  };
  const inGrid = (el: Element) => Boolean(el.closest("table, [data-journal-grid], [role=grid]"));
  const r2 = (n: number) => Math.round(n * 10) / 10;

  // ── Шапка ──
  const header = document.querySelector("header");
  const headerRect = header?.getBoundingClientRect();
  const headerControls = header
    ? Array.from(header.querySelectorAll("a[href], button, [role=button]"))
        .filter(visible)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el: label(el), w: r2(r.width), h: r2(r.height) };
        })
    : [];

  // ── Кликабельное в содержимом ──
  const scope = Array.from(document.querySelectorAll("body *")).filter((el) => !el.closest("header, footer"));
  const FIELD = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]), select, textarea, [role=combobox]";
  const TOGGLE = "[role=checkbox], [role=switch], [role=radio], input[type=checkbox], input[type=radio]";
  const CLICK = "button, [role=button], [role=tab], a[href], summary";
  const controls: Array<{ kind: "button" | "field" | "toggle"; el: string; w: number; h: number; fs: number; rect: DOMRect; node: Element }> = [];
  let inlineLinks = 0;
  let gridSkipped = 0;
  for (const el of scope) {
    const kind = el.matches(FIELD) ? "field" : el.matches(TOGGLE) ? "toggle" : el.matches(CLICK) ? "button" : null;
    if (!kind) continue;
    if (!visible(el)) continue;
    if (inGrid(el)) {
      gridSkipped += 1;
      continue;
    }
    // Кнопка внутри другой кнопки/ссылки (обёртки) — считаем внешнюю.
    if (kind === "button" && el.parentElement?.closest(CLICK)) continue;
    const cs = getComputedStyle(el);
    if (kind === "button" && el.tagName === "A" && cs.display === "inline") {
      inlineLinks += 1;
      continue;
    }
    const r = el.getBoundingClientRect();
    controls.push({ kind, el: label(el), w: r2(r.width), h: r2(r.height), fs: parseFloat(cs.fontSize), rect: r, node: el });
  }
  const small = controls.filter((c) => c.kind !== "toggle" && c.h < 47.5).map(({ kind, el, w, h }) => ({ kind, el, w, h }));
  const smallFieldFont = controls.filter((c) => c.kind === "field" && c.fs < 16).map(({ el, fs }) => ({ el, fs }));
  const toggles = controls.filter((c) => c.kind === "toggle").map(({ el, w, h }) => ({ el, w, h }));

  // Зазоры: соседи в одном ряду или столбце ближе 8px (вложенные — пропуск).
  const tight: Array<{ a: string; b: string; gap: number }> = [];
  const flat = controls.filter((c) => c.kind !== "toggle");
  for (let i = 0; i < flat.length; i += 1) {
    for (let j = i + 1; j < flat.length; j += 1) {
      const a = flat[i];
      const b = flat[j];
      if (a.node.contains(b.node) || b.node.contains(a.node)) continue;
      const A = a.rect;
      const B = b.rect;
      const vOverlap = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      const hOverlap = Math.min(A.right, B.right) - Math.max(A.left, B.left);
      let gap: number | null = null;
      if (vOverlap > Math.min(A.height, B.height) * 0.5) gap = Math.max(B.left - A.right, A.left - B.right);
      else if (hOverlap > Math.min(A.width, B.width) * 0.5) gap = Math.max(B.top - A.bottom, A.top - B.bottom);
      if (gap !== null && gap > -0.5 && gap < 7.5) tight.push({ a: a.el, b: b.el, gap: r2(gap) });
    }
  }

  // ── Кегль текста (вне таблиц), взвешенный по числу символов ──
  const sizes: Record<string, number> = {};
  let chars = 0;
  const walker = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? "").trim();
    const parent = node.parentElement;
    if (!text || !parent || inGrid(parent) || !visible(parent)) continue;
    const size = String(Math.round(parseFloat(getComputedStyle(parent).fontSize) * 2) / 2);
    sizes[size] = (sizes[size] ?? 0) + text.length;
    chars += text.length;
  }
  const share = (min: number) =>
    chars ? r2((Object.entries(sizes).filter(([s]) => Number(s) >= min).reduce((sum, [, n]) => sum + n, 0) / chars) * 100) : 0;
  const sorted = Object.entries(sizes).sort((x, y) => Number(x[0]) - Number(y[0]));
  let acc = 0;
  let median = 0;
  for (const [s, n] of sorted) {
    acc += n;
    if (acc >= chars / 2) {
      median = Number(s);
      break;
    }
  }

  // ── Горизонтальный вылет ──
  const offenders: Array<{ el: string; left: number; right: number }> = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 1 && r.left >= -1) continue;
    if (!visible(el)) continue;
    let scrolled = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== "visible" || cs.position === "fixed") {
        scrolled = true;
        break;
      }
    }
    if (scrolled || getComputedStyle(el).position === "fixed") continue;
    offenders.push({ el: label(el), left: r2(r.left), right: r2(r.right) });
    if (offenders.length > 15) break;
  }

  // Горизонтальные прокрутчики без таблиц, у которых содержимое шире окна:
  // там часть кнопок/вкладок спрятана за краем (для бланков это норма —
  // таблицы и pan-зона документа исключены).
  const hiddenOverflow: Array<{ el: string; client: number; scroll: number }> = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    // Только прокрутчики (auto/scroll): `overflow: hidden` — это обрезка
    // по замыслу (`truncate`, `line-clamp`, декоративные пятна hero).
    const ox = getComputedStyle(el).overflowX;
    if (ox !== "auto" && ox !== "scroll") continue;
    if (el.clientWidth <= 2 || el.scrollWidth <= el.clientWidth + 1) continue;
    if (el.querySelector("table, [data-journal-grid]") || el.closest("[data-journal-doc-pan]") || el.hasAttribute("data-journal-doc-pan")) continue;
    if (!visible(el)) continue;
    hiddenOverflow.push({ el: label(el), client: el.clientWidth, scroll: el.scrollWidth });
    if (hiddenOverflow.length > 10) break;
  }

  return {
    hiddenOverflow,
    header: headerRect ? { height: r2(headerRect.height), controls: headerControls } : null,
    counts: { controls: controls.length, inlineLinks, gridSkipped },
    small,
    smallFieldFont,
    toggles,
    tight: tight.slice(0, 30),
    tightCount: tight.length,
    text: { chars, medianPx: median, shareGe15: share(15), shareGe16: share(16), sizes },
    overflow: { scrollWidth: document.documentElement.scrollWidth, innerWidth: vw, offenders },
  };
}

/** Кнопки и поля внутри открытого окна (портал в <body>). */
function dialogProbe() {
  const dialogs = Array.from(document.querySelectorAll("[role=dialog]")).filter((d) => d.getBoundingClientRect().height > 0);
  const dialog = dialogs[dialogs.length - 1];
  if (!dialog) return null;
  const FIELD = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea, [role=combobox]";
  const CLICK = "button, [role=button], [role=tab], a[href], summary";
  const rows: Array<{ kind: string; el: string; h: number; fs: number }> = [];
  for (const el of Array.from(dialog.querySelectorAll(`${FIELD}, ${CLICK}`))) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || el.closest("table")) continue;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    if (el.matches(CLICK) && el.parentElement?.closest(CLICK)) continue;
    const text = ((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 30);
    rows.push({ kind: el.matches(FIELD) ? "field" : "button", el: `${el.tagName.toLowerCase()} «${text}»`, h: Math.round(r.height * 10) / 10, fs: parseFloat(getComputedStyle(el).fontSize) });
  }
  return {
    title: (dialog.querySelector("h2, h3, [data-slot=dialog-title]") as HTMLElement | null)?.innerText.slice(0, 60) ?? null,
    controls: rows.length,
    small: rows.filter((r) => r.h < 47.5),
    smallFieldFont: rows.filter((r) => r.kind === "field" && r.fs < 16),
  };
}

/** Геометрия каждого видимого элемента — для сравнения десктопа до/после. */
function desktopProbe() {
  const out: string[] = [];
  const header = document.querySelector("header")?.getBoundingClientRect();
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    out.push(
      `${el.tagName.toLowerCase()} ${Math.round(r.left * 2) / 2},${Math.round(r.top * 2) / 2} ${Math.round(r.width * 2) / 2}x${Math.round(r.height * 2) / 2} ${cs.fontSize} ${cs.paddingTop}/${cs.paddingLeft}`
    );
  }
  return { headerHeight: header ? Math.round(header.height * 10) / 10 : null, count: out.length, geometry: out };
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-gl=swiftshader", "--no-sandbox"] });
  const results: Record<string, unknown> = { phase: PHASE, base: BASE, at: new Date().toISOString(), pages: {} as Record<string, unknown> };
  const pagesOut = results.pages as Record<string, Record<string, unknown>>;
  try {
    for (const vp of VIEWPORTS) {
      const contexts: Record<string, BrowserContext> = {
        owner: await newContext(browser, vp, fixture.ownerEmail),
        master: await newContext(browser, vp, fixture.masterEmail),
      };
      for (const item of PAGES) {
        const page = await contexts[item.as].newPage();
        await open(page, item.path);
        // Второй заход: первый в dev-режиме ещё докомпилирует чанки.
        if (vp.name === "390" && item.key === "01-dashboard") await open(page, item.path);
        const shot = `${PHASE}-${vp.mobile ? PHONE_W : vp.name}-${item.key}.png`;
        await page.screenshot({ path: path.join(SHOTS, shot), type: "png" });
        const data = vp.mobile ? await page.evaluate(mobileProbe) : await page.evaluate(desktopProbe);
        pagesOut[item.key] = { ...(pagesOut[item.key] ?? {}), path: item.path, finalUrl: page.url().replace(BASE, ""), [vp.name]: { shot, ...data } };
        console.log(PHASE, vp.name, item.key, page.url().replace(BASE, ""));
        // Окно поверх страницы (портал): «Настройки документа» на бланке.
        if (vp.mobile && item.key === "03-journal-doc") {
          const trigger = page.getByRole("button", { name: "Настройки документа" }).first();
          if (await trigger.isVisible().catch(() => false)) {
            await trigger.click();
            await page.locator("[role=dialog]").last().waitFor({ timeout: 15_000 }).catch(() => undefined);
            await page.waitForTimeout(700);
            const dialogShot = `${PHASE}-${PHONE_W}-09-doc-settings-dialog.png`;
            await page.screenshot({ path: path.join(SHOTS, dialogShot), type: "png" });
            const dialog = await page.evaluate(dialogProbe);
            (results as Record<string, unknown>).dialog = { shot: dialogShot, ...(dialog ?? { error: "no dialog" }) };
            await page.keyboard.press("Escape").catch(() => undefined);
          }
        }
        await page.close();
      }
      const extraOut = ((results as Record<string, unknown>).extra ??= {}) as Record<string, Record<string, unknown>>;
      for (const item of ONLY_PHONE ? [] : EXTRA) {
        const page = await contexts[item.as].newPage();
        try {
          await open(page, item.path);
          const data = vp.mobile ? await page.evaluate(mobileProbe) : await page.evaluate(desktopProbe);
          extraOut[item.key] = { ...(extraOut[item.key] ?? {}), path: item.path, finalUrl: page.url().replace(BASE, ""), [vp.name]: data };
          console.log(PHASE, vp.name, item.key, item.path);
        } catch (err) {
          extraOut[item.key] = { ...(extraOut[item.key] ?? {}), path: item.path, [vp.name]: { error: String(err).slice(0, 200) } };
        }
        await page.close();
      }
      await Promise.all(Object.values(contexts).map((ctx) => ctx.close()));
    }
  } finally {
    await browser.close();
  }
  results.consoleErrors = consoleErrors;
  fs.writeFileSync(path.join(__dirname, `results-${PHASE}${SUFFIX}.json`), JSON.stringify(results, null, 1));
  console.log("written", `results-${PHASE}${SUFFIX}.json`, "console errors:", consoleErrors.length);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
