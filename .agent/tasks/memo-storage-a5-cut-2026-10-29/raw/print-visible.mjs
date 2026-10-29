// Что видно в режиме печати, кроме рамки памятки (e2e, порт 3020).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
const base = "http://localhost:3020";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 718, height: 1000 } });
  page.setDefaultTimeout(420000);
  await page.goto(`${base}/login`);
  await page.fill("#email", seed.manager);
  await page.fill("#password", "Verify-2026!");
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto(`${base}/production-control/documents/posters/hygiene`, { waitUntil: "load" });
  await page.waitForSelector("[data-print-brand-frame]");
  await page.emulateMedia({ media: "print" });
  const info = await page.evaluate(() => {
    const frame = document.querySelector("[data-print-brand-frame]");
    const visible = [];
    for (const el of document.body.querySelectorAll("body *")) {
      if (frame && (frame.contains(el) || el.contains(frame))) continue;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (s.display === "none" || s.visibility === "hidden" || r.height < 4 || !el.innerText?.trim()) continue;
      if ([...el.children].some((c) => c.innerText?.trim() === el.innerText?.trim())) continue;
      visible.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} top=${Math.round(r.top)} h=${Math.round(r.height)} "${el.innerText.trim().slice(0, 90).replace(/\s+/g, " ")}"`);
    }
    const r = frame.getBoundingClientRect();
    return { frame: { top: Math.round(r.top), h: Math.round(r.height) }, visible: visible.slice(0, 15) };
  });
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: ".agent/tasks/memo-storage-a5-cut-2026-10-29/raw/print-media.png", fullPage: true });
} finally {
  await browser.close();
}
