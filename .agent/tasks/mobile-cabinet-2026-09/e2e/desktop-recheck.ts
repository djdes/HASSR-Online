/* eslint-disable no-console */
/**
 * Десктоп 1440 «до/после» с ожиданием покоя страницы.
 *
 * В основном прогоне (measure.ts) страница снимается через 0.9 с после
 * networkidle, и часть расхождений на 1440 — не вёрстка, а то, что к этому
 * моменту успело отрисоваться: плавающий док помощи (2 или 3 кнопки),
 * график Recharts, скрытое поле Radix у переключателя, иконка на середине
 * анимации. Здесь геометрия снимается, только когда два замера подряд
 * (через 1.5 с) совпали, — так сравнивается сама вёрстка.
 *
 *   E2E_BASE=http://localhost:3040 npx tsx .agent/tasks/mobile-cabinet-2026-09/e2e/desktop-recheck.ts before|after|compare
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.E2E_BASE ?? "http://localhost:3040";
const MODE = process.argv[2] ?? "after";
const CHROME = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture.json"), "utf8")) as {
  ownerEmail: string;
  masterEmail: string;
  password: string;
  documents: Array<{ code: string; id: string }>;
};
const doc = (code: string) => fixture.documents.find((d) => d.code === code)?.id;
const PAGES: Array<{ path: string; as: "owner" | "master" }> = [
  { path: "/dashboard", as: "owner" },
  { path: "/journals", as: "owner" },
  { path: `/journals/hygiene/documents/${doc("hygiene")}`, as: "owner" },
  { path: "/settings", as: "owner" },
  { path: "/settings/users", as: "owner" },
  { path: "/settings/qr-posters", as: "owner" },
  { path: "/orders", as: "owner" },
  { path: "/master", as: "master" },
  { path: `/journals/health_check/documents/${doc("health_check")}`, as: "owner" },
  { path: `/journals/fryer_oil/documents/${doc("fryer_oil")}`, as: "owner" },
  { path: "/reports", as: "owner" },
  { path: "/control-board", as: "owner" },
  { path: "/journals-progress", as: "owner" },
  { path: "/team", as: "owner" },
  { path: "/verifications", as: "owner" },
];

const GEOMETRY = `(() => {
  const out = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    out.push(el.tagName.toLowerCase() + " " + Math.round(r.left * 2) / 2 + "," + Math.round(r.top * 2) / 2 + " " + Math.round(r.width * 2) / 2 + "x" + Math.round(r.height * 2) / 2 + " " + cs.fontSize + " " + cs.paddingTop + "/" + cs.paddingLeft + " " + cs.minHeight);
  }
  return out;
})()`;

async function settled(page: Page): Promise<{ geometry: string[]; samples: number }> {
  let previous: string[] | null = null;
  for (let sample = 1; sample <= 12; sample += 1) {
    const current = (await page.evaluate(GEOMETRY)) as string[];
    if (previous && previous.length === current.length && previous.every((g, i) => g === current[i])) return { geometry: current, samples: sample };
    previous = current;
    await page.waitForTimeout(1_500);
  }
  return { geometry: previous ?? [], samples: -1 };
}

async function capture(phase: string) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const result: Record<string, { finalUrl: string; samples: number; geometry: string[] }> = {};
  try {
    const contexts = {} as Record<"owner" | "master", Awaited<ReturnType<typeof browser.newContext>>>;
    for (const who of ["owner", "master"] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU", timezoneId: "Europe/Moscow", reducedMotion: "reduce" });
      ctx.setDefaultNavigationTimeout(180_000);
      const email = who === "owner" ? fixture.ownerEmail : fixture.masterEmail;
      const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: fixture.password }, timeout: 120_000 });
      if (res.status() !== 200) throw new Error(`login ${email}: ${res.status()}`);
      contexts[who] = ctx;
    }
    for (const item of PAGES) {
      const page = await contexts[item.as].newPage();
      for (let attempt = 1; ; attempt += 1) {
        try {
          await page.goto(`${BASE}${item.path}`, { waitUntil: "load" });
          await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
          await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
          break;
        } catch (err) {
          if (attempt >= 3 || !/context was destroyed|navigation/i.test(String(err))) throw err;
          await page.waitForTimeout(2_000);
        }
      }
      const { geometry, samples } = await settled(page);
      result[item.path] = { finalUrl: page.url().replace(BASE, ""), samples, geometry };
      console.log(phase, item.path, "samples", samples, "elements", geometry.length);
      await page.close();
    }
    await Promise.all(Object.values(contexts).map((ctx) => ctx.close()));

    // Мини-приложение на 390 (кука ws-shell=mini): после загрузки шрифтов и
    // покоя страницы — у оболочки свои веб-шрифты, и до их загрузки текст
    // переносится иначе.
    const mini = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU", timezoneId: "Europe/Moscow", reducedMotion: "reduce" });
    mini.setDefaultNavigationTimeout(180_000);
    await mini.request.post(`${BASE}/api/auth/login`, { data: { email: fixture.ownerEmail, password: fixture.password }, timeout: 120_000 });
    await mini.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    for (const url of ["/settings/users", "/settings/qr-posters", "/journals"]) {
      const page = await mini.newPage();
      await page.goto(`${BASE}${url}`, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      await page.evaluate("document.fonts.ready.then(() => true)");
      const { geometry, samples } = await settled(page);
      result[`mini390:${url}`] = { finalUrl: page.url().replace(BASE, ""), samples, geometry };
      console.log(phase, "mini390", url, "samples", samples, "elements", geometry.length);
      await page.close();
    }
    await mini.close();
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(__dirname, `desktop-${phase}.json`), JSON.stringify(result));
}

function compare() {
  const b = JSON.parse(fs.readFileSync(path.join(__dirname, "desktop-before.json"), "utf8"));
  const a = JSON.parse(fs.readFileSync(path.join(__dirname, "desktop-after.json"), "utf8"));
  const summary: Record<string, unknown> = {};
  for (const url of Object.keys(a)) {
    const gb: string[] = b[url]?.geometry ?? [];
    const ga: string[] = a[url].geometry;
    const diffs: string[] = [];
    for (let i = 0; i < Math.max(gb.length, ga.length); i += 1) if (gb[i] !== ga[i]) diffs.push(`#${i}: ${gb[i] ?? "—"} → ${ga[i] ?? "—"}`);
    summary[url] = { elements: ga.length, samplesBefore: b[url]?.samples, samplesAfter: a[url].samples, diffs: diffs.length, firstDiffs: diffs.slice(0, 4) };
  }
  fs.writeFileSync(path.join(__dirname, "desktop-compare.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 1));
}

/**
 * `baseline`: стабильный снимок «после» против 1440 из основного прогона
 * «до» (results-before.json) — без отдельного прогона «до» со спрятанными
 * правками. Формат строк тот же, кроме последнего поля (`min-height`), его
 * отрезаем.
 */
