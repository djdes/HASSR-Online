// Гипотеза: подвал памятки уходит на 2-й лист из-за пустых полей-боксов @page (#49).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
const base = "http://localhost:3020";
const countPages = (b) => (b.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(420000);
  await page.goto(`${base}/login`);
  await page.fill("#email", seed.manager);
  await page.fill("#password", "Verify-2026!");
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto(`${base}/production-control/documents/posters/hygiene`, { waitUntil: "load" });
  await page.waitForSelector("[data-print-brand-frame]");
  console.log("как есть:", countPages(await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true })));
  await page.addStyleTag({ content: "@media print { @page { @top-center { content: none; } @bottom-center { content: none; } } }" });
  console.log("без полей-боксов:", countPages(await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true })));
  const hint = await page.evaluate(() => {
    const frame = document.querySelector("[data-print-brand-frame]");
    const r = frame?.getBoundingClientRect();
    return { frameTop: r?.top, frameH: r?.height };
  });
  console.log("рамка на экране:", JSON.stringify(hint));
} finally {
  await browser.close();
}
