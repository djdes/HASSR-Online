// Проверка шапки на разных ширинах: ничего не наезжает, нет горизонтальной прокрутки.
// Запуск: BASE=http://localhost:3033 npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/hdr-check.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3033";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const WIDTHS = [390, 600, 768, 900, 1024, 1280, 1440, 1920];
const results: Array<{ width: number; ok: boolean; detail?: unknown }> = [];

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 180_000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 });
}

async function dismiss(page: Page) {
  const terms = page.getByRole("button", { name: "Принять и продолжить" });
  if (await terms.isVisible().catch(() => false)) {
    await page.locator("div.fixed.inset-0 input[type=checkbox]").first().check();
    await terms.click();
    await terms.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => null);
  }
  await page.locator('[aria-labelledby="whats-new-title"] button[aria-label="Закрыть"]').click({ timeout: 4000 }).catch(() => {});
}

async function main() {
  const state = JSON.parse(fs.readFileSync(path.join(HERE, "sw-state.json"), "utf8")) as {
    password: string;
    users: Record<string, { email: string }>;
  };
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, state.users.manager.email, state.password);
    await dismiss(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/journals`, { waitUntil: "load", timeout: 120_000 });
      await page.waitForTimeout(900);
      const report = await page.evaluate(() => {
        const header = document.querySelector("header");
        if (!header) return { error: "no header" };
        const bar = header.firstElementChild as HTMLElement | null;
        if (!bar) return { error: "no bar" };
        const boxes = Array.from(bar.children).map((el) => {
          const rect = el.getBoundingClientRect();
          return { text: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 40), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
        });
        const overlaps: Array<[string, string]> = [];
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            if (boxes[i].width > 0 && boxes[j].width > 0 && boxes[i].right > boxes[j].left + 1 && boxes[j].right > boxes[i].left + 1) {
              overlaps.push([boxes[i].text, boxes[j].text]);
            }
          }
        }
        return {
          overlaps,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          headerOverflow: Math.round(bar.scrollWidth - bar.clientWidth),
          boxes,
        };
      });
      const r = report as { overlaps?: Array<[string, string]>; scrollWidth?: number; clientWidth?: number; headerOverflow?: number; error?: string };
      const ok = !r.error && (r.overlaps?.length ?? 1) === 0 && (r.scrollWidth ?? 1) <= (r.clientWidth ?? 0) + 1 && (r.headerOverflow ?? 1) <= 1;
      results.push({ width, ok, detail: ok ? undefined : r });
      console.log(`${ok ? "PASS" : "FAIL"} ${width}px${ok ? "" : ` :: ${JSON.stringify(r).slice(0, 600)}`}`);
      await page.screenshot({ path: path.join(SHOTS, `hdr-${width}.png`), clip: { x: 0, y: 0, width, height: 90 } });
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(HERE, "hdr-check.json"), JSON.stringify(results, null, 2));
    console.log(`${results.filter((r) => r.ok).length}/${results.length} PASS`);
  }
}

void main();
