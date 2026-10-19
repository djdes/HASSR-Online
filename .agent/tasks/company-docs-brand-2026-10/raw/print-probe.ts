/**
 * Проба печати плаката ППК: применяется ли `print-color-adjust: exact` к
 * маркерам и полосе и что попадает на бумагу с «фоновой графикой» и без неё.
 * Стенд: wesetup_company, порт 3041.
 */
import fs from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

import { renderPdfPageToPng } from "@/lib/journal-preview/render-pages";

const BASE = "http://localhost:3041";
const OUT = path.join(process.cwd(), ".agent", "tasks", "company-docs-brand-2026-10", "raw", "ui");
const state = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), ".agent/tasks/location-tabs-2026-09/e2e/state.json"), "utf8"),
) as { password: string };

async function main() {
  const shell = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium_headless_shell-1243", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
  const browser = await chromium.launch(fs.existsSync(shell) ? { executablePath: shell } : {});
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 600_000 });
  await page.waitForTimeout(1500);
  await page.fill("#email", "loc-manager@e2e.local");
  await page.fill("#password", state.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 300_000 });

  const out: Record<string, unknown> = {};
  for (const [name, route] of [
    ["poster", "/production-control/documents/posters/hand-washing"],
    ["program", "/production-control/program"],
    ["order", "/orders/haccp-responsible"],
  ] as const) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
    await page.waitForSelector("article", { timeout: 600_000 });
    await page.waitForTimeout(2000);
    await page.emulateMedia({ media: "print" });
    out[name] = await page.evaluate(() => {
      const accents = Array.from(document.querySelectorAll<HTMLElement>("article [aria-hidden], article li > span:first-child"));
      return {
        orgHeaderVisible: Array.from(document.querySelectorAll("article img")).map((img) => getComputedStyle(img).display !== "none" && (img as HTMLElement).offsetParent !== null),
        accents: accents.slice(0, 3).map((el) => {
          const style = getComputedStyle(el);
          return { tag: el.tagName, bg: style.backgroundColor, color: style.color, adjust: style.getPropertyValue("print-color-adjust"), webkit: style.getPropertyValue("-webkit-print-color-adjust"), border: style.borderTopColor + " " + style.borderTopWidth };
        }),
      };
    });
    for (const background of [false, true]) {
      const pdf = await page.pdf({ format: "A4", printBackground: background });
      const sheet = await renderPdfPageToPng(new Uint8Array(pdf), 1, { width: 900 });
      fs.writeFileSync(path.join(OUT, `probe-${name}-bg-${background}.png`), sheet.png);
    }
    await page.emulateMedia({ media: "screen" });
  }
  fs.writeFileSync(path.join(OUT, "print-probe.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
