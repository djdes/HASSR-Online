/*
 * Screenshots of the timesheet (first rows) and of the «Изменить» dialog, for a
 * pixel comparison between two builds on the same data.
 *
 *   BASE=http://localhost:3000 OUT=dir node .agent/tasks/staff-dialog-lag-2026-11-23/raw/screenshot-grid.cjs
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT;
const EMAIL = process.env.EMAIL || "perf-staff-owner@example.test";
const PASSWORD = process.env.PASSWORD || "perf-pass-2026";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "ru-RU", deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.press("#password", "Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000 });
  await page.goto(`${BASE}/settings/users`, { waitUntil: "networkidle", timeout: 120000 });
  // No animations, no caret: compare the settled picture.
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}" });
  await page.locator("[data-print-landscape]").first().scrollIntoViewIfNeeded();
  await page.waitForSelector("[data-print-schedule]", { timeout: 30000 });
  await page.waitForTimeout(800);
  const table = page.locator("[data-print-schedule]");
  const box = await table.boundingBox();
  await page.evaluate((y) => window.scrollTo(0, window.scrollY + y - 80), box.y);
  await page.waitForTimeout(500);
  const box2 = await table.boundingBox();
  await page.screenshot({ path: path.join(OUT, "grid.png"), clip: { x: box2.x, y: box2.y, width: Math.min(box2.width, 1500), height: 700 } });
  // A cell's tooltip and accessible name stay the same.
  const cellInfo = await page.evaluate(() =>
    [...document.querySelectorAll("[data-workoff-cell]")].slice(0, 62).map((cell) => ({
      title: cell.getAttribute("title"),
      label: cell.getAttribute("aria-label"),
      pressed: cell.getAttribute("aria-pressed"),
    })),
  );
  fs.writeFileSync(path.join(OUT, "cells.json"), JSON.stringify(cellInfo, null, 1));
  // Print view: the marks on paper.
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(300);
  const printMarks = await page.evaluate(() =>
    [...document.querySelectorAll("[data-workoff-cell]")].slice(0, 62).map((cell) => {
      const after = getComputedStyle(cell, "::after").content;
      const span = cell.querySelector("span[aria-hidden]");
      // Old markup: the mark is a print-only span; new: ::after from data-print-mark.
      const text = span ? span.textContent : after && after !== "none" && after !== "normal" ? after.replace(/^"|"$/g, "") : "";
      return text;
    }),
  );
  fs.writeFileSync(path.join(OUT, "print-marks.json"), JSON.stringify(printMarks));
  await page.screenshot({ path: path.join(OUT, "grid-print.png"), clip: { x: box2.x, y: box2.y, width: Math.min(box2.width, 1500), height: 500 } });
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="Редактировать сотрудника"]').first().click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: "visible" });
  await page.waitForTimeout(600);
  await dialog.screenshot({ path: path.join(OUT, "dialog.png") });
  console.log(JSON.stringify({ out: OUT, cells: cellInfo.length, printMarks: printMarks.filter(Boolean).length }));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
