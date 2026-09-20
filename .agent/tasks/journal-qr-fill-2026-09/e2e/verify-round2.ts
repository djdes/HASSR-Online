/* eslint-disable no-console */
// Круг 2: плакат QR на одном листе A4 (высота в print-media), свайп вниз закрывает шторку (390px).
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { whatsNewVersion } from "@/lib/whats-new-notes";

const BASE = process.env.BASE ?? "http://localhost:3020";
const ROOT = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e");
const STATE = path.resolve(process.cwd(), ".agent/tasks/names-memory-2026-09/e2e/state.json");
const results: Record<string, unknown> = {};
const errors: string[] = [];
const A4_PORTRAIT_CONTENT_PX = Math.round((297 - 24) / 25.4 * 96); // 12mm поля сверху и снизу

async function settle(page: Page, ms = 2000) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((el) => el.remove())).catch(() => null);
  await page.evaluate(() => document.querySelectorAll('[role="dialog"]').forEach((el) => { if (el.className.includes("z-[120]")) el.remove(); }));
}

async function swipeDown(page: Page, selector: string, startY: number, distance: number) {
  await page.evaluate(({ selector, startY, distance }) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) throw new Error("no dialog");
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const mk = (type: string, y: number) => {
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
      return new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [touch], targetTouches: type === "touchend" ? [] : [touch], changedTouches: [touch] });
    };
    el.dispatchEvent(mk("touchstart", rect.top + startY));
    for (let i = 1; i <= 6; i += 1) el.dispatchEvent(mk("touchmove", rect.top + startY + (distance * i) / 6));
    el.dispatchEvent(mk("touchend", rect.top + startY + distance));
  }, { selector, startY, distance });
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  const seen = `try { localStorage.setItem("wesetup.last-seen-build-sha", ${JSON.stringify(whatsNewVersion())}); } catch {}`;
  try {
    // --- плакат: высота в print media ≤ рабочей области A4
    const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 }, storageState: STATE });
    await ctx.addInitScript(seen);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(`${BASE}/settings/qr-posters?kind=journals`, { waitUntil: "load", timeout: 240_000 });
    await page.waitForSelector(".qr-poster", { timeout: 120_000 }).catch(() => null);
    await settle(page, 2500);
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(800);
    const posters = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".qr-poster")).slice(0, 4).map((el) => {
        const r = el.getBoundingClientRect();
        const qr = el.querySelector(".qr-box")?.getBoundingClientRect();
        return { h: Math.round(r.height), w: Math.round(r.width), qr: qr ? Math.round(qr.width) : null, scrollH: (el as HTMLElement).scrollHeight, title: el.querySelector(".qr-poster-title")?.textContent?.trim().slice(0, 40) };
      })
    );
    results.posterA4ContentPx = A4_PORTRAIT_CONTENT_PX;
    results.posters = posters;
    results.postersFit = posters.every((p) => p.h <= A4_PORTRAIT_CONTENT_PX && p.scrollH <= p.h + 1);
    await page.screenshot({ path: path.join(ROOT, "shots", "round2-poster-print.png"), fullPage: false });
    await page.pdf({ path: path.join(ROOT, "round2-posters.pdf"), format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } }).catch((e) => { results.pdfError = String(e).slice(0, 120); });
    await page.emulateMedia({ media: "screen" });
    await ctx.close();

    // --- свайп вниз закрывает шторку
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: STATE });
    await mctx.addInitScript(seen);
    await mctx.addInitScript("window.__name = (fn) => fn;");
    const mp = await mctx.newPage();
    mp.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await mp.goto(`${BASE}/journals/finished_product/documents/cmt6j45tj0i0c82tstt9fjbvg`, { waitUntil: "load", timeout: 240_000 });
    await settle(mp, 3000);
    await mp.getByRole("button", { name: /^Добавить изделие$/ }).first().click();
    const dialogSel = '[data-slot="dialog-content"]';
    await mp.waitForSelector(dialogSel, { state: "visible", timeout: 30_000 });
    results.handleVisible = await mp.evaluate((sel) => {
      const el = document.querySelector(sel)!;
      const handle = el.querySelector('div[aria-hidden].rounded-full');
      return handle ? getComputedStyle(handle).display !== "none" : false;
    }, dialogSel);
    // Замер полей даты/времени (Chromium: высота должна быть 44px).
    results.dateInputHeights = await mp.evaluate(() => Array.from(document.querySelectorAll('[data-slot="dialog-content"] input[type="date"], [data-slot="dialog-content"] input[type="time"]')).slice(0, 4).map((i) => Math.round(i.getBoundingClientRect().height)));
    await mp.screenshot({ path: path.join(ROOT, "shots", "round2-sheet.png") });
    // Короткий свайп (40px) — не закрывает.
    await swipeDown(mp, dialogSel, 20, 40);
    await mp.waitForTimeout(600);
    results.shortSwipeStillOpen = (await mp.locator(dialogSel).count()) > 0;
    // Свайп из зоны содержимого (ниже 72px) — не закрывает.
    await swipeDown(mp, dialogSel, 200, 200);
    await mp.waitForTimeout(600);
    results.contentSwipeStillOpen = (await mp.locator(dialogSel).count()) > 0;
    // Длинный свайп за шапку — закрывает.
    await swipeDown(mp, dialogSel, 20, 160);
    await mp.waitForTimeout(1000);
    results.longSwipeClosed = (await mp.locator(dialogSel).count()) === 0;
    await mp.screenshot({ path: path.join(ROOT, "shots", "round2-after-swipe.png") });
    await mctx.close();
  } finally {
    results.errors = errors;
    fs.writeFileSync(path.join(ROOT, "results-round2.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 1));
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
