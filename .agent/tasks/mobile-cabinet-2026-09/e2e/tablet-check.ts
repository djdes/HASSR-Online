/* eslint-disable no-console */
/**
 * Планшет и узкий ноутбук не меняются: геометрия каждого видимого элемента
 * восьми страниц на 768 и 1024 до и после правки (правки действуют только
 * < 640px).
 *
 *   E2E_BASE=http://localhost:3040 npx tsx .agent/tasks/mobile-cabinet-2026-09/e2e/tablet-check.ts before|after|compare
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
const hygiene = fixture.documents.find((d) => d.code === "hygiene");
const PAGES: Array<{ path: string; as: "owner" | "master" }> = [
  { path: "/dashboard", as: "owner" },
  { path: "/journals", as: "owner" },
  ...(hygiene ? [{ path: `/journals/hygiene/documents/${hygiene.id}`, as: "owner" as const }] : []),
  { path: "/settings", as: "owner" },
  { path: "/settings/users", as: "owner" },
  { path: "/settings/qr-posters", as: "owner" },
  { path: "/orders", as: "owner" },
  { path: "/master", as: "master" },
];

function geometry() {
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    out.push(`${el.tagName.toLowerCase()} ${Math.round(r.left * 2) / 2},${Math.round(r.top * 2) / 2} ${Math.round(r.width * 2) / 2}x${Math.round(r.height * 2) / 2} ${cs.fontSize} ${cs.minHeight}`);
  }
  return out;
}

async function open(page: Page, url: string) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(`${BASE}${url}`, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      await page.evaluate("globalThis.__name = (f) => f");
      await page.waitForTimeout(900);
      return;
    } catch (err) {
      if (attempt >= 3 || !/context was destroyed|navigation/i.test(String(err))) throw err;
      await page.waitForTimeout(2_000);
    }
  }
}

async function capture(phase: string) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const result: Record<string, Record<string, string[]>> = {};
  try {
    for (const width of [768, 1024]) {
      const contexts = {} as Record<"owner" | "master", Awaited<ReturnType<typeof browser.newContext>>>;
      for (const who of ["owner", "master"] as const) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, locale: "ru-RU", timezoneId: "Europe/Moscow", reducedMotion: "reduce" });
        ctx.setDefaultNavigationTimeout(180_000);
        const email = who === "owner" ? fixture.ownerEmail : fixture.masterEmail;
        const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: fixture.password }, timeout: 120_000 });
        if (res.status() !== 200) throw new Error(`login ${email}: ${res.status()}`);
        contexts[who] = ctx;
      }
      for (const item of PAGES) {
        const page = await contexts[item.as].newPage();
        await open(page, item.path);
        (result[item.path] ??= {})[String(width)] = await page.evaluate(geometry);
        console.log(phase, width, item.path);
        await page.close();
      }
      await Promise.all(Object.values(contexts).map((ctx) => ctx.close()));
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(__dirname, `tablet-${phase}.json`), JSON.stringify(result));
}

function compare() {
  const b = JSON.parse(fs.readFileSync(path.join(__dirname, "tablet-before.json"), "utf8"));
  const a = JSON.parse(fs.readFileSync(path.join(__dirname, "tablet-after.json"), "utf8"));
  const summary: Record<string, Record<string, unknown>> = {};
  for (const url of Object.keys(a)) {
    for (const width of Object.keys(a[url])) {
      const gb: string[] = b[url]?.[width] ?? [];
      const ga: string[] = a[url][width];
      const diffs: string[] = [];
      for (let i = 0; i < Math.max(gb.length, ga.length); i += 1) if (gb[i] !== ga[i]) diffs.push(`#${i}: ${gb[i] ?? "—"} → ${ga[i] ?? "—"}`);
      (summary[url] ??= {})[width] = { elements: ga.length, diffs: diffs.length, firstDiffs: diffs.slice(0, 5) };
    }
  }
  fs.writeFileSync(path.join(__dirname, "tablet-compare.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 1));
}

(MODE === "compare" ? Promise.resolve(compare()) : capture(MODE)).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