function compareWithBaseline() {
  const before = JSON.parse(fs.readFileSync(path.join(__dirname, "results-before.json"), "utf8")) as {
    pages: Record<string, { path: string; "1440": { geometry: string[] } }>;
    extra?: Record<string, { path: string; "1440"?: { geometry: string[] } }>;
  };
  const a = JSON.parse(fs.readFileSync(path.join(__dirname, "desktop-after.json"), "utf8")) as Record<string, { samples: number; geometry: string[] }>;
  const byPath = new Map<string, string[]>();
  for (const row of [...Object.values(before.pages), ...Object.values(before.extra ?? {})]) {
    if (row["1440"]?.geometry) byPath.set(row.path, row["1440"].geometry);
  }
  const strip = (g: string) => g.replace(/ \S+$/, "");
  const summary: Record<string, unknown> = {};
  for (const [url, v] of Object.entries(a)) {
    if (url.startsWith("mini390:")) continue;
    const gb = byPath.get(url);
    if (!gb) continue;
    const ga = v.geometry.map(strip);
    const diffs: string[] = [];
    for (let i = 0; i < Math.max(gb.length, ga.length); i += 1) if (gb[i] !== ga[i]) diffs.push(`#${i}: ${gb[i] ?? "—"} → ${ga[i] ?? "—"}`);
    summary[url] = { elements: ga.length, samplesBefore: "main run", samplesAfter: v.samples, diffs: diffs.length, firstDiffs: diffs.slice(0, 4) };
  }
  fs.writeFileSync(path.join(__dirname, "desktop-compare.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 1));
}

(MODE === "compare" ? Promise.resolve(compare()) : MODE === "baseline" ? Promise.resolve(compareWithBaseline()) : capture(MODE)).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
