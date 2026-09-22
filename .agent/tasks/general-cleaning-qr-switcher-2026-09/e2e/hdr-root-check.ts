import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
const BASE = "http://localhost:3033";
const SHOTS = "D:/www/Wesetup.ru/.agent/tasks/general-cleaning-qr-switcher-2026-09/shots";
const WIDTHS = [390, 768, 900, 1024, 1180, 1280, 1440, 1920];
async function dismiss(page: Page) {
  const terms = page.getByRole("button", { name: "Принять и продолжить" });
  if (await terms.isVisible().catch(() => false)) {
    await page.locator("div.fixed.inset-0 input[type=checkbox]").first().check();
    await terms.click().catch(() => null);
    await page.waitForTimeout(800);
  }
  await page.locator('[aria-labelledby="whats-new-title"] button[aria-label="Закрыть"]').click({ timeout: 3000 }).catch(() => {});
}
async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180000 });
  await page.fill("#email", "root@haccp.local");
  await page.fill("#password", "E2eTest2026!");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90000 });
  await dismiss(page);
  const res = await ctx.request.post(`${BASE}/api/root/impersonate`, { data: { organizationId: "e2e-org-a" } });
  console.log("impersonate", res.status());
  let pass = 0;
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/journals`, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(800);
    await dismiss(page);
    const r = await page.evaluate(() => {
      const bars = Array.from(document.querySelectorAll("header")).map((h) => h.firstElementChild as HTMLElement).filter(Boolean);
      const out: Array<{ overlaps: string[][]; overflow: number }> = [];
      for (const bar of bars) {
        const boxes = Array.from(bar.children).map((el) => { const b = el.getBoundingClientRect(); return { t: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 30), l: b.left, r: b.right, w: b.width }; });
        const overlaps: string[][] = [];
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxes[i].w > 0 && boxes[j].w > 0 && boxes[i].r > boxes[j].l + 1 && boxes[j].r > boxes[i].l + 1) overlaps.push([boxes[i].t, boxes[j].t]);
        out.push({ overlaps, overflow: Math.round(bar.scrollWidth - bar.clientWidth) });
      }
      return { bars: out, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, root: document.body.innerText.includes("ROOT · Просмотр организации") };
    });
    const ok = r.bars.every((b) => b.overlaps.length === 0 && b.overflow <= 1) && r.scrollWidth <= r.clientWidth + 1;
    if (ok) pass++;
    console.log(`${ok ? "PASS" : "FAIL"} ${width}px root=${r.root} ${ok ? "" : JSON.stringify(r).slice(0, 500)}`);
    await page.screenshot({ path: path.join(SHOTS, `hdr-root-${width}.png`), clip: { x: 0, y: 0, width, height: 150 } });
  }
  console.log(`${pass}/${WIDTHS.length} PASS`);
  await browser.close();
}
void main();
