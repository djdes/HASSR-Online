// Сколько листов PDF дают памятки в этом окружении (e2e, порт 3020).
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
const base = "http://localhost:3020";
const countPages = (b) => (b.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const out = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(420000);
  await page.goto(`${base}/login`);
  await page.fill("#email", seed.manager);
  await page.fill("#password", "Verify-2026!");
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  for (const key of ["storage-times", "storage", "board-marking", "hygiene"]) {
    await page.goto(`${base}/production-control/documents/posters/${key}`, { waitUntil: "load" });
    await page.waitForSelector("[data-print-brand-frame]");
    const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
    writeFileSync(`.agent/tasks/memo-storage-a5-cut-2026-10-29/raw/${key}.pdf`, pdf);
    const line = `${key}: ${countPages(pdf)} лист(а)`;
    out.push(line); console.log(line);
  }
} finally {
  await browser.close();
  writeFileSync(".agent/tasks/memo-storage-a5-cut-2026-10-29/raw/pages-compare.txt", out.join("\n") + "\n");
}
