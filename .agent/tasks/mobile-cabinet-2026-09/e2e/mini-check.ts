/* eslint-disable no-console */
/**
 * Мини-приложение не должно измениться: те же страницы кабинета в оболочке
 * мини-приложения (кука `ws-shell=mini`) на 390 — геометрия каждого
 * видимого элемента до и после правки.
 *
 * Заодно — «прилипание как сейчас»: шапка кабинета после прокрутки на
 * 1200px остаётся у верхнего края (390 и 1440).
 *
 *   E2E_BASE=http://localhost:3040 npx tsx .agent/tasks/mobile-cabinet-2026-09/e2e/mini-check.ts before|after
 *   ... mini-check.ts compare
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE ?? "http://localhost:3040";
const MODE = process.argv[2] ?? "after";
const CHROME = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture.json"), "utf8")) as {
  ownerEmail: string;
  password: string;
  documents: Array<{ code: string; id: string }>;
};
const hygiene = fixture.documents.find((d) => d.code === "hygiene");
const PAGES = ["/journals", "/settings/users", "/settings/qr-posters", ...(hygiene ? [`/journals/hygiene/documents/${hygiene.id}`] : [])];

function geometry() {
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    out.push(`${el.tagName.toLowerCase()} ${Math.round(r.left * 2) / 2},${Math.round(r.top * 2) / 2} ${Math.round(r.width * 2) / 2}x${Math.round(r.height * 2) / 2} ${cs.fontSize} ${cs.minHeight}`);
  }
  return { miniRoot: Boolean(document.querySelector(".mini-root")), count: out.length, geometry: out };
}

async function capture(phase: string) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const result: Record<string, unknown> = {};
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU", timezoneId: "Europe/Moscow", reducedMotion: "reduce" });
    ctx.setDefaultNavigationTimeout(180_000);
    const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: fixture.ownerEmail, password: fixture.password }, timeout: 120_000 });
    if (login.status() !== 200) throw new Error(`login ${login.status()}`);
    await ctx.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    for (const url of PAGES) {
      const page = await ctx.newPage();
      await page.goto(`${BASE}${url}`, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      await page.evaluate("globalThis.__name = (f) => f");
      await page.waitForTimeout(900);
      result[url] = { finalUrl: page.url().replace(BASE, ""), ...(await page.evaluate(geometry)) };
      console.log(phase, url, page.url().replace(BASE, ""));
      await page.close();
    }
    // Прилипание шапки кабинета (обычная оболочка, без куки мини-приложения).
    const sticky: Record<string, unknown> = {};
    for (const vp of [
      { name: "390", width: 390, height: 844, mobile: true },
      { name: "1440", width: 1440, height: 900, mobile: false },
    ]) {
      const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile, locale: "ru-RU", reducedMotion: "reduce" });
      c.setDefaultNavigationTimeout(180_000);
      await c.request.post(`${BASE}/api/auth/login`, { data: { email: fixture.ownerEmail, password: fixture.password }, timeout: 120_000 });
      const page = await c.newPage();
      await page.goto(`${BASE}/settings/users`, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(600);
      sticky[vp.name] = await page.evaluate(`(() => { const h = document.querySelector("header"); const r = h.getBoundingClientRect(); return { scrollY: Math.round(window.scrollY), headerTop: Math.round(r.top), headerHeight: Math.round(r.height * 10) / 10, position: getComputedStyle(h).position }; })()`);
      await c.close();
    }
    result.__sticky = sticky;
    console.log(phase, "sticky", JSON.stringify(sticky));

    // «Полезного места больше»: где начинается содержимое страницы на 390 —
    // верх заголовка h1 (или первого блока main) и строка «назад + крошки».
    const contentStart: Record<string, unknown> = {};
    const c390 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU", reducedMotion: "reduce" });
    c390.setDefaultNavigationTimeout(180_000);
    await c390.request.post(`${BASE}/api/auth/login`, { data: { email: fixture.ownerEmail, password: fixture.password }, timeout: 120_000 });
    for (const url of ["/dashboard", "/journals", ...(hygiene ? [`/journals/hygiene/documents/${hygiene.id}`] : []), "/settings", "/settings/users", "/settings/qr-posters", "/orders"]) {
      const page = await c390.newPage();
      await page.goto(`${BASE}${url}`, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      contentStart[url] = await page.evaluate(`(() => {
        const header = document.querySelector("header").getBoundingClientRect();
        const main = document.querySelector("main");
        const h1 = main.querySelector("h1");
        const first = h1 ?? main.firstElementChild;
        const nav = main.querySelector('nav[aria-label="Хлебные крошки"]');
        const navRow = nav ? nav.parentElement.getBoundingClientRect() : null;
        return {
          header: Math.round(header.height * 10) / 10,
          h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
          firstTop: first ? Math.round(first.getBoundingClientRect().top) : null,
          navRow: navRow ? { top: Math.round(navRow.top), height: Math.round(navRow.height) } : null,
        };
      })()`);
      await page.close();
    }
    await c390.close();
    result.__contentStart = contentStart;
    console.log(phase, "contentStart", JSON.stringify(contentStart));
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(__dirname, `mini-${phase}.json`), JSON.stringify(result));
}

function compare() {
  const b = JSON.parse(fs.readFileSync(path.join(__dirname, "mini-before.json"), "utf8"));
  const a = JSON.parse(fs.readFileSync(path.join(__dirname, "mini-after.json"), "utf8"));
  const summary: Record<string, unknown> = {};
  summary.__sticky = { before: b.__sticky, after: a.__sticky };
  summary.__contentStart = { before: b.__contentStart, after: a.__contentStart };
  for (const url of Object.keys(a).filter((key) => !key.startsWith("__"))) {
    const gb: string[] = b[url]?.geometry ?? [];
    const ga: string[] = a[url]?.geometry ?? [];
    const diffs: string[] = [];
    for (let i = 0; i < Math.max(gb.length, ga.length); i += 1) if (gb[i] !== ga[i]) diffs.push(`#${i}: ${gb[i] ?? "—"} → ${ga[i] ?? "—"}`);
    summary[url] = { miniRoot: a[url].miniRoot, finalUrl: a[url].finalUrl, elements: ga.length, diffs: diffs.length, firstDiffs: diffs.slice(0, 5) };
  }
  fs.writeFileSync(path.join(__dirname, "mini-compare.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 1));
}

(MODE === "compare" ? Promise.resolve(compare()) : capture(MODE)).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
