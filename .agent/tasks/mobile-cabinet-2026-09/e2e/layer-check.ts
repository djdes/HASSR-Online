/* eslint-disable no-console */
/**
 * Проверка «ярусов» правила «крупнее» на телефоне (390):
 *  1. минимумы в слое `components` НЕ уменьшают крупное: строка меню-листа
 *     с утилитой `min-h-[52px]` остаётся 52px (слой ниже утилит);
 *  2. кегль вне слоёв перебивает утилиту: `text-[14px]` → 16px;
 *  3. переключатель и галочка из ui/ — `touch:`-размеры;
 *  4. в мини-приложении (кука ws-shell=mini) те же элементы — прежние.
 *
 *   E2E_BASE=http://localhost:3040 npx tsx .agent/tasks/mobile-cabinet-2026-09/e2e/layer-check.ts
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE ?? "http://localhost:3040";
const CHROME = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture.json"), "utf8")) as {
  ownerEmail: string;
  password: string;
  documents: Array<{ code: string; id: string }>;
};

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const out: Record<string, unknown> = {};
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU", reducedMotion: "reduce" });
    ctx.setDefaultNavigationTimeout(180_000);
    await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: fixture.ownerEmail, password: fixture.password }, timeout: 120_000 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/settings/users`, { waitUntil: "load" });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    // Меню разделов в шапке — лист снизу (портал, role=dialog).
    await page.getByRole("button", { name: "Меню" }).first().click();
    await page.locator("[role=dialog]").last().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(600);
    out.menuSheet = await page.evaluate(`(() => {
      const dialog = Array.from(document.querySelectorAll("[role=dialog]")).pop();
      const rows = Array.from(dialog.querySelectorAll("a[href]")).map((a) => {
        const cs = getComputedStyle(a);
        return { text: a.innerText.trim().slice(0, 24), cls52: a.className.includes("min-h-[52px]"), minHeight: cs.minHeight, height: Math.round(a.getBoundingClientRect().height) };
      });
      return rows.slice(0, 6);
    })()`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    out.textRemap = await page.evaluate(`(() => {
      // Первый элемент с классом вне крошек и таблиц (они исключены из правила намеренно).
      const pick = (cls) => { const el = Array.from(document.querySelectorAll("main ." + CSS.escape(cls))).find((n) => !n.closest('nav[aria-label="Хлебные крошки"], table, [role=grid]')); return el ? getComputedStyle(el).fontSize : null; };
      return { "text-[14px]": pick("text-[14px]"), "text-[13px]": pick("text-[13px]"), "text-[12px]": pick("text-[12px]"), "text-[11px]": pick("text-[11px]") };
    })()`);
    await page.close();

    const doc = fixture.documents.find((d) => d.code === "hygiene");
    const health = fixture.documents.find((d) => d.code === "health_check");
    const healthPage = await ctx.newPage();
    await healthPage.goto(`${BASE}/journals/health_check/documents/${health?.id}`, { waitUntil: "load" });
    await healthPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await healthPage.waitForTimeout(800);
    out.healthStripButtons = await healthPage.evaluate(`(() => Array.from(document.querySelectorAll("main button")).filter((b) => /Перейти/.test(b.innerText)).map((b) => ({ text: b.innerText.trim().slice(0, 24), height: Math.round(b.getBoundingClientRect().height) })))()`);
    await healthPage.close();
    const docPage = await ctx.newPage();
    await docPage.goto(`${BASE}/journals/hygiene/documents/${doc?.id}`, { waitUntil: "load" });
    await docPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await docPage.waitForTimeout(800);
    // Кнопка «Перейти» в полосе прогресса (у неё свой max-sm:min-h-[36px]).
    out.progressStripButtons = await docPage.evaluate(`(() => Array.from(document.querySelectorAll("main button")).filter((b) => /Перейти/.test(b.innerText)).map((b) => ({ text: b.innerText.trim().slice(0, 24), height: Math.round(b.getBoundingClientRect().height) })))()`);
    out.switchSite = await docPage.evaluate(`(() => { const s = document.querySelector("main [data-slot=switch]"); if (!s) return null; const t = s.querySelector("[data-slot=switch-thumb]"); const r = s.getBoundingClientRect(); const tr = t.getBoundingClientRect(); return { track: Math.round(r.width) + "x" + Math.round(r.height), thumb: Math.round(tr.width), hitArea: getComputedStyle(s, "::after").inset }; })()`);
    await docPage.close();

    // Мини-приложение: та же страница в оболочке — размеры прежние.
    await ctx.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
    const mini = await ctx.newPage();
    await mini.goto(`${BASE}/journals/hygiene/documents/${doc?.id}`, { waitUntil: "load" });
    await mini.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await mini.waitForTimeout(800);
    out.switchMini = await mini.evaluate(`(() => { const s = document.querySelector(".mini-root [data-slot=switch]"); if (!s) return { note: "no switch in mini shell" }; const t = s.querySelector("[data-slot=switch-thumb]"); const r = s.getBoundingClientRect(); return { track: Math.round(r.width) + "x" + Math.round(r.height), thumb: Math.round(t.getBoundingClientRect().width) }; })()`);
    out.miniButtons = await mini.evaluate(`(() => Array.from(document.querySelectorAll(".mini-root main button")).slice(0, 5).map((b) => ({ text: (b.innerText || b.getAttribute("aria-label") || "").trim().slice(0, 20), minHeight: getComputedStyle(b).minHeight, height: Math.round(b.getBoundingClientRect().height) })))()`);
    await mini.close();
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(__dirname, "layer-check.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
