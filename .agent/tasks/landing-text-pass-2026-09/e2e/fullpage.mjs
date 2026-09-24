// Полная страница на 390px: высота, вхождения «датчик», скрин целиком.
import { chromium } from "playwright-core";
import path from "node:path";
import fs from "node:fs";

const exe = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
const outDir = "D:/www/Wesetup.ru/.agent/tasks/landing-text-pass-2026-09/shots";
const prefix = process.argv[2] || "before";
const baseUrl = process.argv[3] || "https://wesetup.ru";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(baseUrl + "/", { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => ({
  height: document.documentElement.scrollHeight,
  sensors: (document.body.innerText.toLowerCase().match(/датчик/g) || []).length,
  hasAutomationSection: document.body.innerText.includes("Температура пишется сама"),
}));
console.log(JSON.stringify({ prefix, ...info }));
await page.screenshot({ path: path.join(outDir, `${prefix}-full-390.png`), fullPage: true });
// Хиро отдельно: первый экран как есть.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(outDir, `${prefix}-hero-390.png`) });
await browser.close();
